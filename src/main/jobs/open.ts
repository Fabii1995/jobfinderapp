import type { Db } from '../db'
import type { Job } from '../db/schema'
import { getJobById, markVisited } from './queries'

/**
 * Opens a job's URL externally (http/https only), THEN marks it visited via markVisited
 * (the only writer of visitedAt). Rejects, without marking, on any failure. Electron-free:
 * `openExternal` is injected (shell.openExternal in main).
 */
export async function openJob(
  db: Db,
  id: unknown,
  openExternal: (url: string) => Promise<void>
): Promise<Job | null> {
  if (typeof id !== 'number' || !Number.isInteger(id)) {
    throw new Error('jobs:open requires an integer id')
  }
  const job = getJobById(db, id)
  if (!job) return null
  let url: URL
  try {
    url = new URL(job.url)
  } catch {
    throw new Error('Job URL is not a valid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Refusing to open non-http(s) URL (${url.protocol})`)
  }
  await openExternal(url.toString())
  return markVisited(db, id)
}
