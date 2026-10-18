import type { Job } from '../../../shared/ipc'

/**
 * List order chosen in the toolbar. `default` keeps the server order (New: score; Visited: last
 * visited). `added-*` orders by when the app first saw the job (firstSeenAt); `posted-*` by the
 * posting date (postedAt, else firstSeenAt).
 */
export type SortMode = 'default' | 'added-desc' | 'added-asc' | 'posted-desc' | 'posted-asc'

export const DEFAULT_SORT: SortMode = 'default'

export const SORT_MODES: readonly SortMode[] = ['default', 'added-desc', 'added-asc', 'posted-desc', 'posted-asc']

export function sortLabel(mode: SortMode, tab: 'new' | 'visited'): string {
  if (mode === 'added-desc') return 'Recently added'
  if (mode === 'added-asc') return 'Oldest added'
  if (mode === 'posted-desc') return 'Newest posted'
  if (mode === 'posted-asc') return 'Oldest posted'
  return tab === 'new' ? 'Best match' : 'Recently visited'
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Posting date: postedAt, else firstSeenAt; null when neither is a finite number. */
export function effectiveDate(j: Pick<Job, 'postedAt' | 'firstSeenAt'>): number | null {
  return finite(j.postedAt) ?? finite(j.firstSeenAt)
}

/** Compare two nullable numbers in `dir` (1 asc, -1 desc); null always sorts last. */
function cmp(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === b) return 0
  if (a == null) return 1
  if (b == null) return -1
  return dir * (a - b)
}

/**
 * Returns a new array in the chosen order. Jobs missing a value for a key go last in either
 * direction. added-*: firstSeenAt, then postedAt (same direction; a big first refresh stamps many
 * jobs with near-identical firstSeenAt), then score desc, then id desc. posted-*: effective posting
 * date, then score desc, then id desc. `default` returns the input order unchanged.
 */
export function sortJobs(jobs: readonly Job[], mode: SortMode): Job[] {
  if (mode === 'default') return jobs as Job[]
  const dir: 1 | -1 = mode.endsWith('-asc') ? 1 : -1
  const added = mode.startsWith('added')
  return [...jobs].sort((a, b) => {
    const c = added
      ? cmp(finite(a.firstSeenAt), finite(b.firstSeenAt), dir) || cmp(finite(a.postedAt), finite(b.postedAt), dir)
      : cmp(effectiveDate(a), effectiveDate(b), dir)
    return c || (b.score ?? 0) - (a.score ?? 0) || b.id - a.id
  })
}

export function sanitizeSort(v: unknown): SortMode {
  return SORT_MODES.includes(v as SortMode) ? (v as SortMode) : DEFAULT_SORT
}
