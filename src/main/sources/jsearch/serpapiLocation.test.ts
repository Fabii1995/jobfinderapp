import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memDb, tempDirs } from '../../testing/db'
import { createJSearchService, SERPAPI_QUERIES, type FetchLike } from './index'
import { SERPAPI_LOCATION, SERPAPI_TIMEOUT_MS } from './service'

// Fake keys only. Mocked HTTP only. Covers the google_jobs request shape (location=Israel, no gl), per-query network
// error tolerance for SerpApi, 400 param naming, key secrecy on every path, and the 45 s SerpApi timeout.
const JSKEY = 'fake-jsearch-key-AAAA1111'
const SPKEY = 'fake-serpapi-key-BBBB2222'
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0)
const EMPTY_ERR = "Google hasn't returned any results for this query."

const db = memDb()
const tempDir = tempDirs()
let dir: string

type Resp = { ok: boolean; status: number; json(): Promise<unknown>; text?(): Promise<string> }
const ok200 = (body: unknown): Resp => ({ ok: true, status: 200, json: async () => body })
const bad = (status: number, body: unknown): Resp => ({
  ok: false,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body)
})
const fetchMock = vi.fn<FetchLike>()
type Svc = ReturnType<typeof createJSearchService>
const mk = (): Svc => createJSearchService({ userDataDir: dir, db, fetchImpl: fetchMock, now: () => NOW })
const spSvc = (): Svc => {
  const s = mk()
  s.setSerpapiKey(SPKEY)
  return s
}

let logSpies: ReturnType<typeof vi.spyOn>[]
beforeEach(() => {
  dir = tempDir('jf-serploc-')
  fetchMock.mockReset().mockImplementation(async () => ok200({ jobs_results: [] }))
  logSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
})
afterEach(() => {
  vi.restoreAllMocks()
})

const stateFiles = (): string =>
  readdirSync(dir)
    .filter((f) => f !== 'config.json')
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
const logged = (): string => JSON.stringify(logSpies.flatMap((s) => s.mock.calls))
const spUsed = (s: Svc): number => s.getStatus().serpapi.used

describe('SerpApi request URL', () => {
  it('constants', () => {
    expect(SERPAPI_LOCATION).toBe('Israel')
    expect(SERPAPI_QUERIES).toEqual([
      'junior software developer',
      'junior QA engineer',
      'entry level backend developer',
      'junior python developer'
    ])
  })

  it('exact params: engine=google_jobs, q without Israel, location=Israel, hl=en, api_key, no gl', async () => {
    await spSvc().runDeepRefresh()
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const qs: string[] = []
    for (const [url, init] of fetchMock.mock.calls) {
      const u = new URL(url)
      expect(u.origin + u.pathname).toBe('https://serpapi.com/search.json')
      expect([...u.searchParams.keys()].sort()).toEqual(['api_key', 'engine', 'hl', 'location', 'q'])
      expect(u.searchParams.get('engine')).toBe('google_jobs')
      expect(u.searchParams.get('location')).toBe('Israel')
      expect(u.searchParams.get('hl')).toBe('en')
      expect(u.searchParams.get('api_key')).toBe(SPKEY)
      expect(u.searchParams.has('gl')).toBe(false)
      expect(u.searchParams.get('q')).not.toMatch(/israel/i)
      expect(init.method).toBe('GET')
      qs.push(u.searchParams.get('q')!)
    }
    expect(qs).toEqual(SERPAPI_QUERIES)
  })
})

describe('SerpApi timeout', () => {
  it('SERPAPI_TIMEOUT_MS is 45000 and is what SerpApi requests use; JSearch stays 25000', async () => {
    expect(SERPAPI_TIMEOUT_MS).toBe(45_000)
    const spy = vi.spyOn(AbortSignal, 'timeout')
    await spSvc().runDeepRefresh()
    expect(spy).toHaveBeenCalledTimes(4)
    expect(spy.mock.calls.every((c) => c[0] === 45_000)).toBe(true)
    for (const [, init] of fetchMock.mock.calls) expect(init.signal).toBeInstanceOf(AbortSignal)

    spy.mockClear()
    dir = tempDir('jf-serploc-js-')
    const js = mk()
    js.setKey(JSKEY)
    await js.runDeepRefresh()
    expect(spy.mock.calls.length).toBeGreaterThan(0)
    expect(spy.mock.calls.every((c) => c[0] === 25_000)).toBe(true)
  })
})

describe('SerpApi network errors are skipped', () => {
  it('one query throws, the rest succeed: run continues, request counted, failure count reported, ok true', async () => {
    let n = 0
    fetchMock.mockImplementation(async () => {
      if (++n === 2) throw new Error('ETIMEDOUT')
      return ok200({ jobs_results: [] })
    })
    const svc = spSvc()
    const r = await svc.runDeepRefresh()
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(r.ok).toBe(true)
    expect(r.summary?.requests).toBe(4)
    expect(spUsed(svc)).toBe(4)
    expect(JSON.parse(readFileSync(join(dir, 'serpapi-state.json'), 'utf8')).used).toBe(4)
    expect(r.message).toContain('1 of 4 request(s) failed (network error or timeout) and were skipped.')
    expect(svc.getStatus().serpapi.blocked).toBe(false)
  })

  it('a timeout (AbortError/TimeoutError) is treated the same way', async () => {
    let n = 0
    fetchMock.mockImplementation(async () => {
      if (++n === 1) throw new DOMException('The operation timed out', 'TimeoutError')
      return ok200({ jobs_results: [] })
    })
    const r = await spSvc().runDeepRefresh()
    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(r.message).toContain('1 of 4 request(s) failed')
  })

  it('rows from queries after a failed one are still ingested', async () => {
    let n = 0
    fetchMock.mockImplementation(async () => {
      if (++n === 1) throw new Error('ECONNRESET')
      return ok200({
        jobs_results: [
          {
            job_id: 'after-fail',
            title: 'Junior QA Engineer',
            company_name: 'NetCo',
            location: 'Tel Aviv-Yafo, Israel',
            description: 'Entry level role for new graduates.',
            apply_options: [{ link: 'https://example.com/j/after-fail' }],
            detected_extensions: { posted_at: '2 days ago' }
          }
        ]
      })
    })
    const r = await spSvc().runDeepRefresh()
    expect(r.ok).toBe(true)
    expect(r.summary).toMatchObject({ kept: 1, inserted: 1, requests: 4 })
  })

  it('all queries fail: ok false, "4 of 4", all counted, not blocked', async () => {
    fetchMock.mockRejectedValue(new Error('ENOTFOUND'))
    const svc = spSvc()
    const r = await svc.runDeepRefresh()
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('4 of 4 request(s) failed (network error or timeout) and were skipped.')
    expect(spUsed(svc)).toBe(4)
    expect(svc.getStatus().serpapi.blocked).toBe(false)
  })

  it('JSearch still stops at the first network error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    const svc = mk()
    svc.setKey(JSKEY)
    const r = await svc.runDeepRefresh()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('A request failed (network error); stopped.')
    expect(r.message).not.toContain('were skipped')
  })

  it('a network error does not hide a later hard stop (500 after a skipped query)', async () => {
    let n = 0
    fetchMock.mockImplementation(async () => {
      if (++n === 1) throw new Error('ECONNRESET')
      return bad(500, { error: 'Upstream exploded' })
    })
    const svc = spSvc()
    const r = await svc.runDeepRefresh()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('A request failed (HTTP 500); stopped.')
    expect(r.message).toContain('1 of 2 request(s) failed')
    expect(spUsed(svc)).toBe(2)
  })
})

describe('SerpApi HTTP 400 param naming', () => {
  it('names the offending param when the error mentions it', async () => {
    fetchMock.mockResolvedValueOnce(bad(400, { error: 'Unsupported `location` parameter' }))
    const svc = spSvc()
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(r.message).toContain('A request failed (HTTP 400); stopped.')
    expect(r.message).toContain('Details: Unsupported `location` parameter')
    expect(r.message).toContain('Offending param named by SerpApi: location (sent: engine, q, location, hl).')
    expect(spUsed(svc)).toBe(0) // 4xx refunded
    expect(svc.getStatus().serpapi.blocked).toBe(false)
  })

  it('plain wording "Unsupported location parameter" also names location', async () => {
    fetchMock.mockResolvedValueOnce(bad(400, { error: 'Unsupported location parameter' }))
    const r = await spSvc().runDeepRefresh()
    expect(r.message).toContain('Offending param named by SerpApi: location')
  })

  it('an unnamed 400 lists the params sent', async () => {
    fetchMock.mockResolvedValueOnce(bad(400, { error: 'Bad request' }))
    const r = await spSvc().runDeepRefresh()
    expect(r.message).toContain('Details: Bad request (params sent: engine, q, location, hl).')
    expect(r.message).not.toContain('Offending param')
  })

  it('does not match param names embedded in longer words (e.g. "global")', async () => {
    fetchMock.mockResolvedValueOnce(bad(400, { error: 'global outage, please retry' }))
    const r = await spSvc().runDeepRefresh()
    expect(r.message).not.toContain('Offending param')
  })
})

describe('SerpApi "no results" with location set', () => {
  it('is a normal empty result: ok, not blocked, all 4 queries, counted', async () => {
    fetchMock.mockImplementation(async () => ok200({ error: EMPTY_ERR }))
    const svc = spSvc()
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(r.summary).toMatchObject({ fetched: 0, kept: 0, requests: 4 })
    expect(r.message).toContain('normal empty result')
    expect(r.message).not.toContain('were skipped')
    expect(svc.getStatus().serpapi.blocked).toBe(false)
    expect(spUsed(svc)).toBe(4)
    for (const [url] of fetchMock.mock.calls) expect(new URL(url).searchParams.get('location')).toBe('Israel')
  })

  it('"Unsupported location parameter" in a 200 body is a hard error (stops), not a quiet empty', async () => {
    fetchMock.mockImplementation(async () => ok200({ error: 'Unsupported location parameter' }))
    const r = await spSvc().runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('SerpApi key never leaks (new paths)', () => {
  const everything = (svc: Svc, r: unknown): string => JSON.stringify([r, svc.getStatus()]) + stateFiles() + logged()

  it('network error whose message embeds the api_key URL and headers', async () => {
    fetchMock.mockImplementation(async (u, init) => {
      throw new Error(`fetch failed ${u} ${JSON.stringify(init.headers)} api_key=${SPKEY}`)
    })
    const svc = spSvc()
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(everything(svc, r)).not.toContain(SPKEY)
  })

  it('400 whose error text echoes the full request URL and the key', async () => {
    fetchMock.mockImplementation(async (u) =>
      bad(400, { error: `Unsupported location parameter in ${u} (key ${SPKEY}) x-api-key: ${SPKEY}` })
    )
    const svc = spSvc()
    const r = await svc.runDeepRefresh()
    expect(r.message).toContain('Offending param named by SerpApi')
    expect(r.message).toContain('api_key=***')
    expect(everything(svc, r)).not.toContain(SPKEY)
  })

  it('mixed run: skipped network error then 400, both keys configured', async () => {
    let n = 0
    fetchMock.mockImplementation(async (u) => {
      if (++n === 1) throw new Error(`down ${u}`)
      return bad(400, { error: `bad location ${SPKEY}` })
    })
    const svc = mk()
    svc.setKey(JSKEY)
    svc.setSerpapiKey(SPKEY)
    // force SerpApi: JSearch near its limit
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'jsearch-state.json'), JSON.stringify({ month: '2026-10', used: 180, seen: {} }))
    const r = await svc.runDeepRefresh()
    expect(r.provider).toBe('serpapi')
    const all = everything(svc, r)
    expect(all).not.toContain(SPKEY)
    expect(all).not.toContain(JSKEY)
  })

  it('empty-result path with key echoed in the error text', async () => {
    fetchMock.mockImplementation(async () => ok200({ error: `${EMPTY_ERR} api_key=${SPKEY}` }))
    const svc = spSvc()
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(true)
    expect(everything(svc, r)).not.toContain(SPKEY)
  })
})
