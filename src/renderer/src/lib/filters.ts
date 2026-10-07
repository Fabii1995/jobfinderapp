import type { Job, Role } from './types'
import { ROLES } from './types'
import { MIN_SCORE_OPTIONS, type MinScore } from './score'

/** 'all' = no work-mode filter. Rows with a null work_mode (pre-rework) count as 'unknown'. */
export type WorkModeFilter = 'all' | 'onsite' | 'hybrid' | 'unknown'
export const WORK_MODE_OPTIONS: { value: WorkModeFilter; label: string }[] = [
  { value: 'all', label: 'All work modes' },
  { value: 'onsite', label: 'On-site' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'unknown', label: 'Unknown' }
]
export const WORK_MODE_LABEL: Record<string, string> = {
  onsite: 'On-site',
  hybrid: 'Hybrid',
  remote: 'Remote',
  unknown: 'Unknown'
}

export interface Filters {
  /** Company display name, or null for all companies. */
  company: string | null
  workMode: WorkModeFilter
  roles: Role[]
  minScore: MinScore
}

export const DEFAULT_FILTERS: Filters = { company: null, workMode: 'all', roles: [], minScore: 0 }

const ROLE_SLUGS: readonly string[] = ROLES.map((r) => r.slug)

/** Validates a persisted/unknown value into safe Filters (drops unknown roles/scores). */
export function sanitizeFilters(v: unknown): Filters {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof Filters, unknown>>
  const company =
    typeof o.company === 'string' && o.company.length > 0 && o.company.length <= 200 ? o.company : null
  const workMode = WORK_MODE_OPTIONS.some((w) => w.value === o.workMode)
    ? (o.workMode as WorkModeFilter)
    : 'all'
  const roles = Array.isArray(o.roles)
    ? o.roles.filter((r): r is Role => typeof r === 'string' && ROLE_SLUGS.includes(r))
    : []
  const minScore = (MIN_SCORE_OPTIONS as readonly unknown[]).includes(o.minScore)
    ? (o.minScore as MinScore)
    : 0
  return { company, workMode, roles, minScore }
}

export function activeFilterCount(f: Filters, search: string): number {
  return (
    (f.company ? 1 : 0) +
    (f.workMode !== 'all' ? 1 : 0) +
    (f.roles.length ? 1 : 0) +
    (f.minScore > 0 ? 1 : 0) +
    (search.trim() ? 1 : 0)
  )
}

/**
 * Pure client-side filter, applied identically to both tabs. Order is preserved.
 * A persisted company that no longer exists (not in `knownCompanies`, once known) is ignored, not an error.
 * Selected roles match with OR; different filters combine with AND.
 */
export function applyFilters(
  jobs: Job[],
  f: Filters,
  search: string,
  knownCompanies?: readonly string[]
): Job[] {
  const company = f.company && (!knownCompanies || knownCompanies.includes(f.company)) ? f.company : null
  const q = search.trim().toLowerCase()
  return jobs.filter((j) => {
    if (company && (j.company ?? '') !== company) return false
    if (f.workMode !== 'all' && (j.workMode ?? 'unknown') !== f.workMode) return false
    if (f.roles.length && !(j.roles ?? []).some((r) => f.roles.includes(r))) return false
    if (f.minScore > 0 && (j.score ?? 0) < f.minScore) return false
    if (q) {
      const hay = `${j.title ?? ''}\n${j.company ?? ''}\n${j.location ?? ''}\n${j.description ?? ''}`
      if (!hay.toLowerCase().includes(q)) return false
    }
    return true
  })
}
