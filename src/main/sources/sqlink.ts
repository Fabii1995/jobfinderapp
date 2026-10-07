import { normalizeLocation } from '../location'
import { isHardRejectTitle, titleHasSoftwareRole } from '../scoring'
import { asString, sleep, stripHtml } from './http'
import type { ConnectorFn, RawJob } from './types'

/**
 * SQLink (sqlink.com), an Israeli tech recruiter. Connector id "sqlink" (single instance).
 *
 * Access basis (verified 2026-10-06): robots.txt is `User-agent: * / Allow: / / Disallow: /archive/` with
 * `Sitemap: https://www.sqlink.com/sitemap/`; job pages are plain server-rendered HTML; no login,
 * CAPTCHA or bot challenge is involved. The site's תקנון שימוש (terms of use) page could not be located
 * (only a privacy statement and an HR harassment-policy page are published), so no prohibition on
 * automated access was found. There is no JSON endpoint and no JSON-LD JobPosting on job pages.
 *
 * How it works (deliberately gentle):
 *   1. ONE GET of the sitemap; keep `/career/<category>/<subcategory>/<slug>/` URLs.
 *   2. Staleness: closed jobs stay online (2019 pages still render), so `lastmod` is the only
 *      freshness signal; only URLs modified within WINDOW_DAYS are considered, newest first.
 *   3. Cheap pre-filter on the decoded slug (which mirrors the title): categories hardware /
 *      אלקטרוניקה / student are skipped; senior/intern slugs (isHardRejectTitle) and slugs with no
 *      software-role keyword are never fetched.
 *   4. At most MAX_DETAIL job pages are fetched, sequentially, >= 1 s apart (ctx.delayMs === 0 in tests).
 *   5. Any 403/429/5xx or a Cloudflare/CAPTCHA challenge page aborts the whole connector by throwing.
 *      Nothing retries around a block.
 *
 * Fields: title (h3), description + requirements sections (HTML -> stripHtml), job number (externalId;
 * "מס' משרה"), url (the page), postedAt = sitemap lastmod (last modified, not first published).
 * Location: postings only name a region ("באזור השרון") or a city inside the intro sentence, so
 * country is set to IL (it is an Israeli recruiter placing Israeli roles), city is the first allowlisted
 * city found in the first 400 characters of the description (often null), and workMode is `unknown`
 * unless the text says hybrid / fully remote.
 */
const SQLINK_BASE = 'https://www.sqlink.com'
const SQLINK_SITEMAP = `${SQLINK_BASE}/sitemap/`
const WINDOW_DAYS = 90
export const MAX_DETAIL = 150
const MIN_DELAY_MS = 1000
const SKIP_CATEGORIES = new Set(['hardware', 'אלקטרוניקה', 'student'])
const BLOCK_STATUS = /HTTP (?:401|403|407|429|5\d\d)\b/
const CHALLENGE = /Just a moment\.\.\.|cf-chl-|Attention Required! \| Cloudflare|cf-browser-verification|captcha-delivery/i

interface SitemapJob {
  url: string
  category: string
  slugTitle: string
  lastmod: number
}

/** Pure: sitemap XML -> candidate job URLs (decoded category/slug), newest first, after the cheap filters. */
export function selectCandidates(xml: string, now: number = Date.now(), windowDays = WINDOW_DAYS): SitemapJob[] {
  const out: SitemapJob[] = []
  for (const m of xml.matchAll(/<url>\s*<loc>\s*([^<\s]+)\s*<\/loc>(?:\s*<lastmod>\s*([^<\s]+)\s*<\/lastmod>)?/g)) {
    let u: URL
    try {
      u = new URL(m[1])
    } catch {
      continue
    }
    if (u.protocol !== 'https:' || u.hostname !== 'www.sqlink.com') continue
    const segs = u.pathname.split('/').filter(Boolean).map((s) => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    })
    if (segs[0] !== 'career' || segs.length < 4) continue
    const category = segs[1]
    if (SKIP_CATEGORIES.has(category.toLowerCase())) continue
    const lastmod = m[2] ? Date.parse(m[2]) : NaN
    if (!Number.isFinite(lastmod) || now - lastmod > windowDays * 86_400_000) continue
    // Sitemap slugs fuse the gender suffix: "תוכניתן/ית" is "תוכניתןית" (a final-form letter followed by more letters).
    const slugTitle = segs[segs.length - 1]
      .replace(/-/g, ' ')
      .replace(/\s+\d+$/, '')
      .replace(/([ןםךףץ])(?:ית|ת|ה)(?![\p{L}\p{N}])/gu, '$1')
    if (isHardRejectTitle(slugTitle) || !titleHasSoftwareRole(slugTitle)) continue
    out.push({ url: u.href, category, slugTitle, lastmod })
  }
  return out.sort((a, b) => b.lastmod - a.lastmod)
}

interface ParsedSqlinkJob {
  title: string
  description: string
  number: string | null
}

/** Pure: one job page -> title / description / job number, or null when the page has no job article. */
export function parseJobPage(html: string): ParsedSqlinkJob | null {
  const start = html.indexOf('class="article"')
  if (start < 0) return null
  // The first article only; "more jobs" lists further down the page are not this job.
  const next = html.indexOf('class="article"', start + 10)
  const block = html.slice(start, next < 0 ? undefined : next)
  const title = stripHtml(/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(block)?.[1] ?? '')
  if (!title) return null
  // Drop the section headings ("תיאור המשרה:", "דרישות המשרה:").
  const desc = (/<section class="description">([\s\S]*?)<\/section>/.exec(block)?.[1] ?? '').replace(/<h4[\s\S]*?<\/h4>/i, '')
  const req = (/<section class="requirements">([\s\S]*?)<\/section>/.exec(block)?.[1] ?? '').replace(/^\s*<strong>[\s\S]*?<\/strong>/i, '')
  const number = /<section class="description number">[\s\S]*?(\d{3,})/.exec(block)?.[1] ?? null
  const description = [stripHtml(desc), stripHtml(req)].filter(Boolean).join('\n\n')
  return { title, description, number }
}

const HYBRID_HINT = /היברידי|\bhybrid\b|יום(?:ים)?(?: \S+)? מהבית|ימי עבודה מהבית/i
const REMOTE_HINT = /\bfully remote\b|100% remote|עבודה מרחוק מלאה|מרחוק מלא|עבודה מהבית בלבד/i

/** Pure: location fields for a posting (see the file header for what is and is not known). */
export function sqlinkLocation(description: string): ReturnType<typeof normalizeLocation> & { location: string } {
  const region = /באזור\s+([\p{L}"״' ]{2,24}?)(?=[\s,.;)\n]|$)/u.exec(description)?.[1]?.trim()
  const intro = description.slice(0, 400)
  const city = normalizeLocation({ location: intro, country: 'IL' }).city
  const workplaceType = REMOTE_HINT.test(description) ? 'remote' : HYBRID_HINT.test(description) ? 'hybrid' : null
  const location = city ?? (region ? `ישראל, ${region}` : 'ישראל')
  const loc = normalizeLocation({ location: city ?? location, country: 'IL', city, workplaceType })
  return { ...loc, location }
}

export const fetchSqlink: ConnectorFn = async (_params, ctx) => {
  const getText = ctx.http.getText
  if (!getText) throw new Error('sqlink: http.getText is not available')
  const delay = ctx.delayMs === 0 ? 0 : Math.max(ctx.delayMs ?? MIN_DELAY_MS, MIN_DELAY_MS)

  const xml = await getText(SQLINK_SITEMAP)
  if (CHALLENGE.test(xml.slice(0, 4000))) throw new Error('sqlink: blocked by a bot challenge (not bypassed)')
  const candidates = selectCandidates(xml).slice(0, MAX_DETAIL)

  const out: RawJob[] = []
  for (const c of candidates) {
    await sleep(delay)
    let html: string
    try {
      html = await getText(c.url)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (BLOCK_STATUS.test(msg)) throw new Error(`sqlink: stopped, site refused the request (${msg})`)
      continue // 404/410 (gone) or a transient network failure for this one job
    }
    if (CHALLENGE.test(html.slice(0, 6000))) throw new Error('sqlink: blocked by a bot challenge (not bypassed)')
    const job = parseJobPage(html)
    const externalId = job?.number ?? null
    const title = asString(job?.title)
    if (!job || !externalId || !title) continue
    out.push({
      source: ctx.id,
      externalId,
      title,
      company: ctx.name,
      url: c.url,
      description: job.description || null,
      ...sqlinkLocation(job.description),
      postedAt: c.lastmod
    })
  }
  return out
}
