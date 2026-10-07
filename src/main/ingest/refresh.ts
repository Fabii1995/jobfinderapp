import { seedCompanies } from '../companies/seeds'
import { getCompaniesConfigDir, loadCompanies } from '../companies/store'
import type { CompanyEntry } from '../companies/types'
import type { Db } from '../db'
import { upsertJobs, type ScoredJob } from '../jobs/upsert'
import { isKeepableLocation } from '../location'
import { classifyRoles } from '../roles'
import { scoreJob } from '../scoring'
import { fetchCompany } from '../sources'
import { mapLimit } from '../sources/http'
import type { RawJob } from '../sources/types'
import type { SourceOutcome } from '../../shared/ipc'

/**
 * Jobs scoring below this are dropped before storage. 30 is reached by:
 *   - one strong target-role title (QA/backend/python/AI-solutions/FDE) with no seniority penalty,
 *   - a general software title plus any junior signal, or
 *   - a general software title whose posting states no experience requirement at all
 *     (the no-experience baseline, exactly 30).
 * Below it: bare general titles with a stated non-junior requirement (20), role-less junior
 * postings (capped at NO_ROLE_TITLE_CAP = 25), intern/student titles (capped at 20) and senior
 * titles (0).
 */
export const MIN_SCORE = 30

export interface RefreshResult {
  inserted: number
  updated: number
  /** Per-company failure messages keyed by connector id; a failing company never fails the refresh. */
  errors: Record<string, string>
  /** One outcome per enabled company, in config order. */
  sources: SourceOutcome[]
}

export interface RefreshOptions {
  /** Explicit company list (tests / callers); wins over configDir. */
  companies?: CompanyEntry[]
  /** Directory holding companies.json (Electron userData). Defaults to setCompaniesConfigDir(), else the seeds. */
  configDir?: string
  /** Injectable fetcher per company (tests). */
  fetchCompany?: (entry: CompanyEntry) => Promise<RawJob[]>
  /** Companies fetched concurrently (default 4). */
  concurrency?: number
}

const DEFAULT_CONCURRENCY = 4

function resolveCompanies(opts: RefreshOptions): { list: CompanyEntry[]; configError?: string } {
  if (opts.companies) return { list: opts.companies.filter((c) => c.enabled) }
  const dir = opts.configDir ?? getCompaniesConfigDir()
  if (!dir) return { list: seedCompanies().filter((c) => c.enabled) }
  const { companies, error } = loadCompanies(dir)
  return { list: companies.filter((c) => c.enabled), configError: error }
}

let inFlight: Promise<RefreshResult> | null = null

async function run(db: Db, opts: RefreshOptions): Promise<RefreshResult> {
  const { list, configError } = resolveCompanies(opts)
  const fetcher = opts.fetchCompany ?? ((e: CompanyEntry) => fetchCompany(e))
  const errors: Record<string, string> = {}
  if (configError) errors['companies.json'] = configError
  const sources: SourceOutcome[] = []
  const scored: ScoredJob[] = []
  // One company's failure (including a throwing normalizer) never stops the others.
  const results = await mapLimit(list, opts.concurrency ?? DEFAULT_CONCURRENCY, async (entry) => {
    try {
      return { entry, jobs: await fetcher(entry), error: undefined as string | undefined }
    } catch (e) {
      return { entry, jobs: undefined, error: e instanceof Error ? e.message : String(e) }
    }
  })
  for (const r of results) {
    if (!r.jobs) {
      const error = r.error ?? 'unknown error'
      errors[r.entry.id] = error
      sources.push({ source: r.entry.id, ok: false, error, name: r.entry.name })
      continue
    }
    let israel = 0
    let kept = 0
    for (const job of r.jobs) {
      if (!isKeepableLocation(job)) continue // hard filter: Israel, on-site/hybrid/unknown
      israel++
      const score = scoreJob(job)
      if (score >= MIN_SCORE) {
        scored.push({ ...job, score, roles: classifyRoles(job) })
        kept++
      }
    }
    sources.push({ source: r.entry.id, ok: true, count: r.jobs.length, name: r.entry.name, israel, kept })
  }
  // upsertJobs is the only DB write: its update branch cannot touch visitedAt (RULES.md).
  const { inserted, updated } = upsertJobs(db, scored)
  return { inserted, updated, errors, sources }
}

/** Fetch all enabled companies, filter to Israel/non-remote, score, filter by MIN_SCORE, upsert. Overlapping calls share one run. */
export function refreshJobs(db: Db, opts: RefreshOptions = {}): Promise<RefreshResult> {
  if (inFlight) return inFlight
  inFlight = run(db, opts).finally(() => {
    inFlight = null
  })
  return inFlight
}
