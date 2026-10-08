import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../shared/ipc'
import { MAX_API_KEY_LENGTH, type JSearchRunResult } from '../shared/jsearch'
import type { JSearchService } from './sources/jsearch'

vi.mock('electron', async () => (await import('./testing/electron')).electronMock())

import { handlers } from './testing/electron'
import { createDeepRunner, registerJSearchIpc } from './jsearchIpc'

const KEY = 'test-key-SECRET123'
const res = (inserted: number, ok = true): JSearchRunResult => ({
  ok,
  message: 'm',
  summary: { fetched: 1, kept: inserted, inserted, updated: 0, skippedDuplicates: 0, requests: 4 }
})

interface Fake {
  runDeepRefresh: ReturnType<typeof vi.fn>
  maybeRunWeekly: ReturnType<typeof vi.fn>
  setKey: ReturnType<typeof vi.fn>
  clearKey: ReturnType<typeof vi.fn>
  setSerpapiKey: ReturnType<typeof vi.fn>
  clearSerpapiKey: ReturnType<typeof vi.fn>
  getStatus: ReturnType<typeof vi.fn>
}
const fake = (): Fake => ({
  runDeepRefresh: vi.fn(async () => res(0)),
  maybeRunWeekly: vi.fn(async () => null),
  setKey: vi.fn(),
  clearKey: vi.fn(),
  setSerpapiKey: vi.fn(),
  clearSerpapiKey: vi.fn(),
  getStatus: vi.fn(() => ({ configured: true }))
})
const asSvc = (f: Fake): JSearchService => f as unknown as JSearchService
const call = (ch: string, ...a: unknown[]): unknown => handlers.get(ch)!({}, ...a)

beforeEach(() => {
  handlers.clear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('createDeepRunner', () => {
  it('shares one in-flight promise between concurrent deepRefresh calls', async () => {
    const f = fake()
    let release!: (r: JSearchRunResult) => void
    f.runDeepRefresh.mockImplementation(() => new Promise((r) => (release = r)))
    const notify = vi.fn()
    const runner = createDeepRunner(asSvc(f), notify)
    const a = runner.deepRefresh()
    const b = runner.deepRefresh()
    expect(a).toBe(b)
    release(res(3))
    await Promise.all([a, b])
    expect(f.runDeepRefresh).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledTimes(1)
    f.runDeepRefresh.mockResolvedValue(res(0))
    await runner.deepRefresh()
    expect(f.runDeepRefresh).toHaveBeenCalledTimes(2)
  })

  it('notifies only when inserted > 0 and ok', async () => {
    const f = fake()
    const notify = vi.fn()
    const runner = createDeepRunner(asSvc(f), notify)
    f.runDeepRefresh.mockResolvedValueOnce(res(0))
    await runner.deepRefresh()
    f.runDeepRefresh.mockResolvedValueOnce(res(2, false))
    await runner.deepRefresh()
    f.runDeepRefresh.mockResolvedValueOnce({ ok: true, message: 'x' })
    await runner.deepRefresh()
    expect(notify).not.toHaveBeenCalled()
    f.runDeepRefresh.mockResolvedValueOnce(res(2))
    await runner.deepRefresh()
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('a throwing notify or service does not reject and does not echo the key', async () => {
    const f = fake()
    const runner = createDeepRunner(asSvc(f), () => {
      throw new Error('n')
    })
    f.runDeepRefresh.mockResolvedValueOnce(res(1))
    await expect(runner.deepRefresh()).resolves.toMatchObject({ ok: true })
    f.runDeepRefresh.mockRejectedValueOnce(new Error(`boom ${KEY}`))
    const r = await runner.deepRefresh()
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain(KEY)
  })

  it('maybeRunWeekly returns null while a manual run is in flight, without touching the service', async () => {
    const f = fake()
    let release!: (r: JSearchRunResult) => void
    f.runDeepRefresh.mockImplementation(() => new Promise((r) => (release = r)))
    const runner = createDeepRunner(asSvc(f), vi.fn())
    const p = runner.deepRefresh()
    expect(await runner.maybeRunWeekly()).toBeNull()
    expect(f.maybeRunWeekly).not.toHaveBeenCalled()
    release(res(0))
    await p
  })

  it('maybeRunWeekly passes through null, and notifies on inserted > 0', async () => {
    const f = fake()
    const notify = vi.fn()
    const runner = createDeepRunner(asSvc(f), notify)
    expect(await runner.maybeRunWeekly()).toBeNull()
    expect(notify).not.toHaveBeenCalled()
    f.maybeRunWeekly.mockResolvedValueOnce(res(4))
    expect((await runner.maybeRunWeekly())?.ok).toBe(true)
    expect(notify).toHaveBeenCalledTimes(1)
  })
})

describe('registerJSearchIpc: jsearch:setKey', () => {
  const setup = (f = fake()): Fake => {
    registerJSearchIpc(asSvc(f), createDeepRunner(asSvc(f), vi.fn()))
    return f
  }

  it('registers all six channels', () => {
    setup()
    for (const ch of [
      IPC.jsearchStatus,
      IPC.jsearchSetKey,
      IPC.jsearchClearKey,
      IPC.jsearchSetSerpapiKey,
      IPC.jsearchClearSerpapiKey,
      IPC.jsearchDeepRefresh
    ]) {
      expect(handlers.has(ch)).toBe(true)
    }
  })

  it.each([undefined, null, 5, {}, '', '   '])('rejects non-string / blank key %j without calling the service', (k) => {
    const f = setup()
    expect(call(IPC.jsearchSetKey, k)).toEqual({ ok: false, error: 'Enter your API key.' })
    expect(f.setKey).not.toHaveBeenCalled()
  })

  it('rejects over-long keys without echoing them', () => {
    const f = setup()
    const long = 'k'.repeat(MAX_API_KEY_LENGTH + 1)
    const r = call(IPC.jsearchSetKey, long) as { ok: boolean; error: string }
    expect(r.ok).toBe(false)
    expect(r.error).not.toContain(long)
    expect(f.setKey).not.toHaveBeenCalled()
  })

  it('success returns {ok:true}', () => {
    const f = setup()
    expect(call(IPC.jsearchSetKey, KEY)).toEqual({ ok: true })
    expect(f.setKey).toHaveBeenCalledWith(KEY)
  })

  it('service throw becomes ok:false with the service message when safe', () => {
    const f = fake()
    f.setKey.mockImplementation(() => {
      throw new Error('Invalid API key format.')
    })
    setup(f)
    expect(call(IPC.jsearchSetKey, KEY)).toEqual({ ok: false, error: 'Invalid API key format.' })
  })

  it('service throw whose message contains the key is replaced (no key echo)', () => {
    const f = fake()
    f.setKey.mockImplementation(() => {
      throw new Error(`bad ${KEY}`)
    })
    setup(f)
    const r = call(IPC.jsearchSetKey, `  ${KEY}  `)
    expect(r).toEqual({ ok: false, error: 'Could not save the key.' })
    expect(JSON.stringify(r)).not.toContain(KEY)
  })

  it('non-Error throw gives a generic message', () => {
    const f = fake()
    f.setKey.mockImplementation(() => {
      throw KEY
    })
    setup(f)
    expect(call(IPC.jsearchSetKey, KEY)).toEqual({ ok: false, error: 'Could not save the key.' })
  })

  it('clearKey and deepRefresh channels delegate', async () => {
    const f = setup()
    expect(call(IPC.jsearchClearKey)).toEqual({ ok: true })
    expect(f.clearKey).toHaveBeenCalled()
    expect(await call(IPC.jsearchDeepRefresh)).toMatchObject({ ok: true })
  })
})

describe('registerJSearchIpc: jsearch:setSerpapiKey / clearSerpapiKey', () => {
  const SPKEY = 'fake-serpapi-key-BBBB2222'
  const setup = (f = fake()): Fake => {
    registerJSearchIpc(asSvc(f), createDeepRunner(asSvc(f), vi.fn()))
    return f
  }

  it('channel names are distinct from the JSearch ones', () => {
    expect(IPC.jsearchSetSerpapiKey).not.toBe(IPC.jsearchSetKey)
    expect(IPC.jsearchClearSerpapiKey).not.toBe(IPC.jsearchClearKey)
  })

  it.each([undefined, null, 5, {}, '', '   '])('rejects non-string / blank key %j without calling the service', (k) => {
    const f = setup()
    expect(call(IPC.jsearchSetSerpapiKey, k)).toEqual({ ok: false, error: 'Enter your API key.' })
    expect(f.setSerpapiKey).not.toHaveBeenCalled()
  })

  it('rejects over-long keys without echoing them', () => {
    const f = setup()
    const long = 'k'.repeat(MAX_API_KEY_LENGTH + 1)
    const r = call(IPC.jsearchSetSerpapiKey, long) as { ok: boolean; error: string }
    expect(r.ok).toBe(false)
    expect(r.error).not.toContain(long)
    expect(f.setSerpapiKey).not.toHaveBeenCalled()
  })

  it('success calls setSerpapiKey (not setKey) and returns {ok:true}', () => {
    const f = setup()
    expect(call(IPC.jsearchSetSerpapiKey, SPKEY)).toEqual({ ok: true })
    expect(f.setSerpapiKey).toHaveBeenCalledWith(SPKEY)
    expect(f.setKey).not.toHaveBeenCalled()
  })

  it('the JSearch channel does not touch the SerpApi store', () => {
    const f = setup()
    call(IPC.jsearchSetKey, KEY)
    expect(f.setSerpapiKey).not.toHaveBeenCalled()
  })

  it('service throw with a safe message is passed through', () => {
    const f = fake()
    f.setSerpapiKey.mockImplementation(() => {
      throw new Error('Invalid API key format.')
    })
    setup(f)
    expect(call(IPC.jsearchSetSerpapiKey, SPKEY)).toEqual({ ok: false, error: 'Invalid API key format.' })
  })

  it('service throw whose message contains the key is replaced by "Could not save the key."', () => {
    const f = fake()
    f.setSerpapiKey.mockImplementation(() => {
      throw new Error(`bad ${SPKEY}`)
    })
    setup(f)
    const r = call(IPC.jsearchSetSerpapiKey, `  ${SPKEY}  `)
    expect(r).toEqual({ ok: false, error: 'Could not save the key.' })
    expect(JSON.stringify(r)).not.toContain(SPKEY)
  })

  it('non-Error throw and empty-message throw give the generic message', () => {
    const f = fake()
    f.setSerpapiKey.mockImplementationOnce(() => {
      throw SPKEY
    })
    f.setSerpapiKey.mockImplementationOnce(() => {
      throw new Error('')
    })
    setup(f)
    expect(call(IPC.jsearchSetSerpapiKey, SPKEY)).toEqual({ ok: false, error: 'Could not save the key.' })
    expect(call(IPC.jsearchSetSerpapiKey, SPKEY)).toEqual({ ok: false, error: 'Could not save the key.' })
  })

  it('clear delegates to clearSerpapiKey only', () => {
    const f = setup()
    expect(call(IPC.jsearchClearSerpapiKey)).toEqual({ ok: true })
    expect(f.clearSerpapiKey).toHaveBeenCalledTimes(1)
    expect(f.clearKey).not.toHaveBeenCalled()
  })
})
