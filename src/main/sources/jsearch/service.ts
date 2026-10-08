import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ne } from 'drizzle-orm'
import type { Db } from '../../db'
import { jobs } from '../../db/schema'
import { upsertJobs, type ScoredJob } from '../../jobs/upsert'
import { classifyRoles } from '../../roles'
import { asArray, asRecord } from '../http'
import { dedupeKey, JSEARCH_SOURCE, mapJSearchRow, mapSerpapiRow, serpapiJobId, SERPAPI_SOURCE, type MapOutcome } from './map'
import type { DeepSearchProvider, JSearchRunResult, JSearchRunSummary, JSearchStatus } from './types'

export const JSEARCH_URL = 'https://api.openwebninja.com/jsearch/search-v2'
/** JSearch monthly limit: 200 is the user's plan limit; the app blocks at this many requests. */
export const SOFT_LIMIT = 200
/** JSearch usage at/above which SerpApi takes over (170 = fallback near the 200 limit). */
export const JSEARCH_FALLBACK_THRESHOLD = 170
export const SERPAPI_URL = 'https://serpapi.com/search.json'
/**
 * Monthly SerpApi search cap enforced by the app. The 250 searches/month limit is user-stated (confirmed
 * by the user). The block-on-quota-error path stays, so a smaller real quota degrades safely.
 */
export const SERPAPI_MONTHLY_CAP = 250
const WEEK_MS = 7 * 24 * 3600 * 1000
const SEEN_TTL_MS = 90 * 24 * 3600 * 1000
const SEEN_MAX = 3000
const MIN_KEY_LEN = 8
const MAX_KEY_LEN = 512
const ERR_TEXT_MAX = 200
const TIMEOUT_MS = 25_000
/** SerpApi google_jobs can be slow (a live run timed out at 25 s), so it gets a longer per-request timeout. */
export const SERPAPI_TIMEOUT_MS = 45_000

/** Exactly one page (one credit) each. Order = priority; the run stops early if the cap would be exceeded. */
export const QUERIES = [
  'junior backend developer in Israel',
  'junior QA engineer in Israel',
  'junior python developer in Israel',
  'entry level software engineer in Israel'
]

/**
 * One search per query (one request, no pagination). Queries carry no country word; Israel comes from `location`.
 * UNTESTED GUESS: `location=Israel` (and deliberately NO `gl`). A live run with only q="... Israel" returned HTTP 200
 * with "Google hasn't returned any results" for every query, so the hypothesis is that google_jobs needs a valid
 * `location`. An earlier attempt with location=Israel&gl=il got HTTP 400 (reason never seen; 400 Details now show the
 * error text and the offending param when SerpApi names it). If this still returns nothing or 400s, revisit.
 */
export const SERPAPI_QUERIES = [
  'junior software developer',
  'junior QA engineer',
  'entry level backend developer',
  'junior python developer'
]
/** Fixed SerpApi location param (untested guess, see SERPAPI_QUERIES). */
export const SERPAPI_LOCATION = 'Israel'
const SERPAPI_PARAM_NAMES = ['engine', 'q', 'location', 'gl', 'hl']

export interface ProviderAvailability {
  configured: boolean
  blocked: boolean
  used: number
  cap: number
}

/**
 * Pure provider choice (JSearch preferred). SerpApi only when it is usable (key, not blocked, under cap) AND
 * JSearch is at/above the threshold, blocked, or has no key. 'none' when neither is usable.
 */
export function selectProvider(
  js: ProviderAvailability,
  sp: ProviderAvailability,
  threshold: number = JSEARCH_FALLBACK_THRESHOLD
): DeepSearchProvider | 'none' {
  const usable = (p: ProviderAvailability): boolean => p.configured && !p.blocked && p.used < p.cap
  if (usable(sp) && (!js.configured || js.blocked || js.used >= threshold || js.used >= js.cap)) return 'serpapi'
  return usable(js) ? 'jsearch' : 'none'
}

/** Minimal fetch surface (global fetch satisfies it). */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text?(): Promise<string> }>

export interface JSearchServiceOptions {
  /** Electron userData directory: holds config.json (key) and jsearch-state.json. */
  userDataDir: string
  db: Db
  fetchImpl?: FetchLike
  now?: () => number
}

interface State {
  month: string
  used: number
  blockedUntil: number | null
  blockedReason: string | null
  lastRunAt: number | null
  lastRunSummary: JSearchRunSummary | null
  /** job_id -> first seen (ms); includes rejected rows so they are not re-scored. */
  seen: Record<string, number>
}

const monthKey = (ms: number): string => new Date(ms).toISOString().slice(0, 7)
const nextMonthStart = (ms: number): number => {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}
const freshState = (ms: number): State => ({
  month: monthKey(ms),
  used: 0,
  blockedUntil: null,
  blockedReason: null,
  lastRunAt: null,
  lastRunSummary: null,
  seen: {}
})

type SerpOutcome =
  | { kind: 'rows'; rows: unknown[] }
  | { kind: 'empty' }
  | { kind: 'exhausted' }
  | { kind: 'badkey' }
  | { kind: 'error' }

/**
 * Interprets a SerpApi 200 body. The `error` field text is ASSUMED from SerpApi docs and UNVERIFIED: a
 * "hasn't returned any results" error is a normal empty result; out-of-searches/limit errors are quota
 * exhaustion; invalid key is a key error. The raw error text is never surfaced.
 */
export function interpretSerpapiBody(body: unknown): SerpOutcome {
  const rec = asRecord(body)
  const err = typeof rec?.error === 'string' ? rec.error : null
  if (err !== null) {
    if (/hasn'?t returned any results|no results/i.test(err)) return { kind: 'empty' }
    if (/invalid api key|api key.*(missing|invalid)/i.test(err)) return { kind: 'badkey' }
    if (/out of searches|run out|searches per|limit|quota|exceed|plan/i.test(err)) return { kind: 'exhausted' }
    return { kind: 'error' }
  }
  // Tolerant of shape variants: the first recognized job array wins (jobs_results is the documented one).
  for (const k of ['jobs_results', 'jobs', 'results']) {
    if (Array.isArray(rec?.[k])) return { kind: 'rows', rows: rec[k] as unknown[] }
  }
  return { kind: 'rows', rows: [] }
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, path)
}

export function createJSearchService(opts: JSearchServiceOptions) {
  const now = opts.now ?? (() => Date.now())
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init))
  const configPath = join(opts.userDataDir, 'config.json')
  const jsStatePath = join(opts.userDataDir, 'jsearch-state.json')
  const spStatePath = join(opts.userDataDir, 'serpapi-state.json')
  let inFlight: Promise<JSearchRunResult> | null = null

  const CAPS: Record<DeepSearchProvider, number> = { jsearch: SOFT_LIMIT, serpapi: SERPAPI_MONTHLY_CAP }
  const LABELS: Record<DeepSearchProvider, string> = { jsearch: 'JSearch', serpapi: 'SerpApi' }
  const KEY_FIELDS: Record<DeepSearchProvider, string> = { jsearch: 'jsearchApiKey', serpapi: 'serpapiApiKey' }
  const STATE_PATHS: Record<DeepSearchProvider, string> = { jsearch: jsStatePath, serpapi: spStatePath }

  function readKeyFor(p: DeepSearchProvider): string | null {
    const v = readJson(configPath)?.[KEY_FIELDS[p]]
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }

  function loadState(path: string): State {
    const t = now()
    const base = freshState(t)
    const raw = readJson(path)
    if (!raw) return base
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    const s: State = {
      month: typeof raw.month === 'string' ? raw.month : base.month,
      used: Math.max(0, num(raw.used) ?? 0),
      blockedUntil: num(raw.blockedUntil),
      blockedReason: typeof raw.blockedReason === 'string' ? raw.blockedReason : null,
      lastRunAt: num(raw.lastRunAt),
      lastRunSummary: (asRecord(raw.lastRunSummary) as JSearchRunSummary | null) ?? null,
      seen: {}
    }
    for (const [k, v] of Object.entries(asRecord(raw.seen) ?? {})) {
      if (typeof v === 'number' && t - v < SEEN_TTL_MS) s.seen[k] = v
    }
    if (s.month !== base.month) {
      // New month: counter resets; a block that was only valid until month end lifts by itself below.
      s.month = base.month
      s.used = 0
    }
    if (s.blockedUntil !== null && s.blockedUntil <= t) {
      s.blockedUntil = null
      s.blockedReason = null
    }
    return s
  }

  function saveState(path: string, s: State): void {
    mkdirSync(opts.userDataDir, { recursive: true })
    const ids = Object.entries(s.seen)
      .sort((a, b) => b[1] - a[1])
      .slice(0, SEEN_MAX)
    writeJsonAtomic(path, { ...s, seen: Object.fromEntries(ids) })
  }

  function blockInfo(s: State, p: DeepSearchProvider): { blocked: boolean; reason: string | null; until: number | null } {
    if (s.blockedUntil !== null) return { blocked: true, reason: s.blockedReason, until: s.blockedUntil }
    if (s.used >= CAPS[p])
      return {
        blocked: true,
        reason:
          p === 'jsearch'
            ? `Monthly limit reached (${s.used} of ${CAPS[p]} requests used). Resumes next month.`
            : `SerpApi monthly limit reached (${s.used} of ${CAPS[p]} searches used). Resumes next month.`,
        until: nextMonthStart(now())
      }
    return { blocked: false, reason: null, until: null }
  }

  function availability(p: DeepSearchProvider): ProviderAvailability & { reason: string | null; until: number | null; s: State } {
    const s = loadState(STATE_PATHS[p])
    const b = blockInfo(s, p)
    return { configured: readKeyFor(p) !== null, blocked: b.blocked, used: s.used, cap: CAPS[p], reason: b.reason, until: b.until, s }
  }

  const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString())

  function getStatus(): JSearchStatus {
    const js = availability('jsearch')
    const sp = availability('serpapi')
    return {
      configured: js.configured,
      used: js.s.used,
      softLimit: SOFT_LIMIT,
      month: js.s.month,
      blocked: js.blocked,
      blockedReason: js.reason,
      blockedUntil: iso(js.until),
      lastRunAt: iso(js.s.lastRunAt),
      lastRunSummary: js.s.lastRunSummary,
      serpapi: {
        configured: sp.configured,
        used: sp.used,
        cap: SERPAPI_MONTHLY_CAP,
        blocked: sp.blocked,
        blockedReason: sp.reason,
        blockedUntil: iso(sp.until)
      },
      fallbackThreshold: JSEARCH_FALLBACK_THRESHOLD,
      activeProvider: selectProvider(js, sp)
    }
  }

  /**
   * Stores a key in config.json (only that provider's field is touched; other fields are kept). Choice: saving a
   * DIFFERENT key lifts an API-error block (401/403/429/quota) because the old key was the likely cause; the
   * monthly request counter and the cap are kept (we cannot verify a new account's quota). Re-saving the same
   * key changes nothing. Throws on an invalid key or an unreadable existing config.json (never overwrites it).
   */
  function setKeyFor(p: DeepSearchProvider, key: string): void {
    const field = KEY_FIELDS[p]
    const k = typeof key === 'string' ? key.trim() : ''
    if (k.length < MIN_KEY_LEN || k.length > MAX_KEY_LEN || /\s/.test(k)) throw new Error('Invalid API key format.')
    let cfg: Record<string, unknown> = {}
    if (existsSync(configPath)) {
      const parsed = readJson(configPath)
      if (!parsed) throw new Error('config.json could not be read; refusing to overwrite it.')
      cfg = parsed
    }
    const changed = cfg[field] !== k
    mkdirSync(opts.userDataDir, { recursive: true })
    writeJsonAtomic(configPath, { ...cfg, [field]: k })
    if (changed) {
      const s = loadState(STATE_PATHS[p])
      if (s.blockedUntil !== null) {
        s.blockedUntil = null
        s.blockedReason = null
        saveState(STATE_PATHS[p], s)
      }
    }
  }

  /** Removes only that provider's key field from config.json (other fields preserved). No-op when absent. */
  function clearKeyFor(p: DeepSearchProvider): void {
    if (!existsSync(configPath)) return
    const cfg = readJson(configPath)
    if (!cfg) throw new Error('config.json could not be read; refusing to overwrite it.')
    const field = KEY_FIELDS[p]
    if (!(field in cfg)) return
    const { [field]: _drop, ...rest } = cfg
    void _drop
    writeJsonAtomic(configPath, rest)
  }

  const setKey = (key: string): void => setKeyFor('jsearch', key)
  const clearKey = (): void => clearKeyFor('jsearch')
  const setSerpapiKey = (key: string): void => setKeyFor('serpapi', key)
  const clearSerpapiKey = (): void => clearKeyFor('serpapi')

  function currentProvider(): DeepSearchProvider | 'none' {
    return selectProvider(availability('jsearch'), availability('serpapi'))
  }

  /** Message for a run when no provider is usable (never contains a key). */
  function noneMessage(): string {
    const parts: string[] = []
    for (const p of ['jsearch', 'serpapi'] as const) {
      const a = availability(p)
      if (a.configured && a.blocked) parts.push(a.reason ?? `${LABELS[p]} is blocked.`)
    }
    if (parts.length === 0) return 'JSearch is not configured: add an API key first (or a SerpApi key as fallback).'
    return parts.join(' ')
  }

  async function execute(p: DeepSearchProvider): Promise<JSearchRunResult> {
    const label = LABELS[p]
    const key = readKeyFor(p)
    if (!key) return { ok: false, message: `${label} is not configured: add an API key first.` }
    const statePath = STATE_PATHS[p]
    const cap = CAPS[p]
    const s = loadState(statePath)
    const pre = blockInfo(s, p)
    if (pre.blocked) return { ok: false, message: pre.reason ?? `${label} is blocked.` }

    const t = now()
    const summary: JSearchRunSummary = {
      fetched: 0,
      kept: 0,
      inserted: 0,
      updated: 0,
      skippedDuplicates: 0,
      requests: 0,
      provider: p
    }
    // Dedupe against every row not from this provider's own source (ATS rows and the other provider's rows).
    const ownSource = p === 'serpapi' ? SERPAPI_SOURCE : JSEARCH_SOURCE
    const atsKeys = new Set<string>()
    for (const r of opts.db
      .select({ title: jobs.title, company: jobs.company })
      .from(jobs)
      .where(ne(jobs.source, ownSource))
      .all()) {
      atsKeys.add(dedupeKey(r.title, r.company))
    }
    const rows: ScoredJob[] = []
    const runKeys = new Set<string>()
    let stopNote = ''
    let failed = false
    const queries = p === 'serpapi' ? SERPAPI_QUERIES : QUERIES

    const block = (reason: string): void => {
      s.blockedUntil = nextMonthStart(now())
      s.blockedReason = reason
      stopNote = ` ${reason}`
      failed = true
    }

    const emptyNotes = new Map<string, number[]>()
    let qIndex = 0
    let netFailed = 0
    for (const q of queries) {
      qIndex++
      if (s.used >= cap) {
        stopNote = ' Stopped early: monthly limit reached.'
        break
      }
      // Count before sending: a request that fails after leaving still may consume a credit.
      s.used++
      summary.requests++
      saveState(statePath, s)
      let status = 0
      let body: unknown = null
      let errDetail = ''
      try {
        const req: { url: string; headers: Record<string, string> } =
          p === 'serpapi'
            ? {
                url: `${SERPAPI_URL}?${new URLSearchParams({ engine: 'google_jobs', q, location: SERPAPI_LOCATION, hl: 'en', api_key: key })}`,
                headers: { Accept: 'application/json' }
              }
            : {
                url: `${JSEARCH_URL}?${new URLSearchParams({ query: q, num_pages: '1', date_posted: 'month', country: 'il' })}`,
                headers: { 'x-api-key': key, Accept: 'application/json' }
              }
        const res = await fetchImpl(req.url, {
          method: 'GET',
          headers: req.headers,
          signal: AbortSignal.timeout(p === 'serpapi' ? SERPAPI_TIMEOUT_MS : TIMEOUT_MS)
        })
        status = res.status
        if (res.ok) body = await res.json()
        else errDetail = await readErrorDetail(res)
      } catch {
        if (p === 'serpapi') {
          // Network error/timeout on one query: the request stays counted (quota may be consumed); keep going.
          netFailed++
          continue
        }
        stopNote = ' A request failed (network error); stopped.'
        failed = true
        break
      }
      // A definite client error (4xx except 429): the provider rejected the request without running a search, so
      // refund the pre-counted request. Network errors, timeouts, 5xx, 429 and 200 stay counted.
      if (status >= 400 && status < 500 && status !== 429) {
        s.used = Math.max(0, s.used - 1)
        summary.requests = Math.max(0, summary.requests - 1)
        saveState(statePath, s)
      }
      let detail = errDetail ? ` Details: ${errDetail}` : ''
      if (p === 'serpapi' && status === 400) {
        const named = SERPAPI_PARAM_NAMES.filter((n) => new RegExp(`(^|[^a-z_])${n}([^a-z_]|$)`, 'i').test(errDetail))
        const sent = `engine, q, location, hl`
        detail += named.length ? ` Offending param named by SerpApi: ${named.join(', ')} (sent: ${sent}).` : ` (params sent: ${sent}).`
      }
      if (status === 401 || status === 403 || status === 429) {
        block(
          (status === 429
            ? `${label} reported the request limit was reached (HTTP 429). Disabled until next month.`
            : `${label} rejected the API key (HTTP ${status}). Disabled until next month or until a new key is saved.`) +
            detail
        )
        break
      }
      // Other non-2xx (400/404/422/5xx) never block the provider; the run just stops.
      if (status < 200 || status >= 300) {
        stopNote = ` A request failed (HTTP ${status}); stopped.${detail}`
        failed = true
        break
      }
      let items: unknown[]
      if (p === 'serpapi') {
        const out = interpretSerpapiBody(body)
        if (out.kind === 'exhausted') {
          block('SerpApi reports no searches left on this plan. Disabled until next month or until a new key is saved.')
          break
        }
        if (out.kind === 'badkey') {
          block('SerpApi rejected the API key. Disabled until next month or until a new key is saved.')
          break
        }
        if (out.kind === 'error') {
          const e = bodyErrorText(body)
          stopNote = ` SerpApi returned an error; stopped.${e ? ` Details: ${e}` : ''}`
          failed = true
          break
        }
        items = out.kind === 'rows' ? out.rows : []
        if (items.length === 0) addEmptyNote(emptyNotes, qIndex, body, out.kind === 'empty')
      } else {
        const rec = asRecord(body)
        items = Array.isArray(rec?.data) ? rec.data : asArray(asRecord(rec?.data)?.jobs)
        if (items.length === 0) addEmptyNote(emptyNotes, qIndex, body, false)
      }
      for (const item of items) {
        summary.fetched++
        const id = p === 'serpapi' ? serpapiJobId(item) : asRecord(item)?.job_id
        if (typeof id === 'string' && id) {
          if (s.seen[id] !== undefined) {
            summary.skippedDuplicates++
            continue
          }
          s.seen[id] = t
        }
        const out: MapOutcome = p === 'serpapi' ? mapSerpapiRow(item, t) : mapJSearchRow(item, t)
        if (out.kind !== 'job') continue
        const dk = dedupeKey(out.job.title, out.job.company)
        if (atsKeys.has(dk) || runKeys.has(dk)) {
          summary.skippedDuplicates++
          continue
        }
        runKeys.add(dk)
        rows.push({ ...out.job, score: out.score, roles: classifyRoles(out.job) })
      }
    }

    if (netFailed > 0) {
      stopNote += ` ${netFailed} of ${summary.requests} request(s) failed (network error or timeout) and were skipped.`
      if (netFailed === summary.requests) failed = true
    }
    for (const [note, idx] of emptyNotes) stopNote += ` [q${idx.join(',q')}: ${note}]`
    summary.kept = rows.length
    if (rows.length > 0) {
      const { inserted, updated } = upsertJobs(opts.db, rows)
      summary.inserted = inserted
      summary.updated = updated
    }
    s.lastRunAt = now()
    s.lastRunSummary = summary
    saveState(statePath, s)
    if (p === 'serpapi') {
      // The weekly gate and the status "last run" fields are shared: record the run in the JSearch state file too.
      const js = loadState(jsStatePath)
      js.lastRunAt = s.lastRunAt
      js.lastRunSummary = summary
      saveState(jsStatePath, js)
    }
    return {
      ok: !failed,
      summary,
      provider: p,
      message: `${label}: ${summary.requests} request(s), ${summary.fetched} fetched, ${summary.kept} kept (${summary.inserted} new, ${summary.updated} updated), ${summary.skippedDuplicates} duplicates skipped.${stopNote}`
    }
  }

  /** Redacts both provider keys, x-api-key and api_key= (query/JSON) occurrences from an error message. */
  function scrub(msg: string): string {
    for (const p of ['jsearch', 'serpapi'] as const) {
      const key = readKeyFor(p)
      if (key) msg = msg.split(key).join('***')
    }
    return msg
      .replace(/(x-api-key["']?\s*[:=]\s*)\S+/gi, '$1***')
      .replace(/(api_key["']?\s*[:=]\s*)[^&\s"']+/gi, '$1***')
  }

  /** Pulls `error` (or `message`) from a parsed body; scrubbed, whitespace-collapsed, truncated. '' when absent. */
  function bodyErrorText(body: unknown): string {
    const rec = asRecord(body)
    const raw = typeof rec?.error === 'string' ? rec.error : typeof rec?.message === 'string' ? rec.message : ''
    return clean(raw)
  }

  /**
   * Records a safe note for a 200 response that parsed to zero rows: sorted top-level key names (max 15, 40 chars
   * each), search_metadata.status and the `error` text only. Never job content. Identical notes are grouped by
   * 1-based query number.
   */
  function addEmptyNote(notes: Map<string, number[]>, qIdx: number, body: unknown, normalEmpty: boolean): void {
    const rec = asRecord(body)
    const keys = rec ? Object.keys(rec).sort() : []
    const shown = keys.slice(0, 15).map((k) => clean(k.slice(0, 40)))
    const more = keys.length > 15 ? ` +${keys.length - 15} more` : ''
    const st = asRecord(rec?.search_metadata)?.status
    const err = bodyErrorText(body)
    const parts = [
      normalEmpty ? '0 results for this query (normal empty result, not a failure)' : '0 rows parsed',
      rec ? `keys: ${shown.join(', ') || '(none)'}${more}` : 'body is not a JSON object'
    ]
    if (typeof st === 'string') parts.push(`status: ${clean(st.slice(0, 40))}`)
    if (err) parts.push(`error: ${err}`)
    const note = parts.join('; ')
    const list = notes.get(note)
    if (list) list.push(qIdx)
    else notes.set(note, [qIdx])
  }

  function clean(raw: string): string {
    const t = scrub(raw).replace(/\s+/g, ' ').trim()
    return t.length > ERR_TEXT_MAX ? `${t.slice(0, ERR_TEXT_MAX)}...` : t
  }

  /** Best-effort read of a non-2xx response body. Never throws. Falls back to scrubbed plain text. */
  async function readErrorDetail(res: { json(): Promise<unknown>; text?(): Promise<string> }): Promise<string> {
    try {
      if (typeof res.text === 'function') {
        const txt = await res.text()
        try {
          return bodyErrorText(JSON.parse(txt)) || (/^\s*[{[]/.test(txt) ? '' : clean(txt))
        } catch {
          return clean(txt)
        }
      }
      return bodyErrorText(await res.json())
    } catch {
      return ''
    }
  }

  function guarded(label: string, fn: () => Promise<JSearchRunResult>): Promise<JSearchRunResult> {
    if (inFlight) return inFlight
    inFlight = fn()
      .catch((e: unknown): JSearchRunResult => {
        const msg = scrub(e instanceof Error ? e.message : 'unknown error')
        return { ok: false, message: `${label} run failed: ${msg}` }
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }

  /** Manual deep refresh. Uses exactly one provider (JSearch preferred, SerpApi as fallback), see selectProvider. */
  function runDeepRefresh(): Promise<JSearchRunResult> {
    if (inFlight) return inFlight
    const p = currentProvider()
    if (p === 'none') return Promise.resolve({ ok: false, message: noneMessage() })
    return guarded(LABELS[p], () => execute(p))
  }

  /** Runs only when a provider is usable and the last run (either provider) is older than 7 days (or never). Otherwise null. */
  async function maybeRunWeekly(): Promise<JSearchRunResult | null> {
    if (inFlight) return null
    const p = currentProvider()
    if (p === 'none') return null
    const last = loadState(jsStatePath).lastRunAt
    if (last !== null && now() - last < WEEK_MS) return null
    return guarded(LABELS[p], () => execute(p))
  }

  return { getStatus, setKey, clearKey, setSerpapiKey, clearSerpapiKey, runDeepRefresh, maybeRunWeekly }
}

export type JSearchService = ReturnType<typeof createJSearchService>
