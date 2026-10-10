/** JSearch (OpenWebNinja) types shared by main, preload and renderer. Mirrors main/sources/jsearch/types.ts. */

export interface JSearchRunSummary {
  fetched: number
  kept: number
  inserted: number
  updated: number
  skippedDuplicates: number
  requests: number
  /** Provider that produced this summary (absent in summaries persisted before SerpApi was added). */
  provider?: DeepSearchProvider
  /** Jobs skipped because an earlier run already evaluated them (absent on older summaries). */
  seenSkipped?: number
  /** Why fetched jobs were dropped (absent on older summaries). fetched = seenSkipped + sum(dropped) + kept. */
  dropped?: JSearchDropped
}

export interface JSearchDropped {
  location: number
  old: number
  noJuniorSignal: number
  scoreTooLow: number
  duplicate: number
  invalid: number
}

/** Never contains the API key. */
export type DeepSearchProvider = 'jsearch' | 'serpapi'

/** SerpApi (Google Jobs) fallback provider status. Never contains the key. */
export interface SerpapiStatus {
  /** A non-empty serpapiApiKey is present in config.json. */
  configured: boolean
  /** Searches counted this month (own counter, resets on a new UTC month). */
  used: number
  /** The app blocks at this many searches per month (SERPAPI_MONTHLY_CAP). */
  cap: number
  blocked: boolean
  blockedReason: string | null
  /** ISO timestamp the block lifts, or null. */
  blockedUntil: string | null
}

export interface JSearchStatus {
  configured: boolean
  used: number
  softLimit: number
  /** 'YYYY-MM' (UTC). */
  month: string
  blocked: boolean
  blockedReason: string | null
  /** ISO timestamp the block lifts, or null. */
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

export type JSearchSetKeyResult = { ok: true } | { ok: false; error: string }

export type JSearchClearSeenResult = { ok: true; cleared: number } | { ok: false; error: string }

export type DroppedReason = keyof JSearchDropped

/** One job rejected by a filter in a recent deep refresh (in memory in main only). Mirrors main/sources/jsearch/types.ts DroppedJob. */
export interface DroppedJob {
  title: string
  company: string
  location: string
  reason: DroppedReason
  /** null when the job was rejected before scoring. */
  score: number | null
  provider: DeepSearchProvider
  /** ISO timestamp of the run start. */
  runAt: string
}

export const DROPPED_LIST_MAX = 100
export const DROPPED_TEXT_MAX = 160
export const DROPPED_REASONS: readonly DroppedReason[] = [
  'location',
  'old',
  'noJuniorSignal',
  'scoreTooLow',
  'duplicate',
  'invalid'
]

export const MAX_API_KEY_LENGTH = 256
