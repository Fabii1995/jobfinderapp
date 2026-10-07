import { describe, expect, it } from 'vitest'
import { makeCompanyEntry } from '../companies/validate'
import { scoreJob } from '../scoring'
import { CONNECTORS, fetchCompany } from './index'
import { fetchSqlink, parseJobPage, selectCandidates, sqlinkLocation, MAX_DETAIL } from './sqlink'
import type { ConnectorContext, Http } from './types'

const NOW = Date.parse('2026-10-06T12:00:00Z')
const DAY = 86_400_000
const iso = (daysAgo: number): string => new Date(NOW - daysAgo * DAY).toISOString()

const url = (cat: string, sub: string, slug: string): string => `https://www.sqlink.com/career/${cat}/${sub}/${slug}/`
const sitemap = (rows: Array<[string, string]>): string =>
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows
    .map(([u, lm]) => `<url><loc>${u}</loc><lastmod>${lm}</lastmod><priority>0.5</priority></url>`)
    .join('')}</urlset>`

const page = (title: string, desc: string, req: string, number: string): string => `<html><body>
<div class="positionItem"><div class="panel job"><div class="article" id="id-1">
<a href="x"><h3 >${title}</h3></a>
<div class="positionArticle">
<section class="description"><h4><strong>תיאור המשרה:</strong></h4><p class=&#39;ltr&#39;>${desc}</p></section>
<section class="requirements"><strong>דרישות המשרה:</strong><p><p>${req}</p></p></section>
<section class="description number"><strong>מס&#39; משרה:</strong> ${number}</section>
</div></div></div></div>
<div class="article" id="id-2"><h3>Other job in the sidebar</h3></div>
</body></html>`

describe('selectCandidates (sitemap pre-filter)', () => {
  const rows: Array<[string, string]> = [
    [url('פיתוח-תוכנה-webmobile', 'go', 'מפתחת-go-לחברה'), iso(5)],
    [url('פיתוח-תוכנה-webmobile', 'go', 'senior-backend-developer'), iso(5)], // senior slug
    [url('פיתוח-תוכנה-webmobile', 'go', 'ארכיטקטית-תוכנה'), iso(5)], // senior (Hebrew feminine)
    [url('db', 'qa', 'דרושה-בודקת-תוכנה'), iso(3)],
    [url('פיתוח-תוכנה-webmobile', 'go', 'חברת-הייטק-באזור-השרון-מגייסת-תוכניתןית-go'), iso(4)], // fused gender suffix
    [url('hardware', 'x', 'firmware-engineer'), iso(2)], // skipped category
    [url('אלקטרוניקה', 'x', 'מפתח-firmware'), iso(2)], // skipped category
    [url('student', 'x', 'python-developer-student'), iso(2)], // skipped category
    [url('dba', 'pm', 'מנהלת-פרויקטים'), iso(2)], // no software role keyword
    [url('devops', 'devops', 'devops-engineer'), iso(400)], // stale lastmod (2019-style pages still render)
    [url('devops', 'devops', 'devops-engineer-1'), iso(1)],
    ['https://evil.example.com/career/a/b/python-developer/', iso(1)], // wrong host
    ['https://www.sqlink.com/blog/a/b/python-developer/', iso(1)] // not /career/
  ]
  it('keeps only fresh, non-senior, software-role candidates, newest first', () => {
    const c = selectCandidates(sitemap(rows), NOW)
    expect(c.map((x) => x.slugTitle)).toEqual([
      'devops engineer',
      'דרושה בודקת תוכנה',
      'חברת הייטק באזור השרון מגייסת תוכניתן go',
      'מפתחת go לחברה'
    ])
    expect(c[0].url.startsWith('https://www.sqlink.com/career/devops/devops/devops-engineer-1')).toBe(true)
    expect([...c[0].url].every((ch) => ch.charCodeAt(0) < 128)).toBe(true) // percent-encoded, safe to fetch/open
  })
})

describe('parseJobPage', () => {
  it('reads the first article only: title, description + requirements, job number', () => {
    const j = parseJobPage(page('מפתח/ת Python', 'חברת הייטק &amp; סטארטאפ ברמת גן מגייסת', '- שנה ניסיון<br />- Django', '154695'))
    expect(j).toEqual({
      title: 'מפתח/ת Python',
      description: 'חברת הייטק & סטארטאפ ברמת גן מגייסת\n\n- שנה ניסיון\n- Django',
      number: '154695'
    })
  })
  it('returns null for a page without a job article', () => {
    expect(parseJobPage('<html><body>404</body></html>')).toBeNull()
  })
})

describe('sqlinkLocation', () => {
  it('country IL; city from the intro; region fallback; hybrid hint', () => {
    expect(sqlinkLocation('ארגון ציבורי ברמת גן מגייס מפתח')).toMatchObject({ country: 'IL', city: 'Ramat Gan', workMode: 'unknown' })
    const r = sqlinkLocation('חברת הייטק באזור השרון מגייסת. עבודה היברידית, יומיים מהבית')
    expect(r).toMatchObject({ country: 'IL', city: null, location: 'ישראל, השרון' })
    expect(sqlinkLocation('סטארטאפ בתל אביב. עבודה היברידי').workMode).toBe('hybrid')
    expect(sqlinkLocation('משרה 100% remote').workMode).toBe('remote')
  })
})

describe('fetchSqlink (mocked HTTP, never the network)', () => {
  const sm = sitemap([
    [url('פיתוח-תוכנה-webmobile', 'go', 'מפתחת-go-לחברה'), iso(3)],
    [url('db', 'qa', 'דרושה-בודקת-תוכנה'), iso(2)],
    [url('devops', 'devops', 'devops-engineer'), iso(1)]
  ])
  const pages: Record<string, string> = {
    'מפתחת-go-לחברה': page('מפתח/ת Go', 'חברה בתל אביב מגייסת', '- ללא ניסיון קודם', '1001'),
    'דרושה-בודקת-תוכנה': page('בודק/ת תוכנה', 'ארגון באזור המרכז', '- 3 שנים ניסיון בבדיקות', '1002')
  }
  const mkHttp = (calls: string[], overrides: Record<string, () => never> = {}): Http => ({
    getJson: async () => {
      throw new Error('no json')
    },
    postJson: async () => {
      throw new Error('no json')
    },
    getText: async (u: string) => {
      calls.push(u)
      if (u === 'https://www.sqlink.com/sitemap/') return sm
      const key = Object.keys(overrides).find((k) => decodeURIComponent(u).includes(k))
      if (key) overrides[key]()
      const slug = Object.keys(pages).find((k) => decodeURIComponent(u).includes(k))
      if (slug) return pages[slug]
      throw new Error(`HTTP 404 Not Found for ${u}`)
    }
  })
  const ctx = (http: Http): ConnectorContext => ({ id: 'sqlink', name: 'SQLink', http, delayMs: 0 })

  it('normalizes jobs; a 404 on one page is skipped; scoring sees Hebrew titles', async () => {
    const calls: string[] = []
    const jobs = await fetchSqlink({}, ctx(mkHttp(calls)))
    expect(jobs.map((j) => j.externalId).sort()).toEqual(['1001', '1002'])
    const go = jobs.find((j) => j.externalId === '1001')!
    expect(go).toMatchObject({
      source: 'sqlink',
      company: 'SQLink',
      title: 'מפתח/ת Go',
      country: 'IL',
      city: 'Tel Aviv',
      postedAt: Date.parse(iso(3))
    })
    expect(go.url.startsWith('https://www.sqlink.com/career/')).toBe(true)
    expect(scoreJob(go)).toBeGreaterThanOrEqual(50) // "ללא ניסיון" + software role
    const qa = jobs.find((j) => j.externalId === '1002')!
    expect(qa.country).toBe('IL')
    expect(scoreJob(qa)).toBeLessThan(scoreJob(go)) // 3 שנים ניסיון penalty
    expect(calls.length).toBe(1 + 3) // sitemap + 3 candidates
  })

  it('throws (never retries around it) on 403 / 429 / 503', async () => {
    for (const code of ['403 Forbidden', '429 Too Many Requests', '503 Service Unavailable']) {
      const calls: string[] = []
      const http = mkHttp(calls, {
        'מפתחת-go': () => {
          throw new Error(`HTTP ${code} for https://www.sqlink.com/x`)
        }
      })
      await expect(fetchSqlink({}, ctx(http))).rejects.toThrow(/refused the request/)
      expect(calls.filter((u) => decodeURIComponent(u).includes('מפתחת-go')).length).toBe(1)
    }
  })

  it('throws on a Cloudflare / bot challenge page', async () => {
    const http: Http = {
      getJson: async () => ({}),
      postJson: async () => ({}),
      getText: async (u) => (u.endsWith('/sitemap/') ? sm : '<html><title>Just a moment...</title><div id="cf-chl-widget"></div></html>')
    }
    await expect(fetchSqlink({}, ctx(http))).rejects.toThrow(/bot challenge/)
  })

  it('fails clearly when the Http has no getText; detail fetches are capped', async () => {
    await expect(
      fetchSqlink({}, { id: 'sqlink', name: 'SQLink', delayMs: 0, http: { getJson: async () => ({}), postJson: async () => ({}) } })
    ).rejects.toThrow(/getText/)
    const many = sitemap(Array.from({ length: MAX_DETAIL + 40 }, (_, i): [string, string] => [url('devops', 'devops', `devops-engineer-${i}x`), iso(1)]))
    const calls: string[] = []
    const http: Http = {
      getJson: async () => ({}),
      postJson: async () => ({}),
      getText: async (u) => {
        calls.push(u)
        return u.endsWith('/sitemap/') ? many : '<html></html>'
      }
    }
    await fetchSqlink({}, ctx(http))
    expect(calls.length).toBe(1 + MAX_DETAIL)
  })

  it('is registered: entry id "sqlink", connector present, fetchCompany routes to it', async () => {
    const e = makeCompanyEntry({ name: 'SQLink', ats: 'sqlink', params: {} })
    expect(e.id).toBe('sqlink')
    expect(CONNECTORS.sqlink).toBe(fetchSqlink)
    const calls: string[] = []
    const jobs = await fetchCompany(e, mkHttp(calls), 0)
    expect(jobs.length).toBe(2)
  })
})
