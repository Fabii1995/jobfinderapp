import cron from 'node-cron'

/** Every 3 hours, on the hour. */
const REFRESH_CRON = '0 */3 * * *'

/** Starts the periodic refresh. Errors are logged, never thrown. Returns a stop function. */
export function startScheduler(run: () => Promise<unknown>): () => void {
  const task = cron.schedule(REFRESH_CRON, () => {
    run().then(
      (r) => console.log('[scheduler] refresh done', JSON.stringify(r)),
      (err) => console.error('[scheduler] refresh failed', err)
    )
  })
  return () => {
    task.stop()
  }
}
