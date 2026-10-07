import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb, type Db } from '../db'
import { jobs } from '../db/schema'
import { refreshJobs } from '../ingest/refresh'
import { makeCompanyEntry } from '../companies/validate'
import type { CompanyEntry } from '../companies/types'
import { CONNECTORS, fetchCompany } from './index'
import type { Http, RawJob } from './types'

/**
 * Mocked-HTTP tests for every ATS connector (no network). Connectors NORMALIZE (country / workMode);
 * the Israel + not-remote + score filters run in refreshJobs, so each rule is checked at both layers.
 */

interface Item {
  id: string
  title: string
  /** Free-text location as the ATS shows it. */
  loc: string
  /** Structured country as the ATS reports it (ISO-2 / name). */
  country?: string
  mode?: 'onsite' | 'hybrid' | 'remote' | null
  desc?: string
}

interface Calls {
  get: string[]
  post: Array<{ url: string; body: unknown }>
}
interface Desc {
  key: string
  entry: CompanyEntry
  ext: (id: string) => string
  /** Raw listing entries -> a mock Http (any other call returns `{}`). */
  serveRaw: (entries: unknown[], calls: Calls) => Http
  build: (i: Item) => unknown
  /** The ATS filters by country server-side, so a non-Israel row cannot come back from a real call. */
  serverFiltersCountry?: boolean
  /** Work mode reported for an on-site posting (SmartRecruiters only has hybrid/remote flags, so on-site is 'unknown'). */
  onsiteAs?: 'onsite' | 'unknown'
  /** Description comes as plain text (not HTML) from this ATS. */
  plainDescription?: boolean
}

const newCalls = (): Calls => ({ get: [], post: [] })
const MODE_TEXT = { onsite: ' (On-site)', hybrid: ' (Hybrid)', remote: ' (Remote)' } as const

const GREENHOUSE: Desc = {
  key: 'greenhouse',
  entry: makeCompanyEntry({ name: 'GH Co', ats: 'greenhouse', params: { token: 'ghco' } }),
  ext: (id) => id,
  build: (i) => ({
    id: i.id,
    title: i.title,
    absolute_url: `https://boards.greenhouse.io/ghco/jobs/${i.id}`,
    location: { name: i.loc + (i.mode ? MODE_TEXT[i.mode] : '') },
    content: i.desc ? `&lt;p&gt;${i.desc}&lt;/p&gt;` : undefined,
    first_published: '2026-09-01T10:00:00Z'
  }),
  serveRaw: (entries, calls) => ({
    getJson: async (url) => (calls.get.push(url), { jobs: entries }),
    postJson: async () => ({})
  })
}

const COMEET: Desc = {
  key: 'comeet',
  entry: makeCompanyEntry({ name: 'Comeet Co', ats: 'comeet', params: { uid: 'AB.123', token: 'TOKEN1234567890' } }),
  ext: (id) => id,
  build: (i) => ({
    uid: i.id,
    name: i.title,
    url_active_page: `https://www.comeet.com/jobs/co/AB.123/${i.id}`,
    // is_remote is true for hybrid postings in the real API: it must never be used on its own to exclude.
    location: { name: i.loc, country: i.country ?? null, city: i.loc.split(',')[0], is_remote: i.mode !== 'onsite' },
    workplace_type: i.mode === 'onsite' ? 'On-site' : i.mode === 'hybrid' ? 'Hybrid' : i.mode === 'remote' ? 'Remote' : undefined,
    details: i.desc ? [{ name: 'Description', value: `<p>${i.desc}</p>` }] : [],
    time_updated: '2026-09-02T00:00:00Z'
  }),
  serveRaw: (entries, calls) => ({
    getJson: async (url) => (calls.get.push(url), entries),
    postJson: async () => ({})
  })
}

const LEVER: Desc = {
  key: 'lever',
  plainDescription: true,
  entry: makeCompanyEntry({ name: 'Lever Co', ats: 'lever', params: { slug: 'leverco' } }),
  ext: (id) => id,
  build: (i) => ({
    id: i.id,
    text: i.title,
    hostedUrl: `https://jobs.lever.co/leverco/${i.id}`,
    categories: { location: i.loc, allLocations: [i.loc] },
    country: i.country,
    workplaceType: i.mode ?? undefined,
    descriptionPlain: i.desc,
    createdAt: 1_790_000_000_000
  }),
  serveRaw: (entries, calls) => ({
    getJson: async (url) => (calls.get.push(url), entries),
    postJson: async () => ({})
  })
}

const ASHBY: Desc = {
  key: 'ashby',
  plainDescription: true,
  entry: makeCompanyEntry({ name: 'Ashby Co', ats: 'ashby', params: { name: 'ashbyco' } }),
  ext: (id) => id,
  build: (i) => ({
    id: i.id,
    title: i.title,
    jobUrl: `https://jobs.ashbyhq.com/ashbyco/${i.id}`,
    location: i.loc,
    address: i.country ? { postalAddress: { addressCountry: i.country } } : undefined,
    workplaceType: i.mode === 'onsite' ? 'OnSite' : i.mode === 'hybrid' ? 'Hybrid' : i.mode === 'remote' ? 'Remote' : undefined,
    isRemote: i.mode === 'remote',
    descriptionPlain: i.desc,
    publishedAt: '2026-09-03T00:00:00Z'
  }),
  serveRaw: (entries, calls) => ({
    getJson: async (url) => (calls.get.push(url), { jobs: entries }),
    postJson: async () => ({})
  })
}

const SMART: Desc = {
  key: 'smartrecruiters',
  onsiteAs: 'unknown',
  entry: makeCompanyEntry({ name: 'SR Co', ats: 'smartrecruiters', params: { id: 'SrCo' } }),
  ext: (id) => id,
  serverFiltersCountry: true,
  build: (i) => ({
    id: i.id,
    name: i.title,
    location: {
      city: i.loc.split(',')[0],
      country: i.country ?? undefined,
      fullLocation: i.loc,
      hybrid: i.mode === 'hybrid',
      remote: i.mode === 'remote'
    },
    experienceLevel: { id: 'associate' },
    releasedDate: '2026-09-04T00:00:00Z',
    _desc: i.desc
  }),
  serveRaw: (entries, calls) => ({
    getJson: async (url) => {
      calls.get.push(url)
      if (url.includes('/postings?')) return { content: entries, totalFound: entries.length }
      const m = /\/postings\/([^/?]+)$/.exec(url)
      const src = entries.find((e) => (e as { id?: string } | null)?.id === m?.[1]) as { _desc?: string } | undefined
      return { jobAd: { sections: { jobDescription: { text: `<p>${src?._desc ?? ''}</p>` } } }, postingUrl: `https://jobs.smartrecruiters.com/SrCo/${m?.[1]}` }
    },
    postJson: async () => ({})
  })
}

const AMAZON: Desc = {
  key: 'amazon',
  entry: makeCompanyEntry({ name: 'Amazon', ats: 'amazon', params: {} }),
  ext: (id) => id,
  build: (i) => {
    const il = (i.country ?? '').toUpperCase() === 'IL'
    return {
      id_icims: i.id,
      id: 'internal-' + i.id,
      title: i.title,
      job_path: `/en/jobs/${i.id}/x`,
      description: i.desc ? `<p>${i.desc}</p>` : undefined,
      basic_qualifications: '',
      city: i.loc.split(',')[0],
      country_code: il ? 'ISR' : 'USA',
      normalized_location: i.loc,
      location: i.loc,
      locations: il ? [JSON.stringify({ countryIso3a: 'ISR', type: (i.mode ?? 'ONSITE').toUpperCase(), locationNonStemming: i.loc })] : [],
      posted_date: 'September 5, 2026'
    }
  },
  serveRaw: (entries, calls) => ({
    getJson: async (url) => (calls.get.push(url), { hits: entries.length, jobs: entries }),
    postJson: async () => ({})
  })
}

const WORKDAY: Desc = {
  key: 'workday',
  entry: makeCompanyEntry({
    name: 'WD Co',
    ats: 'workday',
    params: { host: 'wdco.wd5.myworkdayjobs.com', tenant: 'wdco', site: 'Ext' }
  }),
  ext: (id) => `/job/${id}`,
  serverFiltersCountry: true,
  build: (i) => ({
    title: i.title,
    externalPath: `/job/${i.id}`,
    locationsText: i.loc,
    _detail: {
      jobDescription: i.desc ? `<p>${i.desc}</p>` : '',
      location: i.loc,
      remoteType: i.mode === 'remote' ? 'Remote' : i.mode === 'hybrid' ? 'Hybrid' : i.mode === 'onsite' ? 'On-site' : undefined
    }
  }),
  serveRaw: (entries, calls) => ({
    postJson: async (url, body) => {
      calls.post.push({ url, body })
      const b = body as { appliedFacets: Record<string, string[]>; offset: number; limit: number }
      if (Object.keys(b.appliedFacets).length === 0) {
        return { total: entries.length, jobPostings: [], facets: [{ facetParameter: 'locations', descriptor: 'Location', values: [{ descriptor: 'Israel, Haifa', id: 'il1' }] }] }
      }
      return { total: b.offset === 0 ? entries.length : 0, jobPostings: entries.slice(b.offset, b.offset + b.limit) }
    },
    getJson: async (url) => {
      calls.get.push(url)
      const e = entries.find((x) => url.endsWith((x as { externalPath?: string } | null)?.externalPath ?? '\u0000')) as { _detail?: unknown } | undefined
      return { jobPostingInfo: e?._detail ?? {} }
    }
  })
}

const ALL: Desc[] = [GREENHOUSE, COMEET, LEVER, ASHBY, SMART, AMAZON, WORKDAY]

const run = (d: Desc, entries: unknown[], calls = newCalls()): Promise<RawJob[]> =>
  CONNECTORS[d.entry.ats](d.entry.params, { id: d.entry.id, name: d.entry.name, http: d.serveRaw(entries, calls), delayMs: 0 })
const runItems = (d: Desc, items: Item[], calls = newCalls()): Promise<RawJob[]> => run(d, items.map(d.build), calls)

const TLV: Item = { id: '1', title: 'Junior QA Engineer', loc: 'Tel Aviv, Israel', country: 'IL', mode: 'onsite', desc: 'Test our product.' }

describe.each(ALL)('$key connector: normalization', (d) => {
  it('happy path: maps ids, company, url, description, Israel country/city, work mode', async () => {
    const out = await runItems(d, [TLV, { ...TLV, id: '2', mode: 'hybrid', title: 'Junior Backend Developer' }])
    expect(out).toHaveLength(2)
    const [a, b] = out
    expect(a).toMatchObject({ source: d.entry.id, externalId: d.ext('1'), title: 'Junior QA Engineer', company: d.entry.name, country: 'IL', workMode: d.onsiteAs ?? 'onsite' })
    expect(a.city).toBe('Tel Aviv')
    expect(a.url).toMatch(/^https:\/\//)
    expect(a.description ?? '').toContain('Test our product')
    expect(a.description ?? '').not.toMatch(/<\/?p>|&lt;/)
    expect(b).toMatchObject({ externalId: d.ext('2'), workMode: 'hybrid', country: 'IL' })
  })

  it('remote-only is normalized to workMode "remote" (Israel-based but fully remote)', async () => {
    const [r] = await runItems(d, [{ ...TLV, loc: 'Tel Aviv, Israel', mode: 'remote' }])
    expect(r.workMode).toBe('remote')
    expect(r.country).toBe('IL')
  })

  it('a non-Israel structured country is never labelled IL', async () => {
    if (d.serverFiltersCountry && d.key === 'workday') return // facet guarantees IL by construction
    const [r] = await runItems(d, [{ ...TLV, loc: 'London, UK', country: 'GB', mode: 'onsite' }])
    expect(r.country).not.toBe('IL')
  })

  it('"Chicago, IL" (Illinois) is not Israel', async () => {
    if (d.key === 'workday') return // facet guarantees IL by construction; Chicago-only facets are covered below
    const [r] = await runItems(d, [{ id: '9', title: 'Junior QA Engineer', loc: 'Chicago, IL', country: 'US', mode: 'onsite', desc: 'x' }])
    expect(r.country).not.toBe('IL')
    const [r2] = await runItems(d, [{ id: '10', title: 'Junior QA Engineer', loc: 'Chicago, IL', mode: 'onsite', desc: 'x' }])
    expect(r2.country).not.toBe('IL')
  })

  it('empty result sets -> []', async () => {
    expect(await run(d, [])).toEqual([])
  })

  it('wrong-typed / malformed entries are skipped without throwing', async () => {
    const out = await run(d, [null, 5, 'x', [], {}, { id: 1 }, { title: 5 }, { id: {}, title: [], name: {}, text: 7, uid: [] }])
    expect(out).toEqual([])
    const [ok] = await run(d, [null, d.build(TLV), 7])
    expect(ok.externalId).toBe(d.ext('1'))
  })

  it('wrong-typed top-level payloads resolve to [] (never throw)', async () => {
    for (const junk of [null, undefined, 'x', 5, true, [], {}, { jobs: 'x' }, { jobs: {} }, { content: 'x' }, { jobPostings: 5 }]) {
      const http: Http = { getJson: async () => junk, postJson: async () => junk }
      const out = await CONNECTORS[d.entry.ats](d.entry.params, { id: d.entry.id, name: d.entry.name, http, delayMs: 0 })
      expect(out, JSON.stringify(junk)).toEqual([])
    }
  })

  it('HTTP errors from the injected client propagate (so refresh can isolate them)', async () => {
    for (const msg of ['HTTP 404 Not Found for u', 'HTTP 429 Too Many Requests for u', 'HTTP 500 Server Error for u']) {
      const http: Http = { getJson: async () => { throw new Error(msg) }, postJson: async () => { throw new Error(msg) } }
      await expect(CONNECTORS[d.entry.ats](d.entry.params, { id: d.entry.id, name: d.entry.name, http, delayMs: 0 })).rejects.toThrow(msg)
    }
  })

  it('invalid params are rejected BEFORE any request', async () => {
    const http: Http = { getJson: vi.fn(), postJson: vi.fn() }
    const bad = Object.fromEntries(Object.keys(d.entry.params).map((k) => [k, "../../x'; DROP"]))
    if (d.key === 'amazon') return // no params
    await expect(CONNECTORS[d.entry.ats](bad, { id: 'x', name: 'x', http, delayMs: 0 })).rejects.toThrow()
    await expect(CONNECTORS[d.entry.ats]({}, { id: 'x', name: 'x', http, delayMs: 0 })).rejects.toThrow()
    expect(http.getJson).not.toHaveBeenCalled()
    expect(http.postJson).not.toHaveBeenCalled()
  })

  it('HTML in a description is reduced to text (no tags, no script bodies)', async () => {
    if (d.plainDescription) return // Lever/Ashby ship descriptionPlain (already text)
    const [r] = await runItems(d, [{ ...TLV, desc: 'Hello <script>alert(1)</script>world' }])
    if (r.description) expect(r.description).not.toMatch(/<script|alert\(1\)/i)
  })
})

describe.each(ALL)('$key connector: real HTTP client against mocked fetch', (d) => {
  afterEach(() => vi.unstubAllGlobals())
  const stub = (res: () => Response): ReturnType<typeof vi.fn> => {
    const f = vi.fn(() => Promise.resolve(res()))
    vi.stubGlobal('fetch', f)
    return f
  }
  for (const [status, text] of [[404, 'Not Found'], [429, 'Too Many Requests'], [500, 'Server Error'], [503, 'Unavailable']] as const) {
    it(`HTTP ${status} rejects with the status and is not retried`, async () => {
      const f = stub(() => new Response('x', { status, statusText: text }))
      await expect(fetchCompany(d.entry)).rejects.toThrow(new RegExp(`HTTP ${status}`))
      expect(f).toHaveBeenCalledTimes(1)
    })
  }
  it('malformed JSON / an HTML 200 page rejects', async () => {
    stub(() => new Response('{not json', { status: 200 }))
    await expect(fetchCompany(d.entry)).rejects.toThrow()
    stub(() => new Response('<html>blocked</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    await expect(fetchCompany(d.entry)).rejects.toThrow()
  })
  it('a 200 with an empty JSON body yields no jobs', async () => {
    stub(() => new Response('[]', { status: 200 }))
    expect(await fetchCompany(d.entry)).toEqual([])
    stub(() => new Response('{}', { status: 200 }))
    expect(await fetchCompany(d.entry)).toEqual([])
  })
})

describe.each(ALL)('$key connector: refreshJobs ingest rules', (d) => {
  let db: Db
  let close: () => void
  beforeEach(() => {
    ;({ db, close } = openDb(':memory:'))
  })
  afterEach(() => close())

  const refreshWith = (entries: unknown[]): ReturnType<typeof refreshJobs> =>
    refreshJobs(db, {
      companies: [d.entry],
      fetchCompany: (e) => CONNECTORS[e.ats](e.params, { id: e.id, name: e.name, http: d.serveRaw(entries, newCalls()), delayMs: 0 })
    })
  const storedIds = (): string[] => db.select().from(jobs).all().map((j) => j.externalId).sort()

  it('keeps Israel on-site/hybrid junior roles; drops remote-only, non-Israel, Chicago IL and senior titles', async () => {
    const items: Item[] = [
      { ...TLV, id: 'keep-onsite' },
      { ...TLV, id: 'keep-hybrid', mode: 'hybrid', title: 'Junior Python Developer' },
      { ...TLV, id: 'drop-remote', mode: 'remote' },
      { ...TLV, id: 'drop-senior', title: 'Senior QA Engineer' },
      { ...TLV, id: 'drop-sr', title: 'Sr. Python Developer' },
      { ...TLV, id: 'drop-intern', title: 'QA Engineer Intern' },
      { ...TLV, id: 'drop-lead', title: 'Software Team Lead' }
    ]
    if (!(d.key === 'workday')) {
      items.push({ ...TLV, id: 'drop-london', loc: 'London, UK', country: 'GB' })
      items.push({ ...TLV, id: 'drop-chicago', loc: 'Chicago, IL', country: 'US' })
      items.push({ ...TLV, id: 'drop-chicago-nocountry', loc: 'Chicago, IL', country: undefined })
    }
    const res = await refreshWith(items.map(d.build))
    expect(storedIds()).toEqual([d.ext('keep-hybrid'), d.ext('keep-onsite')].sort())
    expect(res.errors).toEqual({})
    expect(res.sources[0]).toMatchObject({ source: d.entry.id, ok: true, count: items.length })
    expect(res.sources[0].kept).toBe(2)
    // everything stored carries the company display name and the connector id as source
    for (const j of db.select().from(jobs).all()) expect(j).toMatchObject({ source: d.entry.id, company: d.entry.name, country: 'IL' })
  })

  it('a senior title is rejected at ingest even when the body screams junior', async () => {
    const res = await refreshWith([
      d.build({ ...TLV, id: 's1', title: 'Senior Backend Developer', desc: 'No experience required. 0-2 years. Entry level. New grad welcome.' })
    ])
    expect(storedIds()).toEqual([])
    expect(res.sources[0]).toMatchObject({ ok: true, count: 1, kept: 0 })
  })

  it('nothing is written when the connector returns nothing', async () => {
    const res = await refreshWith([])
    expect(res).toMatchObject({ inserted: 0, updated: 0 })
    expect(storedIds()).toEqual([])
  })
})

describe('refreshJobs: per-company failure isolation with real connectors', () => {
  let db: Db
  let close: () => void
  beforeEach(() => {
    ;({ db, close } = openDb(':memory:'))
  })
  afterEach(() => close())

  it('one company 429-ing, one malformed, one throwing a TypeError: the healthy ones still store, errors are keyed by id', async () => {
    const good = [GREENHOUSE, LEVER]
    const failing: Array<[Desc, string]> = [
      [COMEET, 'HTTP 429 Too Many Requests for https://www.comeet.co/x'],
      [ASHBY, 'HTTP 500 Server Error for https://api.ashbyhq.com/x']
    ]
    const entries = [...failing.map(([d]) => d.entry), ...good.map((d) => d.entry), AMAZON.entry]
    const res = await refreshJobs(db, {
      companies: entries,
      concurrency: 2,
      fetchCompany: async (e) => {
        const f = failing.find(([d]) => d.entry.id === e.id)
        if (f) throw new Error(f[1])
        if (e.id === AMAZON.entry.id) return (null as unknown as RawJob[]).map((x) => x) // TypeError inside the fetcher
        const d = good.find((g) => g.entry.id === e.id)!
        return runItems(d, [{ ...TLV, id: 'ok-' + d.key }])
      }
    })
    expect(Object.keys(res.errors).sort()).toEqual([COMEET.entry.id, ASHBY.entry.id, AMAZON.entry.id].sort())
    expect(res.errors[COMEET.entry.id]).toMatch(/429/)
    expect(res.errors[ASHBY.entry.id]).toMatch(/500/)
    expect(res.errors[AMAZON.entry.id]).toMatch(/null|undefined|map/i)
    expect(res.sources.map((s) => [s.source, s.ok])).toEqual([
      [COMEET.entry.id, false],
      [ASHBY.entry.id, false],
      [GREENHOUSE.entry.id, true],
      [LEVER.entry.id, true],
      [AMAZON.entry.id, false]
    ])
    expect(res.inserted).toBe(2)
    expect(db.select().from(jobs).all().map((j) => j.externalId).sort()).toEqual(['ok-greenhouse', 'ok-lever'])
  })

  it('all companies failing still resolves (no throw) with every error recorded', async () => {
    const res = await refreshJobs(db, {
      companies: ALL.map((d) => d.entry),
      fetchCompany: async () => {
        throw new Error('offline')
      }
    })
    expect(res.inserted).toBe(0)
    expect(Object.keys(res.errors)).toHaveLength(ALL.length)
    expect(res.sources.every((s) => !s.ok && s.error === 'offline')).toBe(true)
  })

  it('a non-Error rejection is stringified', async () => {
    const res = await refreshJobs(db, { companies: [GREENHOUSE.entry], fetchCompany: () => Promise.reject('plain string') })
    expect(res.errors[GREENHOUSE.entry.id]).toBe('plain string')
  })

  it('disabled companies are skipped', async () => {
    const off = { ...GREENHOUSE.entry, enabled: false }
    const fetcher = vi.fn(async () => [] as RawJob[])
    const res = await refreshJobs(db, { companies: [off, LEVER.entry], fetchCompany: fetcher })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(res.sources.map((s) => s.source)).toEqual([LEVER.entry.id])
  })
})

describe('connector specifics', () => {
  it('greenhouse: URL uses the token and content=true; offices contribute a location; first_published wins over updated_at', async () => {
    const calls = newCalls()
    const http: Http = {
      getJson: async (u) => (calls.get.push(u), {
        jobs: [{ id: 7, title: 'QA Engineer', absolute_url: 'https://x/7', location: { name: 'Remote' }, offices: [{ location: 'Herzliya, Israel' }], first_published: '2026-01-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z' }]
      }),
      postJson: async () => ({})
    }
    const [j] = await CONNECTORS.greenhouse({ token: 'ghco' }, { id: 'greenhouse:ghco', name: 'GH', http })
    expect(calls.get).toEqual(['https://boards-api.greenhouse.io/v1/boards/ghco/jobs?content=true'])
    expect(j).toMatchObject({ externalId: '7', country: 'IL', city: 'Herzliya' })
    expect(j.postedAt).toBe(Date.parse('2026-01-01T00:00:00Z'))
  })

  it('comeet: requests details=true with uid and token; workplace_type decides, is_remote alone never excludes', async () => {
    const calls = newCalls()
    const out = await runItems(COMEET, [
      { ...TLV, id: 'h', mode: 'hybrid' }, // is_remote true in the payload
      { ...TLV, id: 'o', mode: 'onsite' },
      { ...TLV, id: 'u', mode: null } // no workplace_type, is_remote true
    ], calls)
    expect(calls.get[0]).toBe('https://www.comeet.co/careers-api/2.0/company/AB.123/positions?token=TOKEN1234567890&details=true')
    expect(out.map((j) => j.workMode)).toEqual(['hybrid', 'onsite', 'unknown'])
    // refreshJobs keeps all three (is_remote not used to exclude)
    const { db, close } = openDb(':memory:')
    try {
      await refreshJobs(db, { companies: [COMEET.entry], fetchCompany: () => Promise.resolve(out) })
      expect(db.select().from(jobs).all()).toHaveLength(3)
    } finally {
      close()
    }
  })

  it('comeet: location country IL (structured) is Israel even if the text has no city; description joins detail sections', async () => {
    const [j] = await run(COMEET, [{ uid: 'u1', name: 'QA', url_active_page: 'https://c/u1', location: { name: 'Office', country: 'IL', city: null }, details: [{ value: '<p>A</p>' }, { value: '<ul><li>B</li></ul>' }, { value: 5 }] }])
    expect(j.country).toBe('IL')
    expect(j.description).toBe('A\n\nB')
  })

  it('lever: workplaceType maps onsite/hybrid/remote; EU tenants use the EU host', async () => {
    const calls = newCalls()
    const out = await runItems(LEVER, [{ ...TLV, id: 'a', mode: 'onsite' }, { ...TLV, id: 'b', mode: 'hybrid' }, { ...TLV, id: 'c', mode: 'remote' }, { ...TLV, id: 'd', mode: null }], calls)
    expect(out.map((j) => j.workMode)).toEqual(['onsite', 'hybrid', 'remote', 'unknown'])
    expect(calls.get[0]).toBe('https://api.lever.co/v0/postings/leverco?mode=json')
    const eu = newCalls()
    await CONNECTORS.lever({ slug: 'euco', region: 'eu' }, { id: 'lever:euco', name: 'EU', http: LEVER.serveRaw([], eu) })
    expect(eu.get[0]).toBe('https://api.eu.lever.co/v0/postings/euco?mode=json')
    expect(out[0].postedAt).toBe(1_790_000_000_000)
  })

  it('lever: lists and additional text join into the description; non-numeric createdAt gives null', async () => {
    const [j] = await run(LEVER, [{ id: 'x', text: 'QA', hostedUrl: 'https://l/x', categories: { location: 'Tel Aviv' }, descriptionPlain: 'Plain', lists: [{ text: 'Reqs', content: '<li>Python</li>' }, null, 7], additionalPlain: 'Extra', createdAt: '123' }])
    expect(j.description).toContain('Plain')
    expect(j.description).toContain('Reqs')
    expect(j.description).toContain('Python')
    expect(j.description).toContain('Extra')
    expect(j.postedAt).toBeNull()
  })

  it('ashby: unlisted postings are skipped; secondary locations can make a posting Israeli; isRemote alone yields remote', async () => {
    const out = await run(ASHBY, [
      { id: '1', title: 'QA Engineer', jobUrl: 'https://a/1', location: 'London', secondaryLocations: [{ location: 'Tel Aviv, Israel' }], workplaceType: 'Hybrid' },
      { id: '2', title: 'QA Engineer', jobUrl: 'https://a/2', location: 'Tel Aviv', isListed: false },
      { id: '3', title: 'QA Engineer', jobUrl: 'https://a/3', location: 'Tel Aviv, Israel', isRemote: true },
      { id: '4', title: 'QA Engineer', jobUrl: 'https://a/4', location: 'Tel Aviv, Israel', isRemote: true, workplaceType: 'Hybrid' }
    ])
    expect(out.map((j) => j.externalId)).toEqual(['1', '3', '4'])
    expect(out[0]).toMatchObject({ country: 'IL', city: 'Tel Aviv', workMode: 'hybrid' })
    expect(out[1].workMode).toBe('remote')
    expect(out[2].workMode).toBe('hybrid') // explicit workplaceType beats isRemote
  })

  describe('smartrecruiters', () => {
    it('lists with country=il and paginates by limit/offset until totalFound', async () => {
      const calls = newCalls()
      const items = Array.from({ length: 150 }, (_, i) => ({ ...TLV, id: `p${i}`, title: 'Junior QA Engineer' }))
      const entries = items.map(SMART.build)
      const http: Http = {
        getJson: async (url) => {
          calls.get.push(url)
          const m = /offset=(\d+)/.exec(url)
          if (m) return { content: entries.slice(Number(m[1]), Number(m[1]) + 100), totalFound: 150 }
          return { jobAd: { sections: { jobDescription: { text: 'd' } } } }
        },
        postJson: async () => ({})
      }
      const out = await CONNECTORS.smartrecruiters({ id: 'SrCo' }, { id: 'smartrecruiters:srco', name: 'SR', http, delayMs: 0 })
      expect(out).toHaveLength(150)
      const lists = calls.get.filter((u) => u.includes('/postings?'))
      expect(lists).toHaveLength(2)
      expect(lists[0]).toBe('https://api.smartrecruiters.com/v1/companies/SrCo/postings?country=il&limit=100&offset=0')
      expect(lists[1]).toContain('offset=100')
    })
    it('skips the detail call for senior / intern titles (no description) but still returns them', async () => {
      const calls = newCalls()
      const out = await runItems(SMART, [
        { ...TLV, id: 'ok' },
        { ...TLV, id: 'sen', title: 'Senior QA Engineer' },
        { ...TLV, id: 'int', title: 'QA Intern' },
        { ...TLV, id: 'sr', title: 'Sr. Backend Developer' }
      ], calls)
      const details = calls.get.filter((u) => !u.includes('/postings?'))
      expect(details).toHaveLength(1)
      expect(details[0]).toMatch(/\/postings\/ok$/)
      expect(out.find((j) => j.externalId === 'ok')!.description).toContain('Test our product')
      for (const id of ['sen', 'int', 'sr']) expect(out.find((j) => j.externalId === id)!.description).toBeNull()
    })
    it('a failing detail call keeps the job without a description', async () => {
      const http: Http = {
        getJson: async (url) => {
          if (url.includes('/postings?')) return { content: [SMART.build(TLV)], totalFound: 1 }
          throw new Error('HTTP 429 Too Many Requests')
        },
        postJson: async () => ({})
      }
      const [j] = await CONNECTORS.smartrecruiters({ id: 'SrCo' }, { id: 'smartrecruiters:srco', name: 'SR', http, delayMs: 0 })
      expect(j).toMatchObject({ externalId: '1', description: null, country: 'IL' })
      expect(j.url).toBe('https://jobs.smartrecruiters.com/SrCo/1')
    })
    it('experienceLevel maps to seniority tags (entry_level, internship, director/executive)', async () => {
      const mk = (id: string, lvl: string): unknown => ({ ...(SMART.build({ ...TLV, id, title: 'Junior QA Engineer' }) as object), experienceLevel: { id: lvl } })
      const out = await run(SMART, [mk('a', 'entry_level'), mk('b', 'internship'), mk('c', 'director'), mk('d', 'executive'), mk('e', 'associate')])
      expect(out.map((j) => j.seniority)).toEqual([['entry-level'], ['intern'], ['senior'], ['senior'], undefined])
    })
    it('hybrid / remote flags drive workMode; fullLocation Israel text is Israel without a country', async () => {
      const out = await run(SMART, [
        { id: 'h', name: 'QA', location: { fullLocation: 'Tel Aviv, Israel', hybrid: true } },
        { id: 'r', name: 'QA', location: { fullLocation: 'Tel Aviv, Israel', remote: true } },
        { id: 'o', name: 'QA', location: { city: 'Haifa' } }
      ])
      expect(out.map((j) => [j.workMode, j.country])).toEqual([['hybrid', 'IL'], ['remote', 'IL'], ['unknown', 'IL']])
    })
    it('a mid-pagination failure rejects the whole company (partial pages are not stored)', async () => {
      const http: Http = {
        getJson: async (url) => {
          if (url.includes('offset=0')) return { content: Array.from({ length: 100 }, (_, i) => SMART.build({ ...TLV, id: 'q' + i })), totalFound: 200 }
          throw new Error('HTTP 500')
        },
        postJson: async () => ({})
      }
      await expect(CONNECTORS.smartrecruiters({ id: 'SrCo' }, { id: 'x', name: 'x', http, delayMs: 0 })).rejects.toThrow('HTTP 500')
    })
  })

  describe('amazon', () => {
    const page = (n: number, offset: number): unknown[] =>
      Array.from({ length: n }, (_, i) => AMAZON.build({ ...TLV, id: `a${offset + i}`, title: 'Software Development Engineer I' }))
    it('paginates 100 at a time (offset + country=ISR) until hits is reached', async () => {
      const urls: string[] = []
      const http: Http = {
        getJson: async (url) => {
          urls.push(url)
          const off = Number(/offset=(\d+)/.exec(url)![1])
          return { hits: 250, jobs: page(Math.min(100, 250 - off), off) }
        },
        postJson: async () => ({})
      }
      const out = await CONNECTORS.amazon({}, { id: 'amazon', name: 'Amazon', http, delayMs: 0 })
      expect(out).toHaveLength(250)
      expect(urls).toHaveLength(3)
      expect(urls[0]).toContain('loc_query=Israel')
      expect(urls[0]).toContain('country=ISR')
      expect(urls.map((u) => /offset=(\d+)/.exec(u)![1])).toEqual(['0', '100', '200'])
      expect(new Set(out.map((j) => j.externalId)).size).toBe(250)
    })
    it('stops after one request when the first page is short', async () => {
      const getJson = vi.fn(async () => ({ hits: 5, jobs: page(5, 0) }))
      const out = await CONNECTORS.amazon({}, { id: 'amazon', name: 'Amazon', http: { getJson, postJson: vi.fn() }, delayMs: 0 })
      expect(out).toHaveLength(5)
      expect(getJson).toHaveBeenCalledTimes(1)
    })
    it('never loops forever when hits lies (caps at 15 pages)', async () => {
      const getJson = vi.fn(async () => ({ hits: 1e9, jobs: page(100, 0) }))
      await CONNECTORS.amazon({}, { id: 'amazon', name: 'Amazon', http: { getJson, postJson: vi.fn() }, delayMs: 0 })
      expect(getJson.mock.calls.length).toBeLessThanOrEqual(15)
    })
    it('Israel is decided by country_code/locations (ISR), not the "IL" in "IL, Tel Aviv"; US "Chicago, IL" is not Israel', async () => {
      const out = await run(AMAZON, [
        { id_icims: '1', title: 'SDE I', job_path: '/p/1', city: 'Tel Aviv', country_code: 'ISR', normalized_location: 'IL, Tel Aviv', location: 'IL, Tel Aviv', locations: [JSON.stringify({ countryIso3a: 'ISR', type: 'ONSITE' })] },
        { id_icims: '2', title: 'SDE I', job_path: '/p/2', city: 'Chicago', country_code: 'USA', normalized_location: 'Chicago, IL, USA', location: 'US, IL, Chicago', locations: [JSON.stringify({ countryIso3a: 'USA', type: 'ONSITE' })] },
        { id_icims: '3', title: 'SDE I', job_path: '/p/3', city: 'London', country_code: 'GBR', normalized_location: 'London, GBR', location: 'GB, London', locations: ['not json', 5, null] }
      ])
            expect(out[0]).toMatchObject({ country: 'IL', city: 'Tel Aviv', workMode: 'onsite' })
      expect(out[1].country).not.toBe('IL')
      expect(out[2].country).not.toBe('IL')
    })
    it('multi-location: the Israeli entry sets the work mode', async () => {
      const [j] = await run(AMAZON, [{
        id_icims: '1', title: 'SDE I', job_path: '/p/1', city: 'Seattle', country_code: 'USA', normalized_location: 'Seattle, USA',
        locations: [JSON.stringify({ countryIso3a: 'USA', type: 'REMOTE', locationNonStemming: 'Seattle, USA' }), JSON.stringify({ countryIso3a: 'ISR', type: 'HYBRID', locationNonStemming: 'Tel Aviv, Israel' })]
      }])
      expect(j).toMatchObject({ country: 'IL', workMode: 'hybrid' })
    })
    it('intern / university flags become seniority tags; intern wins; refresh drops interns', async () => {
      const base = { job_path: '/p/x', city: 'Tel Aviv', country_code: 'ISR', normalized_location: 'Tel Aviv, Israel', locations: [JSON.stringify({ countryIso3a: 'ISR', type: 'ONSITE' })] }
      const out = await run(AMAZON, [
        { ...base, id_icims: 'i', title: 'Software Development Engineer Intern', is_intern: true },
        { ...base, id_icims: 'u', title: 'Software Development Engineer', university_job: true },
        { ...base, id_icims: 'b', title: 'Software Development Engineer', is_intern: true, university_job: true },
        { ...base, id_icims: 'n', title: 'Software Development Engineer' }
      ])
      expect(out.map((j) => j.seniority)).toEqual([['intern'], ['entry-level'], ['intern'], undefined])
      const { db, close } = openDb(':memory:')
      try {
        await refreshJobs(db, { companies: [AMAZON.entry], fetchCompany: () => Promise.resolve(out) })
        const ids = db.select().from(jobs).all().map((j) => j.externalId).sort()
        expect(ids).toEqual(['n', 'u'])
        const scores = Object.fromEntries(db.select().from(jobs).all().map((j) => [j.externalId, j.score]))
        expect(scores.u!).toBeGreaterThan(scores.n!)
      } finally {
        close()
      }
    })
    it('description = description + basic qualifications; preferred qualifications are ignored', async () => {
      const [j] = await run(AMAZON, [{ id_icims: '1', title: 'SDE', job_path: '/p/1', description: 'Build <b>things</b>', basic_qualifications: '<br/>1+ years of Java', preferred_qualifications: '10 years of experience', city: 'Tel Aviv', country_code: 'ISR' }])
      expect(j.description).toContain('Build things')
      expect(j.description).toContain('1+ years of Java')
      expect(j.description).not.toContain('10 years')
      expect(j.url).toBe('https://www.amazon.jobs/p/1')
      expect(j.postedAt).toBeNull()
    })
    it('falls back to id when id_icims is missing; rows without a job_path are skipped', async () => {
      const out = await run(AMAZON, [{ id: 'fallback', title: 'SDE', job_path: '/p/f' }, { id_icims: 'nopath', title: 'SDE' }])
      expect(out.map((j) => j.externalId)).toEqual(['fallback'])
    })
  })
})

describe('workday (beyond workday.test.ts)', () => {
  const FAC = (leaves: Array<[string, string]>): unknown[] => [
    {
      facetParameter: 'locationMainGroup',
      descriptor: 'Location',
      values: [
        {
          facetParameter: 'locationRegionStateProvince',
          descriptor: 'Region',
          values: [
            {
              descriptor: 'Asia',
              values: [{ facetParameter: 'locations', descriptor: 'Sub', values: leaves.map(([descriptor, id]) => ({ descriptor, id })) }]
            }
          ]
        }
      ]
    }
  ]
  const posting = (title: string, path: string, text = '2 Locations'): unknown => ({ title, externalPath: path, locationsText: text })
  const mkHttp = (o: {
    facets?: unknown
    pages?: unknown[]
    newGrad?: unknown[] | 'throw'
    detail?: (url: string) => unknown
    calls?: Calls
  }): Http => ({
    postJson: async (url, body) => {
      o.calls?.post.push({ url, body })
      const b = body as { appliedFacets: Record<string, string[]>; offset: number; limit: number }
      if (Object.keys(b.appliedFacets).length === 0) return { total: 0, jobPostings: [], facets: o.facets ?? [] }
      if (b.appliedFacets.workerSubType) {
        if (o.newGrad === 'throw') throw new Error('HTTP 500')
        return { total: 0, jobPostings: (o.newGrad ?? []).slice(b.offset, b.offset + b.limit) }
      }
      const all = o.pages ?? []
      return { total: b.offset === 0 ? all.length : 0, jobPostings: all.slice(b.offset, b.offset + b.limit) }
    },
    getJson: async (url) => {
      o.calls?.get.push(url)
      if (o.detail) return o.detail(url)
      return { jobPostingInfo: {} }
    }
  })
  const params = { host: 'wdco.wd5.myworkdayjobs.com', tenant: 'wdco', site: 'Ext' }
  const ctx = (http: Http): Parameters<(typeof CONNECTORS)['workday']>[1] => ({ id: 'workday:wdco', name: 'WD', http, delayMs: 0 })

  it('discovers the Israel facet nested three groups deep and sends only its ids', async () => {
    const calls = newCalls()
    await CONNECTORS.workday(params, ctx(mkHttp({ facets: FAC([['USA, Austin', 'us1'], ['Israel, Haifa', 'il1'], ['Israel, Tel Aviv', 'il2']]), pages: [], calls })))
    const filtered = calls.post.filter((c) => Object.keys((c.body as { appliedFacets: object }).appliedFacets).length > 0)
    expect((filtered[0].body as { appliedFacets: unknown }).appliedFacets).toEqual({ locations: ['il1', 'il2'] })
  })

  it('matches Hebrew ישראל and ignores "Israeli"-lookalikes and Chicago, IL', async () => {
    const calls = newCalls()
    await CONNECTORS.workday(params, ctx(mkHttp({ facets: FAC([['ישראל, חיפה', 'he1'], ['Chicago, IL', 'ch1']]), pages: [], calls })))
    const filtered = calls.post.find((c) => Object.keys((c.body as { appliedFacets: object }).appliedFacets).length > 0)!
    expect((filtered.body as { appliedFacets: unknown }).appliedFacets).toEqual({ locations: ['he1'] })
    const none = await CONNECTORS.workday(params, ctx(mkHttp({ facets: FAC([['Chicago, IL', 'ch1'], ['Israeli Cuisine Cafe', 'x']]), pages: [posting('QA', '/job/a')] })))
    expect(none).toEqual([]) // no Israel facet: nothing is fetched at all
  })

  it('paginates with limit 20 across pages although `total` is only reported on page 1 (45 postings -> 3 pages)', async () => {
    const calls = newCalls()
    const pages = Array.from({ length: 45 }, (_, i) => posting('Junior QA Engineer', `/job/p${i}`))
    const out = await CONNECTORS.workday(params, ctx(mkHttp({ facets: FAC([['Israel, Haifa', 'il1']]), pages, calls })))
    expect(out).toHaveLength(45)
    const offsets = calls.post
      .filter((c) => Object.keys((c.body as { appliedFacets: object }).appliedFacets).length > 0)
      .map((c) => (c.body as { offset: number }).offset)
    expect(offsets).toEqual([0, 20, 40])
    expect(new Set(out.map((j) => j.externalId)).size).toBe(45)
  })

  it('multi-location posting ("2 Locations") is Israeli via the facet; detail picks the Israeli location and city', async () => {
    const out = await CONNECTORS.workday(params, ctx(mkHttp({
      facets: FAC([['Israel, Haifa', 'il1']]),
      pages: [posting('Junior QA Engineer', '/job/Israel-Haifa/QA_1')],
      detail: () => ({ jobPostingInfo: { jobDescription: '<p>0-2 years</p>', location: 'USA, Austin', additionalLocations: ['Israel, Haifa', null, 7], remoteType: 'Hybrid', startDate: '2026-09-01' } })
    })))
    expect(out[0]).toMatchObject({ country: 'IL', city: 'Haifa', workMode: 'hybrid', location: 'Israel, Haifa' })
    expect(out[0].postedAt).toBe(Date.parse('2026-09-01'))
    expect(out[0].url).toBe('https://wdco.wd5.myworkdayjobs.com/en-US/Ext/job/Israel-Haifa/QA_1')
  })

  it('multi-location posting with NO Israeli text in the detail is still country IL (facet) and not remote', async () => {
    const out = await CONNECTORS.workday(params, ctx(mkHttp({
      facets: FAC([['Israel, Haifa', 'il1']]),
      pages: [posting('QA Engineer', '/job/Israel-Yokneam/QA_2')],
      detail: () => ({ jobPostingInfo: { location: '5 Locations', additionalLocations: ['USA, Austin'] } })
    })))
    expect(out[0]).toMatchObject({ country: 'IL', workMode: 'unknown' })
  })

  it('remoteType Remote yields workMode remote (excluded at ingest)', async () => {
    const out = await CONNECTORS.workday(params, ctx(mkHttp({
      facets: FAC([['Israel, Haifa', 'il1']]),
      pages: [posting('Junior QA Engineer', '/job/a')],
      detail: () => ({ jobPostingInfo: { location: 'Israel, Haifa', remoteType: 'Remote' } })
    })))
    expect(out[0].workMode).toBe('remote')
    const { db, close } = openDb(':memory:')
    try {
      await refreshJobs(db, { companies: [WORKDAY.entry], fetchCompany: () => Promise.resolve(out) })
      expect(db.select().from(jobs).all()).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('new-grad query: second filtered request carries the workerSubType id and tags only matching paths entry-level', async () => {
    const calls = newCalls()
    const facets = [
      { facetParameter: 'workerSubType', descriptor: 'Worker Sub Type', values: [{ descriptor: 'Regular', id: 'r1' }, { descriptor: 'New College Graduate', id: 'ng1' }] },
      ...FAC([['Israel, Haifa', 'il1']])
    ]
    const out = await CONNECTORS.workday(params, ctx(mkHttp({
      facets,
      pages: [posting('Software Engineer', '/job/ng'), posting('Software Engineer', '/job/reg')],
      newGrad: [posting('Software Engineer', '/job/ng')],
      calls
    })))
    const withNg = calls.post.find((c) => (c.body as { appliedFacets: Record<string, unknown> }).appliedFacets.workerSubType)!
    expect((withNg.body as { appliedFacets: unknown }).appliedFacets).toEqual({ locations: ['il1'], workerSubType: ['ng1'] })
    expect(out.map((j) => j.seniority)).toEqual([['entry-level'], undefined])
  })

  it('a failing new-grad query is tolerated (jobs still returned without tags)', async () => {
    const facets = [{ facetParameter: 'workerSubType', values: [{ descriptor: 'New Grad', id: 'ng1' }] }, ...FAC([['Israel, Haifa', 'il1']])]
    const out = await CONNECTORS.workday(params, ctx(mkHttp({ facets, pages: [posting('Software Engineer', '/job/a')], newGrad: 'throw' })))
    expect(out).toHaveLength(1)
    expect(out[0].seniority).toBeUndefined()
  })

  it('a failing detail call keeps the listing: country IL, city from the path hint, no description', async () => {
    const out = await CONNECTORS.workday(params, ctx(mkHttp({
      facets: FAC([['Israel, Haifa', 'il1']]),
      pages: [posting('Junior QA Engineer', '/job/Israel-Tel-Aviv/QA_3', '2 Locations')],
      detail: () => {
        throw new Error('HTTP 429')
      }
    })))
    expect(out[0]).toMatchObject({ country: 'IL', city: 'Tel Aviv', description: null, location: '2 Locations' })
  })

  it('senior / intern titles never trigger the detail call', async () => {
    const calls = newCalls()
    await CONNECTORS.workday(params, ctx(mkHttp({
      facets: FAC([['Israel, Haifa', 'il1']]),
      pages: [posting('Senior QA Engineer', '/job/s'), posting('QA Intern', '/job/i'), posting('Junior QA Engineer', '/job/j')],
      calls
    })))
    expect(calls.get).toHaveLength(1)
    expect(calls.get[0]).toMatch(/\/job\/j$/)
  })

  it('HTTP 4xx/5xx on the very first request rejects; on a later page it also rejects (no partial store)', async () => {
    for (const msg of ['HTTP 429', 'HTTP 500']) {
      const first: Http = { getJson: async () => ({}), postJson: async () => { throw new Error(msg) } }
      await expect(CONNECTORS.workday(params, ctx(first))).rejects.toThrow(msg)
    }
    let n = 0
    const later: Http = {
      getJson: async () => ({ jobPostingInfo: {} }),
      postJson: async (_u, body) => {
        const b = body as { appliedFacets: Record<string, unknown>; offset: number }
        if (Object.keys(b.appliedFacets).length === 0) return { facets: FAC([['Israel, Haifa', 'il1']]) }
        if (n++ === 0) return { total: 100, jobPostings: Array.from({ length: 20 }, (_, i) => posting('QA Engineer', '/job/x' + i)) }
        throw new Error('HTTP 500')
      }
    }
    await expect(CONNECTORS.workday(params, ctx(later))).rejects.toThrow('HTTP 500')
  })

  it('rejects hosts that are not <name>.wdN.myworkdayjobs.com before any request', async () => {
    const http = mkHttp({})
    for (const host of ['evil.example.com', 'wdco.wd5.myworkdayjobs.com.evil.com', 'a.b.wd5.myworkdayjobs.com', 'http://wdco.wd5.myworkdayjobs.com', 'wdco.wd5.myworkdayjobs.com/x']) {
      await expect(CONNECTORS.workday({ ...params, host }, ctx(http)), host).rejects.toThrow()
    }
    await expect(CONNECTORS.workday({ ...params, site: '../x' }, ctx(http))).rejects.toThrow()
  })
})
