import type { Job } from '../main/db/schema'
import type { Ats } from '../main/companies/types'
import type {
  JSearchRunResult,
  JSearchSetKeyResult,
  JSearchStatus
} from './jsearch'

export type { Job }

export const IPC = {
  list: 'jobs:list',
  refresh: 'jobs:refresh',
  visit: 'jobs:visit',
  stats: 'jobs:stats',
  open: 'jobs:open',
  companyCounts: 'jobs:companyCounts',
  companiesList: 'companies:list',
  companiesAdd: 'companies:add',
  companiesRemove: 'companies:remove',
  companiesSetEnabled: 'companies:setEnabled',
  jsearchStatus: 'jsearch:status',
  jsearchSetKey: 'jsearch:setKey',
  jsearchClearKey: 'jsearch:clearKey',
  jsearchSetSerpapiKey: 'jsearch:setSerpapiKey',
  jsearchClearSerpapiKey: 'jsearch:clearSerpapiKey',
  jsearchDeepRefresh: 'jsearch:deepRefresh',
  /** main -> renderer push: job data changed (a refresh finished, manual or scheduled). */
  changed: 'jobs:changed'
} as const

export interface ListJobsRequest {
  visited: boolean
}
type ListJobsResponse = Job[]

export interface SourceOutcome {
  source: string
  ok: boolean
  /** Jobs fetched from the source (before the MIN_SCORE filter). Present when ok. */
  count?: number
  /** Failure message. Present when !ok. */
  error?: string
  /** Company display name. */
  name?: string
  /** Fetched jobs located in Israel and not remote-only (before the score filter). Present when ok. */
  israel?: number
  /** Jobs that passed the location and score filters and were stored. Present when ok. */
  kept?: number
}

export interface RefreshResponse {
  inserted: number
  updated: number
  /** Per-source failure messages (a failing source does not fail the refresh). */
  errors: Record<string, string>
  sources: SourceOutcome[]
}

/** Persisted summary of the most recent refresh (manual or scheduled). */
export interface LastRefresh {
  at: number
  inserted: number
  updated: number
  sources: SourceOutcome[]
}

type VisitResponse = Job | null

export interface JobStats {
  newCount: number
  visitedCount: number
  /** Time of the last refresh (from the meta table); null if never refreshed. */
  lastRefreshAt: number | null
  lastRefresh: LastRefresh | null
}

export type { Ats }

/** One configured company (mirror of main/companies/types CompanyEntry). `id` == jobs.source. */
export interface Company {
  id: string
  name: string
  ats: Ats
  params: Record<string, string>
  enabled: boolean
}

export interface CompaniesListResponse {
  companies: Company[]
  /** Set when companies.json is unreadable (the list is then the seeds and edits are refused). */
  error?: string
}

interface AddCompanyRequest {
  /** A careers-page URL (max 2048 chars). */
  url: string
  /** Optional display name; defaults to one derived from the URL. */
  name?: string
}
export type AddCompanyResponse = { ok: true; company: Company } | { ok: false; error: string }
export type CompanyMutationResponse = { ok: true } | { ok: false; error: string }

export const MAX_URL_LENGTH = 2048
export const MAX_COMPANY_NAME_LENGTH = 100

export interface JobFinderApi {
  list(req: ListJobsRequest): Promise<ListJobsResponse>
  refresh(): Promise<RefreshResponse>
  visit(id: number): Promise<VisitResponse>
  stats(): Promise<JobStats>
  /** Opens the job's URL in the system browser (http/https only), then marks it visited. Rejects on failure. */
  open(id: number): Promise<Job | null>
  /** Job counts per company display name (new + visited). */
  companyCounts(): Promise<Record<string, number>>
  companies: {
    list(): Promise<CompaniesListResponse>
    add(req: AddCompanyRequest): Promise<AddCompanyResponse>
    remove(id: string): Promise<CompanyMutationResponse>
    setEnabled(id: string, enabled: boolean): Promise<CompanyMutationResponse>
  }
  jsearch: {
    /** Never includes the key. */
    status(): Promise<JSearchStatus>
    /** Validates + stores the key. Never echoes it; errors come back as { ok: false, error }. */
    setKey(key: string): Promise<JSearchSetKeyResult>
    clearKey(): Promise<{ ok: true }>
    /** SerpApi (Google Jobs) fallback key. Same contract as setKey/clearKey; never echoed. */
    setSerpapiKey(key: string): Promise<JSearchSetKeyResult>
    clearSerpapiKey(): Promise<{ ok: true }>
    /** Manual deep refresh (spends API quota). Concurrent calls share one run. */
    deepRefresh(): Promise<JSearchRunResult>
  }
  /** Subscribe to `jobs:changed` pushes. Returns an unsubscribe function. */
  onChanged(cb: () => void): () => void
}
