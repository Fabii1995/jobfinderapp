import { detectAtsFromUrl } from '../companies/detect'
import { isValidToken } from '../sources/params'

/** A single posting recognised from its public URL. Pure; no network. */
export type PostingRef =
  | { ats: 'greenhouse'; token: string; id: string }
  | { ats: 'lever'; slug: string; region?: 'eu'; id: string }
  | { ats: 'ashby'; name: string; id: string }
  | { ats: 'smartrecruiters'; company: string; id: string }
  | { ats: 'workday'; host: string; tenant: string; site: string; externalPath: string }
  | { ats: 'amazon'; id: string }
  | { ats: 'comeet'; pageUrl: string; positionUid: string }
  | { ats: 'sqlink'; url: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COMEET_UID = /^[0-9A-Fa-f]{2}\.[0-9A-Fa-f]{3}$/

function segments(u: URL): string[] {
  return u.pathname
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    })
}

/**
 * Recognises the job posting (not just the board) behind a URL on a supported ATS:
 *   boards.greenhouse.io/<token>/jobs/<id> (also job-boards., eu), jobs.lever.co/<slug>/<uuid>,
 *   jobs.ashbyhq.com/<name>/<uuid>, jobs.smartrecruiters.com/<Company>/<id>-<slug>,
 *   <tenant>.wdN.myworkdayjobs.com/[locale/]<site>/job/..., amazon.jobs/<locale>/jobs/<id>/<slug>,
 *   comeet.com/jobs/<name>/<companyUid>/<slug>/<positionUid>, sqlink.com/career/... .
 * Returns null for anything else (the caller falls back to the JSON-LD path).
 */
export function parsePostingUrl(raw: string): PostingRef | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase()
  const segs = segments(u)

  if (host === 'amazon.jobs' || host === 'www.amazon.jobs') {
    const i = segs.indexOf('jobs')
    const id = i >= 0 ? segs[i + 1] : undefined
    return id && /^\d{4,}$/.test(id) ? { ats: 'amazon', id } : null
  }
  if (host === 'sqlink.com' || host === 'www.sqlink.com') {
    return segs[0] === 'career' && segs.length >= 3 ? { ats: 'sqlink', url: u.toString() } : null
  }

  const det = detectAtsFromUrl(raw)
  if (!det) return null
  switch (det.ats) {
    case 'greenhouse': {
      // /<token>/jobs/<id>; the embed form carries ?gh_jid=<id>.
      const id = segs[1] === 'jobs' ? segs[2] : (u.searchParams.get('gh_jid') ?? undefined)
      return id && /^\d+$/.test(id) ? { ats: 'greenhouse', token: det.params.token, id } : null
    }
    case 'lever': {
      const id = segs[1]
      return id && UUID.test(id)
        ? { ats: 'lever', slug: det.params.slug, ...(det.params.region === 'eu' ? { region: 'eu' as const } : {}), id }
        : null
    }
    case 'ashby': {
      const id = segs[1]
      return id && UUID.test(id) ? { ats: 'ashby', name: det.params.name, id } : null
    }
    case 'smartrecruiters': {
      const id = /^(\d{6,})/.exec(segs[1] ?? '')?.[1]
      return id ? { ats: 'smartrecruiters', company: det.params.id, id } : null
    }
    case 'workday': {
      const i = segs.indexOf('job')
      if (i < 0 || i === segs.length - 1) return null
      const parts = segs.slice(i).filter((s, j, a) => !(j === a.length - 1 && /^apply$/i.test(s)))
      const externalPath = '/' + parts.map((s) => encodeURIComponent(s)).join('/')
      return { ats: 'workday', host: det.params.host, tenant: det.params.tenant, site: det.params.site, externalPath }
    }
    case 'comeet': {
      // The position uid is the LAST uid-shaped segment (the company uid comes earlier).
      const uids = segs.filter((s) => COMEET_UID.test(s))
      const positionUid = uids.length >= 2 ? uids[uids.length - 1] : null
      return positionUid ? { ats: 'comeet', pageUrl: u.toString(), positionUid: positionUid.toUpperCase() } : null
    }
    default:
      return null
  }
}

/** Defensive: identifiers from a PostingRef end up in request URLs. */
export function refIsSafe(ref: PostingRef): boolean {
  switch (ref.ats) {
    case 'greenhouse':
      return isValidToken(ref.token) && /^\d+$/.test(ref.id)
    case 'lever':
      return isValidToken(ref.slug) && UUID.test(ref.id)
    case 'ashby':
      return isValidToken(ref.name) && UUID.test(ref.id)
    case 'smartrecruiters':
      return isValidToken(ref.company) && /^\d+$/.test(ref.id)
    case 'amazon':
      return /^\d+$/.test(ref.id)
    default:
      return true
  }
}
