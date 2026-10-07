import type { Db } from '../db'
import type { RefreshResponse } from '../../shared/ipc'
import { saveLastRefresh } from './queries'

interface RefreshServiceDeps {
  db: Db
  /** Fetch + upsert (refreshJobs). */
  run: (db: Db) => Promise<RefreshResponse>
  /** Called after the summary is saved (main: send `jobs:changed` to every window). */
  notify: () => void
  now?: () => number
}

/**
 * The ONE refresh entry point, used by both the IPC handler and the scheduler:
 * run -> persist summary -> notify. Concurrent callers share a single in-flight promise,
 * so the summary is saved and the push event sent exactly once per run.
 */
export function createRefreshService({
  db,
  run,
  notify,
  now = Date.now
}: RefreshServiceDeps): () => Promise<RefreshResponse> {
  let inFlight: Promise<RefreshResponse> | null = null
  return () => {
    if (inFlight) return inFlight
    inFlight = (async () => {
      const result = await run(db)
      saveLastRefresh(db, {
        at: now(),
        inserted: result.inserted,
        updated: result.updated,
        sources: result.sources
      })
      try {
        notify()
      } catch (err) {
        console.error('[refresh] notify failed', err)
      }
      return result
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }
}
