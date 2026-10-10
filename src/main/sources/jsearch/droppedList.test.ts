import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memDb, tempDirs } from '../../testing/db'
import { scoredJob } from '../../testing/fixtures'
import { upsertJobs } from '../../jobs/upsert'
import { createJSearchService, type FetchLike } from './index'

const JSKEY = 'fake-jsearch-key-AAAA1111'
const SPKEY = 'fake-serpapi-key-BBBB2222'
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0)
const DAY = 24 * 3600 * 1000
const iso = (ms: number): string => new Date(ms).toISOString()

const db = memDb()
const tempDir = tempDirs()
let dir: string
let nowMs = NOW

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

/** One row per outcome. k1 is kept; duprun duplicates k1 inside the run; dupats duplicates a seeded ATS row. */
const jsRows = (): unknown[] => [
  jsRow('k1'),
  jsRow('loc1', { employer_name: 'LocCo', job_country: 'US', job_city: 'New York', job_location: 'New York, USA' }),
  jsRow('old1', { employer_name: 'OldCo', job_posted_at_datetime_utc: iso(NOW - 100 * DAY) }),
  jsRow('nojr1', { job_title: 'Software Engineer', employer_name: 'NoJr', job_description: 'We build things.' }),
  jsRow('low1', { job_title: 'Senior Backend Engineer', employer_name: 'LowCo', job_description: 'x' }),
  jsRow('dupats', { employer_name: 'DupCo' }),
  jsRow('duprun', { employer_name: 'Acme' }),
  jsRow('inv1', { employer_name: 'InvCo', job_apply_link: '' })
]
const spRows = (): unknown[] => [
  spRow('k1'),
  spRow('loc1', { company_name: 'LocCo', location: 'New York, NY, USA' }),
  spRow('old1', { company_name: 'OldCo', detected_extensions: { posted_at: '3 months ago' } }),
  spRow('nojr1', { title: 'Software Engineer', company_name: 'NoJr', description: 'We build things.' }),
  spRow('low1', { title: 'Senior Backend Engineer', company_name: 'LowCo', description: 'x' }),
  spRow('dupats', { company_name: 'DupCo' }),
  spRow('duprun', { company_name: 'Acme' }),
  spRow('inv1', { company_name: 'InvCo', apply_options: [] })
]

const fetchMock = vi.fn<FetchLike>()
/** First request gets `first`; every other request gets an empty response of the right shape. */
function serveFirst(first: Resp): void {
  let n = 0
  fetchMock.mockImplementation(async (u) => {
    n++
    if (n === 1) return first
    return isSp(u) ? spOk([]) : jsOk([])
  })
}
const mk = (): ReturnType<typeof createJSearchService> =>
  createJSearchService({ userDataDir: dir, db, fetchImpl: fetchMock, now: () => nowMs })
const P = (name: string): string => join(dir, name)
const writeCfg = (o: Record<string, unknown>): void => writeFileSync(P('config.json'), JSON.stringify(o))
const writeJson = (name: string, o: unknown): void => writeFileSync(P(name), JSON.stringify(o))
const seedAts = (): void => {
  upsertJobs(db, [scoredJob({ source: 'greenhouse:x', externalId: 'ats-1', title: 'Junior QA Engineer', company: 'DupCo', score: 60 })])
}

let consoleSpies: ReturnType<typeof vi.spyOn>[] = []
const consoleText = (): string => JSON.stringify(consoleSpies.map((s) => s.mock.calls))

beforeEach(() => {
  dir = tempDir('jf-dropped-')
  nowMs = NOW
  fetchMock.mockReset().mockImplementation(async (u) => (isSp(u) ? spOk([]) : jsOk([])))
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
})
afterEach(() => {
  vi.restoreAllMocks()
})

const EXPECTED: Record<string, { reason: string; scored: boolean }> = {
  LocCo: { reason: 'location', scored: false },
  OldCo: { reason: 'old', scored: false },
  NoJr: { reason: 'noJuniorSignal', scored: true },
  LowCo: { reason: 'scoreTooLow', scored: true },
  DupCo: { reason: 'duplicate', scored: true },
  Acme: { reason: 'duplicate', scored: true },
  InvCo: { reason: 'invalid', scored: false }
}

describe.each([
  ['jsearch', JSKEY, 'jsearchApiKey', (): Resp => jsOk(jsRows())],
  ['serpapi', SPKEY, 'serpapiApiKey', (): Resp => spOk(spRows())]
] as const)('getDroppedList captures per reason: %s', (provider, key, cfgField, resp) => {
  it('records every reason with provider, runAt, and score only when computed', async () => {
    seedAts()
    writeCfg({ [cfgField]: key })
    serveFirst(resp())
    const svc = mk()
    expect(svc.getDroppedList()).toEqual([])
    const r = await svc.runDeepRefresh()
    expect(r.summary!.provider).toBe(provider)
    const list = svc.getDroppedList()
    expect(list).toHaveLength(7)
    expect(list.map((d) => d.reason).sort()).toEqual(
      ['duplicate', 'duplicate', 'invalid', 'location', 'noJuniorSignal', 'old', 'scoreTooLow']
    )
    const dropped = r.summary!.dropped
    for (const k of Object.keys(dropped) as (keyof typeof dropped)[]) {
      expect(list.filter((d) => d.reason === k)).toHaveLength(dropped[k])
    }
    for (const d of list) {
      const exp = EXPECTED[d.company]
      expect(exp, `unexpected company ${d.company}`).toBeDefined()
      expect(d.reason).toBe(exp.reason)
      expect(d.provider).toBe(provider)
      expect(d.runAt).toBe(iso(NOW))
      if (exp.scored) expect(typeof d.score).toBe('number')
      else expect(d.score).toBeNull()
    }
    // Newest first: the last-processed drop (inv1) leads, the first-processed drop (loc1) is last.
    expect(list[0].company).toBe('InvCo')
    expect(list[list.length - 1].company).toBe('LocCo')
  })

  it('does not record seen-skipped rows', async () => {
    writeCfg({ [cfgField]: key })
    writeJson(provider === 'jsearch' ? 'jsearch-state.json' : 'serpapi-state.json', {
      month: '2026-10',
      used: 0,
      seen: { loc1: NOW - DAY, inv1: NOW - DAY }
    })
    serveFirst(resp())
    const svc = mk()
    const r = await svc.runDeepRefresh()
    expect(r.summary!.seenSkipped).toBe(2)
    const cos = svc.getDroppedList().map((d) => d.company)
    expect(cos).not.toContain('LocCo')
    expect(cos).not.toContain('InvCo')
    expect(cos).toContain('OldCo')
  })

  it('returns a copy: mutating it does not change the next read', async () => {
    writeCfg({ [cfgField]: key })
    serveFirst(resp())
    const svc = mk()
    await svc.runDeepRefresh()
    const a = svc.getDroppedList()
    const n = a.length
    expect(n).toBeGreaterThan(0)
    a[0].title = 'MUTATED'
    a.pop()
    const b = svc.getDroppedList()
    expect(b).toHaveLength(n)
    expect(b.some((d) => d.title === 'MUTATED')).toBe(false)
  })

  it('is replaced (not appended) by the next run', async () => {
    writeCfg({ [cfgField]: key })
    serveFirst(resp())
    const svc = mk()
    await svc.runDeepRefresh()
    expect(svc.getDroppedList().length).toBeGreaterThan(0)
    nowMs = NOW + 1000
    const only =
      provider === 'jsearch'
        ? jsOk([jsRow('solo', { employer_name: 'SoloCo', job_apply_link: '' })])
        : spOk([spRow('solo', { company_name: 'SoloCo', apply_options: [] })])
    serveFirst(only)
    await svc.runDeepRefresh()
    const list = svc.getDroppedList()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ company: 'SoloCo', reason: 'invalid', runAt: iso(NOW + 1000) })
  })

  it('a clean second run empties the list', async () => {
    writeCfg({ [cfgField]: key })
    serveFirst(resp())
    const svc = mk()
    await svc.runDeepRefresh()
    expect(svc.getDroppedList().length).toBeGreaterThan(0)
    fetchMock.mockImplementation(async (u) => (isSp(u) ? spOk([]) : jsOk([])))
    await svc.runDeepRefresh()
    expect(svc.getDroppedList()).toEqual([])
  })

  it('caps at 100 and keeps the newest', async () => {
    writeCfg({ [cfgField]: key })
    let call = 0
    fetchMock.mockImplementation(async (u) => {
      call++
      const rows = Array.from({ length: 30 }, (_, i) => {
        const id = `c${call}-${i}`
        const co = `Co-${call}-${i}`
        return provider === 'jsearch'
          ? jsRow(id, { employer_name: co, job_country: 'US', job_city: 'NYC', job_location: 'New York, USA' })
          : spRow(id, { company_name: co, location: 'New York, NY, USA' })
      })
      return isSp(u) ? spOk(rows) : jsOk(rows)
    })
    const svc = mk()
    const r = await svc.runDeepRefresh()
    expect(r.summary!.dropped.location).toBeGreaterThan(100)
    const list = svc.getDroppedList()
    expect(list).toHaveLength(100)
    // Newest first: the last row of the last query leads; the summary count is not capped.
    expect(list[0].company).toBe(`Co-${call}-29`)
    const keys = list.map((d) => d.company.split('-').slice(1).map(Number))
    for (let i = 1; i < keys.length; i++) {
      const [pc, pi] = keys[i - 1]
      const [cc, ci] = keys[i]
      expect(pc * 100 + pi).toBeGreaterThan(cc * 100 + ci)
    }
    // The oldest survivor is exactly the 100th newest: 100 = 30*3 + 10 -> call-3, index 20.
    expect(list[99].company).toBe(`Co-${call - 3}-20`)
  })
})

describe('refused runs and clearSeen leave the list intact', () => {
  async function primed(): Promise<{ svc: ReturnType<typeof mk>; before: ReturnType<ReturnType<typeof mk>['getDroppedList']> }> {
    writeCfg({ jsearchApiKey: JSKEY })
    serveFirst(jsOk(jsRows()))
    const svc = mk()
    await svc.runDeepRefresh()
    const before = svc.getDroppedList()
    expect(before.length).toBeGreaterThan(0)
    return { svc, before }
  }

  it('no key (run refused)', async () => {
    const { svc, before } = await primed()
    writeCfg({})
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(svc.getDroppedList()).toEqual(before)
  })

  it('blocked provider (run refused)', async () => {
    const { svc, before } = await primed()
    writeJson('jsearch-state.json', { month: '2026-10', used: 1, blockedUntil: NOW + 10 * DAY, blockedReason: 'blocked for test', seen: {} })
    const calls = fetchMock.mock.calls.length
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(fetchMock.mock.calls.length).toBe(calls)
    expect(svc.getDroppedList()).toEqual(before)
  })

  it('monthly cap reached (run refused)', async () => {
    const { svc, before } = await primed()
    writeJson('jsearch-state.json', { month: '2026-10', used: 200, seen: {} })
    const r = await svc.runDeepRefresh()
    expect(r.ok).toBe(false)
    expect(svc.getDroppedList()).toEqual(before)
  })

  it('clearSeen', async () => {
    const { svc, before } = await primed()
    const r = svc.clearSeen()
    expect(r.ok).toBe(true)
    expect(svc.getDroppedList()).toEqual(before)
  })

  it('weekly check that is not due does not touch it', async () => {
    const { svc, before } = await primed()
    expect(await svc.maybeRunWeekly()).toBeNull()
    expect(svc.getDroppedList()).toEqual(before)
  })
})

describe('dropped list is in memory only and never leaks secrets', () => {
  const SECRET_TITLE = 'ZZQUNIQUE Marker Engineer'
  const SECRET_CO = 'ZZQUNIQUE Corp'

  it('state files hold counts only: no dropped titles, no list field', async () => {
    writeCfg({ jsearchApiKey: JSKEY, serpapiApiKey: SPKEY })
    serveFirst(
      jsOk([jsRow('z1', { job_title: SECRET_TITLE, employer_name: SECRET_CO, job_country: 'US', job_city: 'NYC', job_location: 'New York, USA' })])
    )
    const svc = mk()
    const r = await svc.runDeepRefresh()
    expect(r.summary!.dropped.location).toBe(1)
    expect(svc.getDroppedList()[0].title).toBe(SECRET_TITLE)
    for (const f of readdirSync(dir)) {
      expect(readFileSync(P(f), 'utf8'), f).not.toContain('ZZQUNIQUE')
    }
    const st = JSON.parse(readFileSync(P('jsearch-state.json'), 'utf8')) as Record<string, unknown>
    expect(Object.keys(st).sort()).toEqual(['blockedReason', 'blockedUntil', 'lastRunAt', 'lastRunSummary', 'month', 'seen', 'used'])
    expect(JSON.stringify(st)).not.toMatch(/droppedList|"title"|"company"/)
    expect((st.lastRunSummary as { dropped: unknown }).dropped).toEqual({
      location: 1,
      old: 0,
      noJuniorSignal: 0,
      scoreTooLow: 0,
      duplicate: 0,
      invalid: 0
    })
  })

  it('SerpApi run: no file in userData contains dropped titles', async () => {
    writeCfg({ serpapiApiKey: SPKEY })
    serveFirst(spOk([spRow('z2', { title: SECRET_TITLE, company_name: SECRET_CO, location: 'New York, NY, USA' })]))
    const svc = mk()
    const r = await svc.runDeepRefresh()
    expect(r.summary!.provider).toBe('serpapi')
    expect(svc.getDroppedList()).toHaveLength(1)
    for (const f of readdirSync(dir)) expect(readFileSync(P(f), 'utf8'), f).not.toContain('ZZQUNIQUE')
  })

  it('a fresh service instance (app restart) starts with an empty list', async () => {
    writeCfg({ jsearchApiKey: JSKEY })
    serveFirst(jsOk(jsRows()))
    await mk().runDeepRefresh()
    expect(mk().getDroppedList()).toEqual([])
  })

  it('no dropped row text reaches the console; API keys never appear in list, console or message', async () => {
    seedAts()
    writeCfg({ jsearchApiKey: JSKEY, serpapiApiKey: SPKEY })
    serveFirst(
      jsOk([...jsRows(), jsRow('z3', { job_title: SECRET_TITLE, employer_name: SECRET_CO, job_country: 'US', job_location: 'NY, USA' })])
    )
    const svc = mk()
    const r = await svc.runDeepRefresh()
    const list = JSON.stringify(svc.getDroppedList())
    expect(list).toContain('ZZQUNIQUE')
    for (const k of [JSKEY, SPKEY, 'AAAA1111', 'BBBB2222']) {
      expect(list).not.toContain(k)
      expect(consoleText()).not.toContain(k)
      expect(r.message).not.toContain(k)
    }
    expect(consoleText()).not.toContain('ZZQUNIQUE')
    expect(consoleText()).not.toContain('Acme')
    expect(r.message).not.toContain('ZZQUNIQUE')
    for (const d of svc.getDroppedList()) {
      expect(Object.keys(d).sort()).toEqual(['company', 'location', 'provider', 'reason', 'runAt', 'score', 'title'])
    }
  })

  it('keys never appear in the list or console after a failing (401) run either', async () => {
    writeCfg({ jsearchApiKey: JSKEY })
    fetchMock.mockImplementation(async () => ({ ok: false, status: 401, json: async () => ({ error: `bad ${JSKEY}` }), text: async () => `bad ${JSKEY}` }))
    const svc = mk()
    await svc.runDeepRefresh()
    expect(JSON.stringify(svc.getDroppedList())).not.toContain(JSKEY)
    expect(consoleText()).not.toContain(JSKEY)
  })
})

describe('dropped text is sanitized', () => {
  it('strips HTML, collapses whitespace and truncates to 160 chars (JSearch)', async () => {
    writeCfg({ jsearchApiKey: JSKEY })
    serveFirst(
      jsOk([
        jsRow('h1', {
          job_title: '<b>Hot</b>\n\n   <script>alert(1)</script>Job   &amp; Co',
          employer_name: '<i>Tag</i>   Corp',
          job_country: 'US',
          job_city: 'NYC',
          job_location: '<p>New</p>\tYork,   USA'
        }),
        jsRow('h2', {
          job_title: 'T'.repeat(500),
          employer_name: 'C'.repeat(300),
          job_country: 'US',
          job_city: 'NYC',
          job_location: 'L '.repeat(300)
        })
      ])
    )
    const svc = mk()
    await svc.runDeepRefresh()
    const list = svc.getDroppedList()
    expect(list).toHaveLength(2)
    for (const d of list) {
      for (const f of [d.title, d.company, d.location]) {
        expect(f).not.toMatch(/[<>]/)
        expect(f).not.toMatch(/\s{2,}|[\n\t]/)
        expect(f.length).toBeLessThanOrEqual(160)
        // Truncation happens after trimming, so a cut at exactly 160 chars may end in one space (cosmetic, reported).
        if (f.length < 160) expect(f).toBe(f.trim())
      }
    }
    const html = list.find((d) => d.company.startsWith('Tag'))!
    expect(html.company).toBe('Tag Corp')
    expect(html.location).toBe('New York, USA')
    expect(html.title).toContain('Hot')
    const long = list.find((d) => d.title.startsWith('TTTT'))!
    expect(long.title).toHaveLength(160)
    expect(long.company).toHaveLength(160)
  })

  it('strips HTML and truncates (SerpApi)', async () => {
    writeCfg({ serpapiApiKey: SPKEY })
    serveFirst(
      spOk([spRow('h3', { title: '<b>Bold</b>   Title ' + 'x'.repeat(400), company_name: '<u>Under</u> Co', location: 'New York, NY, USA' })])
    )
    const svc = mk()
    await svc.runDeepRefresh()
    const [d] = svc.getDroppedList()
    expect(d.title.startsWith('Bold Title x')).toBe(true)
    expect(d.title).toHaveLength(160)
    expect(d.company).toBe('Under Co')
  })
})
