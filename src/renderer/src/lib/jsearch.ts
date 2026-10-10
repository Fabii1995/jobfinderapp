import type { DeepSearchProvider, Job, JSearchDropped, JSearchRunSummary } from './types'

export const JSEARCH_SOURCE = 'jsearch'
export const SERPAPI_SOURCE = 'serpapi'

export const isJSearchJob = (job: Pick<Job, 'source'>): boolean =>
  typeof job.source === 'string' && job.source.startsWith(JSEARCH_SOURCE)

export const isSerpapiJob = (job: Pick<Job, 'source'>): boolean =>
  typeof job.source === 'string' && job.source.startsWith(SERPAPI_SOURCE)

/** Job found through a Deep search provider (JSearch or SerpApi) rather than a company ATS. */
export const isDeepSearchJob = (job: Pick<Job, 'source'>): boolean =>
  isJSearchJob(job) || isSerpapiJob(job)

export const providerName = (p: 'jsearch' | 'serpapi'): string => (p === 'serpapi' ? 'SerpApi' : 'JSearch')

/** Display only: true when the job's URL host is linkedin.com. The app never fetches it. */
export function isLinkedInUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const h = new URL(url).hostname.toLowerCase()
    return h === 'linkedin.com' || h.endsWith('.linkedin.com')
  } catch {
    return false
  }
}

export const isLinkedInJob = (job: Pick<Job, 'source' | 'url'>): boolean =>
  isDeepSearchJob(job) && isLinkedInUrl(job.url)

/** First day of the month after `month` ('YYYY-MM'), as epoch ms (UTC), or null if unparseable. */
export function nextMonthStart(month: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]), 1)
}

export const formatUtcDate = (ts: number): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(ts)

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : null

const DROP_LABELS: ReadonlyArray<readonly [keyof JSearchDropped, string]> = [
  ['location', 'location'],
  ['old', 'old'],
  ['noJuniorSignal', 'no junior signal'],
  ['scoreTooLow', 'score too low'],
  ['duplicate', 'duplicate'],
  ['invalid', 'invalid']
]

export interface LastRunLines {
  /** Text after "Last run {when}": " via X: N found, M requests." (via omitted when unknown). */
  headerTail: string
  /** Funnel line 2, or null when there is nothing to show (and always null for old summaries). */
  filtering: string | null
  /** Funnel line 3 (new summaries) or the merged legacy line (old summaries). */
  kept: string
}

/**
 * Pure formatter for the "Last run" block (spec 10.6). `fallbackProvider` is this session's provider,
 * used when the summary predates the `provider` field. Never prints undefined/NaN or an unrecorded 0.
 */
export function formatLastRun(
  s: JSearchRunSummary,
  fallbackProvider?: DeepSearchProvider | null
): LastRunLines {
  const provider = s.provider ?? fallbackProvider ?? null
  const via = provider ? ` via ${providerName(provider)}` : ''
  const headerTail = `${via}: ${num(s.fetched) ?? 0} found, ${num(s.requests) ?? 0} requests.`

  const kept = num(s.kept) ?? 0
  const inserted = num(s.inserted) ?? 0
  const updated = num(s.updated) ?? 0
  const seen = num(s.seenSkipped)
  const dropped = s.dropped && typeof s.dropped === 'object' ? s.dropped : null

  if (seen === null && !dropped) {
    const dup = num(s.skippedDuplicates)
    const parts = [`${kept} kept`, `${inserted} new`, `${updated} updated`]
    if (dup !== null) parts.push(`${dup} duplicates skipped`)
    return { headerTail, filtering: null, kept: `${parts.join(', ')}.` }
  }

  const sentences: string[] = []
  if (seen !== null && seen > 0) sentences.push(`Skipped ${seen} already seen.`)
  if (dropped) {
    const items = DROP_LABELS.flatMap(([key, label]) => {
      const n = num(dropped[key])
      return n !== null && n > 0 ? [`${n} ${label}`] : []
    })
    if (items.length > 0) sentences.push(`Dropped: ${items.join(', ')}.`)
  }
  return {
    headerTail,
    filtering: sentences.length > 0 ? sentences.join(' ') : null,
    kept: `Kept ${kept}: ${inserted} new, ${updated} updated.`
  }
}
