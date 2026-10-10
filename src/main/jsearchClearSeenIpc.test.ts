import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../shared/ipc'
import type { JSearchRunResult } from '../shared/jsearch'
import type { JSearchService } from './sources/jsearch'

vi.mock('electron', async () => (await import('./testing/electron')).electronMock())

import { handlers } from './testing/electron'
import { createDeepRunner, registerJSearchIpc } from './jsearchIpc'

const KEY = 'test-key-SECRET123'
const res = (inserted = 0): JSearchRunResult => ({
  ok: true,
  message: 'm',
  summary: { fetched: 1, kept: inserted, inserted, updated: 0, skippedDuplicates: 0, requests: 4 }
})

interface Fake {
  runDeepRefresh: ReturnType<typeof vi.fn>
  maybeRunWeekly: ReturnType<typeof vi.fn>
  clearSeen: ReturnType<typeof vi.fn>
  getStatus: ReturnType<typeof vi.fn>
  setKey: ReturnType<typeof vi.fn>
  clearKey: ReturnType<typeof vi.fn>
  setSerpapiKey: ReturnType<typeof vi.fn>
  clearSerpapiKey: ReturnType<typeof vi.fn>
}
const fake = (): Fake => ({
  runDeepRefresh: vi.fn(async () => res()),
  maybeRunWeekly: vi.fn(async () => null),
  clearSeen: vi.fn(() => ({ ok: true, cleared: 7 })),
  getStatus: vi.fn(() => ({ configured: true })),
  setKey: vi.fn(),
  clearKey: vi.fn(),
  setSerpapiKey: vi.fn(),
  clearSerpapiKey: vi.fn()
})
const asSvc = (f: Fake): JSearchService => f as unknown as JSearchService
const call = (...a: unknown[]): unknown => handlers.get(IPC.jsearchClearSeen)!({}, ...a)

function setup(f = fake()): { f: Fake; runner: ReturnType<typeof createDeepRunner> } {
  const runner = createDeepRunner(asSvc(f), vi.fn())
  registerJSearchIpc(asSvc(f), runner)
  return { f, runner }
}

beforeEach(() => {
  handlers.clear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('createDeepRunner.isRunning', () => {
  it('is false when idle, true while a deep refresh is in flight, false again after', async () => {
    const f = fake()
    let release!: (r: JSearchRunResult) => void
    f.runDeepRefresh.mockImplementation(() => new Promise((r) => (release = r)))
    const runner = createDeepRunner(asSvc(f), vi.fn())
    expect(runner.isRunning()).toBe(false)
    const p = runner.deepRefresh()
    expect(runner.isRunning()).toBe(true)
    release(res())
    await p
    expect(runner.isRunning()).toBe(false)
  })

  it('goes back to false after a failed/throwing run', async () => {
    const f = fake()
    f.runDeepRefresh.mockRejectedValueOnce(new Error('boom'))
    const runner = createDeepRunner(asSvc(f), vi.fn())
    await runner.deepRefresh()
    expect(runner.isRunning()).toBe(false)
  })
})

describe('registerJSearchIpc: jsearch:clearSeen', () => {
  it('registers the channel', () => {
    setup()
    expect(IPC.jsearchClearSeen).toBeTruthy()
    expect(handlers.has(IPC.jsearchClearSeen)).toBe(true)
  })

  it.each([[1], ['x'], [undefined], [null], [{}], [1, 2]])('extra args %j -> Invalid request., service untouched', (...args) => {
    const { f } = setup()
    expect(call(...args)).toEqual({ ok: false, error: 'Invalid request.' })
    expect(f.clearSeen).not.toHaveBeenCalled()
  })

  it('refuses while the runner has a manual run in flight, without calling the service', async () => {
    const f = fake()
    let release!: (r: JSearchRunResult) => void
    f.runDeepRefresh.mockImplementation(() => new Promise((r) => (release = r)))
    const { runner } = setup(f)
    const p = runner.deepRefresh()
    expect(call()).toEqual({ ok: false, error: 'A deep refresh is running; try again when it finishes.' })
    expect(f.clearSeen).not.toHaveBeenCalled()
    release(res())
    await p
    expect(call()).toEqual({ ok: true, cleared: 7 })
  })

  it('success passes the cleared count through, nothing else', () => {
    const { f } = setup()
    expect(call()).toEqual({ ok: true, cleared: 7 })
    expect(f.clearSeen).toHaveBeenCalledTimes(1)
    expect(f.clearSeen).toHaveBeenCalledWith()
    expect(f.runDeepRefresh).not.toHaveBeenCalled()
  })

  it('cleared 0 is a valid success', () => {
    const f = fake()
    f.clearSeen.mockReturnValue({ ok: true, cleared: 0 })
    setup(f)
    expect(call()).toEqual({ ok: true, cleared: 0 })
  })

  it('service-level refusal (ok:false) is passed through with its error', () => {
    const f = fake()
    f.clearSeen.mockReturnValue({ ok: false, error: 'A deep refresh is running; try again when it finishes.' })
    setup(f)
    expect(call()).toEqual({ ok: false, error: 'A deep refresh is running; try again when it finishes.' })
  })

  it('an ok:false with a missing/blank error gets a generic message', () => {
    const f = fake()
    f.clearSeen.mockReturnValue({ ok: false, error: '' })
    setup(f)
    expect(call()).toEqual({ ok: false, error: 'Could not clear seen jobs.' })
  })

  it('a thrown error becomes a generic message with no key text', () => {
    const f = fake()
    f.clearSeen.mockImplementation(() => {
      throw new Error(`disk failure while holding ${KEY}`)
    })
    setup(f)
    const r = call()
    expect(r).toEqual({ ok: false, error: 'Could not clear seen jobs.' })
    expect(JSON.stringify(r)).not.toContain(KEY)
  })

  it('a non-Error throw (even the key itself) also yields the generic message', () => {
    const f = fake()
    f.clearSeen.mockImplementation(() => {
      throw KEY
    })
    setup(f)
    const r = call()
    expect(r).toEqual({ ok: false, error: 'Could not clear seen jobs.' })
    expect(JSON.stringify(r)).not.toContain(KEY)
  })

  it('results never contain extra fields from the service (no key/state leaks)', () => {
    const f = fake()
    f.clearSeen.mockReturnValue({ ok: true, cleared: 3, key: KEY, state: { seen: { a: 1 } } })
    setup(f)
    const r = call()
    expect(r).toEqual({ ok: true, cleared: 3 })
    expect(JSON.stringify(r)).not.toContain(KEY)
  })
})
