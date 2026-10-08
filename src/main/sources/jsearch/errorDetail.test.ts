import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memDb, tempDirs } from '../../testing/db'
import { createJSearchService, SERPAPI_QUERIES, type FetchLike } from './index'

// Fake keys only. Mocked HTTP only.
const JSKEY = 'fake-jsearch-key-AAAA1111'
const SPKEY = 'fake-serpapi-key-BBBB2222'
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0)

const db = memDb()
const tempDir = tempDirs()
let dir: string

type Resp = { ok: boolean; status: number; json(): Promise<unknown>; text?(): Promise<string> }
const bodyResp = (status: number, body: unknown, mode: 'text' | 'json' = 'text'): Resp =>
  mode === 'text'
    ? { ok: false, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }
    : { ok: false, status, json: async () => body }
const okJson = (body: unknown): Resp => ({ ok: true, status: 200, json: async () => body })

type Svc = ReturnType<typeof createJSearchService>
const fetchMock = vi.fn<FetchLike>()
const mk = (): Svc => createJSearchService({ userDataDir: dir, db, fetchImpl: fetchMock, now: () => NOW })

let logSpies: ReturnType<typeof vi.spyOn>[]
beforeEach(() => {
  dir = tempDir('jf-errdetail-')
  fetchMock.mockReset()
  logSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
})
afterEach(() => {
  vi.restoreAllMocks()
})

const readFiles = (): string =>
  readdirSync(dir)
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
const stateFile = (p: 'jsearch' | 'serpapi'): Record<string, unknown> =>
  JSON.parse(readFileSync(join(dir, `${p}-state.json`), 'utf8'))

interface Prov {
  name: 'jsearch' | 'serpapi'
  key: string
  setup(svc: Svc): void
  used(svc: Svc): number
  blocked(svc: Svc): boolean
}
const provs: Prov[] = [
  { name: 'jsearch', key: JSKEY, setup: (s) => s.setKey(JSKEY), used: (s) => s.getStatus().used, blocked: (s) => s.getStatus().blocked },
  {
    name: 'serpapi',
    key: SPKEY,
    setup: (s) => s.setSerpapiKey(SPKEY),
    used: (s) => s.getStatus().serpapi.used,
    blocked: (s) => s.getStatus().serpapi.blocked
  }
]

for (const p of provs) {
  describe(`${p.name}: non-2xx error detail and counter refund`, () => {
    // Everything an observer could see: message, status, ALL files in userData except config.json is included too
    // only for the OTHER provider's key; here we check the key of this provider is absent from state/status/console.
    const leaks = (svc: Svc, msg: string): string => {
      const files = readdirSync(dir)
        .filter((f) => f !== 'config.json')
        .map((f) => readFileSync(join(dir, f), 'utf8'))
        .join('\n')
      return msg + JSON.stringify(svc.getStatus()) + files + JSON.stringify(logSpies.flatMap((s) => s.mock.calls))
    }

    for (const mode of ['text', 'json'] as const) {
      it(`400 with {"error"} (${mode}() body): text surfaced, not blocked, counter refunded, ok false`, async () => {
        const svc = mk()
        p.setup(svc)
        fetchMock.mockResolvedValueOnce(bodyResp(400, { error: 'Invalid parameter foo' }, mode))
        const r = await svc.runDeepRefresh()
        expect(r.ok).toBe(false)
        expect(r.message).toContain('A request failed (HTTP 400); stopped.')
        expect(r.message).toContain('Details: Invalid parameter foo')
        expect(fetchMock).toHaveBeenCalledTimes(1) // run stops
        expect(p.blocked(svc)).toBe(false)
        expect(p.used(svc)).toBe(0)
        expect(r.summary?.requests).toBe(0)
        expect(stateFile(p.name).used).toBe(0) // persisted
        expect(p.used(mk())).toBe(0)
        expect(leaks(svc, r.message)).not.toContain(p.key)
      })
    }

    it('"message" field is used when there is no "error"', async () => {
      const svc = mk()
      p.setup(svc)
      fetchMock.mockResolvedValueOnce(bodyResp(400, { message: 'Bad thing happened' }))
      const r = await svc.runDeepRefresh()
      expect(r.message).toContain('Details: Bad thing happened')
    })

    it('plain-text (non-JSON) body is surfaced; whitespace collapsed', async () => {
      const svc = mk()
      p.setup(svc)
      fetchMock.mockResolvedValueOnce(bodyResp(400, 'Bad   request\n\n  here'))
      const r = await svc.runDeepRefresh()
      expect(r.message).toContain('Details: Bad request here')
    })

    it('unreadable body: still ok false, no Details, counter refunded', async () => {
      const svc = mk()
      p.setup(svc)
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => {
          throw new Error('x')
        },
        text: async () => {
          throw new Error('y')
        }
      })
      const r = await svc.runDeepRefresh()
      expect(r.ok).toBe(false)
      expect(r.message).not.toContain('Details:')
      expect(p.used(svc)).toBe(0)
    })

    for (const status of [401, 403]) {
      it(`${status} blocks with Details, counter refunded, key not leaked`, async () => {
        const svc = mk()
        p.setup(svc)
        fetchMock.mockResolvedValueOnce(bodyResp(status, { error: 'Invalid credentials for this account' }))
        const r = await svc.runDeepRefresh()
        expect(r.ok).toBe(false)
        expect(r.message).toContain(`HTTP ${status}`)
        expect(r.message).toContain('Details: Invalid credentials for this account')
        expect(p.blocked(svc)).toBe(true)
        expect(p.used(svc)).toBe(0)
        expect(leaks(svc, r.message)).not.toContain(p.key)
      })
    }

    it('429 blocks with Details and STAYS counted', async () => {
      const svc = mk()
      p.setup(svc)
      fetchMock.mockResolvedValueOnce(bodyResp(429, { error: 'Too many requests' }))
      const r = await svc.runDeepRefresh()
      expect(r.ok).toBe(false)
      expect(r.message).toContain('HTTP 429')
      expect(r.message).toContain('Details: Too many requests')
      expect(p.blocked(svc)).toBe(true)
      expect(p.used(svc)).toBe(1)
      expect(r.summary?.requests).toBe(1)
    })

    it('500 stays counted, is not blocked, shows Details', async () => {
      const svc = mk()
      p.setup(svc)
      fetchMock.mockResolvedValueOnce(bodyResp(500, { error: 'Upstream exploded' }))
      const r = await svc.runDeepRefresh()
      expect(r.ok).toBe(false)
      expect(r.message).toContain('A request failed (HTTP 500); stopped.')
      expect(r.message).toContain('Details: Upstream exploded')
      expect(p.blocked(svc)).toBe(false)
      expect(p.used(svc)).toBe(1)
      expect(r.summary?.requests).toBe(1)
    })

    it('network error stays counted and is not blocked', async () => {
      const svc = mk()
      p.setup(svc)
      fetchMock.mockRejectedValue(new Error('ECONNRESET'))
      const r = await svc.runDeepRefresh()
      expect(r.ok).toBe(false)
      expect(p.blocked(svc)).toBe(false)
      // JSearch stops on the first network error; SerpApi skips it and tries every query (all counted).
      expect(p.used(svc)).toBe(p.name === 'jsearch' ? 1 : SERPAPI_QUERIES.length)
    })

    it('long error is truncated to 200 chars plus "..."', async () => {
      const svc = mk()
      p.setup(svc)
      fetchMock.mockResolvedValueOnce(bodyResp(400, { error: 'x'.repeat(500) }))
      const r = await svc.runDeepRefresh()
      // SerpApi 400s append a " (params sent: ...)" hint after the details.
      expect(r.message.split('Details: ')[1].startsWith(`${'x'.repeat(200)}...`)).toBe(true)
      expect(r.message).not.toContain('x'.repeat(201))
    })

    it('error body containing the key / api_key= / x-api-key is scrubbed', async () => {
      const svc = mk()
      p.setup(svc)
      const err = `bad url https://x.test/search?q=a&api_key=${p.key}&hl=en and x-api-key: ${p.key} raw ${p.key}`
      fetchMock.mockResolvedValueOnce(bodyResp(400, { error: err }))
      const r = await svc.runDeepRefresh()
      expect(r.message).toContain('Details:')
      expect(r.message).toContain('api_key=***')
      expect(leaks(svc, r.message)).not.toContain(p.key)
    })

    it('scrubs api_key=<value> even when the value is not the configured key', async () => {
      const svc = mk()
      p.setup(svc)
      fetchMock.mockResolvedValueOnce(bodyResp(400, { error: 'see ?api_key=zzTOPSECRETzz&x=1' }))
      const r = await svc.runDeepRefresh()
      expect(r.message).not.toContain('zzTOPSECRETzz')
    })

    it('success path: key never in message, status, state files or console', async () => {
      const svc = mk()
      p.setup(svc)
      fetchMock.mockResolvedValue(okJson({ jobs_results: [], data: [] }))
      const r = await svc.runDeepRefresh()
      expect(r.ok).toBe(true)
      expect(leaks(svc, r.message)).not.toContain(p.key)
    })
  })
}

describe('serpapi: 200-body error details and request URL', () => {
  it('unknown 200 error -> "SerpApi returned an error; stopped. Details: <text>", not blocked, counted', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    fetchMock.mockResolvedValue(okJson({ error: `Something odd api_key=${SPKEY}` }))
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(r.message).toContain('SerpApi returned an error; stopped. Details: Something odd api_key=***')
    expect(r.message).not.toContain(SPKEY)
    expect(svc.getStatus().serpapi.blocked).toBe(false)
    expect(svc.getStatus().serpapi.used).toBe(1) // 200 stays counted
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  for (const e of ['Your account has run out of searches.', 'Invalid API key. Your API key should be here.']) {
    it(`200 JSON error "${e}" blocks and stays counted`, async () => {
      const svc = mk()
      svc.setSerpapiKey(SPKEY)
      fetchMock.mockResolvedValue(okJson({ error: e }))
      const r = await svc.runDeepRefresh()
      expect(r.ok).toBe(false)
      expect(svc.getStatus().serpapi.blocked).toBe(true)
      expect(svc.getStatus().serpapi.used).toBe(1)
    })
  }

  it('URL has exactly engine, q, location, hl, api_key: no gl; queries carry no "Israel"', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    fetchMock.mockResolvedValue(okJson({ jobs_results: [] }))
    await svc.runDeepRefresh()
    expect(fetchMock).toHaveBeenCalledTimes(SERPAPI_QUERIES.length)
    for (const [url] of fetchMock.mock.calls) {
      const u = new URL(url)
      expect([...u.searchParams.keys()].sort()).toEqual(['api_key', 'engine', 'hl', 'location', 'q'])
      expect(u.searchParams.get('engine')).toBe('google_jobs')
      expect(u.searchParams.get('hl')).toBe('en')
      expect(u.searchParams.get('api_key')).toBe(SPKEY)
      expect(u.searchParams.get('location')).toBe('Israel')
      expect(u.searchParams.get('q')).not.toMatch(/Israel/i)
      expect(url).not.toMatch(/[?&]gl=/)
    }
    expect(SERPAPI_QUERIES.some((q) => /Israel/i.test(q))).toBe(false)
  })

  it('refund is floored at 0', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    writeFileSync(join(dir, 'serpapi-state.json'), JSON.stringify({ month: '2026-10', used: 0, seen: {} }))
    fetchMock.mockResolvedValueOnce(bodyResp(400, { error: 'nope' }))
    await svc.runDeepRefresh()
    expect(svc.getStatus().serpapi.used).toBe(0)
  })

  it('refund only undoes the rejected request, earlier usage is kept', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    writeFileSync(join(dir, 'serpapi-state.json'), JSON.stringify({ month: '2026-10', used: 5, seen: {} }))
    fetchMock.mockResolvedValueOnce(bodyResp(400, { error: 'nope' }))
    await svc.runDeepRefresh()
    expect(svc.getStatus().serpapi.used).toBe(5)
    void readFiles
  })
})
