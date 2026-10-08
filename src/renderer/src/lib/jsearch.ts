import type { Job } from './types'

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
