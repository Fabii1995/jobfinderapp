import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memDb, tempDirs } from '../../testing/db'
import { scoredJob } from '../../testing/fixtures'
import { jobs } from '../../db/schema'
import { upsertJobs } from '../../jobs/upsert'
import { getJobById, markVisited } from '../../jobs/queries'
import { createJSearchService, QUERIES, SOFT_LIMIT, type FetchLike } from './index'
import { dedupeKey, mapJSearchRow } from './map'

const KEY = 'test-key-SECRET123'
const KEY2 = 'test-key-OTHER456'
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0) // 2026-10-08
const DAY = 24 * 3600 * 1000
const iso = (ms: number): string => new Date(ms).toISOString()

const db = memDb()
const tempDir = tempDirs()
let dir: string
let clock: number
const now = (): number => clock

interface Row {
  job_id: string
  job_title: string
  employer_name: string
  job_apply_link: string
  job_city: string
  job_country: string
  job_location: string
  job_is_remote: boolean
  job_description: string
  job_posted_at_datetime_utc: string
}
const row = (id: string, o: Partial<Row> = {}): Row => ({
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

type Resp = { ok: boolean; status: number; json(): Promise<unknown> }
const okResp = (data: unknown[]): Resp => ({ ok: true, status: 200, json: async () => ({ status: 'OK', data }) })
const errResp = (status: number): Resp => ({ ok: false, status, json: async () => ({}) })

const fetchMock = vi.fn<FetchLike>()
const mk = (): ReturnType<typeof createJSearchService> =>
  createJSearchService({ userDataDir: dir, db, fetchImpl: fetchMock, now })
const writeCfg = (o: Record<string, unknown>): void => writeFileSync(join(dir, 'config.json'), JSON.stringify(o))
const readCfg = (): Record<string, unknown> => JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))
const writeState = (o: Record<string, unknown>): void => writeFileSync(join(dir, 'jsearch-state.json'), JSON.stringify(o))
const readState = (): Record<string, unknown> => JSON.parse(readFileSync(join(dir, 'jsearch-state.json'), 'utf8'))
const allJs = (): { id: number; externalId: string; title: string | null; visitedAt: number | null }[] =>
  db.select().from(jobs).all().filter((j) => j.source === 'jsearch')

let logSpies: ReturnType<typeof vi.spyOn>[]
beforeEach(() => {
  dir = tempDir('jf-jsearch-')
  clock = NOW
  fetchMock.mockReset().mockResolvedValue(okResp([]))
  logSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
})
afterEach(() => {
  vi.restoreAllMocks()
})
const logged = (): string => JSON.stringify(logSpies.flatMap((s) => s.mock.calls))

describe('jsearch: no key', () => {
  it('is inert: no fetch, ok:false, status not configured', async () => {
    const svc = mk()
    expect(svc.getStatus().configured).toBe(false)
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/not configured/i)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(existsSync(join(dir, 'jsearch-state.json'))).toBe(false)
    expect(await svc.maybeRunWeekly()).toBeNull()
  })

  it('status.configured flips with setKey / clearKey; blank key in config counts as unconfigured', () => {
    const svc = mk()
    svc.setKey(KEY)
    expect(svc.getStatus().configured).toBe(true)
    svc.clearKey()
    expect(svc.getStatus().configured).toBe(false)
    writeCfg({ jsearchApiKey: '   ' })
    expect(svc.getStatus().configured).toBe(false)
  })
})

describe('jsearch: request shape and counter', () => {
  it('sends 5 GET search-v2 requests, one page each, with x-api-key header; counter persisted', async () => {
    const svc = mk()
    svc.setKey(KEY)
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(QUERIES).toHaveLength(5)
    const seenQueries: string[] = []
    for (const [url, init] of fetchMock.mock.calls) {
      const u = new URL(url)
      expect(u.origin + u.pathname).toBe('https://api.openwebninja.com/jsearch/search-v2')
      expect(u.searchParams.get('num_pages')).toBe('1')
      seenQueries.push(u.searchParams.get('query')!)
      expect(init.method).toBe('GET')
      expect(init.headers['x-api-key']).toBe(KEY)
      expect(url).not.toContain(KEY)
    }
    expect(seenQueries).toEqual(QUERIES)
    expect(r.summary?.requests).toBe(5)
    expect(svc.getStatus().used).toBe(5)
    expect(readState().used).toBe(5)
    expect(mk().getStatus().used).toBe(5) // new instance sees persisted counter
    await mk().runDeepRefresh()
    expect(mk().getStatus().used).toBe(10)
  })

  it('stops mid-run before exceeding SOFT_LIMIT', async () => {
    const svc = mk()
    svc.setKey(KEY)
    writeState({ month: '2026-10', used: SOFT_LIMIT - 2, seen: {} })
    const r = await svc.runDeepRefresh()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(r.summary?.requests).toBe(2)
    expect(r.message).toMatch(/limit/i)
    const st = svc.getStatus()
    expect(st.used).toBe(SOFT_LIMIT)
    expect(st.blocked).toBe(true)
    fetchMock.mockClear()
    const r2 = await svc.runDeepRefresh()
    expect(r2.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mk().getStatus().used).toBe(SOFT_LIMIT)
  })

  it('QUERIES is exactly the 5 expected strings, in priority order', () => {
    expect([...QUERIES]).toEqual([
      'junior backend developer in Israel',
      'junior QA engineer in Israel',
      'junior python developer in Israel',
      'graduate software engineer in Israel',
      'graduate backend engineer in Israel'
    ])
  })

  it('run starting at used=169 stays on JSearch (SerpApi key present) and does 5 requests ending at 174', async () => {
    const svc = mk()
    svc.setKey(KEY)
    svc.setSerpapiKey('serp-key-SECRET789')
    writeState({ month: '2026-10', used: 169, seen: {} })
    expect(svc.getStatus().activeProvider).toBe('jsearch')
    const r = await svc.runDeepRefresh()
    expect(r.summary?.provider).toBe('jsearch')
    expect(r.summary?.requests).toBe(5)
    expect(fetchMock).toHaveBeenCalledTimes(5)
    for (const [url] of fetchMock.mock.calls) expect(url).toContain('api.openwebninja.com')
    expect(svc.getStatus().used).toBe(174)
    expect(readState().used).toBe(174)
  })

  it('run starting at used=195 does 5 requests ending exactly at 200', async () => {
    const svc = mk()
    svc.setKey(KEY)
    writeState({ month: '2026-10', used: 195, seen: {} })
    const r = await svc.runDeepRefresh()
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(r.summary?.requests).toBe(5)
    expect(r.message).not.toMatch(/Stopped early/)
    expect(svc.getStatus().used).toBe(200)
    expect(svc.getStatus().blocked).toBe(true)
  })

  it('run starting at used=197 does exactly 3 requests, stops early, and never exceeds 200', async () => {
    const svc = mk()
    svc.setKey(KEY)
    writeState({ month: '2026-10', used: 197, seen: {} })
    const r = await svc.runDeepRefresh()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(r.summary?.requests).toBe(3)
    expect(r.message).toContain('Stopped early: monthly limit reached.')
    expect(svc.getStatus().used).toBe(200)
    expect(readState().used).toBe(200)
    fetchMock.mockClear()
    await svc.runDeepRefresh()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(readState().used).toBe(200)
  })

  it('month rollover resets the counter and lifts the cap block', async () => {
    const svc = mk()
    svc.setKey(KEY)
    writeState({ month: '2026-10', used: SOFT_LIMIT, seen: {} })
    expect(svc.getStatus().blocked).toBe(true)
    clock = Date.UTC(2026, 10, 1, 0, 0, 1)
    const st = svc.getStatus()
    expect(st.month).toBe('2026-11')
    expect(st.used).toBe(0)
    expect(st.blocked).toBe(false)
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })
})

describe('jsearch: API-error blocks', () => {
  for (const status of [401, 403, 429]) {
    it(`HTTP ${status} disables until next month, persists, message has no key`, async () => {
      const svc = mk()
      svc.setKey(KEY)
      fetchMock.mockResolvedValueOnce(errResp(status))
      const r = await svc.runDeepRefresh()
      expect(r.ok).toBe(false)
      expect(r.message).toContain(String(status))
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const st = svc.getStatus()
      expect(st.blocked).toBe(true)
      expect(st.blockedUntil).toBe(iso(Date.UTC(2026, 10, 1)))
      expect(st.used).toBe(status === 429 ? 1 : 0) // 4xx except 429 is refunded
      expect(JSON.stringify(st) + r.message).not.toContain(KEY)

      const again = mk() // new instance
      expect(again.getStatus().blocked).toBe(true)
      fetchMock.mockClear()
      expect((await again.runDeepRefresh()).ok).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(await again.maybeRunWeekly()).toBeNull()

      clock = Date.UTC(2026, 10, 1, 0, 0, 1)
      expect(mk().getStatus().blocked).toBe(false)
    })
  }

  it('setKey with a DIFFERENT key lifts the block but keeps the counter; same key changes nothing', async () => {
    const svc = mk()
    svc.setKey(KEY)
    fetchMock.mockResolvedValueOnce(errResp(401))
    await svc.runDeepRefresh()
    svc.setKey(KEY) // same key
    expect(svc.getStatus().blocked).toBe(true)
    svc.setKey(KEY2)
    const st = svc.getStatus()
    expect(st.blocked).toBe(false)
    expect(st.blockedReason).toBeNull()
    expect(st.used).toBe(0) // 401 was refunded
  })

  it('429 (backend choice, see report): a different key also lifts the block', async () => {
    const svc = mk()
    svc.setKey(KEY)
    fetchMock.mockResolvedValueOnce(errResp(429))
    await svc.runDeepRefresh()
    expect(svc.getStatus().blocked).toBe(true)
    svc.setKey(KEY2)
    expect(svc.getStatus().blocked).toBe(false)
    expect(svc.getStatus().used).toBe(1)
  })

  it('a different key does NOT lift the monthly-cap block', () => {
    const svc = mk()
    svc.setKey(KEY)
    writeState({ month: '2026-10', used: SOFT_LIMIT, seen: {} })
    svc.setKey(KEY2)
    expect(svc.getStatus().blocked).toBe(true)
    expect(svc.getStatus().used).toBe(SOFT_LIMIT)
  })

  it('network error: ok:false, no block, no key in message or console', async () => {
    const svc = mk()
    svc.setKey(KEY)
    fetchMock.mockRejectedValue(new Error(`fetch failed: headers {"x-api-key":"${KEY}"}`))
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(r.message).not.toContain(KEY)
    expect(svc.getStatus().blocked).toBe(false)
    expect(svc.getStatus().used).toBe(1)
    expect(logged()).not.toContain(KEY)
  })

  it('other HTTP errors (500) stop the run without a block', async () => {
    const svc = mk()
    svc.setKey(KEY)
    fetchMock.mockResolvedValueOnce(errResp(500))
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(svc.getStatus().blocked).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('jsearch: filtering', () => {
  it('maps a good row and inserts it as source jsearch with externalId = job_id', async () => {
    const svc = mk()
    svc.setKey(KEY)
    fetchMock.mockResolvedValueOnce(okResp([row('j1')]))
    const r = await svc.runDeepRefresh()
    expect(r.summary).toMatchObject({ fetched: 1, kept: 1, inserted: 1, updated: 0 })
    const js = allJs()
    expect(js).toHaveLength(1)
    expect(js[0].externalId).toBe('j1')
  })

  it('drops postings older than 45 days (keeps 44)', () => {
    expect(mapJSearchRow(row('o', { job_posted_at_datetime_utc: iso(NOW - 46 * DAY) }), NOW)).toEqual({ kind: 'drop', reason: 'old' })
    expect(mapJSearchRow(row('n', { job_posted_at_datetime_utc: iso(NOW - 44 * DAY) }), NOW).kind).toBe('job')
  })

  it('drops a bare "Software Engineer" (no junior signal)', () => {
    const out = mapJSearchRow(row('s', { job_title: 'Software Engineer', job_description: 'Build services with our team.' }), NOW)
    expect(out.kind).toBe('drop')
  })

  it('drops non-Israel and remote-only rows', () => {
    const us = mapJSearchRow(row('us', { job_country: 'US', job_city: 'Austin', job_location: 'Austin, TX' }), NOW)
    expect(us).toEqual({ kind: 'drop', reason: 'location' })
    const remote = mapJSearchRow(row('r', { job_is_remote: true, job_city: '', job_location: 'Israel' }), NOW)
    expect(remote.kind).toBe('drop')
  })

  it('drops invalid rows (no title / non-http link / not an object)', () => {
    expect(mapJSearchRow(null, NOW).kind).toBe('drop')
    expect(mapJSearchRow({ ...row('x'), job_title: '' }, NOW).kind).toBe('drop')
    expect(mapJSearchRow({ ...row('x'), job_apply_link: 'javascript:alert(1)' }, NOW).kind).toBe('drop')
  })

  it('normalizes multi-line titles', () => {
    const out = mapJSearchRow(row('m', { job_title: '  Junior QA\n   Engineer \r\n (Tel Aviv) ' }), NOW)
    expect(out.kind).toBe('job')
    if (out.kind === 'job') expect(out.job.title).toBe('Junior QA Engineer (Tel Aviv)')
  })

  it('dedupes against existing ATS rows (normalized title + company) and within the run', async () => {
    upsertJobs(db, [scoredJob({ source: 'greenhouse:acme', externalId: 'g1', title: 'Junior QA Engineer', company: 'Acme Ltd.' })])
    const svc = mk()
    svc.setKey(KEY)
    fetchMock.mockResolvedValueOnce(
      okResp([
        row('d1'), // same as the ATS row after normalization
        row('d2', { job_title: 'Junior Python Developer', employer_name: 'Beta' }),
        row('d3', { job_title: 'JUNIOR python developer!', employer_name: 'Beta Inc' }) // dup within run
      ])
    )
    const r = await svc.runDeepRefresh()
    expect(r.summary).toMatchObject({ fetched: 3, kept: 1, inserted: 1, skippedDuplicates: 2 })
    expect(allJs().map((j) => j.externalId)).toEqual(['d2'])
    expect(dedupeKey('Junior QA Engineer', 'Acme Ltd.')).toBe(dedupeKey('junior qa  engineer', 'ACME'))
  })

  it('job_id cache skips already-seen ids on later queries and later runs (including rejected ones)', async () => {
    const svc = mk()
    svc.setKey(KEY)
    const reject = row('rej', { job_title: 'Software Engineer', job_description: 'generic' })
    fetchMock.mockResolvedValue(okResp([row('keep'), reject]))
    const r1 = await svc.runDeepRefresh()
    expect(r1.summary).toMatchObject({ kept: 1, inserted: 1 })
    expect(r1.summary?.skippedDuplicates).toBe(8) // queries 2-5 return the same two ids
    const r2 = await mk().runDeepRefresh()
    expect(r2.summary).toMatchObject({ kept: 0, inserted: 0, updated: 0, skippedDuplicates: 10 })
    expect(Object.keys(readState().seen as object).sort()).toEqual(['keep', 'rej'])
  })
})

describe('jsearch: visitedAt is preserved (RULES.md)', () => {
  it('refreshing an already-visited jsearch row with a changed listing keeps visitedAt and firstSeenAt', async () => {
    const svc = mk()
    svc.setKey(KEY)
    fetchMock.mockResolvedValue(okResp([row('v1')]))
    await svc.runDeepRefresh()
    const id = allJs()[0].id
    const visited = markVisited(db, id)!
    expect(visited.visitedAt).toBeTypeOf('number')
    const before = getJobById(db, id)!

    // Forget the id (the seen cache would otherwise skip it) and change the listing.
    writeState({ ...readState(), seen: {} })
    clock = NOW + 3 * DAY
    fetchMock.mockReset().mockResolvedValue(
      okResp([
        row('v1', {
          job_title: 'Junior QA Automation Engineer',
          job_apply_link: 'https://www.linkedin.com/jobs/view/v1-new',
          job_posted_at_datetime_utc: iso(NOW + 2 * DAY)
        })
      ])
    )
    const r = await mk().runDeepRefresh()
    expect(r.summary?.updated).toBe(1)
    expect(r.summary?.inserted).toBe(0)

    const after = getJobById(db, id)!
    expect(after.title).toBe('Junior QA Automation Engineer') // listing really refreshed
    expect(after.url).toBe('https://www.linkedin.com/jobs/view/v1-new')
    expect(after.visitedAt).not.toBeNull()
    expect(after.visitedAt).toBe(before.visitedAt)
    expect(after.firstSeenAt).toBe(before.firstSeenAt)
    expect(allJs()).toHaveLength(1)
  })
})

describe('jsearch: key never leaks', () => {
  it('status JSON, run messages, state file, thrown errors and console never contain the key', async () => {
    const svc = mk()
    svc.setKey(KEY)
    fetchMock.mockImplementation(async (_u, init) => {
      throw new Error(`request failed ${JSON.stringify(init.headers)}`)
    })
    const r = await svc.runDeepRefresh()
    expect(JSON.stringify(r)).not.toContain(KEY)
    expect(JSON.stringify(svc.getStatus())).not.toContain(KEY)
    expect(JSON.stringify(readState())).not.toContain(KEY)
    expect(logged()).not.toContain(KEY)
    expect(() => svc.setKey(`${KEY} with space`)).toThrow('Invalid API key format.')
    try {
      svc.setKey(`${KEY} x`)
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(KEY)
    }
  })

  it('unexpected internal failure (guarded catch): message does not contain the key', async () => {
    const svc = createJSearchService({
      userDataDir: dir,
      fetchImpl: fetchMock,
      now,
      db: new Proxy(db, {
        get(t, p) {
          if (p === 'select') throw new Error(`boom with header x-api-key: ${KEY}`)
          return Reflect.get(t, p)
        }
      })
    })
    svc.setKey(KEY)
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/failed/)
    expect(r.message).not.toContain(KEY)
  })
})

describe('jsearch: config handling', () => {
  it('setKey / clearKey preserve other config.json fields', () => {
    writeCfg({ theme: 'dark', nested: { a: 1 } })
    const svc = mk()
    svc.setKey(`  ${KEY}  `)
    expect(readCfg()).toEqual({ theme: 'dark', nested: { a: 1 }, jsearchApiKey: KEY })
    svc.clearKey()
    expect(readCfg()).toEqual({ theme: 'dark', nested: { a: 1 } })
    svc.clearKey() // no-op
    expect(readCfg()).toEqual({ theme: 'dark', nested: { a: 1 } })
  })

  it('clearKey with no config.json is a no-op', () => {
    expect(() => mk().clearKey()).not.toThrow()
    expect(existsSync(join(dir, 'config.json'))).toBe(false)
  })

  it.each(['', 'short', 'has space inside', 'x'.repeat(513)])('rejects bad key %j', (k) => {
    expect(() => mk().setKey(k)).toThrow('Invalid API key format.')
    expect(existsSync(join(dir, 'config.json'))).toBe(false)
  })

  it('rejects non-string keys', () => {
    expect(() => mk().setKey(123 as unknown as string)).toThrow()
  })

  it('unreadable config.json is never overwritten (setKey and clearKey throw)', () => {
    writeFileSync(join(dir, 'config.json'), '{ not json')
    const svc = mk()
    expect(() => svc.setKey(KEY)).toThrow(/refusing to overwrite/)
    expect(() => svc.clearKey()).toThrow(/refusing to overwrite/)
    expect(readFileSync(join(dir, 'config.json'), 'utf8')).toBe('{ not json')
  })
})

describe('jsearch: in-flight guard and weekly gate', () => {
  it('concurrent runDeepRefresh calls share one run / one set of requests', async () => {
    const svc = mk()
    svc.setKey(KEY)
    let release!: () => void
    const gate = new Promise<void>((res) => (release = res))
    fetchMock.mockImplementation(async () => {
      await gate
      return okResp([])
    })
    const a = svc.runDeepRefresh()
    const b = svc.runDeepRefresh()
    expect(await svc.maybeRunWeekly()).toBeNull() // weekly while manual in flight
    release()
    const [ra, rb] = await Promise.all([a, b])
    expect(ra).toBe(rb)
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(svc.getStatus().used).toBe(5)
    await svc.runDeepRefresh() // guard released afterwards
    expect(fetchMock).toHaveBeenCalledTimes(10)
  })

  it('maybeRunWeekly: <7 days null, >=7 days runs; no key / blocked null', async () => {
    const svc = mk()
    expect(await svc.maybeRunWeekly()).toBeNull() // no key
    svc.setKey(KEY)
    const first = await svc.maybeRunWeekly() // never run -> runs
    expect(first?.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(5)
    clock = NOW + 7 * DAY - 1000
    expect(await mk().maybeRunWeekly()).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(5)
    clock = NOW + 7 * DAY
    expect((await mk().maybeRunWeekly())?.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(10)

    // blocked -> null even when due
    fetchMock.mockReset().mockResolvedValue(errResp(403))
    clock = NOW + 15 * DAY
    await mk().runDeepRefresh()
    fetchMock.mockClear()
    clock = NOW + 22 * DAY
    expect(await mk().maybeRunWeekly()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
