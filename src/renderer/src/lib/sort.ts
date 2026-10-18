import type { Job } from '../../../shared/ipc'

/** List order chosen in the toolbar. `default` keeps the server order (New: score; Visited: last visited). */
export type SortMode = 'default' | 'latest' | 'oldest'

export const DEFAULT_SORT: SortMode = 'default'

export const SORT_MODES: readonly SortMode[] = ['default', 'latest', 'oldest']

export function sortLabel(mode: SortMode, tab: 'new' | 'visited'): string {
  if (mode === 'latest') return 'Latest first'
  if (mode === 'oldest') return 'Oldest first'
  return tab === 'new' ? 'Best match' : 'Recently visited'
}

/** Effective job date: postedAt, else firstSeenAt; null when neither is a finite number. */
export function effectiveDate(j: Pick<Job, 'postedAt' | 'firstSeenAt'>): number | null {
  if (typeof j.postedAt === 'number' && Number.isFinite(j.postedAt)) return j.postedAt
  if (typeof j.firstSeenAt === 'number' && Number.isFinite(j.firstSeenAt)) return j.firstSeenAt
  return null
}

/**
 * Returns a new array ordered by effective date (newest or oldest first). Jobs with no date are
 * always last. Ties break by score desc, then id desc, so the order is total and stable.
 * `default` returns the input order unchanged.
 */
export function sortJobs(jobs: readonly Job[], mode: SortMode): Job[] {
  if (mode === 'default') return jobs as Job[]
  const dir = mode === 'latest' ? -1 : 1
  return [...jobs].sort((a, b) => {
    const da = effectiveDate(a)
    const db = effectiveDate(b)
    if (da !== db) {
      if (da == null) return 1
      if (db == null) return -1
      return dir * (da - db)
    }
    return (b.score ?? 0) - (a.score ?? 0) || b.id - a.id
  })
}

export function sanitizeSort(v: unknown): SortMode {
  return SORT_MODES.includes(v as SortMode) ? (v as SortMode) : DEFAULT_SORT
}
