import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchJson, postJson } from '../sources/http'
import type { CompanyEntry } from '../companies/types'
import type { RawJob } from '../sources/types'
import { openDb, type Db } from '../db'
import { refreshJobs } from '../ingest/refresh'
import { listJobs, markVisited } from '../jobs/queries'

type Handler = (url: string) => Response | Promise<Response>
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>
function stubFetch(h: Handler): void {
  fetchMock = vi.fn((url: string | URL) => Promise.resolve(h(String(url))))
  vi.stubGlobal('fetch', fetchMock)
}
afterEach(() => vi.unstubAllGlobals())

describe('fetchJson', () => {
  it('throws a clear error on HTTP 500 and 404', async () => {
    for (const s of [500, 404]) {
      stubFetch(() => new Response('nope', { status: s, statusText: 'X' }))
      await expect(fetchJson('https://a.test/x')).rejects.toThrow(new RegExp(`HTTP ${s}`))
    }
  })
  it('rejects on malformed JSON', async () => {
    stubFetch(() => new Response('{not json', { status: 200 }))
    await expect(fetchJson('https://a.test/x')).rejects.toThrow()
  })
  it('propagates network errors and timeouts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(fetchJson('https://a.test/x')).rejects.toThrow('fetch failed')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    )
    await expect(fetchJson('https://a.test/x')).rejects.toThrow('timed out')
  })
  it('passes an abort signal (timeout) and a User-Agent', async () => {
    stubFetch(() => json({}))
    await fetchJson('https://a.test/x')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/JobFinderApp/)
  })
})

describe('postJson', () => {
  it('POSTs a JSON body and throws on non-2xx', async () => {
    stubFetch(() => json({ ok: 1 }))
    expect(await postJson('https://a.test/x', { a: 1 })).toEqual({ ok: 1 })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"a":1}')
    stubFetch(() => new Response('no', { status: 500, statusText: 'Boom' }))
    await expect(postJson('https://a.test/x', {})).rejects.toThrow(/HTTP 500/)
  })
})

const entry = (id: string): CompanyEntry => ({ id, name: id, ats: 'amazon', params: {}, enabled: true })
const raw = (source: string, externalId: string, o: Partial<RawJob> = {}): RawJob => ({
  source,
  externalId,
  title: 'Junior QA Engineer',
  company: source,
  url: 'https://e.com/' + externalId,
  description: 'qa testing',
  location: 'Tel Aviv, Israel',
  country: 'IL',
  city: 'Tel Aviv',
  workMode: 'onsite',
  postedAt: null,
  ...o
})

describe('refreshJobs', () => {
  let db: Db
  let close: () => void
  beforeEach(() => {
    ;({ db, close } = openDb(':memory:'))
  })
  afterEach(() => close())

  const companies = [entry('a'), entry('b'), entry('c')]

  it('survives one company failing and reports it per company', async () => {
    const res = await refreshJobs(db, {
      companies,
      fetchCompany: async (e) => {
        if (e.id === 'b') throw new Error('HTTP 500 Boom')
        return [raw(e.id, '1')]
      }
    })
    expect(Object.keys(res.errors)).toEqual(['b'])
    expect(res.sources.map((s) => [s.source, s.ok])).toEqual([
      ['a', true],
      ['b', false],
      ['c', true]
    ])
    expect(res.sources[0]).toMatchObject({ count: 1, israel: 1, kept: 1 })
    expect(res.inserted).toBe(2)
    expect(listJobs(db, { visited: false })).toHaveLength(2)
  })

  it('all companies failing resolves with one error each and writes nothing', async () => {
    const res = await refreshJobs(db, {
      companies,
      fetchCompany: async () => {
        throw new Error('x')
      }
    })
    expect(Object.keys(res.errors).sort()).toEqual(['a', 'b', 'c'])
    expect(res.inserted).toBe(0)
  })

  it('hard location filter: only Israel and not remote-only are stored; unknown mode is kept', async () => {
    await refreshJobs(db, {
      companies: [entry('a')],
      fetchCompany: async () => [
        raw('a', 'il'),
        raw('a', 'remote', { workMode: 'remote' }),
        raw('a', 'us', { country: 'US', location: 'Chicago, IL' }),
        raw('a', 'nocountry', { country: null }),
        raw('a', 'unk', { workMode: 'unknown' }),
        raw('a', 'hyb', { workMode: 'hybrid' })
      ]
    })
    expect(
      listJobs(db, { visited: false })
        .map((j) => j.externalId)
        .sort()
    ).toEqual(['hyb', 'il', 'unk'])
  })

  it('disabled companies are not fetched', async () => {
    const fetchCompany = vi.fn(async () => [] as RawJob[])
    const res = await refreshJobs(db, { companies: [{ ...entry('a'), enabled: false }], fetchCompany })
    expect(fetchCompany).not.toHaveBeenCalled()
    expect(res.sources).toEqual([])
  })

  it('in-flight guard: concurrent calls share one run, and it resets afterwards', async () => {
    const fetchCompany = vi.fn(async (e: CompanyEntry) => [raw(e.id, '1')])
    const a = refreshJobs(db, { companies: [entry('a')], fetchCompany })
    const b = refreshJobs(db, { companies: [entry('a')], fetchCompany })
    expect(b).toBe(a)
    await a
    expect(fetchCompany).toHaveBeenCalledTimes(1)
    const c = refreshJobs(db, { companies: [entry('a')], fetchCompany })
    expect(c).not.toBe(a)
    await c
  })

  it('second refresh updates (not duplicates) and leaves visited rows visited', async () => {
    const opts = { companies: [entry('a')], fetchCompany: async () => [raw('a', '1')] }
    await refreshJobs(db, opts)
    const id = listJobs(db, { visited: false })[0].id
    const v = markVisited(db, id)!.visitedAt
    const res = await refreshJobs(db, opts)
    expect(res).toMatchObject({ inserted: 0, updated: 1 })
    expect(listJobs(db, { visited: true })[0].visitedAt).toBe(v)
    expect(listJobs(db, { visited: false })).toHaveLength(0)
  })

  it('stores country/city/workMode and can filter by them', async () => {
    await refreshJobs(db, {
      companies: [entry('a')],
      fetchCompany: async () => [raw('a', '1'), raw('a', '2', { workMode: 'hybrid', company: 'Other' })]
    })
    expect(listJobs(db, { visited: false, workMode: 'hybrid' }).map((j) => j.externalId)).toEqual(['2'])
    expect(listJobs(db, { visited: false, company: 'a' }).map((j) => j.externalId)).toEqual(['1'])
    expect(listJobs(db, { visited: false })[0]).toMatchObject({ country: 'IL', city: 'Tel Aviv' })
  })
})
