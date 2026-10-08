import { beforeEach, describe, expect, it, vi } from 'vitest'

const scheduled: { expr: string; cb: () => void; stop: ReturnType<typeof vi.fn> }[] = []
vi.mock('node-cron', () => ({
  default: {
    schedule: (expr: string, cb: () => void) => {
      const t = { expr, cb, stop: vi.fn() }
      scheduled.push(t)
      return t
    }
  }
}))

import { startScheduler } from './scheduler'

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  scheduled.length = 0
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('startScheduler', () => {
  it('without opts.daily only the 3h cron is scheduled', () => {
    startScheduler(async () => 1)
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0].expr).toBe('0 */3 * * *')
  })

  it('the 3h cron runs the refresh and never calls daily (JSearch)', async () => {
    const run = vi.fn(async () => 'r')
    const daily = vi.fn(async () => null)
    startScheduler(run, { daily })
    expect(scheduled).toHaveLength(2)
    const three = scheduled.find((s) => s.expr === '0 */3 * * *')!
    const dailyTask = scheduled.find((s) => s.expr !== '0 */3 * * *')!
    expect(dailyTask.expr).toMatch(/^\d+ \d+ \* \* \*$/)
    three.cb()
    three.cb()
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
    expect(daily).not.toHaveBeenCalled()
    dailyTask.cb()
    await flush()
    expect(daily).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('errors in either job are logged, never thrown', async () => {
    startScheduler(
      async () => {
        throw new Error('refresh boom')
      },
      {
        daily: async () => {
          throw new Error('daily boom')
        }
      }
    )
    scheduled[0].cb()
    scheduled[1].cb()
    await flush()
    expect(console.error).toHaveBeenCalledTimes(2)
  })

  it('stop() stops both tasks', () => {
    const stop = startScheduler(async () => 1, { daily: async () => null })
    stop()
    expect(scheduled.every((s) => s.stop.mock.calls.length === 1)).toBe(true)
  })
})
