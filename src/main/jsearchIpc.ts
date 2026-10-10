import { ipcMain } from 'electron'
import type { JSearchService } from './sources/jsearch'
import { IPC } from '../shared/ipc'
import {
  MAX_API_KEY_LENGTH,
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
}
