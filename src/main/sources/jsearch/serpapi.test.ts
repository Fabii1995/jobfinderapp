import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memDb, tempDirs } from '../../testing/db'
import { scoredJob } from '../../testing/fixtures'
import { jobs } from '../../db/schema'
import { upsertJobs } from '../../jobs/upsert'
import { getJobById, markVisited } from '../../jobs/queries'
import {
  createJSearchService,
  interpretSerpapiBody,
  JSEARCH_FALLBACK_THRESHOLD,
  SERPAPI_MONTHLY_CAP,
  SERPAPI_QUERIES,
  SOFT_LIMIT,
  selectProvider,
  type FetchLike,
  type ProviderAvailability
} from './index'
import { finalizeJob, mapSerpapiRow, parseRelativeAgeMs, SERPAPI_SOURCE, serpapiJobId } from './map'
import { rawJob } from '../../testing/fixtures'

// NOTE: every SerpApi response field name used below (jobs_results[], title, company_name, location, description,
// job_id, apply_options[].link, related_links[].link, detected_extensions.posted_at / work_from_home, and the JSON
// `error` strings) is ASSUMED from documentation knowledge and UNVERIFIED against the live API. These fixtures
// only prove the code is consistent with that assumption.

const JSKEY = 'fake-jsearch-key-AAAA1111'
const SPKEY = 'fake-serpapi-key-BBBB2222'
const SPKEY2 = 'fake-serpapi-key-CCCC3333'
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0)
const DAY = 24 * 3600 * 1000
const HOUR = 3600 * 1000

const db = memDb()
const tempDir = tempDirs()
let dir: string
let clock: number
const now = (): number => clock

const spRow = (id: string, o: Record<string, unknown> = {}): Record<string, unknown> => ({
  job_id: id,
  title: 'Junior QA Engineer',
  company_name: 'Acme',
  location: 'Tel Aviv-Yafo, Israel',
  description: 'Entry level position for new graduates. Manual and automated testing.',
  apply_options: [{ title: 'LinkedIn', link: `https://www.linkedin.com/jobs/view/${id}` }],
  detected_extensions: { posted_at: '2 days ago' },
  ...o
})

type Resp = { ok: boolean; status: number; json(): Promise<unknown> }
const spOk = (rows: unknown[]): Resp => ({ ok: true, status: 200, json: async () => ({ jobs_results: rows }) })
const spErrBody = (error: string): Resp => ({ ok: true, status: 200, json: async () => ({ error }) })
const errResp = (status: number): Resp => ({ ok: false, status, json: async () => ({}) })
const jsOk = (data: unknown[]): Resp => ({ ok: true, status: 200, json: async () => ({ status: 'OK', data }) })

const fetchMock = vi.fn<FetchLike>()
const isSp = (u: string): boolean => u.startsWith('https://serpapi.com/')
const spCalls = (): string[] => fetchMock.mock.calls.map((c) => c[0]).filter(isSp)
const jsCalls = (): string[] => fetchMock.mock.calls.map((c) => c[0]).filter((u) => !isSp(u))

const mk = (): ReturnType<typeof createJSearchService> =>
  createJSearchService({ userDataDir: dir, db, fetchImpl: fetchMock, now })
const writeCfg = (o: Record<string, unknown>): void => writeFileSync(join(dir, 'config.json'), JSON.stringify(o))
const readCfg = (): Record<string, unknown> => JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))
const spStatePath = (): string => join(dir, 'serpapi-state.json')
const jsStatePath = (): string => join(dir, 'jsearch-state.json')
const readSp = (): Record<string, unknown> => JSON.parse(readFileSync(spStatePath(), 'utf8'))
const writeSp = (o: Record<string, unknown>): void => writeFileSync(spStatePath(), JSON.stringify(o))
const writeJs = (o: Record<string, unknown>): void => writeFileSync(jsStatePath(), JSON.stringify(o))
const allSp = (): { id: number; externalId: string; title: string | null; url: string }[] =>
  db.select().from(jobs).all().filter((j) => j.source === SERPAPI_SOURCE)

let logSpies: ReturnType<typeof vi.spyOn>[]
beforeEach(() => {
  dir = tempDir('jf-serpapi-')
  clock = NOW
  fetchMock.mockReset().mockImplementation(async (u) => (isSp(u) ? spOk([]) : jsOk([])))
  logSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
})
afterEach(() => {
  vi.restoreAllMocks()
})
const logged = (): string => JSON.stringify(logSpies.flatMap((s) => s.mock.calls))

const av = (o: Partial<ProviderAvailability> = {}): ProviderAvailability => ({
  configured: true,
  blocked: false,
  used: 0,
  cap: SOFT_LIMIT,
  ...o
})

describe('constants', () => {
  it('match the agreed values', () => {
    expect(SOFT_LIMIT).toBe(200)
    expect(JSEARCH_FALLBACK_THRESHOLD).toBe(170)
    expect(SERPAPI_MONTHLY_CAP).toBe(250)
    expect(SERPAPI_QUERIES).toHaveLength(4)
    expect(SERPAPI_SOURCE).toBe('serpapi')
  })
})

describe('selectProvider (pure)', () => {
  const sp = (o: Partial<ProviderAvailability> = {}): ProviderAvailability => av({ cap: SERPAPI_MONTHLY_CAP, ...o })

  it('prefers JSearch below the threshold, even if SerpApi is usable', () => {
    expect(selectProvider(av({ used: 0 }), sp())).toBe('jsearch')
    expect(selectProvider(av({ used: JSEARCH_FALLBACK_THRESHOLD - 1 }), sp())).toBe('jsearch')
  })
  it('switches to SerpApi at >= threshold (169 stays, 170 switches)', () => {
    expect(selectProvider(av({ used: 169 }), sp())).toBe('jsearch')
    expect(selectProvider(av({ used: 170 }), sp())).toBe('serpapi')
    expect(selectProvider(av({ used: SOFT_LIMIT - 1 }), sp())).toBe('serpapi')
  })
  it('SerpApi when JSearch is blocked or keyless', () => {
    expect(selectProvider(av({ blocked: true }), sp())).toBe('serpapi')
    expect(selectProvider(av({ configured: false }), sp())).toBe('serpapi')
  })
  it('SerpApi when JSearch is at its cap, even with a custom higher threshold', () => {
    expect(selectProvider(av({ used: SOFT_LIMIT }), sp(), 999)).toBe('serpapi')
  })
  it('honours a custom threshold', () => {
    expect(selectProvider(av({ used: 10 }), sp(), 10)).toBe('serpapi')
    expect(selectProvider(av({ used: 9 }), sp(), 10)).toBe('jsearch')
  })
  it('JSearch at >= threshold but SerpApi unusable: stays on JSearch', () => {
    expect(selectProvider(av({ used: JSEARCH_FALLBACK_THRESHOLD + 10 }), sp({ configured: false }))).toBe('jsearch')
    expect(selectProvider(av({ used: JSEARCH_FALLBACK_THRESHOLD + 10 }), sp({ blocked: true }))).toBe('jsearch')
    expect(selectProvider(av({ used: JSEARCH_FALLBACK_THRESHOLD + 10 }), sp({ used: SERPAPI_MONTHLY_CAP }))).toBe('jsearch')
  })
  it('none when neither is usable', () => {
    expect(selectProvider(av({ configured: false }), sp({ configured: false }))).toBe('none')
    expect(selectProvider(av({ blocked: true }), sp({ blocked: true }))).toBe('none')
    expect(selectProvider(av({ used: SOFT_LIMIT }), sp({ used: SERPAPI_MONTHLY_CAP }))).toBe('none')
    expect(selectProvider(av({ configured: false }), sp({ blocked: true }))).toBe('none')
  })
  it('SerpApi is not chosen without a key, when blocked, or at cap', () => {
    const jsDown = av({ configured: false })
    expect(selectProvider(jsDown, sp({ configured: false }))).not.toBe('serpapi')
    expect(selectProvider(jsDown, sp({ blocked: true }))).not.toBe('serpapi')
    expect(selectProvider(jsDown, sp({ used: SERPAPI_MONTHLY_CAP }))).not.toBe('serpapi')
    expect(selectProvider(jsDown, sp({ used: SERPAPI_MONTHLY_CAP - 1 }))).toBe('serpapi')
  })
})

describe('parseRelativeAgeMs', () => {
  it.each([
    ['3 days ago', 3 * DAY],
    ['1 day ago', DAY],
    ['an hour ago', HOUR],
    ['5 hours ago', 5 * HOUR],
    ['a day ago', DAY],
    ['2 weeks ago', 14 * DAY],
    ['1 month ago', 30 * DAY],
    ['30+ days ago', 30 * DAY],
    ['  3   DAYS   AGO ', 3 * DAY],
    ['Just posted', 0],
    ['today', 0],
    ['yesterday', DAY]
  ])('%j -> %d ms', (s, ms) => {
    expect(parseRelativeAgeMs(s)).toBe(ms)
  })

  it.each([['soonish'], [''], ['   '], ['3 fortnights ago'], ['days ago'], ['ago 3 days'], [null], [undefined], [42], [{}]])(
    'garbage %j -> null',
    (v) => {
      expect(parseRelativeAgeMs(v)).toBeNull()
    }
  )
})

describe('serpapiJobId', () => {
  it('uses job_id when present', () => {
    expect(serpapiJobId({ job_id: 'abc', title: 'x' })).toBe('abc')
  })
  it('falls back to a stable hash of title+company+location (case-insensitive)', () => {
    const a = serpapiJobId({ title: 'Junior QA', company_name: 'Acme', location: 'Tel Aviv' })
    const b = serpapiJobId({ title: 'JUNIOR QA', company_name: 'ACME', location: 'tel aviv' })
    const c = serpapiJobId({ title: 'Junior QA', company_name: 'Other', location: 'Tel Aviv' })
    expect(a).toMatch(/^h:[0-9a-f]{8}$/)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
  it('null for no title / not an object', () => {
    expect(serpapiJobId({ company_name: 'x' })).toBeNull()
    expect(serpapiJobId(null)).toBeNull()
    expect(serpapiJobId('str')).toBeNull()
  })
})

describe('mapSerpapiRow', () => {
  it('maps a good row (source serpapi, externalId = job_id, first apply link, postedAt from relative age)', () => {
    const out = mapSerpapiRow(spRow('s1'), NOW)
    expect(out.kind).toBe('job')
    if (out.kind !== 'job') return
    expect(out.job).toMatchObject({
      source: 'serpapi',
      externalId: 's1',
      title: 'Junior QA Engineer',
      company: 'Acme',
      url: 'https://www.linkedin.com/jobs/view/s1',
      country: 'IL',
      postedAt: NOW - 2 * DAY
    })
  })

  it('drops postings older than 45 days; keeps 42 days; drops "2 months ago"', () => {
    const at = (s: string) => mapSerpapiRow(spRow('a', { detected_extensions: { posted_at: s } }), NOW)
    expect(at('2 months ago')).toEqual({ kind: 'drop', reason: 'old' })
    expect(at('7 weeks ago')).toEqual({ kind: 'drop', reason: 'old' })
    expect(at('46 days ago')).toEqual({ kind: 'drop', reason: 'old' })
    expect(at('6 weeks ago').kind).toBe('job')
    expect(at('45 days ago').kind).toBe('job')
  })

  it('unparseable / missing posted_at is kept with postedAt null', () => {
    for (const ext of [{ posted_at: 'whenever' }, {}, undefined]) {
      const out = mapSerpapiRow(spRow('g', { detected_extensions: ext }), NOW)
      expect(out.kind).toBe('job')
      if (out.kind === 'job') expect(out.job.postedAt).toBeNull()
    }
  })

  it('falls back to related_links when apply_options has no usable link', () => {
    const out = mapSerpapiRow(
      spRow('r', { apply_options: [{ link: 'javascript:alert(1)' }], related_links: [{ link: 'https://acme.com/careers/r' }] }),
      NOW
    )
    expect(out.kind).toBe('job')
    if (out.kind === 'job') expect(out.job.url).toBe('https://acme.com/careers/r')
  })

  it('drops invalid rows: not an object, no title, no http link', () => {
    expect(mapSerpapiRow(null, NOW)).toEqual({ kind: 'drop', reason: 'invalid' })
    expect(mapSerpapiRow(spRow('x', { title: '' }), NOW)).toEqual({ kind: 'drop', reason: 'invalid' })
    expect(mapSerpapiRow(spRow('x', { apply_options: [{ link: 'ftp://x/y' }] }), NOW)).toEqual({ kind: 'drop', reason: 'invalid' })
    expect(mapSerpapiRow(spRow('x', { apply_options: [], related_links: undefined }), NOW)).toEqual({ kind: 'drop', reason: 'invalid' })
  })

  it('Israel filter: non-Israel and remote-only are dropped', () => {
    expect(mapSerpapiRow(spRow('us', { location: 'Austin, TX' }), NOW)).toEqual({ kind: 'drop', reason: 'location' })
    const remote = mapSerpapiRow(
      spRow('rm', { location: 'Israel', detected_extensions: { posted_at: '1 day ago', work_from_home: true } }),
      NOW
    )
    expect(remote.kind).toBe('drop')
  })

  it('junior gate: a bare "Software Engineer" with generic text is dropped', () => {
    const out = mapSerpapiRow(spRow('se', { title: 'Software Engineer', description: 'Build services with our team.' }), NOW)
    expect(out.kind).toBe('drop')
  })

  it('strips markup from title/company/description', () => {
    const out = mapSerpapiRow(spRow('h', { title: 'Junior <b>QA</b>\n Engineer', company_name: '<i>Acme</i>' }), NOW)
    expect(out.kind).toBe('job')
    if (out.kind === 'job') {
      expect(out.job.title).toBe('Junior QA Engineer')
      expect(out.job.company).toBe('Acme')
    }
  })

  it('finalizeJob is the shared gate for any RawJob', () => {
    expect(finalizeJob(rawJob({ title: 'Junior QA Engineer', country: 'US', city: 'Austin', location: 'Austin' })).kind).toBe('drop')
    expect(finalizeJob(rawJob({ title: 'Junior QA Engineer', location: 'Tel Aviv, Israel', city: 'Tel Aviv' })).kind).toBe('job')
  })
})

describe('interpretSerpapiBody (error texts ASSUMED)', () => {
  it('rows when no error', () => {
    expect(interpretSerpapiBody({ jobs_results: [1, 2] })).toEqual({ kind: 'rows', rows: [1, 2] })
    expect(interpretSerpapiBody({})).toEqual({ kind: 'rows', rows: [] })
    expect(interpretSerpapiBody(null)).toEqual({ kind: 'rows', rows: [] })
  })
  it('no-results error is empty, not a block', () => {
    expect(interpretSerpapiBody({ error: "Google hasn't returned any results for this query." })).toEqual({ kind: 'empty' })
  })
  it('quota-style errors are exhausted', () => {
    for (const e of ['Your account has run out of searches.', 'You exceeded your plan limit', 'Monthly quota reached']) {
      expect(interpretSerpapiBody({ error: e })).toEqual({ kind: 'exhausted' })
    }
  })
  it('invalid key is badkey; unknown error is error', () => {
    expect(interpretSerpapiBody({ error: 'Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key' })).toEqual({
      kind: 'badkey'
    })
    expect(interpretSerpapiBody({ error: 'Something odd' })).toEqual({ kind: 'error' })
  })
})

describe('serpapi: no key', () => {
  it('is inert: no fetch, nothing written', async () => {
    const svc = mk()
    const st = svc.getStatus()
    expect(st.serpapi).toMatchObject({ configured: false, used: 0, cap: SERPAPI_MONTHLY_CAP, blocked: false })
    expect(st.activeProvider).toBe('none')
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(await svc.maybeRunWeekly()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(existsSync(spStatePath())).toBe(false)
    expect(existsSync(jsStatePath())).toBe(false)
  })

  it('blank serpapiApiKey in config counts as unconfigured', () => {
    writeCfg({ serpapiApiKey: '   ' })
    expect(mk().getStatus().serpapi.configured).toBe(false)
  })
})

describe('serpapi: request shape and counter', () => {
  it('sends 4 GET requests, one per query, engine google_jobs, no location/gl; counter persists', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    const st0 = svc.getStatus()
    expect(st0.activeProvider).toBe('serpapi') // JSearch keyless
    expect(st0.fallbackThreshold).toBe(JSEARCH_FALLBACK_THRESHOLD)
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(true)
    expect(r.provider).toBe('serpapi')
    expect(r.summary?.provider).toBe('serpapi')
    expect(r.summary?.requests).toBe(4)
    expect(jsCalls()).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const qs: string[] = []
    for (const [url, init] of fetchMock.mock.calls) {
      const u = new URL(url)
      expect(u.origin + u.pathname).toBe('https://serpapi.com/search.json')
      expect(u.searchParams.get('engine')).toBe('google_jobs')
      expect(u.searchParams.get('location')).toBeNull()
      expect(u.searchParams.get('gl')).toBeNull()
      expect(u.searchParams.get('hl')).toBe('en')
      expect(u.searchParams.get('q')).toMatch(/ Israel$/)
      expect(u.searchParams.get('api_key')).toBe(SPKEY)
      expect(init.method).toBe('GET')
      qs.push(u.searchParams.get('q')!)
    }
    expect(qs).toEqual(SERPAPI_QUERIES)
    expect(svc.getStatus().serpapi.used).toBe(4)
    expect(readSp().used).toBe(4)
    expect(mk().getStatus().serpapi.used).toBe(4)
    await mk().runDeepRefresh()
    expect(mk().getStatus().serpapi.used).toBe(8)
    expect(mk().getStatus().used).toBe(0) // JSearch's own counter untouched
  })

  it('counter resets on a new UTC month', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    writeSp({ month: '2026-10', used: 77, seen: {} })
    expect(svc.getStatus().serpapi.used).toBe(77)
    clock = Date.UTC(2026, 10, 1, 0, 0, 1)
    expect(svc.getStatus().serpapi.used).toBe(0)
    await svc.runDeepRefresh()
    expect(svc.getStatus().serpapi.used).toBe(4)
    expect(readSp().month).toBe('2026-11')
  })

  it('cap (SERPAPI_MONTHLY_CAP) stops the run early and then blocks', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    writeSp({ month: '2026-10', used: SERPAPI_MONTHLY_CAP - 2, seen: {} })
    const r = await svc.runDeepRefresh()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(r.summary?.requests).toBe(2)
    expect(r.message).toMatch(/limit/i)
    const st = svc.getStatus().serpapi
    expect(st.used).toBe(SERPAPI_MONTHLY_CAP)
    expect(st.blocked).toBe(true)
    expect(svc.getStatus().activeProvider).toBe('none')
    fetchMock.mockClear()
    expect((await svc.runDeepRefresh()).ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    // a different key does not lift a cap block
    svc.setSerpapiKey(SPKEY2)
    expect(svc.getStatus().serpapi.blocked).toBe(true)
  })
})

describe('serpapi: fallback switching through the service', () => {
  const bothKeys = (): ReturnType<typeof createJSearchService> => {
    const svc = mk()
    svc.setKey(JSKEY)
    svc.setSerpapiKey(SPKEY)
    return svc
  }

  it('JSearch used below the fallback threshold', async () => {
    const svc = bothKeys()
    writeJs({ month: '2026-10', used: JSEARCH_FALLBACK_THRESHOLD - 1, seen: {} })
    expect(svc.getStatus().activeProvider).toBe('jsearch')
    const r = await svc.runDeepRefresh()
    expect(r.provider).toBe('jsearch')
    expect(spCalls()).toHaveLength(0)
    expect(jsCalls().length).toBeGreaterThan(0)
  })

  it('SerpApi used at >= the fallback threshold', async () => {
    const svc = bothKeys()
    writeJs({ month: '2026-10', used: JSEARCH_FALLBACK_THRESHOLD, seen: {} })
    expect(svc.getStatus().activeProvider).toBe('serpapi')
    const r = await svc.runDeepRefresh()
    expect(r.provider).toBe('serpapi')
    expect(jsCalls()).toHaveLength(0)
    expect(svc.getStatus().used).toBe(JSEARCH_FALLBACK_THRESHOLD) // JSearch counter not consumed
  })

  it('SerpApi takes over after JSearch is blocked by 401 / 403 / 429', async () => {
    for (const status of [401, 403, 429]) {
      dir = tempDir('jf-serpapi-')
      fetchMock.mockReset().mockImplementation(async (u) => (isSp(u) ? spOk([]) : errResp(status)))
      const svc = bothKeys()
      const r1 = await svc.runDeepRefresh()
      expect(r1.ok).toBe(false)
      expect(r1.provider).toBe('jsearch')
      expect(svc.getStatus().blocked).toBe(true)
      expect(svc.getStatus().activeProvider).toBe('serpapi')
      const r2 = await svc.runDeepRefresh()
      expect(r2.ok).toBe(true)
      expect(r2.provider).toBe('serpapi')
    }
  })

  it('none when JSearch is blocked and SerpApi has no key: clear message, no fetch', async () => {
    const svc = mk()
    svc.setKey(JSKEY)
    fetchMock.mockImplementation(async () => errResp(403))
    await svc.runDeepRefresh()
    fetchMock.mockClear()
    expect(svc.getStatus().activeProvider).toBe('none')
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(r.provider).toBeUndefined()
    expect(r.message).toMatch(/403/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await svc.maybeRunWeekly()).toBeNull()
  })

  it('none when both blocked; message mentions both, no keys', async () => {
    const svc = bothKeys()
    writeJs({ month: '2026-10', used: SOFT_LIMIT, seen: {} })
    writeSp({ month: '2026-10', used: SERPAPI_MONTHLY_CAP, seen: {} })
    expect(svc.getStatus().activeProvider).toBe('none')
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(r.message).not.toContain(JSKEY)
    expect(r.message).not.toContain(SPKEY)
  })

  it('JSearch >= threshold but SerpApi blocked: stays on JSearch', async () => {
    const svc = bothKeys()
    writeJs({ month: '2026-10', used: JSEARCH_FALLBACK_THRESHOLD + 10, seen: {} })
    writeSp({ month: '2026-10', used: SERPAPI_MONTHLY_CAP, seen: {} })
    expect(svc.getStatus().activeProvider).toBe('jsearch')
  })

  it('serpapi-only: active provider is serpapi even with JSearch keyless', () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    expect(svc.getStatus().activeProvider).toBe('serpapi')
    expect(svc.getStatus().configured).toBe(false)
    expect(svc.getStatus().serpapi.configured).toBe(true)
  })
})

describe('serpapi: API-error blocks', () => {
  for (const status of [401, 403, 429]) {
    it(`HTTP ${status} blocks until next month, persists, no key in message/status`, async () => {
      const svc = mk()
      svc.setSerpapiKey(SPKEY)
      fetchMock.mockResolvedValueOnce(errResp(status))
      const r = await svc.runDeepRefresh()
      expect(r.ok).toBe(false)
      expect(r.message).toContain(String(status))
      expect(r.message).toContain('SerpApi')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const st = svc.getStatus().serpapi
      expect(st.blocked).toBe(true)
      expect(st.blockedUntil).toBe(new Date(Date.UTC(2026, 10, 1)).toISOString())
      expect(st.used).toBe(status === 429 ? 1 : 0) // 4xx except 429 is refunded
      expect(JSON.stringify(svc.getStatus()) + r.message).not.toContain(SPKEY)

      const again = mk()
      expect(again.getStatus().serpapi.blocked).toBe(true)
      fetchMock.mockClear()
      expect((await again.runDeepRefresh()).ok).toBe(false)
      expect(await again.maybeRunWeekly()).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
      clock = Date.UTC(2026, 10, 1, 0, 0, 1)
      expect(mk().getStatus().serpapi.blocked).toBe(false)
    })
  }

  it('JSON "out of searches" error (HTTP 200) blocks until next month and stops the run', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    fetchMock.mockResolvedValue(spErrBody('Your account has run out of searches.'))
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const st = svc.getStatus().serpapi
    expect(st.blocked).toBe(true)
    expect(st.blockedUntil).toBe(new Date(Date.UTC(2026, 10, 1)).toISOString())
    expect(r.message).not.toContain('run out of searches') // raw provider text is not surfaced
  })

  it('JSON invalid-key error blocks', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    fetchMock.mockResolvedValue(spErrBody('Invalid API key.'))
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(svc.getStatus().serpapi.blocked).toBe(true)
    expect(JSON.stringify(r)).not.toContain(SPKEY)
  })

  it('"hasn\'t returned any results" is NOT a block and the run continues through all queries', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    fetchMock.mockResolvedValue(spErrBody("Google hasn't returned any results for this query."))
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(svc.getStatus().serpapi.blocked).toBe(false)
    expect(svc.getStatus().serpapi.used).toBe(4)
    expect(r.summary).toMatchObject({ fetched: 0, kept: 0 })
  })

  it('unknown JSON error stops the run (ok:false) without blocking', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    fetchMock.mockResolvedValue(spErrBody('Something odd happened'))
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(svc.getStatus().serpapi.blocked).toBe(false)
  })

  it('HTTP 500 and network errors stop without blocking; counter still counts the request', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    fetchMock.mockResolvedValueOnce(errResp(500))
    expect((await svc.runDeepRefresh()).ok).toBe(false)
    expect(svc.getStatus().serpapi.blocked).toBe(false)
    fetchMock.mockReset().mockRejectedValue(new Error('ECONNRESET'))
    expect((await svc.runDeepRefresh()).ok).toBe(false)
    expect(svc.getStatus().serpapi.blocked).toBe(false)
    expect(svc.getStatus().serpapi.used).toBe(2)
  })

  it('saving a DIFFERENT key lifts the block (counter kept); the same key does not', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    fetchMock.mockResolvedValueOnce(errResp(401))
    await svc.runDeepRefresh()
    svc.setSerpapiKey(SPKEY)
    expect(svc.getStatus().serpapi.blocked).toBe(true)
    svc.setSerpapiKey(SPKEY2)
    const st = svc.getStatus().serpapi
    expect(st.blocked).toBe(false)
    expect(st.blockedReason).toBeNull()
    expect(st.used).toBe(0) // 401 was refunded
  })

  it('a SerpApi key change does not lift a JSearch block (and vice versa)', async () => {
    const svc = mk()
    svc.setKey(JSKEY)
    fetchMock.mockImplementation(async () => errResp(401))
    await svc.runDeepRefresh()
    expect(svc.getStatus().blocked).toBe(true)
    svc.setSerpapiKey(SPKEY)
    expect(svc.getStatus().blocked).toBe(true)
  })
})

describe('serpapi: filtering, dedupe, cache', () => {
  it('inserts a good row as source serpapi with externalId = job_id', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    fetchMock.mockResolvedValueOnce(spOk([spRow('p1')]))
    const r = await svc.runDeepRefresh()
    expect(r.summary).toMatchObject({ fetched: 1, kept: 1, inserted: 1, updated: 0 })
    expect(allSp().map((j) => j.externalId)).toEqual(['p1'])
  })

  it('drops non-Israel / senior / old rows in a run', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    fetchMock.mockResolvedValueOnce(
      spOk([
        spRow('ok'),
        spRow('us', { location: 'Austin, TX' }),
        spRow('sr', { title: 'Software Engineer', description: 'Build services.' }),
        spRow('old', { detected_extensions: { posted_at: '3 months ago' } })
      ])
    )
    const r = await svc.runDeepRefresh()
    expect(r.summary).toMatchObject({ fetched: 4, kept: 1, inserted: 1 })
    expect(allSp().map((j) => j.externalId)).toEqual(['ok'])
  })

  it('dedupes vs ATS rows, vs JSearch rows, and within the run', async () => {
    upsertJobs(db, [
      scoredJob({ source: 'greenhouse:acme', externalId: 'g1', title: 'Junior QA Engineer', company: 'Acme Ltd.' }),
      scoredJob({ source: 'jsearch', externalId: 'js1', title: 'Junior Python Developer', company: 'Beta' })
    ])
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    fetchMock.mockResolvedValueOnce(
      spOk([
        spRow('d1'), // dup of ATS row after normalization
        spRow('d2', { title: 'Junior Python Developer', company_name: 'Beta Inc' }), // dup of the JSearch row
        spRow('d3', { title: 'Junior Backend Developer', company_name: 'Gamma' }),
        spRow('d4', { title: 'JUNIOR backend developer!', company_name: 'Gamma Ltd' }) // dup within run
      ])
    )
    const r = await svc.runDeepRefresh()
    expect(r.summary).toMatchObject({ fetched: 4, kept: 1, inserted: 1, skippedDuplicates: 3 })
    expect(allSp().map((j) => j.externalId)).toEqual(['d3'])
  })

  it('caches by job id (including rejected rows) across queries and runs; falls back to hash id', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    const reject = spRow('rej', { title: 'Software Engineer', description: 'generic' })
    const noId = spRow('x', { job_id: undefined, title: 'Junior Backend Developer', company_name: 'Hashco' })
    fetchMock.mockResolvedValue(spOk([spRow('keep'), reject, noId]))
    const r1 = await svc.runDeepRefresh()
    expect(r1.summary).toMatchObject({ kept: 2, inserted: 2 })
    expect(r1.summary?.skippedDuplicates).toBe(9) // queries 2-4 return the same three ids
    const r2 = await mk().runDeepRefresh()
    expect(r2.summary).toMatchObject({ kept: 0, inserted: 0, updated: 0, skippedDuplicates: 12 })
    const seen = Object.keys(readSp().seen as object)
    expect(seen).toContain('keep')
    expect(seen).toContain('rej')
    expect(seen.some((k) => k.startsWith('h:'))).toBe(true)
  })
})

describe('serpapi: visitedAt is preserved (RULES.md)', () => {
  it('re-upserting a visited serpapi row from a run keeps visitedAt and firstSeenAt', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    fetchMock.mockResolvedValue(spOk([spRow('v1')]))
    await svc.runDeepRefresh()
    const id = allSp()[0].id
    const visited = markVisited(db, id)!
    expect(visited.visitedAt).toBeTypeOf('number')
    const before = getJobById(db, id)!

    writeSp({ ...readSp(), seen: {} }) // forget the id so the cache does not skip it
    clock = NOW + 3 * DAY
    fetchMock.mockReset().mockResolvedValue(
      spOk([
        spRow('v1', {
          title: 'Junior QA Automation Engineer',
          apply_options: [{ link: 'https://www.linkedin.com/jobs/view/v1-new' }]
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
    expect(allSp()).toHaveLength(1)
  })
})

describe('serpapi: key never leaks', () => {
  it('status, run results, both state files, config-free messages and console never contain either key', async () => {
    const svc = mk()
    svc.setKey(JSKEY)
    svc.setSerpapiKey(SPKEY)
    writeJs({ month: '2026-10', used: JSEARCH_FALLBACK_THRESHOLD + 10, seen: {} })
    fetchMock.mockImplementation(async (u, init) => {
      throw new Error(`request failed ${u} ${JSON.stringify(init.headers)}`)
    })
    const r = await svc.runDeepRefresh()
    const blockedRun = await (async () => {
      fetchMock.mockReset().mockResolvedValue(errResp(401))
      return svc.runDeepRefresh()
    })()
    const everything = JSON.stringify([r, blockedRun, svc.getStatus()]) + logged()
    for (const k of [JSKEY, SPKEY]) {
      expect(everything).not.toContain(k)
      expect(readFileSync(spStatePath(), 'utf8')).not.toContain(k)
      expect(readFileSync(jsStatePath(), 'utf8')).not.toContain(k)
    }
    expect(() => svc.setSerpapiKey(`${SPKEY} x`)).toThrow('Invalid API key format.')
    try {
      svc.setSerpapiKey(`${SPKEY} x`)
    } catch (e) {
      expect((e as Error).message).not.toContain(SPKEY)
    }
  })

  it('internal failure whose message embeds the api_key URL is scrubbed', async () => {
    const svc = createJSearchService({
      userDataDir: dir,
      fetchImpl: fetchMock,
      now,
      db: new Proxy(db, {
        get(t, p) {
          if (p === 'select')
            throw new Error(`GET https://serpapi.com/search.json?engine=google_jobs&api_key=${SPKEY}&q=x failed`)
          return Reflect.get(t, p)
        }
      })
    })
    svc.setSerpapiKey(SPKEY)
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/failed/)
    expect(r.message).not.toContain(SPKEY)
    expect(r.message).toContain('api_key=***')
    expect(logged()).not.toContain(SPKEY)
  })

  it('scrub also redacts an api_key value that is not the configured key (pattern based)', async () => {
    const other = 'some-other-token-ZZZ999'
    const svc = createJSearchService({
      userDataDir: dir,
      fetchImpl: fetchMock,
      now,
      db: new Proxy(db, {
        get(t, p) {
          if (p === 'select') throw new Error(`bad url ?api_key=${other}&x=1`)
          return Reflect.get(t, p)
        }
      })
    })
    svc.setSerpapiKey(SPKEY)
    const r = await svc.runDeepRefresh()
    expect(r.message).not.toContain(other)
  })
})

describe('serpapi: config handling', () => {
  it('set/clear touch only serpapiApiKey; other fields (incl. jsearchApiKey) preserved', () => {
    writeCfg({ theme: 'dark', jsearchApiKey: JSKEY })
    const svc = mk()
    svc.setSerpapiKey(`  ${SPKEY}  `)
    expect(readCfg()).toEqual({ theme: 'dark', jsearchApiKey: JSKEY, serpapiApiKey: SPKEY })
    svc.clearSerpapiKey()
    expect(readCfg()).toEqual({ theme: 'dark', jsearchApiKey: JSKEY })
    svc.clearSerpapiKey() // no-op
    expect(readCfg()).toEqual({ theme: 'dark', jsearchApiKey: JSKEY })
    svc.setSerpapiKey(SPKEY)
    svc.clearKey() // JSearch clear leaves the SerpApi key
    expect(readCfg()).toEqual({ theme: 'dark', serpapiApiKey: SPKEY })
  })

  it('clearSerpapiKey with no config.json is a no-op', () => {
    expect(() => mk().clearSerpapiKey()).not.toThrow()
    expect(existsSync(join(dir, 'config.json'))).toBe(false)
  })

  it.each(['', 'short', 'has space inside', 'x'.repeat(513)])('rejects bad key %j', (k) => {
    expect(() => mk().setSerpapiKey(k)).toThrow('Invalid API key format.')
    expect(existsSync(join(dir, 'config.json'))).toBe(false)
  })

  it('unreadable config.json is never overwritten', () => {
    writeFileSync(join(dir, 'config.json'), '{ not json')
    const svc = mk()
    expect(() => svc.setSerpapiKey(SPKEY)).toThrow(/refusing to overwrite/)
    expect(() => svc.clearSerpapiKey()).toThrow(/refusing to overwrite/)
    expect(readFileSync(join(dir, 'config.json'), 'utf8')).toBe('{ not json')
  })

  it('clearing the key makes the service inert again', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    svc.clearSerpapiKey()
    expect(svc.getStatus().serpapi.configured).toBe(false)
    expect((await svc.runDeepRefresh()).ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('serpapi: in-flight guard and weekly gate', () => {
  it('concurrent runs share one run (4 requests, not 8)', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    let release!: () => void
    const gate = new Promise<void>((res) => (release = res))
    fetchMock.mockImplementation(async () => {
      await gate
      return spOk([])
    })
    const a = svc.runDeepRefresh()
    const b = svc.runDeepRefresh()
    expect(await svc.maybeRunWeekly()).toBeNull()
    release()
    const [ra, rb] = await Promise.all([a, b])
    expect(ra).toBe(rb)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(svc.getStatus().serpapi.used).toBe(4)
  })

  it('maybeRunWeekly works with SerpApi only: runs when never run, null within 7 days, runs at 7 days', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    const first = await svc.maybeRunWeekly()
    expect(first?.ok).toBe(true)
    expect(first?.provider).toBe('serpapi')
    expect(fetchMock).toHaveBeenCalledTimes(4)
    // the shared weekly gate is recorded in jsearch-state.json
    expect(JSON.parse(readFileSync(jsStatePath(), 'utf8')).lastRunAt).toBe(NOW)
    expect(mk().getStatus().lastRunAt).toBe(new Date(NOW).toISOString())
    clock = NOW + 7 * DAY - 1000
    expect(await mk().maybeRunWeekly()).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(4)
    clock = NOW + 7 * DAY
    expect((await mk().maybeRunWeekly())?.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(8)
  })

  it('maybeRunWeekly uses SerpApi when JSearch is near its limit, and JSearch otherwise', async () => {
    const svc = mk()
    svc.setKey(JSKEY)
    svc.setSerpapiKey(SPKEY)
    writeJs({ month: '2026-10', used: JSEARCH_FALLBACK_THRESHOLD + 5, seen: {} })
    expect((await svc.maybeRunWeekly())?.provider).toBe('serpapi')
    clock = NOW + 8 * DAY
    writeJs({ ...JSON.parse(readFileSync(jsStatePath(), 'utf8')), month: '2026-10', used: 10 })
    expect((await mk().maybeRunWeekly())?.provider).toBe('jsearch')
  })

  it('maybeRunWeekly is null when neither provider is usable', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    writeSp({ month: '2026-10', used: SERPAPI_MONTHLY_CAP, seen: {} })
    expect(await svc.maybeRunWeekly()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
