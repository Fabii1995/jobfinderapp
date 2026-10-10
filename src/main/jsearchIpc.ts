import { ipcMain } from 'electron'
import type { JSearchService } from './sources/jsearch'
import { IPC } from '../shared/ipc'
import { stripHtmlLine } from '../shared/text'
import {
  DROPPED_LIST_MAX,
  DROPPED_REASONS,
  DROPPED_TEXT_MAX,
  MAX_API_KEY_LENGTH,
  type DroppedJob,
  type JSearchClearSeenResult,
  type JSearchRunResult,
  type JSearchSetKeyResult
} from '../shared/jsearch'

/**
 * Wraps the JSearch service for the app: one in-flight guard shared by the manual button and the
 * weekly check (so double clicks can't spend quota twice), and a `jobs:changed` notify after any
 * run that inserted rows. Nothing here logs or returns the API key.
 */
export function createDeepRunner(service: JSearchService, notify: () => void) {
  let inFlight: Promise<JSearchRunResult> | null = null

  const finish = (res: JSearchRunResult): JSearchRunResult => {
    if (res.ok && (res.summary?.inserted ?? 0) > 0) {
      try {
        notify()
      } catch (err) {
        console.error('[jsearch] notify failed', err instanceof Error ? err.message : 'error')
      }
    }
    return res
  }

  const deepRefresh = (): Promise<JSearchRunResult> => {
    if (inFlight) return inFlight
    inFlight = service
      .runDeepRefresh()
      .then(finish)
      .catch((): JSearchRunResult => ({ ok: false, message: 'Deep refresh failed unexpectedly.' }))
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }

  /** Daily scheduler hook: null when not due (or a run is already in flight). */
  const maybeRunWeekly = async (): Promise<JSearchRunResult | null> => {
    if (inFlight) return null
    const p = service.maybeRunWeekly().then((r) => (r ? finish(r) : null))
    return p
  }

  /** True while a manual deep refresh is in flight (the service also refuses during any of its own runs). */
  const isRunning = (): boolean => inFlight !== null

  return { deepRefresh, maybeRunWeekly, isRunning }
}

const clip = (v: unknown): string => {
  const t = typeof v === 'string' ? stripHtmlLine(v) : ''
  return t.length > DROPPED_TEXT_MAX ? t.slice(0, DROPPED_TEXT_MAX) : t
}

/** Defensive re-shape of service rows: drops malformed ones, strips markup, truncates text, caps the count. */
export function sanitizeDroppedList(rows: unknown): DroppedJob[] {
  if (!Array.isArray(rows)) return []
  const out: DroppedJob[] = []
  for (const r of rows) {
    if (out.length >= DROPPED_LIST_MAX) break
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    if (typeof o.reason !== 'string' || !(DROPPED_REASONS as readonly string[]).includes(o.reason)) continue
    if (o.provider !== 'jsearch' && o.provider !== 'serpapi') continue
    if (typeof o.runAt !== 'string' || !Number.isFinite(Date.parse(o.runAt))) continue
    out.push({
      title: clip(o.title),
      company: clip(o.company),
      location: clip(o.location),
      reason: o.reason as DroppedJob['reason'],
      score: typeof o.score === 'number' && Number.isFinite(o.score) ? o.score : null,
      provider: o.provider,
      runAt: o.runAt.slice(0, 40)
    })
  }
  return out
}

export function registerJSearchIpc(
  service: JSearchService,
  runner: ReturnType<typeof createDeepRunner>
): void {
  ipcMain.handle(IPC.jsearchStatus, () => service.getStatus())
  const saveKey = (key: unknown, store: (k: string) => void): JSearchSetKeyResult => {
    if (typeof key !== 'string' || !key.trim()) return { ok: false, error: 'Enter your API key.' }
    if (key.length > MAX_API_KEY_LENGTH) {
      return { ok: false, error: `That key is too long (max ${MAX_API_KEY_LENGTH} characters).` }
    }
    try {
      store(key)
      return { ok: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      // Never echo the key back, even inside an error message.
      const safe = msg && !msg.includes(key.trim()) ? msg : 'Could not save the key.'
      return { ok: false, error: safe }
    }
  }
  ipcMain.handle(IPC.jsearchSetKey, (_e, key: unknown) => saveKey(key, (k) => service.setKey(k)))
  ipcMain.handle(IPC.jsearchClearKey, (): { ok: true } => {
    service.clearKey()
    return { ok: true }
  })
  ipcMain.handle(IPC.jsearchSetSerpapiKey, (_e, key: unknown) =>
    saveKey(key, (k) => service.setSerpapiKey(k))
  )
  ipcMain.handle(IPC.jsearchClearSerpapiKey, (): { ok: true } => {
    service.clearSerpapiKey()
    return { ok: true }
  })
  ipcMain.handle(IPC.jsearchDeepRefresh, () => runner.deepRefresh())
  ipcMain.handle(IPC.jsearchClearSeen, (_e, ...args: unknown[]): JSearchClearSeenResult => {
    if (args.length > 0) return { ok: false, error: 'Invalid request.' }
    if (runner.isRunning()) {
      return { ok: false, error: 'A deep refresh is running; try again when it finishes.' }
    }
    try {
      const res = service.clearSeen()
      if (res.ok) return { ok: true, cleared: res.cleared }
      return { ok: false, error: typeof res.error === 'string' && res.error ? res.error : 'Could not clear seen jobs.' }
    } catch {
      return { ok: false, error: 'Could not clear seen jobs.' }
    }
  })
  ipcMain.handle(IPC.jsearchDroppedList, (_e, ...args: unknown[]): DroppedJob[] => {
    if (args.length > 0) return []
    try {
      return sanitizeDroppedList(service.getDroppedList())
    } catch {
      return []
    }
  })
}
