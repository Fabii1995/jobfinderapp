import { fetchText } from '../sources/http'
import { isValidToken, isValidWorkdayHost } from '../sources/params'
import type { Ats } from './types'

/** Result of recognising an ATS from a careers-page URL. Pure, no network. */
export interface DetectedAts {
  ats: Ats
  /** Identifier params, ready for makeCompanyEntry (empty for comeet until resolved). */
  params: Record<string, string>
  /** True for Comeet: uid + token live in the page's `comeetvar`; call resolveComeetParams(pageUrl). */
  needsFetch?: boolean
  pageUrl?: string
}

const WORKDAY_LOCALE = /^[a-z]{2}(?:-[A-Za-z]{2})?$/ // en, en-US, fr-CA

function firstSegment(pathname: string): string | null {
  const seg = pathname.split('/').filter(Boolean)[0]
  return seg ? safeDecode(seg) : null
}

/** decodeURIComponent that returns null on malformed escapes instead of throwing. */
function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s)
  } catch {
    return null
  }
}

/**
 * Recognises an ATS board from a URL (hostname parsed with URL, never substring-matched):
 *   greenhouse: boards.greenhouse.io | job-boards.greenhouse.io | (job-)boards.eu.greenhouse.io /{token}
 *               (also boards.greenhouse.io/embed/job_board?for={token})
 *   lever: jobs.lever.co | jobs.eu.lever.co /{slug}       ashby: jobs.ashbyhq.com/{name}
 *   smartrecruiters: careers.smartrecruiters.com | jobs.smartrecruiters.com /{id}
 *   workday: {tenant}.wdN.myworkdayjobs.com/[locale/]{site}/...
 *   comeet: any URL whose path contains /careers-api or comeet.com/jobs/{name}/{uid} -> needsFetch;
 *           for a company's own careers page use resolveComeetParams after detection by the caller.
 * Returns null when nothing matches or the identifier fails validation.
 */
export function detectAtsFromUrl(url: string): DetectedAts | null {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase()

  if (/^(?:job-)?boards(?:\.eu)?\.greenhouse\.io$/.test(host)) {
    let token = firstSegment(u.pathname)
    if (token === 'embed') token = u.searchParams.get('for')
    return token && isValidToken(token) ? { ats: 'greenhouse', params: { token } } : null
  }
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
    const slug = firstSegment(u.pathname)
    if (!slug || !isValidToken(slug)) return null
    return { ats: 'lever', params: host.includes('.eu.') ? { slug, region: 'eu' } : { slug } }
  }
  if (host === 'jobs.ashbyhq.com') {
    const name = firstSegment(u.pathname)
    return name && isValidToken(name) ? { ats: 'ashby', params: { name } } : null
  }
  if (host === 'careers.smartrecruiters.com' || host === 'jobs.smartrecruiters.com') {
    const id = firstSegment(u.pathname)
    return id && isValidToken(id) ? { ats: 'smartrecruiters', params: { id } } : null
  }
  if (host.endsWith('.myworkdayjobs.com')) {
    if (!isValidWorkdayHost(host)) return null
    const segs = u.pathname.split('/').filter(Boolean)
    if (segs.length && WORKDAY_LOCALE.test(segs[0])) segs.shift()
    const site = segs[0] ? safeDecode(segs[0]) : null
    const tenant = host.split('.')[0]
    if (!site || !isValidToken(site) || !isValidToken(tenant)) return null
    return { ats: 'workday', params: { host, tenant, site } }
  }
  if (host === 'www.comeet.com' || host === 'comeet.com' || host === 'www.comeet.co' || host === 'comeet.co') {
    return { ats: 'comeet', params: {}, needsFetch: true, pageUrl: u.toString() }
  }
  return null
}

/** Extracts {uid, token} from a page's inline `comeetvar` / comeet_uid + comeet_token script data. */
export function parseComeetVar(html: string): { uid: string; token: string } | null {
  const token = /["']?comeet_token["']?\s*[:=]\s*["']([A-Za-z0-9]{8,100})["']/.exec(html)?.[1]
  const uid = /["']?comeet_uid["']?\s*[:=]\s*["']([A-Za-z0-9.]{2,40})["']/.exec(html)?.[1]
  return token && uid && isValidToken(token) && isValidToken(uid) ? { uid, token } : null
}

/**
 * Comeet needs one page fetch: loads the company's careers page and reads comeetvar.
 * `getText` is injectable for tests. Throws when the page has no Comeet data.
 */
export async function resolveComeetParams(
  pageUrl: string,
  getText: (url: string) => Promise<string> = fetchText
): Promise<{ uid: string; token: string }> {
  const u = new URL(pageUrl)
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('unsupported URL')
  const found = parseComeetVar(await getText(u.toString()))
  if (!found) throw new Error('no Comeet configuration (comeetvar) found on that page')
  return found
}
