/** Plain type definitions for the JSearch (OpenWebNinja) service. No Electron or Node imports: safe for src/shared. */

export interface JSearchRunSummary {
  fetched: number
  kept: number
  inserted: number
  updated: number
  /** Legacy: seenSkipped + dropped.duplicate. */
  skippedDuplicates: number
  requests: number
  /** Rows skipped because their job id was already in `seen` (loadState fills 0 for older persisted summaries). */
  seenSkipped: number
  /** Rows dropped by reason. Invariant: fetched = seenSkipped + sum(dropped) + kept. Zero-filled for older summaries. */
  dropped: JSearchDropCounts
  /** Provider that produced this summary (absent in summaries persisted before SerpApi was added). */
  provider?: DeepSearchProvider
}

export interface JSearchDropCounts {
  location: number
  old: number
  noJuniorSignal: number
  scoreTooLow: number
  duplicate: number
  invalid: number
}

export type DeepSearchProvider = 'jsearch' | 'serpapi'

/** SerpApi (Google Jobs) fallback provider status. Never contains the key. */
export interface SerpapiStatus {
  /** A non-empty serpapiApiKey is present in config.json. */
  configured: boolean
  /** Searches counted this month (own counter, resets on a new UTC month). */
  used: number
  /** The app blocks at this many searches per month (SERPAPI_MONTHLY_CAP; adjust to the user's plan). */
  cap: number
  blocked: boolean
  blockedReason: string | null
  /** ISO timestamp the block lifts, or null. */
  blockedUntil: string | null
}

export interface JSearchStatus {
  /** A non-empty jsearchApiKey is present in config.json. The key itself is never exposed. */
  configured: boolean
  /** Requests counted this month (resets when the YYYY-MM key changes). */
  used: number
  /** The app blocks at this many requests per month (200, the user's JSearch plan limit). */
  softLimit: number
  /** Month the counter belongs to, 'YYYY-MM' (UTC). */
  month: string
  blocked: boolean
  /** Human-readable, never contains the key. */
  blockedReason: string | null
  /** ISO timestamp the block lifts (start of next month, UTC), or null. */
  blockedUntil: string | null
  lastRunAt: string | null
  lastRunSummary: JSearchRunSummary | null
  /** Secondary provider (SerpApi Google Jobs). The flat fields above stay JSearch's own. */
  serpapi: SerpapiStatus
  /** JSearch usage at/above which SerpApi takes over (when usable). */
  fallbackThreshold: number
  /** What a run would use right now ('none' = neither provider usable). */
  activeProvider: DeepSearchProvider | 'none'
}

export interface JSearchRunResult {
  ok: boolean
  message: string
  summary?: JSearchRunSummary
  /** Provider the run used (absent when no provider was usable). */
  provider?: DeepSearchProvider
}
