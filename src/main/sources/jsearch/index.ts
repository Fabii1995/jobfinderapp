/**
 * JSearch (OpenWebNinja) aggregator connector. Opt-in, Electron-free, injectable.
 *
 * API (frontend wires IPC against exactly this):
 *   createJSearchService({ userDataDir, db, fetchImpl?, now? }) -> {
 *     getStatus(): JSearchStatus            // never includes the key
 *     setKey(key: string): void             // trims/validates; writes only config.json "jsearchApiKey". A DIFFERENT key
 *                                           // lifts an API-error block (401/403/429); the monthly counter/cap is kept.
 *                                           // Throws Error('Invalid API key format.') or if config.json is unreadable.
 *     clearKey(): void                      // removes only "jsearchApiKey"
 *     runDeepRefresh(): Promise<JSearchRunResult>   // manual; no-op (ok:false + message) without key or while blocked
 *     clearSeen(): {ok:true;cleared}|{ok:false;error}  // clears only `seen` in both state files; refuses while a run is active
 *     getDroppedList(): DroppedJob[]         // in-memory rows dropped by filters in the current/last run, newest first (copy, max 100)
 *     maybeRunWeekly(): Promise<JSearchRunResult | null> // null unless configured, unblocked, last run >= 7 days ago
 *   }
 *   Types (JSearchStatus, JSearchRunSummary, JSearchRunResult) live in ./types.ts (no imports; safe for src/shared).
 *
 * SerpApi (Google Jobs) is a SECONDARY fallback in the same service: setSerpapiKey(key)/clearSerpapiKey() manage
 * config.json "serpapiApiKey"; a run uses exactly one provider (selectProvider: JSearch unless it is >= 170 used,
 * blocked or keyless, and SerpApi is usable). Source id "serpapi", own counter in serpapi-state.json (cap 250, user-stated).
 *
 * Behaviour: inert without a key. 1 page (1 credit) per query, per run JSearch 6 queries and SerpApi 4, persisted monthly counter in
 * <userDataDir>/jsearch-state.json blocks at 200, the user's plan limit (resets on a new UTC month); 401/403/429 block until next month.
 * Source id "jsearch"; externalId = job_id; links only (never fetches LinkedIn/Indeed/Glassdoor). The 3h cron must
 * not call this; only the optional daily weekly-check in the scheduler (maybeRunWeekly) and the manual button do.
 */
export {
  createJSearchService,
  SOFT_LIMIT,
  QUERIES,
  JSEARCH_FALLBACK_THRESHOLD,
  SERPAPI_MONTHLY_CAP,
  SERPAPI_QUERIES,
  selectProvider,
  interpretSerpapiBody
} from './service'
export type { JSearchService, JSearchServiceOptions, FetchLike, ProviderAvailability } from './service'
export type { JSearchStatus, JSearchRunSummary, JSearchRunResult, SerpapiStatus, DeepSearchProvider, JSearchDropCounts, DroppedJob, DroppedReason } from './types'
export { JSEARCH_SOURCE, SERPAPI_SOURCE, mapJSearchRow, mapSerpapiRow, mapJSearchRowInfo, mapSerpapiRowInfo, parseRelativeAgeMs, dedupeKey } from './map'
