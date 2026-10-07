import { createHash } from 'node:crypto'
import type { WorkMode } from '../sources/types'

/**
 * training-data/examples.json entry. label/reason are the USER's judgment and are never inferred by
 * tooling. The fields beyond the core set (externalId, country, city, workMode, seniority, postedAt,
 * needsText) exist so the report can reproduce what ingestion would score and filter.
 */
export type ExampleLabel = 'fit' | 'no-fit'
export type ExampleVia = 'ats-api' | 'jsonld' | 'manual'

export interface Example {
  /** `<source>:<externalId>` for ATS postings (same as the app's jobs.source + external_id), else `manual:<hash>`. */
  id: string
  url: string
  label: ExampleLabel
  /** The user's own words; omitted when they gave none. */
  reason?: string
  /** Connector id (greenhouse:wizinc, lever:cloudinary, ...) when known. */
  source?: string
  externalId?: string
  title: string
  company: string
  location: string
  /** ISO-2 ('IL') as the connectors would set it; absent when unknown. */
  country?: string | null
  city?: string | null
  workMode?: WorkMode
  /** Structured seniority tags as scoring understands them (entry-level, intern, senior...). */
  seniority?: string[]
  postedAt?: number | null
  /** Stripped plain text. */
  description: string
  /** Sentences about required experience, extracted from the description (dev aid only). */
  experienceText?: string
  /** ISO timestamp of when the data was captured. */
  fetchedAt: string
  via: ExampleVia
  /** True for a manual stub that still has no job text (the user must paste it). */
  needsText?: boolean
}

export const LABELS: readonly ExampleLabel[] = ['fit', 'no-fit']
export const VIAS: readonly ExampleVia[] = ['ats-api', 'jsonld', 'manual']
const WORK_MODES = ['onsite', 'hybrid', 'remote', 'unknown']

/** Returns a list of problems; empty means valid. Never throws. */
export function validateExample(v: unknown): string[] {
  const errs: string[] = []
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return ['entry is not an object']
  const e = v as Record<string, unknown>
  const str = (k: string, required = true): void => {
    if (e[k] === undefined && !required) return
    if (typeof e[k] !== 'string') errs.push(`"${k}" must be a string`)
  }
  for (const k of ['id', 'url', 'title', 'company', 'location', 'description', 'fetchedAt']) str(k)
  for (const k of ['reason', 'source', 'externalId', 'experienceText']) str(k, false)
  if (typeof e.id === 'string' && !e.id.trim()) errs.push('"id" must not be empty')
  if (typeof e.url === 'string' && !/^https?:\/\//i.test(e.url)) errs.push('"url" must be an http(s) URL')
  if (!LABELS.includes(e.label as ExampleLabel)) errs.push('"label" must be "fit" or "no-fit"')
  if (!VIAS.includes(e.via as ExampleVia)) errs.push('"via" must be "ats-api", "jsonld" or "manual"')
  if (e.via !== 'manual') {
    if (typeof e.title === 'string' && !e.title.trim()) errs.push('"title" must not be empty unless via is "manual"')
    if (typeof e.description === 'string' && !e.description.trim()) {
      errs.push('"description" must not be empty unless via is "manual"')
    }
  }
  if (e.workMode !== undefined && !WORK_MODES.includes(e.workMode as string)) errs.push('"workMode" is invalid')
  if (e.seniority !== undefined && !(Array.isArray(e.seniority) && e.seniority.every((s) => typeof s === 'string'))) {
    errs.push('"seniority" must be a string array')
  }
  if (e.needsText !== undefined && typeof e.needsText !== 'boolean') errs.push('"needsText" must be a boolean')
  return errs
}

export class ExamplesFileError extends Error {}

/** Parses the file text. Empty/whitespace text is `[]`. Throws ExamplesFileError (never partially accepts). */
export function parseExamplesFile(text: string): Example[] {
  if (!text.trim()) return []
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new ExamplesFileError(`examples.json is not valid JSON (${e instanceof Error ? e.message : String(e)})`)
  }
  if (!Array.isArray(data)) throw new ExamplesFileError('examples.json must be a JSON array')
  const problems: string[] = []
  data.forEach((entry, i) => {
    for (const p of validateExample(entry)) problems.push(`entry ${i}: ${p}`)
  })
  if (problems.length) throw new ExamplesFileError(`examples.json failed validation:\n  ${problems.join('\n  ')}`)
  return data as Example[]
}

const TRACKING_PARAM = /^(?:utm_.*|gh_src|lever-.*|source|src|ref|refid|trk|trackingid|fbclid|gclid|mc_.*|_ga)$/i

/** LinkedIn job id from /jobs/view/<id> (slug allowed) or ?currentJobId=. Pure string parsing; never fetched. */
function linkedinJobId(u: URL): string | null {
  return /\/jobs\/view\/(?:[^/?]*-)?(\d{6,})/.exec(u.pathname)?.[1] ?? u.searchParams.get('currentJobId') ?? null
}

/** Stable key for "same posting": lowercase host without www, no hash, no tracking params, no trailing slash. */
export function canonicalUrl(raw: string): string {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return raw.trim()
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (host.endsWith('linkedin.com')) {
    const id = linkedinJobId(u)
    if (id) return `https://linkedin.com/jobs/view/${id}`
  }
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAM.test(k))
    .sort(([a], [b]) => a.localeCompare(b))
  const qs = params.length ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : ''
  const path = u.pathname.replace(/\/+$/, '')
  return `${u.protocol}//${host}${path}${qs}`
}

export function manualId(url: string): string {
  return 'manual:' + createHash('sha1').update(canonicalUrl(url)).digest('hex').slice(0, 12)
}
