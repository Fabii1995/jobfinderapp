import cron from 'node-cron'

/** Every 3 hours, on the hour. */
const REFRESH_CRON = '0 */3 * * *'
/** Once a day; the callback itself decides whether a weekly run is due. */
const DAILY_CRON = '17 10 * * *'

export interface SchedulerOptions {
  /** Optional daily check (e.g. JSearch maybeRunWeekly). Separate from the 3h refresh, which never calls it. */
  daily?: () => Promise<unknown>
}

/** Starts the periodic refresh. Errors are logged, never thrown. Returns a stop function. */
export function startScheduler(run: () => Promise<unknown>, opts: SchedulerOptions = {}): () => void {
  const task = cron.schedule(REFRESH_CRON, () => {
    run().then(
      (r) => console.log('[scheduler] refresh done', JSON.stringify(r)),
      (err) => console.error('[scheduler] refresh failed', err)
    )
  })
  const daily = opts.daily
  const dailyTask = daily
    ? cron.schedule(DAILY_CRON, () => {
        Promise.resolve()
          .then(daily)
          .then(
            (r) => console.log('[scheduler] daily check done', r === null ? 'not due' : 'ran'),
            (err) => console.error('[scheduler] daily check failed', err instanceof Error ? err.message : 'error')
          )
      })
    : null
  return () => {
    task.stop()
    dailyTask?.stop()
  }
}
