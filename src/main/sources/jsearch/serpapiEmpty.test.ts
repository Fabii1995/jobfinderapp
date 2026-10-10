import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memDb, tempDirs } from '../../testing/db'
import { createJSearchService, interpretSerpapiBody, SERPAPI_QUERIES, type FetchLike } from './index'
import { mapSerpapiRow, serpapiJobId } from './map'

// Fake keys only. Mocked HTTP only. SerpApi/JSearch body shapes are assumptions (UNVERIFIED against live APIs).
const JSKEY = 'fake-jsearch-key-AAAA1111'
const SPKEY = 'fake-serpapi-key-BBBB2222'
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0)
const EMPTY_ERR = "Google hasn't returned any results for this query."

const db = memDb()
const tempDir = tempDirs()
let dir: string

type Resp = { ok: boolean; status: number; json(): Promise<unknown> }
const ok200 = (body: unknown): Resp => ({ ok: true, status: 200, json: async () => body })
const fetchMock = vi.fn<FetchLike>()
const mk = (): ReturnType<typeof createJSearchService> =>
  createJSearchService({ userDataDir: dir, db, fetchImpl: fetchMock, now: () => NOW })

let logSpies: ReturnType<typeof vi.spyOn>[]
beforeEach(() => {
  dir = tempDir('jf-serpempty-')
  fetchMock.mockReset()
  logSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
})
afterEach(() => {
  vi.restoreAllMocks()
})

const files = (): string =>
  readdirSync(dir)
    .filter((f) => f !== 'config.json')
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
const logged = (): string => JSON.stringify(logSpies.flatMap((s) => s.mock.calls))
const spState = (): Record<string, unknown> => JSON.parse(readFileSync(join(dir, 'serpapi-state.json'), 'utf8'))

/** Service with only a SerpApi key (so SerpApi is the selected provider). */
function spSvc(body: unknown): ReturnType<typeof createJSearchService> {
  const svc = mk()
  svc.setSerpapiKey(SPKEY)
  fetchMock.mockImplementation(async () => ok200(body))
  return svc
}

describe('SERPAPI_QUERIES and request shape', () => {
  it('is pinned to the 4 agreed queries', () => {
    expect(SERPAPI_QUERIES).toEqual([
      'junior software developer',
      'junior QA engineer',
      'entry level backend developer',
      'junior python developer'
    ])
  })

  it('sends engine=google_jobs with each query and the key only in api_key', async () => {
    const svc = spSvc({ search_metadata: { status: 'Success' } })
    await svc.runDeepRefresh()
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const urls = fetchMock.mock.calls.map((c) => new URL(c[0]))
    expect(urls.map((u) => u.searchParams.get('q'))).toEqual(SERPAPI_QUERIES)
    for (const u of urls) {
      expect(u.origin + u.pathname).toBe('https://serpapi.com/search.json')
      expect(u.searchParams.get('engine')).toBe('google_jobs')
      expect(u.searchParams.get('api_key')).toBe(SPKEY)
      expect(u.searchParams.get('location')).toBe('Israel')
      expect(u.searchParams.has('gl')).toBe(false)
    }
  })
})

describe('interpretSerpapiBody', () => {
  it('takes the first array among jobs_results, jobs, results', () => {
    expect(interpretSerpapiBody({ results: [3], jobs: [2], jobs_results: [1] })).toEqual({ kind: 'rows', rows: [1] })
    expect(interpretSerpapiBody({ results: [3], jobs: [2] })).toEqual({ kind: 'rows', rows: [2] })
    expect(interpretSerpapiBody({ results: [3] })).toEqual({ kind: 'rows', rows: [3] })
    expect(interpretSerpapiBody({ jobs_results: 'nope', jobs: [2] })).toEqual({ kind: 'rows', rows: [2] })
    expect(interpretSerpapiBody({ other: [1] })).toEqual({ kind: 'rows', rows: [] })
    expect(interpretSerpapiBody(null)).toEqual({ kind: 'rows', rows: [] })
  })
  it('treats the "hasn\'t returned any results" error as empty', () => {
    expect(interpretSerpapiBody({ error: EMPTY_ERR }).kind).toBe('empty')
  })
})

describe('SerpApi empty-result diagnostics', () => {
  it('"hasn\'t returned any results" is a normal empty result: ok, not blocked, 4 requests counted', async () => {
    const svc = spSvc({ error: EMPTY_ERR, search_metadata: { status: 'Success' } })
    const res = await svc.runDeepRefresh()
    expect(res.ok).toBe(true)
    expect(res.summary?.fetched).toBe(0)
    expect(res.summary?.requests).toBe(4)
    expect(res.message).toContain('normal empty result')
    expect(res.message).toContain('[q1,q2,q3,q4:')
    expect(res.message).toContain('keys: error, search_metadata')
    expect(res.message).toContain('status: Success')
    const st = svc.getStatus()
    expect(st.serpapi.blocked).toBe(false)
    expect(st.serpapi.used).toBe(4)
    expect(spState().blockedUntil).toBeNull()
  })

  it('unknown keys and no job array: diagnostic lists sorted keys and search_metadata.status', async () => {
    const svc = spSvc({ zeta: 1, alpha: 2, search_metadata: { status: 'Success' }, mid: [] })
    const res = await svc.runDeepRefresh()
    expect(res.ok).toBe(true)
    expect(res.summary?.fetched).toBe(0)
    expect(res.message).toContain('0 rows parsed')
    expect(res.message).toContain('keys: alpha, mid, search_metadata, zeta')
    expect(res.message).toContain('status: Success')
    expect(res.message).not.toContain('normal empty result')
    expect(res.message).toContain('[q1,q2,q3,q4:')
    expect(svc.getStatus().serpapi.blocked).toBe(false)
  })

  it('caps keys at 15 with "+N more" and cuts key names to 40 chars', async () => {
    const body: Record<string, unknown> = {}
    for (let i = 0; i < 20; i++) body[`k${String(i).padStart(2, '0')}`] = i
    body['L'.repeat(60)] = 1 // sorts first (uppercase before lowercase)
    const svc = spSvc(body)
    const res = await svc.runDeepRefresh()
    expect(res.message).toContain(`keys: ${'L'.repeat(40)}, k00`)
    expect(res.message).not.toContain('L'.repeat(41))
    expect(res.message).toContain('k13')
    expect(res.message).not.toContain('k14')
    expect(res.message).toContain('+6 more')
  })

  it('scrubs the fake key from error text and key names, and never leaks it anywhere', async () => {
    const svc = spSvc({
      error: `${EMPTY_ERR} debug api_key=${SPKEY} also ${SPKEY} x-api-key: ${SPKEY}`,
      [`has_${SPKEY}`]: 1
    })
    const res = await svc.runDeepRefresh()
    expect(res.ok).toBe(true)
    expect(res.message).toContain('error:')
    expect(res.message).toContain('***')
    expect(res.message).not.toContain(SPKEY)
    expect(JSON.stringify(res)).not.toContain(SPKEY)
    expect(JSON.stringify(svc.getStatus())).not.toContain(SPKEY)
    expect(files()).not.toContain(SPKEY)
    expect(logged()).not.toContain(SPKEY)
  })

  it('truncates error text to 200 chars', async () => {
    const svc = spSvc({ error: `${EMPTY_ERR} ${'x'.repeat(500)}` })
    const res = await svc.runDeepRefresh()
    expect(res.message).toContain('error: ')
    expect(res.message).not.toContain('x'.repeat(201))
    const errPart = /error: ([^\]]*)\]/.exec(res.message)?.[1] ?? ''
    expect(errPart.length).toBeLessThanOrEqual(203) // 200 + "..."
    expect(errPart.endsWith('...')).toBe(true)
  })

  it('never includes job content from unrecognized fields', async () => {
    const svc = spSvc({
      mystery: [{ title: 'Secret Junior Wizard TITLE-LEAK', description: 'DESC-LEAK' }],
      payload: 'STRING-LEAK',
      search_metadata: { status: 'Success', note: 'META-LEAK' }
    })
    const res = await svc.runDeepRefresh()
    for (const leak of ['TITLE-LEAK', 'DESC-LEAK', 'STRING-LEAK', 'META-LEAK', 'Secret Junior']) {
      expect(res.message).not.toContain(leak)
    }
    expect(res.message).toContain('keys: mystery, payload, search_metadata')
  })

  it('non-string search_metadata.status is omitted', async () => {
    const svc = spSvc({ search_metadata: { status: { x: 'STATUS-LEAK' } } })
    const res = await svc.runDeepRefresh()
    expect(res.message).not.toContain('status:')
    expect(res.message).not.toContain('STATUS-LEAK')
  })

  it('different bodies per query are grouped separately by query number', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    let n = 0
    fetchMock.mockImplementation(async () => ok200(++n <= 2 ? { aaa: 1 } : { bbb: 1 }))
    const res = await svc.runDeepRefresh()
    expect(res.message).toContain('[q1,q2: 0 rows parsed; keys: aaa]')
    expect(res.message).toContain('[q3,q4: 0 rows parsed; keys: bbb]')
  })

  it('a non-empty response adds no diagnostic', async () => {
    const svc = spSvc({
      jobs_results: [
        {
          job_id: 'ok1',
          title: 'Junior QA Engineer',
          company_name: 'Acme',
          location: 'Tel Aviv, Israel',
          description: 'Entry level role for new graduates.',
          apply_options: [{ link: 'https://example.com/j/1' }],
          detected_extensions: { posted_at: '2 days ago' }
        }
      ]
    })
    const res = await svc.runDeepRefresh()
    expect(res.summary?.fetched).toBeGreaterThan(0)
    expect(res.message).not.toContain('0 rows parsed')
    expect(res.message).not.toContain('keys:')
  })
})

describe('JSearch zero-row diagnostics', () => {
  it('lists keys, status and a scrubbed error for a 200 with no rows; ok stays true', async () => {
    const svc = mk()
    svc.setKey(JSKEY)
    fetchMock.mockImplementation(async () =>
      ok200({ status: 'OK', data: [], zzz: 1, error: `nothing for ${JSKEY}`, secret: [{ job_title: 'JS-TITLE-LEAK' }] })
    )
    const res = await svc.runDeepRefresh()
    expect(res.provider).toBe('jsearch')
    expect(res.ok).toBe(true)
    expect(res.summary?.fetched).toBe(0)
    expect(res.message).toContain('0 rows parsed')
    expect(res.message).toContain('keys: data, error, secret, status, zzz')
    expect(res.message).toContain('[q1,q2,q3,q4,q5:')
    expect(res.message).not.toContain(JSKEY)
    expect(res.message).not.toContain('JS-TITLE-LEAK')
    expect(files()).not.toContain(JSKEY)
    expect(logged()).not.toContain(JSKEY)
  })
})

describe('SerpApi row-shape variants', () => {
  const base = { company_name: 'Acme', location: 'Tel Aviv, Israel' }
  const desc = 'Entry level role for new graduates.'
  const link = 'https://example.com/job/1'
  const mapped = (row: unknown): ReturnType<typeof mapSerpapiRow> => mapSerpapiRow(row, NOW)

  const variants: [string, Record<string, unknown>, string][] = [
    ['title/description/apply_options', { ...base, job_id: 'v1', title: 'Junior QA Engineer', description: desc, apply_options: [{ link }], detected_extensions: { posted_at: '2 days ago' } }, link],
    ['job_title/company/job_location/snippet/share_link', { job_id: 'v2', job_title: 'Junior Python Developer', company: 'Beta', job_location: 'Haifa, Israel', snippet: desc, share_link: link, posted_at: '3 days ago' }, link],
    ['job_description + share_url', { ...base, job_id: 'v3', title: 'Junior Backend Developer', job_description: desc, share_url: link }, link],
    ['plain link + job_highlights only', { ...base, job_id: 'v4', title: 'Junior Software Engineer', job_highlights: [{ title: 'Qualifications', items: ['Entry level, new graduates welcome'] }], link }, link],
    ['related_links', { ...base, job_id: 'v5', title: 'Junior DevOps Engineer', description: desc, related_links: [{ text: 'x', link }] }, link],
    ['apply_link and no job_id (hash fallback)', { ...base, title: 'Junior QA Automation Engineer', description: desc, apply_link: link }, link],
    ['skips non-http link candidates', { ...base, job_id: 'v7', title: 'Junior Fullstack Developer', description: desc, apply_options: [{ link: 'javascript:alert(1)' }, { link: 'ftp://x/y' }], share_link: link }, link]
  ]
  for (const [name, row, expectedUrl] of variants) {
    it(`maps to a kept job: ${name}`, () => {
      const out = mapped(row)
      expect(out.kind).toBe('job')
      if (out.kind === 'job') {
        expect(out.job.url).toBe(expectedUrl)
        expect(out.job.externalId).toBeTruthy()
        expect(out.job.country).toBe('IL')
      }
    })
  }

  it('hash fallback id is stable, prefixed, and differs by title', () => {
    const a = { title: 'Junior A', company: 'X', location: 'Israel' }
    expect(serpapiJobId(a)).toMatch(/^h:[0-9a-f]{8}$/)
    expect(serpapiJobId(a)).toBe(serpapiJobId({ ...a }))
    expect(serpapiJobId(a)).not.toBe(serpapiJobId({ ...a, title: 'Junior B' }))
    expect(serpapiJobId({ company: 'X' })).toBeNull()
    expect(serpapiJobId({ job_id: 'real', title: 'x' })).toBe('real')
  })

  it('reads posted_at from detected_extensions and drops old postings', () => {
    const row = { ...base, job_id: 'o1', title: 'Junior QA Engineer', description: desc, apply_options: [{ link }] }
    const recent = mapped({ ...row, detected_extensions: { posted_at: '2 days ago' } })
    expect(recent.kind === 'job' && recent.job.postedAt).toBe(NOW - 2 * 86_400_000)
    expect(mapped({ ...row, posted_at: '3 months ago' })).toEqual({ kind: 'drop', reason: 'old' })
  })

  it('ignores non-string fields without throwing', () => {
    const weird: Record<string, unknown>[] = [
      { job_id: 5, title: 42, company_name: {}, location: [], description: 7, apply_options: 'x', detected_extensions: 'y' },
      { job_id: 'n1', title: ['Junior QA'], company_name: null, location: 1, link: 9, related_links: [null, 3, { link: {} }] },
      { job_id: 'n2', title: 'Junior QA Engineer', company_name: 5, location: 'Tel Aviv, Israel', description: desc, apply_options: [null, 'a', { link: 5 }], share_link: link, job_highlights: [1, null, { title: 3, items: [4, {}] }], detected_extensions: { posted_at: 5 } }
    ]
    for (const w of weird) expect(() => mapped(w)).not.toThrow()
    expect(() => serpapiJobId(weird[0])).not.toThrow()
    expect(mapped(weird[0]).kind).toBe('drop')
    expect(mapped(weird[1]).kind).toBe('drop')
    // non-string company ignored -> 'Unknown'; row still kept
    const kept = mapped(weird[2])
    expect(kept.kind).toBe('job')
    if (kept.kind === 'job') expect(kept.job.company).toBe('Unknown')
    for (const bad of [null, undefined, 'str', 5, []]) expect(mapped(bad)).toEqual({ kind: 'drop', reason: 'invalid' })
  })

  it('service inserts kept variant rows end to end and never leaks the key', async () => {
    const svc = mk()
    svc.setSerpapiKey(SPKEY)
    fetchMock.mockImplementation(async () =>
      ok200({
        results: [
          { job_title: 'Junior Software Engineer', company: 'VarCo', job_location: 'Tel Aviv, Israel', snippet: desc, share_link: link, posted_at: '1 day ago' }
        ]
      })
    )
    const res = await svc.runDeepRefresh()
    expect(res.ok).toBe(true)
    expect(res.summary?.kept).toBe(1)
    expect(res.summary?.inserted).toBe(1)
    expect(res.message).not.toContain(SPKEY)
    expect(files()).not.toContain(SPKEY)
    expect(logged()).not.toContain(SPKEY)
    expect(existsSync(join(dir, 'serpapi-state.json'))).toBe(true)
  })
})
