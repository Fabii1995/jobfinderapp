import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memDb, tempDirs } from '../../testing/db'
import { scoredJob } from '../../testing/fixtures'
import { jobs } from '../../db/schema'
import { upsertJobs } from '../../jobs/upsert'
import { getJobById, markVisited } from '../../jobs/queries'
import { createJSearchService, type FetchLike, type JSearchRunSummary } from './index'

const JSKEY = 'fake-jsearch-key-AAAA1111'
const SPKEY = 'fake-serpapi-key-BBBB2222'
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0)
const DAY = 24 * 3600 * 1000
const iso = (ms: number): string => new Date(ms).toISOString()

const db = memDb()
const tempDir = tempDirs()
let dir: string
const now = (): number => NOW

type Resp = { ok: boolean; status: number; json(): Promise<unknown> }
const jsOk = (data: unknown[]): Resp => ({ ok: true, status: 200, json: async () => ({ status: 'OK', data }) })
const spOk = (rows: unknown[]): Resp => ({ ok: true, status: 200, json: async () => ({ jobs_results: rows }) })
const isSp = (u: string): boolean => u.startsWith('https://serpapi.com/')

const jsRow = (id: string | undefined, o: Record<string, unknown> = {}): Record<string, unknown> => ({
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
const spRow = (id: string | undefined, o: Record<string, unknown> = {}): Record<string, unknown> => ({
  job_id: id,
  title: 'Junior QA Engineer',
  company_name: 'Acme',
  location: 'Tel Aviv-Yafo, Israel',
  description: 'Entry level position for new graduates. Manual and automated testing.',
  apply_options: [{ title: 'LinkedIn', link: `https://www.linkedin.com/jobs/view/${id}` }],
  detected_extensions: { posted_at: '2 days ago' },
  ...o
})

/**
 * 11 rows, each exercising one outcome. Expected: kept 3 (k1, k2, seen1 once its seen entry is cleared),
 * seenSkipped 1 (seen1 while it is in `seen`), location 1, old 1, noJuniorSignal 1, scoreTooLow 1,
 * duplicate 2 (one vs an ATS row, one vs k1 within the run), invalid 2 (no link; id-less).
 */
function jsRows(): unknown[] {
  return [
    jsRow('k1'),
    jsRow('k2', { job_title: 'Junior Backend Developer', employer_name: 'Beta' }),
    jsRow('seen1', { job_title: 'Junior Python Developer', employer_name: 'Gamma' }),
    jsRow('loc1', { job_title: 'Junior QA Engineer', employer_name: 'LocCo', job_country: 'US', job_city: 'New York', job_location: 'New York, USA' }),
    jsRow('old1', { employer_name: 'OldCo', job_posted_at_datetime_utc: iso(NOW - 100 * DAY) }),
    jsRow('nojr1', { job_title: 'Software Engineer', employer_name: 'NoJr', job_description: 'We build things.' }),
    jsRow('low1', { job_title: 'Senior Backend Engineer', employer_name: 'LowCo', job_description: 'x' }),
    jsRow('dupats', { employer_name: 'DupCo' }),
    jsRow('duprun', { employer_name: 'Acme' }), // same title+company as k1
    jsRow('inv1', { employer_name: 'InvCo', job_apply_link: '' }),
    jsRow(undefined, { employer_name: 'NoIdCo' }) // id-less -> invalid, never recorded in `seen`
  ]
}
function spRows(): unknown[] {
  return [
    spRow('k1'),
    spRow('k2', { title: 'Junior Backend Developer', company_name: 'Beta' }),
    spRow('seen1', { title: 'Junior Python Developer', company_name: 'Gamma' }),
    spRow('loc1', { company_name: 'LocCo', location: 'New York, NY, USA' }),
    spRow('old1', { company_name: 'OldCo', detected_extensions: { posted_at: '3 months ago' } }),
    spRow('nojr1', { title: 'Software Engineer', company_name: 'NoJr', description: 'We build things.' }),
    spRow('low1', { title: 'Senior Backend Engineer', company_name: 'LowCo', description: 'x' }),
    spRow('dupats', { company_name: 'DupCo' }),
    spRow('duprun', { company_name: 'Acme' }),
    spRow('inv1', { company_name: 'InvCo', apply_options: [] }),
    { company_name: 'NoTitleCo', location: 'Tel Aviv, Israel' } // no title -> serpapiJobId null -> invalid
  ]
}

const fetchMock = vi.fn<FetchLike>()
/** First request of the run gets `first`; every other request gets an empty response of the right shape. */
function serveFirst(first: Resp): void {
  let n = 0
  fetchMock.mockImplementation(async (u) => {
    n++
    if (n === 1) return first
    return isSp(u) ? spOk([]) : jsOk([])
  })
}

const mk = (): ReturnType<typeof createJSearchService> =>
  createJSearchService({ userDataDir: dir, db, fetchImpl: fetchMock, now })
const P = (name: string): string => join(dir, name)
const cfgPath = (): string => P('config.json')
const writeCfg = (o: Record<string, unknown>): void => writeFileSync(cfgPath(), JSON.stringify(o))
const readJson = (name: string): Record<string, unknown> => JSON.parse(readFileSync(P(name), 'utf8'))
const writeJson = (name: string, o: unknown): void => writeFileSync(P(name), JSON.stringify(o))
const bytes = (name: string): string => readFileSync(P(name), 'utf8')

const DROP_KEYS = ['location', 'old', 'noJuniorSignal', 'scoreTooLow', 'duplicate', 'invalid']
const sumDropped = (s: JSearchRunSummary): number => Object.values(s.dropped).reduce((a, b) => a + b, 0)

function seedAts(): void {
  upsertJobs(db, [scoredJob({ source: 'greenhouse:x', externalId: 'ats-1', title: 'Junior QA Engineer', company: 'DupCo', score: 60 })])
}

beforeEach(() => {
  dir = tempDir('jf-runcounts-')
  fetchMock.mockReset().mockImplementation(async (u) => (isSp(u) ? spOk([]) : jsOk([])))
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, m).mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('run counts add up: JSearch', () => {
  it('fetched = seenSkipped + sum(dropped) + kept, kept = inserted + updated, each reason counted once', async () => {
    seedAts()
    writeCfg({ jsearchApiKey: JSKEY })
    writeJson('jsearch-state.json', { month: '2026-10', used: 0, seen: { seen1: NOW - DAY } })
    // k2 already exists as a jsearch row -> it is an update, k1 an insert.
    upsertJobs(db, [scoredJob({ source: 'jsearch', externalId: 'k2', title: 'Old title', company: 'Beta', score: 50 })])
    serveFirst(jsOk(jsRows()))

    const r = await mk().runDeepRefresh()
    const s = r.summary!
    expect(r.ok).toBe(true)
    expect(s.fetched).toBe(11)
    expect(s.seenSkipped).toBe(1)
    expect(s.dropped).toEqual({ location: 1, old: 1, noJuniorSignal: 1, scoreTooLow: 1, duplicate: 2, invalid: 2 })
    expect(s.kept).toBe(2)
    expect(s.inserted).toBe(1)
    expect(s.updated).toBe(1)
    expect(s.kept).toBe(s.inserted + s.updated)
    expect(s.fetched).toBe(s.seenSkipped + sumDropped(s) + s.kept)
    expect(s.skippedDuplicates).toBe(s.seenSkipped + s.dropped.duplicate)
    expect(s.provider).toBe('jsearch')
    // Only the kept rows reached the DB (plus the pre-seeded ones).
    const ext = db.select().from(jobs).all().filter((j) => j.source === 'jsearch').map((j) => j.externalId).sort()
    expect(ext).toEqual(['k1', 'k2'])
  })

  it('the run message mentions the already-seen count and every non-zero drop reason', async () => {
    seedAts()
    writeCfg({ jsearchApiKey: JSKEY })
    writeJson('jsearch-state.json', { month: '2026-10', used: 0, seen: { seen1: NOW - DAY } })
    serveFirst(jsOk(jsRows()))
    const r = await mk().runDeepRefresh()
    expect(r.message).toContain('11 fetched')
    expect(r.message).toContain('2 kept')
    expect(r.message).toContain('1 already seen')
    expect(r.message).toContain('dropped: 1 location, 1 too old, 1 no junior signal, 1 low score, 2 duplicate, 2 invalid')
    expect(r.message).not.toMatch(/NaN|undefined/)
    expect(r.message).not.toContain(JSKEY)
  })

  it('a clean run (nothing dropped, nothing seen) has no breakdown fragment and zeroed counts', async () => {
    writeCfg({ jsearchApiKey: JSKEY })
    serveFirst(jsOk([jsRow('only1')]))
    const r = await mk().runDeepRefresh()
    expect(r.summary).toMatchObject({ fetched: 1, kept: 1, inserted: 1, seenSkipped: 0 })
    expect(r.summary!.dropped).toEqual({ location: 0, old: 0, noJuniorSignal: 0, scoreTooLow: 0, duplicate: 0, invalid: 0 })
    expect(r.message).not.toMatch(/already seen|dropped:/)
  })

  it('an empty run still has seenSkipped 0 and all-zero dropped', async () => {
    writeCfg({ jsearchApiKey: JSKEY })
    const r = await mk().runDeepRefresh()
    expect(r.summary).toMatchObject({ fetched: 0, kept: 0, seenSkipped: 0 })
    expect(r.summary!.dropped).toEqual({ location: 0, old: 0, noJuniorSignal: 0, scoreTooLow: 0, duplicate: 0, invalid: 0 })
  })

  it('an id-less row is dropped as invalid and is not recorded in seen (a re-run counts it again)', async () => {
    writeCfg({ jsearchApiKey: JSKEY })
    fetchMock.mockImplementation(async () => jsOk([jsRow(undefined)]))
    const first = await mk().runDeepRefresh()
    // every one of the 6 queries returns the id-less row
    expect(first.summary).toMatchObject({ fetched: 6, kept: 0, seenSkipped: 0 })
    expect(first.summary!.dropped.invalid).toBe(6)
    expect(Object.keys(readJson('jsearch-state.json').seen as object)).toHaveLength(0)
    const second = await mk().runDeepRefresh()
    expect(second.summary).toMatchObject({ fetched: 6, seenSkipped: 0 })
    expect(second.summary!.dropped.invalid).toBe(6)
  })

  it('non-object rows count as invalid and the identity still holds', async () => {
    writeCfg({ jsearchApiKey: JSKEY })
    serveFirst(jsOk([null, 'str', 42, jsRow('good1')]))
    const s = (await mk().runDeepRefresh()).summary!
    expect(s.fetched).toBe(4)
    expect(s.dropped.invalid).toBe(3)
    expect(s.kept).toBe(1)
    expect(s.fetched).toBe(s.seenSkipped + sumDropped(s) + s.kept)
  })
})

describe('run counts add up: SerpApi', () => {
  it('same identity and per-reason counts, provider serpapi, message mentions them', async () => {
    seedAts()
    writeCfg({ serpapiApiKey: SPKEY })
    writeJson('serpapi-state.json', { month: '2026-10', used: 0, seen: { seen1: NOW - DAY } })
    upsertJobs(db, [scoredJob({ source: 'serpapi', externalId: 'k2', title: 'Old title', company: 'Beta', score: 50 })])
    serveFirst(spOk(spRows()))

    const r = await mk().runDeepRefresh()
    const s = r.summary!
    expect(r.ok).toBe(true)
    expect(r.provider).toBe('serpapi')
    expect(s.provider).toBe('serpapi')
    expect(s.fetched).toBe(11)
    expect(s.seenSkipped).toBe(1)
    expect(s.dropped).toEqual({ location: 1, old: 1, noJuniorSignal: 1, scoreTooLow: 1, duplicate: 2, invalid: 2 })
    expect(s.kept).toBe(2)
    expect(s.kept).toBe(s.inserted + s.updated)
    expect(s.inserted).toBe(1)
    expect(s.updated).toBe(1)
    expect(s.fetched).toBe(s.seenSkipped + sumDropped(s) + s.kept)
    expect(r.message).toContain('1 already seen')
    expect(r.message).toContain('dropped: 1 location, 1 too old, 1 no junior signal, 1 low score, 2 duplicate, 2 invalid')
    expect(r.message).not.toContain(SPKEY)
  })

  it('a SerpApi row without a job_id gets a stable hash id: it is recorded in seen and skipped next time', async () => {
    writeCfg({ serpapiApiKey: SPKEY })
    const row = spRow(undefined, { title: 'Junior Python Developer', company_name: 'HashCo' })
    serveFirst(spOk([row]))
    const a = await mk().runDeepRefresh()
    expect(a.summary).toMatchObject({ fetched: 1, kept: 1, seenSkipped: 0 })
    expect(Object.keys(readJson('serpapi-state.json').seen as object)[0]).toMatch(/^h:/)
    serveFirst(spOk([row]))
    const b = await mk().runDeepRefresh()
    expect(b.summary).toMatchObject({ fetched: 1, kept: 0, seenSkipped: 1 })
  })
})

describe('counts persisted and reloaded', () => {
  it('JSearch: lastRunSummary in jsearch-state.json equals the run summary and getStatus() reloads it', async () => {
    seedAts()
    writeCfg({ jsearchApiKey: JSKEY })
    writeJson('jsearch-state.json', { month: '2026-10', used: 0, seen: { seen1: NOW - DAY } })
    serveFirst(jsOk(jsRows()))
    const r = await mk().runDeepRefresh()
    expect(readJson('jsearch-state.json').lastRunSummary).toEqual(r.summary)
    const st = mk().getStatus() // fresh instance: reload from disk
    expect(st.lastRunSummary).toEqual(r.summary)
    expect(st.lastRunSummary!.seenSkipped).toBe(1)
    expect(st.lastRunSummary!.dropped.duplicate).toBe(2)
  })

  it('SerpApi run: summary in serpapi-state.json and copied to jsearch-state.json, visible via getStatus()', async () => {
    writeCfg({ serpapiApiKey: SPKEY })
    serveFirst(spOk(spRows()))
    const r = await mk().runDeepRefresh()
    expect(readJson('serpapi-state.json').lastRunSummary).toEqual(r.summary)
    expect(readJson('jsearch-state.json').lastRunSummary).toEqual(r.summary)
    expect(readJson('jsearch-state.json').lastRunAt).toBe(readJson('serpapi-state.json').lastRunAt)
    expect(mk().getStatus().lastRunSummary).toEqual(r.summary)
    expect(mk().getStatus().lastRunSummary!.provider).toBe('serpapi')
  })

  it('lastRunSummary holds counts only: no titles, companies, descriptions, urls, keys or job ids', async () => {
    seedAts()
    writeCfg({ jsearchApiKey: JSKEY })
    serveFirst(jsOk(jsRows()))
    await mk().runDeepRefresh()
    const summary = readJson('jsearch-state.json').lastRunSummary as Record<string, unknown>
    expect(Object.keys(summary).sort()).toEqual(
      ['dropped', 'fetched', 'inserted', 'kept', 'provider', 'requests', 'seenSkipped', 'skippedDuplicates', 'updated']
    )
    expect(Object.keys(summary.dropped as object).sort()).toEqual([...DROP_KEYS].sort())
    for (const v of Object.values(summary)) {
      if (typeof v === 'object') for (const x of Object.values(v as object)) expect(typeof x).toBe('number')
      else expect(['number', 'string']).toContain(typeof v)
    }
    const text = JSON.stringify(summary)
    for (const bad of ['Junior QA', 'Junior Backend', 'Junior Python', 'Acme', 'DupCo', 'Entry level', 'linkedin', 'http', JSKEY, 'k1', 'seen1', 'dupats']) {
      expect(text).not.toContain(bad)
    }
    // the whole state file never carries the key
    expect(bytes('jsearch-state.json')).not.toContain(JSKEY)
  })

  it('an old-format summary (no seenSkipped / dropped / provider) loads with zeros and does not crash', () => {
    writeJson('jsearch-state.json', {
      month: '2026-10',
      used: 4,
      lastRunAt: NOW - DAY,
      lastRunSummary: { fetched: 9, kept: 3, inserted: 2, updated: 1, skippedDuplicates: 5, requests: 4 },
      seen: {}
    })
    const st = mk().getStatus()
    expect(st.lastRunSummary).toEqual({
      fetched: 9,
      kept: 3,
      inserted: 2,
      updated: 1,
      skippedDuplicates: 5,
      requests: 4,
      seenSkipped: 0,
      dropped: { location: 0, old: 0, noJuniorSignal: 0, scoreTooLow: 0, duplicate: 0, invalid: 0 }
    })
    expect(st.used).toBe(4)
  })

  it.each([
    ['string', 'oops'],
    ['array', [1, 2]],
    ['null', null]
  ])('a %s lastRunSummary loads as null', (_n, v) => {
    writeJson('jsearch-state.json', { month: '2026-10', used: 1, lastRunSummary: v, seen: {} })
    expect(mk().getStatus().lastRunSummary).toBeNull()
  })

  it('garbage field values (negative, NaN-ish string, wrong types) load as 0; partial dropped keeps good keys', () => {
    writeJson('jsearch-state.json', {
      month: '2026-10',
      lastRunSummary: {
        fetched: -3,
        kept: 'x',
        inserted: null,
        updated: 2,
        skippedDuplicates: {},
        requests: 6,
        seenSkipped: 'many',
        dropped: { location: 4, old: -1, noJuniorSignal: 'z', duplicate: 1 },
        provider: 'bogus'
      },
      seen: {}
    })
    const s = mk().getStatus().lastRunSummary!
    expect(s).toMatchObject({ fetched: 0, kept: 0, inserted: 0, updated: 2, skippedDuplicates: 0, requests: 6, seenSkipped: 0 })
    expect(s.dropped).toEqual({ location: 4, old: 0, noJuniorSignal: 0, scoreTooLow: 0, duplicate: 1, invalid: 0 })
    expect(s.provider).toBeUndefined()
    expect(JSON.stringify(s)).not.toMatch(/NaN|null/)
  })
})

describe('clearSeen', () => {
  const ARR = ['jsearch-state.json', 'serpapi-state.json'] as const

  function seedStates(): void {
    const common = {
      month: '2026-10',
      blockedUntil: NOW + 5 * DAY,
      blockedReason: 'JSearch rejected the API key (HTTP 401).',
      lastRunAt: NOW - DAY,
      lastRunSummary: {
        fetched: 9, kept: 3, inserted: 2, updated: 1, skippedDuplicates: 5, requests: 4, seenSkipped: 2,
        dropped: { location: 1, old: 0, noJuniorSignal: 1, scoreTooLow: 0, duplicate: 3, invalid: 0 }, provider: 'jsearch'
      }
    }
    writeJson('jsearch-state.json', { ...common, used: 17, seen: { a: NOW - DAY, b: NOW - 2 * DAY } })
    writeJson('serpapi-state.json', { ...common, used: 9, seen: { c: NOW - DAY, d: NOW - DAY, e: NOW - DAY } })
  }

  it('clears seen in both files and reports the cleared count; everything else is value-identical', () => {
    writeCfg({ jsearchApiKey: JSKEY, serpapiApiKey: SPKEY, other: 'keep' })
    seedStates()
    const before = ARR.map((f) => readJson(f))
    const r = mk().clearSeen()
    expect(r).toEqual({ ok: true, cleared: 5 })
    ARR.forEach((f, i) => {
      const after = readJson(f)
      expect(after.seen).toEqual({})
      expect({ ...after, seen: undefined }).toEqual({ ...before[i], seen: undefined })
    })
    // counter, block and summary survive explicitly
    expect(readJson('jsearch-state.json')).toMatchObject({ used: 17, blockedUntil: NOW + 5 * DAY, blockedReason: 'JSearch rejected the API key (HTTP 401).' })
    expect(readJson('serpapi-state.json').used).toBe(9)
    const st = mk().getStatus()
    expect(st.blocked).toBe(true)
    expect(st.blockedReason).toContain('HTTP 401')
    expect(st.lastRunSummary!.seenSkipped).toBe(2)
    expect(st.used).toBe(17)
  })

  it('config.json (keys) is byte-identical', () => {
    writeCfg({ jsearchApiKey: JSKEY, serpapiApiKey: SPKEY })
    const before = readFileSync(cfgPath())
    seedStates()
    mk().clearSeen()
    expect(readFileSync(cfgPath()).equals(before)).toBe(true)
  })

  it('a 429/401/403 block recorded by a real run stays after clearSeen', async () => {
    writeCfg({ jsearchApiKey: JSKEY })
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })
    const r = await mk().runDeepRefresh()
    expect(r.ok).toBe(false)
    const blockedBefore = mk().getStatus()
    expect(blockedBefore.blocked).toBe(true)
    const stateBefore = readJson('jsearch-state.json')
    expect(mk().clearSeen()).toMatchObject({ ok: true })
    expect(readJson('jsearch-state.json')).toEqual({ ...stateBefore, seen: {} })
    const after = mk().getStatus()
    expect(after.blocked).toBe(true)
    expect(after.blockedUntil).toBe(blockedBefore.blockedUntil)
    expect(after.blockedReason).toBe(blockedBefore.blockedReason)
  })

  it('does not create missing state files; works with only one present', () => {
    expect(mk().clearSeen()).toEqual({ ok: true, cleared: 0 })
    expect(existsSync(P('jsearch-state.json'))).toBe(false)
    expect(existsSync(P('serpapi-state.json'))).toBe(false)
    expect(existsSync(cfgPath())).toBe(false)
    writeJson('serpapi-state.json', { month: '2026-10', used: 2, seen: { x: NOW - DAY } })
    expect(mk().clearSeen()).toEqual({ ok: true, cleared: 1 })
    expect(existsSync(P('jsearch-state.json'))).toBe(false)
    expect(readJson('serpapi-state.json')).toMatchObject({ used: 2, seen: {} })
  })

  it('an unreadable (corrupt) state file is left untouched and does not throw', () => {
    writeFileSync(P('jsearch-state.json'), '{not json')
    writeJson('serpapi-state.json', { month: '2026-10', seen: { x: NOW - DAY } })
    expect(mk().clearSeen()).toEqual({ ok: true, cleared: 1 })
    expect(bytes('jsearch-state.json')).toBe('{not json')
  })

  it('makes no fetch calls', () => {
    writeCfg({ jsearchApiKey: JSKEY, serpapiApiKey: SPKEY })
    seedStates()
    mk().clearSeen()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('leaves DB jobs unchanged, including visitedAt of an already-visited job', async () => {
    writeCfg({ jsearchApiKey: JSKEY })
    serveFirst(jsOk([jsRow('k1')]))
    await mk().runDeepRefresh()
    const id = db.select().from(jobs).all().find((j) => j.externalId === 'k1')!.id
    const visited = markVisited(db, id)!
    expect(visited.visitedAt).not.toBeNull()
    const snapshot = db.select().from(jobs).all()
    mk().clearSeen()
    expect(db.select().from(jobs).all()).toEqual(snapshot)
    expect(getJobById(db, id)!.visitedAt).toBe(visited.visitedAt)
  })

  it('after clear, a refresh of a visited job still keeps visitedAt (re-scored rows are updates)', async () => {
    writeCfg({ jsearchApiKey: JSKEY })
    serveFirst(jsOk([jsRow('k1')]))
    await mk().runDeepRefresh()
    const id = db.select().from(jobs).all().find((j) => j.externalId === 'k1')!.id
    const visitedAt = markVisited(db, id)!.visitedAt
    mk().clearSeen()
    serveFirst(jsOk([jsRow('k1', { job_title: 'Junior QA Engineer II' })]))
    const r = await mk().runDeepRefresh()
    expect(r.summary).toMatchObject({ kept: 1, inserted: 0, updated: 1, seenSkipped: 0 })
    expect(getJobById(db, id)!.visitedAt).toBe(visitedAt)
  })

  it('a re-run after clear re-scores previously rejected and known rows (seenSkipped goes back to 0)', async () => {
    seedAts()
    writeCfg({ jsearchApiKey: JSKEY })
    const svc = mk()
    serveFirst(jsOk(jsRows()))
    const r1 = await svc.runDeepRefresh()
    expect(r1.summary).toMatchObject({ fetched: 11, seenSkipped: 0, kept: 3 })

    // Without clearing: every row with an id is skipped; only the id-less one is re-evaluated.
    serveFirst(jsOk(jsRows()))
    const r2 = await svc.runDeepRefresh()
    expect(r2.summary).toMatchObject({ fetched: 11, seenSkipped: 10, kept: 0 })
    expect(r2.summary!.dropped).toEqual({ location: 0, old: 0, noJuniorSignal: 0, scoreTooLow: 0, duplicate: 0, invalid: 1 })

    const cleared = svc.clearSeen()
    expect(cleared).toMatchObject({ ok: true })
    expect((cleared as { cleared: number }).cleared).toBe(10)

    serveFirst(jsOk(jsRows()))
    const r3 = await svc.runDeepRefresh()
    const s = r3.summary!
    expect(s.seenSkipped).toBe(0)
    expect(s.dropped).toEqual({ location: 1, old: 1, noJuniorSignal: 1, scoreTooLow: 1, duplicate: 2, invalid: 2 })
    expect(s.kept).toBe(3)
    expect(s.inserted).toBe(0) // all three were stored by run 1
    expect(s.updated).toBe(3)
    expect(s.fetched).toBe(s.seenSkipped + sumDropped(s) + s.kept)
  })

  it('a previously seen-but-never-stored row is now kept after clear (preloaded seen entry)', async () => {
    writeCfg({ jsearchApiKey: JSKEY })
    writeJson('jsearch-state.json', { month: '2026-10', used: 0, seen: { seen1: NOW - DAY } })
    const svc = mk()
    serveFirst(jsOk([jsRow('seen1', { job_title: 'Junior Python Developer', employer_name: 'Gamma' })]))
    expect((await svc.runDeepRefresh()).summary).toMatchObject({ seenSkipped: 1, kept: 0 })
    svc.clearSeen()
    serveFirst(jsOk([jsRow('seen1', { job_title: 'Junior Python Developer', employer_name: 'Gamma' })]))
    expect((await svc.runDeepRefresh()).summary).toMatchObject({ seenSkipped: 0, kept: 1, inserted: 1 })
  })

  it('clears seen after a SerpApi run too (serpapi-state and the copied jsearch-state)', async () => {
    writeCfg({ serpapiApiKey: SPKEY })
    serveFirst(spOk(spRows()))
    await mk().runDeepRefresh()
    expect(Object.keys(readJson('serpapi-state.json').seen as object).length).toBeGreaterThan(0)
    const summaryBefore = readJson('jsearch-state.json').lastRunSummary
    const r = mk().clearSeen()
    expect(r.ok && r.cleared).toBeGreaterThan(0)
    expect(readJson('serpapi-state.json').seen).toEqual({})
    expect(readJson('jsearch-state.json').seen).toEqual({})
    expect(readJson('jsearch-state.json').lastRunSummary).toEqual(summaryBefore)
    expect(readJson('serpapi-state.json').used).toBe(4)
  })

  it('refuses while a run is in flight with the exact error and does not modify state', async () => {
    writeCfg({ jsearchApiKey: JSKEY })
    writeJson('jsearch-state.json', { month: '2026-10', used: 0, seen: { old: NOW - DAY } })
    let release!: (r: Resp) => void
    fetchMock.mockImplementationOnce(() => new Promise<Resp>((res) => (release = res)))
    const svc = mk()
    const run = svc.runDeepRefresh()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const before = bytes('jsearch-state.json')
    const cfgBefore = bytes('config.json')
    const r = svc.clearSeen()
    expect(r).toEqual({ ok: false, error: 'A deep refresh is running; try again when it finishes.' })
    expect(bytes('jsearch-state.json')).toBe(before)
    expect(bytes('config.json')).toBe(cfgBefore)
    expect(existsSync(P('serpapi-state.json'))).toBe(false)
    release(jsOk([]))
    await run
    // once finished, clearing works again
    expect(svc.clearSeen()).toMatchObject({ ok: true })
  })
})
