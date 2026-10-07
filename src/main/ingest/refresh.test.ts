import { describe, expect, it, vi } from 'vitest'
import type { CompanyEntry } from '../companies/types'
import type { RawJob } from '../sources/types'
import { memDb } from '../testing/db'
import { rawJob } from '../testing/fixtures'
import { seedCompanies } from '../companies/seeds'
import { refreshJobs } from './refresh'
import { listJobs, markVisited } from '../jobs/queries'

const entry = (id: string): CompanyEntry => ({ id, name: id, ats: 'amazon', params: {}, enabled: true })
const raw = (source: string, externalId: string, o: Partial<RawJob> = {}): RawJob =>
  rawJob({
    source,
    externalId,
    title: 'Junior QA Engineer',
    company: source,
    url: 'https://e.com/' + externalId,
    description: 'qa testing',
    location: 'Tel Aviv, Israel',
    city: 'Tel Aviv',
    workMode: 'onsite',
    ...o
  })

describe('refreshJobs', () => {
  const db = memDb()

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

  it('stores country/city/workMode and reads them back', async () => {
    await refreshJobs(db, {
      companies: [entry('a')],
      fetchCompany: async () => [raw('a', '1'), raw('a', '2', { workMode: 'hybrid', company: 'Other' })]
    })
    const rows = listJobs(db, { visited: false })
    expect(rows.find((j) => j.externalId === '2')).toMatchObject({ workMode: 'hybrid', company: 'Other' })
    expect(rows.find((j) => j.externalId === '1')).toMatchObject({ company: 'a' })
    expect(rows[0]).toMatchObject({ country: 'IL', city: 'Tel Aviv' })
  })

  it('SQLink is seeded disabled: refresh over the seed list never calls its connector', async () => {
    const fetchCompany = vi.fn(async () => [] as RawJob[])
    const res = await refreshJobs(db, { companies: seedCompanies(), fetchCompany })
    const called = fetchCompany.mock.calls.map((c) => (c as unknown as [CompanyEntry])[0].id)
    expect(called).not.toContain('sqlink')
    expect(called.length).toBe(36)
    expect(res.sources.some((s) => s.source === 'sqlink')).toBe(false)
  })
})
