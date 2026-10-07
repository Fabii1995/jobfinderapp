export type WorkMode = 'onsite' | 'hybrid' | 'remote' | 'unknown'

/**
 * Connector id, stored in `jobs.source`. Scheme: `<ats>:<identifier>` derived from the ATS and
 * the company's identifier (never the display name), lowercased:
 *   greenhouse:wizinc  lever:cloudinary  ashby:<name>  smartrecruiters:armis
 *   comeet:c5.00d (the Comeet company uid)  workday:nvidia (the tenant)  amazon (single instance)
 * Unique together with `externalId` (the ATS's own posting id; Workday uses `externalPath`).
 */
export type JobSource = string

/** Normalized listing shape every source client returns. Score is computed separately. */
export interface RawJob {
  source: JobSource
  externalId: string
  title: string
  /** Company display name from the config entry (stable, so it works as a filter value). */
  company: string
  url: string
  /** Plain text. */
  description: string | null
  /** Free-text location as shown by the source (may list several places). */
  location: string | null
  /** 'IL' when any listed location is in Israel; otherwise the structured ISO 3166-1 alpha-2 country if the source gave one, else null. */
  country: string | null
  city: string | null
  workMode: WorkMode
  /** Epoch milliseconds. */
  postedAt: number | null
  /**
   * Structured seniority tags when the source provides them. Lowercase tokens understood by
   * scoring: 'entry-level' (e.g. Workday "New College Graduate", SmartRecruiters entry_level),
   * 'intern' (Amazon is_intern, SmartRecruiters internship), 'senior', 'mid-level', ...
   * Used by scoring; never persisted.
   */
  seniority?: string[]
}

/** Minimal HTTP surface connectors use; injectable so tests never touch the network. */
export interface Http {
  getJson(url: string): Promise<unknown>
  postJson(url: string, body: unknown): Promise<unknown>
  /** GET as text (HTML/XML). Optional so JSON-only mocks stay valid; connectors that need it throw when absent. */
  getText?(url: string): Promise<string>
}

export interface ConnectorContext {
  /** Connector id == jobs.source. */
  id: string
  /** Company display name. */
  name: string
  http: Http
  /** Pause between sequential requests to the same host (ms). Tests set 0. */
  delayMs?: number
}

export type ConnectorFn = (params: Record<string, string>, ctx: ConnectorContext) => Promise<RawJob[]>
