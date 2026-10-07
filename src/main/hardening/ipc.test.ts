import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../shared/ipc'
import { openDb, type Db } from '../db'
import { upsertJobs, type ScoredJob } from '../jobs/upsert'
import { getStats, listJobs } from '../jobs/queries'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const openExternal = vi.fn().mockResolvedValue(undefined)
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) },
  shell: { openExternal: (u: string) => openExternal(u) }
}))

import { registerJobsIpc } from '../ipc'

let db: Db
let close: () => void
const refresh = vi.fn()
const row = (id: string, url = 'https://e.com/' + id): ScoredJob => ({
  source: 'remoteok',
  externalId: id,
  title: id,
  company: 'c',
  url,
  description: null,
  location: null,
  country: 'IL',
  city: null,
  workMode: 'unknown',
  postedAt: null,
  score: 50,
  roles: []
})
const call = (ch: string, ...args: unknown[]): unknown => handlers.get(ch)!({}, ...args)

beforeEach(() => {
  handlers.clear()
  openExternal.mockClear()
  refresh.mockReset().mockResolvedValue({ inserted: 0, updated: 0, errors: {}, sources: [] })
  ;({ db, close } = openDb(':memory:'))
  upsertJobs(db, [row('a'), row('b'), row('js', 'javascript:alert(1)')])
  registerJobsIpc({ db, refresh })
})
afterEach(() => close())

describe('registration', () => {
  it('registers exactly the five documented invoke channels (and not the push channel)', () => {
    expect([...handlers.keys()].sort()).toEqual(
      [IPC.list, IPC.refresh, IPC.visit, IPC.stats, IPC.open].sort()
    )
    expect(handlers.has(IPC.changed)).toBe(false)
  })
})

describe('jobs:list with malformed args', () => {
  it('undefined / null / non-object / extra props never throw', () => {
    for (const req of [undefined, null, 'x', 5, [], {}, { visited: 'yes' }, { visited: false, extra: "'; DROP TABLE jobs;--" }]) {
      expect(Array.isArray(call(IPC.list, req))).toBe(true)
    }
    expect(call(IPC.list)).toHaveLength(3)
  })
  it('truthy non-boolean `visited` values are coerced (documented): "false" selects Visited', () => {
    // Weakness-adjacent: !!"false" === true. Pinned so a change is noticed.
    expect(call(IPC.list, { visited: 'false' })).toHaveLength(0)
  })
  it('no args at all (event only)', () => {
    expect(() => handlers.get(IPC.list)!({})).not.toThrow()
  })
})

describe('jobs:visit with malformed ids', () => {
  const bad: unknown[] = [undefined, null, '1', '1 OR 1=1', "'; DROP TABLE jobs;--", NaN, Infinity, 1.5, {}, [], [1], true]
  for (const id of bad) {
    it(`rejects ${typeof id === 'string' ? JSON.stringify(id) : String(id)} and visits nothing`, () => {
      expect(() => call(IPC.visit, id)).toThrow(/integer id/)
      expect(getStats(db).visitedCount).toBe(0)
    })
  }
  it('negative / zero / huge integers return null and visit nothing', () => {
    for (const id of [0, -1, -2147483649, 2 ** 53 - 1, 99999]) {
      expect(call(IPC.visit, id)).toBeNull()
    }
    expect(getStats(db).visitedCount).toBe(0)
  })
  it('numbers beyond safe integer range (1e21 is an Integer) return null', () => {
    expect(call(IPC.visit, 1e21)).toBeNull()
  })
  it('valid id visits exactly that row; extra args ignored', () => {
    const id = listJobs(db, { visited: false })[0].id
    const res = call(IPC.visit, id, 'extra', { x: 1 }) as { visitedAt: number }
    expect(res.visitedAt).toBeTypeOf('number')
    expect(getStats(db).visitedCount).toBe(1)
  })
})

describe('jobs:open with malformed ids', () => {
  for (const id of [undefined, null, '1', NaN, 1.5, {}, [], "'; DROP TABLE jobs;--"] as unknown[]) {
    it(`rejects ${typeof id === 'string' ? JSON.stringify(id) : String(id)} without opening or visiting`, async () => {
      await expect(call(IPC.open, id)).rejects.toThrow(/integer id/)
      expect(openExternal).not.toHaveBeenCalled()
      expect(getStats(db).visitedCount).toBe(0)
    })
  }
  it('unknown ids -> null, no open', async () => {
    for (const id of [0, -5, 123456]) await expect(call(IPC.open, id)).resolves.toBeNull()
    expect(openExternal).not.toHaveBeenCalled()
  })
  it('javascript: URL row is refused and stays unvisited', async () => {
    const js = listJobs(db, { visited: false }).find((j) => j.url.startsWith('javascript:'))!
    await expect(call(IPC.open, js.id)).rejects.toThrow(/non-http/)
    expect(openExternal).not.toHaveBeenCalled()
    expect(getStats(db).visitedCount).toBe(0)
  })
  it('openExternal failure leaves the job unvisited', async () => {
    openExternal.mockRejectedValueOnce(new Error('no browser'))
    const ok = listJobs(db, { visited: false }).find((j) => j.url.startsWith('https://'))!
    await expect(call(IPC.open, ok.id)).rejects.toThrow('no browser')
    expect(getStats(db).visitedCount).toBe(0)
  })
  it('valid https row opens the normalized URL then marks visited', async () => {
    const ok = listJobs(db, { visited: false }).find((j) => j.url.startsWith('https://'))!
    await call(IPC.open, ok.id)
    expect(openExternal).toHaveBeenCalledWith(new URL(ok.url).toString())
    expect(getStats(db).visitedCount).toBe(1)
  })
})

describe('jobs:stats / jobs:refresh', () => {
  it('stats ignores args', () => {
    expect(call(IPC.stats, "'; DROP", {})).toMatchObject({ newCount: 3, visitedCount: 0 })
  })
  it('refresh ignores args and passes the service result through', async () => {
    await expect(call(IPC.refresh, { evil: 1 })).resolves.toMatchObject({ inserted: 0 })
    expect(refresh).toHaveBeenCalledWith()
  })
  it('refresh rejection propagates (renderer sees an error, not a hang)', async () => {
    refresh.mockRejectedValueOnce(new Error('boom'))
    await expect(call(IPC.refresh)).rejects.toThrow('boom')
  })
})
