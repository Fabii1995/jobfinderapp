import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memDb, tempDirs } from '../../testing/db'
import { createJSearchService, QUERIES, SOFT_LIMIT, type FetchLike, type JSearchRunSummary } from './index'
import { extractCursor, PAGE2_QUERY } from './service'

// Page 2 for ONE JSearch query (cursor based). Fake keys and cursors only; mocked HTTP only.
const KEY = 'fake-jsearch-key-AAAA1111'
const CUR = 'CURSOR-tok-9f8e7d6c'
const CUR2 = 'CURSOR-tok-second-5a4b3c'
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0)
const DAY = 24 * 3600 * 1000
const iso = (ms: number): string => new Date(ms).toISOString()
const NOTE = 'Note: page 2 unavailable: no cursor in response.'

const db = memDb()
const tempDir = tempDirs()
let dir: string

type Resp = { ok: boolean; status: number; json(): Promise<unknown>; text?(): Promise<string> }
const ok = (body: unknown): Resp => ({ ok: true, status: 200, json: async () => body })
const bad = (status: number, body: unknown): Resp => ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) })

const jsRow = (id: string, o: Record<string, unknown> = {}): Record<string, unknown> => ({
  job_id: id,
  job_title: 'Junior QA Engineer',
  employer_name: 'Acme',
  job_apply_link: `https://www.linkedin.com/jobs/view/${id}`,
  job_city: 'Tel Aviv',
  job_country: 'IL',
  job_location: 'Tel Aviv, Israel',
  job_is_remote: false,
  job_description: 'Entry level position for new graduates. Manual and automated testing.',
  job_posted_at_datetime_utc: iso(NOW - 2 * DAY),
  ...o
})
const P1_ROWS = (): unknown[] => [
  jsRow('p1k'),
  jsRow('p1loc', { employer_name: 'LocCo', job_country: 'US', job_city: 'New York', job_location: 'New York, USA' })
]
const P2_ROWS = (): unknown[] => [
  jsRow('p2k', { job_title: 'Junior Backend Developer', employer_name: 'Beta' }),
  jsRow('p2seen', { job_title: 'Junior Python Developer', employer_name: 'Gamma' }),
  jsRow('p2old', { employer_name: 'OldCo', job_posted_at_datetime_utc: iso(NOW - 100 * DAY) }),
  jsRow('p2dup', { employer_name: 'Acme' }) // same title+company as p1k
]

const fetchMock = vi.fn<FetchLike>()
const mk = (): ReturnType<typeof createJSearchService> => createJSearchService({ userDataDir: dir, db, fetchImpl: fetchMock, now: () => NOW })
const writeState = (o: Record<string, unknown>): void => writeFileSync(join(dir, 'jsearch-state.json'), JSON.stringify(o))
const readState = (): Record<string, unknown> => JSON.parse(readFileSync(join(dir, 'jsearch-state.json'), 'utf8'))
const allFiles = (): string => readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
const urlOf = (i: number): URL => new URL(fetchMock.mock.calls[i][0])
const queryOf = (i: number): string => urlOf(i).searchParams.get('query')!
const cursorCalls = (): number => fetchMock.mock.calls.filter(([u]) => new URL(u).searchParams.has('cursor')).length

/**
 * Serve by query: PAGE2_QUERY page 1 (no cursor param) -> `page1` body; PAGE2_QUERY with a cursor param -> `page2`;
 * every other query -> empty data.
 */
function serve(page1: unknown, page2: Resp | ((u: URL) => Resp) = ok({ status: 'OK', data: P2_ROWS() })): void {
  fetchMock.mockImplementation(async (url) => {
    const u = new URL(url)
    if (u.searchParams.get('query') !== PAGE2_QUERY) return ok({ status: 'OK', data: [] })
    if (!u.searchParams.has('cursor')) return ok(page1)
    return typeof page2 === 'function' ? page2(u) : page2
  })
}
const withCursor = (extra: Record<string, unknown> = { cursor: CUR }): Record<string, unknown> => ({ status: 'OK', data: P1_ROWS(), ...extra })

let logSpies: ReturnType<typeof vi.spyOn>[]
const logged = (): string => JSON.stringify(logSpies.flatMap((s) => s.mock.calls))
beforeEach(() => {
  dir = tempDir('jf-page2-')
  fetchMock.mockReset()
  logSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('extractCursor', () => {
  it('accepts cursor, next_cursor, data.cursor, meta.cursor in that order; non-empty strings only', () => {
    expect(extractCursor({ cursor: 'a' })).toBe('a')
    expect(extractCursor({ next_cursor: 'b' })).toBe('b')
    expect(extractCursor({ data: { cursor: 'c' } })).toBe('c')
    expect(extractCursor({ meta: { cursor: 'd' } })).toBe('d')
    expect(extractCursor({ cursor: 'a', next_cursor: 'b', data: { cursor: 'c' }, meta: { cursor: 'd' } })).toBe('a')
    expect(extractCursor({ next_cursor: 'b', data: { cursor: 'c' }, meta: { cursor: 'd' } })).toBe('b')
    expect(extractCursor({ data: { cursor: 'c' }, meta: { cursor: 'd' } })).toBe('c')
    expect(extractCursor({ cursor: '', next_cursor: 'b' })).toBe('b')
    for (const v of [null, undefined, 5, 'x', [], { cursor: '' }, { cursor: 7 }, { cursor: null }, { data: [] }, { data: [{ cursor: 'z' }] }]) {
      expect(extractCursor(v)).toBeNull()
    }
  })
})

describe('jsearch page 2: cursor present', () => {
  const shapes: [string, Record<string, unknown>][] = [
    ['cursor', { cursor: CUR }],
    ['next_cursor', { next_cursor: CUR }],
    ['meta.cursor', { meta: { cursor: CUR } }]
  ]
  for (const [name, extra] of shapes) {
    it(`cursor in "${name}" -> 7 requests; 2nd request to the same query carries cursor and num_pages=1`, async () => {
      const svc = mk()
      svc.setKey(KEY)
      serve(withCursor(extra))
      const r = await svc.runDeepRefresh()
      expect(r.ok).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(7)
      expect(r.summary?.requests).toBe(7)
      expect(svc.getStatus().used).toBe(7)
      expect(readState().used).toBe(7)
      // page 2 directly follows page 1 of PAGE2_QUERY (the last query), same params plus cursor
      expect([queryOf(5), queryOf(6)]).toEqual([PAGE2_QUERY, PAGE2_QUERY])
      expect(QUERIES[5]).toBe(PAGE2_QUERY)
      const u1 = urlOf(5)
      const u2 = urlOf(6)
      expect(u1.searchParams.has('cursor')).toBe(false)
      expect(u2.searchParams.get('cursor')).toBe(CUR)
      expect(u2.searchParams.get('num_pages')).toBe('1')
      for (const k of ['query', 'date_posted', 'country']) expect(u2.searchParams.get(k)).toBe(u1.searchParams.get(k))
      expect(fetchMock.mock.calls[6][1].headers['x-api-key']).toBe(KEY)
      expect(r.message).not.toContain(NOTE)
      expect(cursorCalls()).toBe(1) // only the page-2 request has a cursor
    })
  }

  it('cursor in data.cursor (data as an object with jobs) -> 7 requests and page-1 rows are read from data.jobs', async () => {
    const svc = mk()
    svc.setKey(KEY)
    serve({ status: 'OK', data: { cursor: CUR, jobs: P1_ROWS() } })
    const r = await svc.runDeepRefresh()
    expect(fetchMock).toHaveBeenCalledTimes(7)
    expect(urlOf(6).searchParams.get('cursor')).toBe(CUR)
    expect(r.summary).toMatchObject({ requests: 7, fetched: 6 }) // 2 page-1 + 4 page-2 rows
  })

  it('page-2 rows go through the same map/filter/dedupe/seen/dropped/counts code', async () => {
    const svc = mk()
    svc.setKey(KEY)
    writeState({ month: '2026-10', used: 0, seen: { p2seen: NOW - DAY } })
    serve(withCursor())
    const r = await svc.runDeepRefresh()
    const s = r.summary as JSearchRunSummary
    expect(s.requests).toBe(7)
    expect(s.fetched).toBe(6) // 2 + 4
    expect(s.seenSkipped).toBe(1) // p2seen
    expect(s.dropped).toMatchObject({ location: 1, old: 1, duplicate: 1 }) // p1loc, p2old, p2dup (dupes p1k across pages)
    expect(s.kept).toBe(2) // p1k, p2k
    expect(s.inserted).toBe(2)
    expect(s.skippedDuplicates).toBe(s.seenSkipped + s.dropped.duplicate)
    expect(s.fetched).toBe(s.seenSkipped + Object.values(s.dropped).reduce((a, b) => a + b, 0) + s.kept)
    const drops = svc.getDroppedList().map((d) => `${d.reason}:${d.company}`).sort()
    expect(drops).toEqual(['duplicate:Acme', 'location:LocCo', 'old:OldCo'])
    expect(Object.keys(readState().seen as object)).toEqual(expect.arrayContaining(['p1k', 'p2k', 'p2seen']))
    // rerun: every row of both pages is now seen, nothing kept
    const r2 = await svc.runDeepRefresh()
    expect(r2.summary?.requests).toBe(7)
    expect(r2.summary).toMatchObject({ kept: 0, seenSkipped: 6, fetched: 6 })
  })

  it('page 2 empty (no rows) is fine: 7 requests, ok', async () => {
    const svc = mk()
    svc.setKey(KEY)
    serve(withCursor(), ok({ status: 'OK', data: [] }))
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(true)
    expect(r.summary).toMatchObject({ requests: 7, fetched: 2, kept: 1 })
  })

  it('never fetches more than 2 pages even if page 2 returns a cursor too', async () => {
    const svc = mk()
    svc.setKey(KEY)
    serve(withCursor(), ok({ status: 'OK', data: P2_ROWS(), cursor: CUR2, next_cursor: CUR2, meta: { cursor: CUR2 } }))
    const r = await svc.runDeepRefresh()
    expect(fetchMock).toHaveBeenCalledTimes(7)
    expect(r.summary?.requests).toBe(7)
    for (const [u] of fetchMock.mock.calls) expect(u).not.toContain(CUR2)
    expect(r.message).not.toContain(NOTE)
  })

  it('only PAGE2_QUERY gets a second page: cursors on other queries are ignored', async () => {
    const svc = mk()
    svc.setKey(KEY)
    fetchMock.mockImplementation(async (url) => {
      const u = new URL(url)
      return ok({ status: 'OK', data: [], cursor: u.searchParams.get('query') === PAGE2_QUERY ? undefined : 'OTHER-CURSOR' })
    })
    const r = await svc.runDeepRefresh()
    expect(fetchMock).toHaveBeenCalledTimes(6)
    for (const [u] of fetchMock.mock.calls) expect(u).not.toContain('OTHER-CURSOR')
    expect(r.message).toContain(NOTE)
  })
})

describe('jsearch page 2: cursor absent', () => {
  const cases: [string, unknown][] = [
    ['no cursor field', { status: 'OK', data: P1_ROWS() }],
    ['empty-string cursors', { status: 'OK', data: P1_ROWS(), cursor: '', next_cursor: '' }],
    ['non-string cursors', { status: 'OK', data: P1_ROWS(), cursor: 5, meta: { cursor: null } }]
  ]
  for (const [name, body] of cases) {
    it(`${name}: 6 requests, counter +6, message carries the note`, async () => {
      const svc = mk()
      svc.setKey(KEY)
      serve(body)
      const r = await svc.runDeepRefresh()
      expect(r.ok).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(6)
      expect(r.summary?.requests).toBe(6)
      expect(r.message).toContain(` ${NOTE}`)
      expect(svc.getStatus().used).toBe(6)
      expect(readState().used).toBe(6)
      expect(cursorCalls()).toBe(0)
    })
  }

  it('default empty responses: 6 requests plus the note', async () => {
    const svc = mk()
    svc.setKey(KEY)
    fetchMock.mockResolvedValue(ok({ status: 'OK', data: [] }))
    const r = await svc.runDeepRefresh()
    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(r.message).toContain(NOTE)
  })
})

describe('jsearch page 2: errors', () => {
  it('page-2 HTTP 429 blocks the provider like any other 429 (counted, blocked until next month, earlier rows kept)', async () => {
    const svc = mk()
    svc.setKey(KEY)
    serve(withCursor(), bad(429, {}))
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(r.message).toContain('429')
    expect(fetchMock).toHaveBeenCalledTimes(7)
    const st = svc.getStatus()
    expect(st.blocked).toBe(true)
    expect(st.blockedUntil).toBe(iso(Date.UTC(2026, 10, 1)))
    expect(st.used).toBe(7) // 429 stays counted
    expect(readState().used).toBe(7)
    expect(r.summary?.requests).toBe(7)
    expect(r.summary?.kept).toBe(1) // page-1 row p1k still ingested
    fetchMock.mockClear()
    expect((await svc.runDeepRefresh()).ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  for (const status of [401, 403]) {
    it(`page-2 HTTP ${status} blocks and refunds the request`, async () => {
      const svc = mk()
      svc.setKey(KEY)
      serve(withCursor(), bad(status, {}))
      const r = await svc.runDeepRefresh()
      expect(r.ok).toBe(false)
      expect(r.message).toContain(String(status))
      expect(svc.getStatus().blocked).toBe(true)
      expect(svc.getStatus().used).toBe(6) // 4xx except 429 refunded
      expect(r.summary?.requests).toBe(6)
    })
  }

  it('page-2 HTTP 500 stops the run (not blocked); cursor and key echoed by the server never reach message/files/console', async () => {
    const svc = mk()
    svc.setKey(KEY)
    serve(withCursor(), bad(500, { error: `bad cursor ${CUR} for x-api-key: ${KEY} api_key=${KEY}` }))
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(r.message).toContain('HTTP 500')
    expect(svc.getStatus().blocked).toBe(false)
    const state = readdirSync(dir).filter((f) => f.endsWith('-state.json')).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
    for (const s of [r.message, state, logged(), JSON.stringify(svc.getDroppedList())]) {
      expect(s).not.toContain(CUR)
      expect(s).not.toContain(KEY)
    }
  })

  it('page-2 network error stops the run with a generic message (no cursor, no key)', async () => {
    const svc = mk()
    svc.setKey(KEY)
    serve(withCursor(), () => {
      throw new Error(`connect failed for ${CUR} ${KEY}`)
    })
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(r.message).toContain('network error')
    for (const s of [r.message, logged()]) {
      expect(s).not.toContain(CUR)
      expect(s).not.toContain(KEY)
    }
  })

  it('page-2 400 with the cursor echoed: refunded, message scrubbed', async () => {
    const svc = mk()
    svc.setKey(KEY)
    serve(withCursor(), bad(400, { message: `invalid cursor ${CUR}` }))
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(r.message).toContain('HTTP 400')
    expect(r.message).not.toContain(CUR)
    expect(svc.getStatus().used).toBe(6)
  })
})

describe('jsearch page 2: monthly cap', () => {
  const setup = (used: number): ReturnType<typeof createJSearchService> => {
    const svc = mk()
    svc.setKey(KEY)
    writeState({ month: '2026-10', used, seen: {} })
    serve(withCursor())
    return svc
  }

  it('start 193 with cursor: 7 requests ending exactly at 200, page 2 sent, no early-stop note', async () => {
    const svc = setup(193)
    const r = await svc.runDeepRefresh()
    expect(fetchMock).toHaveBeenCalledTimes(7)
    expect(cursorCalls()).toBe(1)
    expect(r.summary?.requests).toBe(7)
    expect(r.message).not.toMatch(/Stopped early/)
    expect(svc.getStatus().used).toBe(SOFT_LIMIT)
    expect(readState().used).toBe(SOFT_LIMIT)
    expect(svc.getStatus().blocked).toBe(true)
  })

  it('start 194 with cursor: 6 requests ending at 200, page 2 truncated, stops early', async () => {
    const svc = setup(194)
    const r = await svc.runDeepRefresh()
    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(cursorCalls()).toBe(0)
    expect(r.summary?.requests).toBe(6)
    expect(r.message).toContain('Stopped early: monthly limit reached.')
    expect(svc.getStatus().used).toBe(SOFT_LIMIT)
    expect(readState().used).toBe(SOFT_LIMIT)
    expect(svc.getStatus().blocked).toBe(true)
  })

  it('start 195: truncates before PAGE2_QUERY page 1 (5 requests, no page 2)', async () => {
    const svc = setup(195)
    const r = await svc.runDeepRefresh()
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(cursorCalls()).toBe(0)
    expect(r.message).toContain('Stopped early: monthly limit reached.')
    expect(svc.getStatus().used).toBe(SOFT_LIMIT)
  })

  it('start 169 with cursor stays on JSearch: 7 requests ending at 176', async () => {
    const svc = setup(169)
    svc.setSerpapiKey('serp-key-SECRET789')
    const r = await svc.runDeepRefresh()
    expect(r.summary?.provider).toBe('jsearch')
    expect(fetchMock).toHaveBeenCalledTimes(7)
    expect(svc.getStatus().used).toBe(176)
  })

  it('never exceeds 200 from any start between 190 and 200, and never more than 7 requests', async () => {
    for (let start = 190; start <= 200; start++) {
      dir = tempDir('jf-page2cap-')
      fetchMock.mockReset()
      const svc = setup(start)
      await svc.runDeepRefresh()
      const expectedCalls = Math.min(7, SOFT_LIMIT - start)
      expect(fetchMock.mock.calls.length, `start=${start}`).toBe(expectedCalls)
      expect(readState().used, `start=${start}`).toBeLessThanOrEqual(SOFT_LIMIT)
      expect(svc.getStatus().used, `start=${start}`).toBe(start + expectedCalls)
    }
  })
})

describe('jsearch page 2: secrets', () => {
  it('API key and cursor value never appear in the message, console, state files, status or dropped list', async () => {
    const svc = mk()
    svc.setKey(KEY)
    serve(withCursor())
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(true)
    const surfaces = [r.message, JSON.stringify(r.summary), JSON.stringify(svc.getStatus()), JSON.stringify(svc.getDroppedList()), logged()]
    for (const s of surfaces) {
      expect(s).not.toContain(CUR)
      expect(s).not.toContain(KEY)
    }
    const state = readdirSync(dir).filter((f) => f.endsWith('-state.json')).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
    expect(state).not.toContain(CUR)
    expect(state).not.toContain(KEY)
    const cfg = readFileSync(join(dir, 'config.json'), 'utf8')
    expect(cfg).toContain(KEY) // the key lives only in config.json
    expect(cfg).not.toContain(CUR)
    expect(allFiles()).not.toContain(CUR)
  })
})
