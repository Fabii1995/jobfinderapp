import { isKeepableLocation, normalizeLocation } from '../../location'
import { MIN_SCORE } from '../../ingest/constants'
import { bodyJuniorStrength, JUNIOR_TITLE_KEYWORDS, normalizeTitle, scoreJob } from '../../scoring'
import { wordMatcher } from '../../text'
import { asArray, asRecord, asString, dateToMs, stripHtml } from '../http'
import type { RawJob } from '../types'

export const JSEARCH_SOURCE = 'jsearch'
/** Postings older than this are dropped (date_posted=month leaks old rows). */
export const MAX_AGE_MS = 45 * 24 * 3600 * 1000

const JUNIOR_TITLE_RE = wordMatcher(JUNIOR_TITLE_KEYWORDS)

/** Collapses all whitespace (JSearch titles can span lines) and strips markup. */
export function cleanTitle(v: unknown): string {
  return stripHtml(typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim()
}

/** Dedupe key: lowercase, letters/digits only (Unicode), company legal suffixes removed. */
export function dedupeKey(title: string | null | undefined, company: string | null | undefined): string {
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  const co = norm(company ?? '')
    .replace(/\b(ltd|limited|inc|llc|corp|corporation|gmbh|israel|il)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `${norm(title ?? '').replace(/\s+/g, ' ')}|${co}`
}

export type MapOutcome =
  | { kind: 'job'; job: RawJob; score: number }
  | { kind: 'drop'; reason: 'invalid' | 'old' | 'location' | 'score' | 'no-junior-signal' }

/** True when the title or description carries a real junior signal (a bare baseline-30 does not count). */
export function hasJuniorSignal(title: string, description: string | null): boolean {
  if (JUNIOR_TITLE_RE.test(normalizeTitle(title))) return true
  const s = bodyJuniorStrength(description ?? '')
  return s === 'strong' || s === 'moderate'
}

/** Maps one raw JSearch row to a RawJob; all text is untrusted and goes through stripHtml. Pure. */
export function mapJSearchRow(row: unknown, nowMs: number): MapOutcome {
  const r = asRecord(row)
  if (!r) return { kind: 'drop', reason: 'invalid' }
  const id = asString(r.job_id)
  const title = cleanTitle(r.job_title)
  const link = asString(r.job_apply_link) ?? asString(r.job_google_link)
  if (!id || !title || !link || !/^https?:\/\//i.test(link)) return { kind: 'drop', reason: 'invalid' }

  const postedAt = dateToMs(r.job_posted_at_datetime_utc)
  if (postedAt !== null && nowMs - postedAt > MAX_AGE_MS) return { kind: 'drop', reason: 'old' }

  const city = asString(r.job_city)
  const locText = stripHtml(asString(r.job_location) ?? [city, asString(r.job_country)].filter(Boolean).join(', '))
  const loc = normalizeLocation({
    location: locText || null,
    country: asString(r.job_country),
    city,
    isRemote: r.job_is_remote === true ? true : null
  })
  const desc = asString(r.job_description)
  const job: RawJob = {
    source: JSEARCH_SOURCE,
    externalId: id,
    title,
    company: stripHtml(asString(r.employer_name) ?? '').replace(/\s+/g, ' ') || 'Unknown',
    url: link,
    description: desc ? stripHtml(desc) : null,
    location: locText || null,
    country: loc.country,
    city: loc.city,
    workMode: loc.workMode,
    postedAt
  }
  return finalizeJob(job)
}

/** Shared gate for every aggregator row: Israel on-site/hybrid, score >= MIN_SCORE, real junior signal. */
export function finalizeJob(job: RawJob): MapOutcome {
  if (!isKeepableLocation(job)) return { kind: 'drop', reason: 'location' }
  const score = scoreJob(job)
  if (score < MIN_SCORE) return { kind: 'drop', reason: 'score' }
  if (!hasJuniorSignal(job.title, job.description)) return { kind: 'drop', reason: 'no-junior-signal' }
  return { kind: 'job', job, score }
}

// ---------------------------------------------------------------------------------------------------------
// SerpApi (Google Jobs engine). Response field names below (jobs_results[].title / company_name / location /
// description / job_id / apply_options[].link / related_links / detected_extensions.posted_at|work_from_home)
// are ASSUMED from SerpApi documentation knowledge and are UNVERIFIED against the live API.
// ---------------------------------------------------------------------------------------------------------

export const SERPAPI_SOURCE = 'serpapi'

const UNIT_MS: Record<string, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
  year: 365 * 86_400_000
}

/**
 * Parses Google Jobs relative dates ("3 days ago", "an hour ago", "1 month ago", "30+ days ago", "Just posted",
 * "yesterday") into an age in ms. Returns null when unparseable (caller treats that as fresh/unknown). Pure.
 */
export function parseRelativeAgeMs(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const t = v.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!t) return null
  if (/^(just posted|just now|today|now)$/.test(t)) return 0
  if (t === 'yesterday') return UNIT_MS.day
  const m = /^(?:(\d{1,4})\+?|an?|one)\s+(second|minute|hour|day|week|month|year)s?(?:\s+ago)?$/.exec(t)
  if (!m) return null
  const n = m[1] ? Number(m[1]) : 1
  return Number.isFinite(n) ? n * UNIT_MS[m[2]] : null
}

/** Stable FNV-1a hash (hex) for the job-id fallback. */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Cache id: SerpApi job_id, else a hash of title+company+location. Null when the row has no title. */
export function serpapiJobId(row: unknown): string | null {
  const r = asRecord(row)
  if (!r) return null
  const id = asString(r.job_id)
  if (id) return id
  const title = cleanTitle(r.title)
  if (!title) return null
  const co = asString(r.company_name) ?? ''
  const loc = asString(r.location) ?? ''
  return `h:${hash(`${title.toLowerCase()}|${co.toLowerCase()}|${loc.toLowerCase()}`)}`
}

/** First apply link (http/https only), else a related link. */
function serpapiLink(r: Record<string, unknown>): string | null {
  const cands: unknown[] = [
    ...asArray(r.apply_options).map((o) => asRecord(o)?.link),
    ...asArray(r.related_links).map((o) => asRecord(o)?.link)
  ]
  for (const c of cands) {
    const s = asString(c)
    if (s && /^https?:\/\//i.test(s)) return s
  }
  return null
}

/** Maps one raw SerpApi Google Jobs row to a RawJob. Untrusted text goes through stripHtml. Pure. */
export function mapSerpapiRow(row: unknown, nowMs: number): MapOutcome {
  const r = asRecord(row)
  if (!r) return { kind: 'drop', reason: 'invalid' }
  const id = serpapiJobId(r)
  const title = cleanTitle(r.title)
  const link = serpapiLink(r)
  if (!id || !title || !link) return { kind: 'drop', reason: 'invalid' }

  const ext = asRecord(r.detected_extensions)
  const age = parseRelativeAgeMs(ext?.posted_at)
  if (age !== null && age > MAX_AGE_MS) return { kind: 'drop', reason: 'old' }
  const postedAt = age === null ? null : nowMs - age

  const locText = stripHtml(asString(r.location) ?? '').replace(/\s+/g, ' ').trim()
  const loc = normalizeLocation({
    location: locText || null,
    country: null,
    city: null,
    isRemote: ext?.work_from_home === true ? true : null
  })
  const desc = asString(r.description)
  return finalizeJob({
    source: SERPAPI_SOURCE,
    externalId: id,
    title,
    company: stripHtml(asString(r.company_name) ?? '').replace(/\s+/g, ' ').trim() || 'Unknown',
    url: link,
    description: desc ? stripHtml(desc) : null,
    location: locText || null,
    country: loc.country,
    city: loc.city,
    workMode: loc.workMode,
    postedAt
  })
}
