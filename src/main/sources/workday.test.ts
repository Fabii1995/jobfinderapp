import { describe, expect, it } from 'vitest'
import { fetchWorkday, findIsraelFacet, findNewGradFacet } from './workday'
import type { Http } from './types'

const FACETS = [
  { facetParameter: 'workerSubType', descriptor: 'Time Type', values: [{ descriptor: 'New College Graduate', id: 'ng1' }] },
  {
    facetParameter: 'locationMainGroup',
    descriptor: 'Location',
    values: [
      {
        facetParameter: 'locations',
        descriptor: 'Locations',
        values: [
          { descriptor: 'USA, Austin', id: 'us1' },
          { descriptor: 'Israel, Haifa', id: 'il1' },
          { descriptor: 'Israel, Petah Tikva', id: 'il2' }
        ]
      }
    ]
  }
]

describe('workday facets', () => {
  it('finds Israel ids in a nested location facet and the new-grad subtype', () => {
    expect(findIsraelFacet(FACETS)).toEqual({ param: 'locations', ids: ['il1', 'il2'] })
    expect(findNewGradFacet(FACETS)).toEqual({ param: 'workerSubType', ids: ['ng1'] })
    expect(findIsraelFacet([{ facetParameter: 'x', values: [{ descriptor: 'Chicago, IL', id: '1' }] }])).toBeNull()
  })
})

describe('fetchWorkday', () => {
  const posting = (title: string, path: string) => ({ title, externalPath: path, locationsText: '3 Locations' })
  it('pages with limit 20, tags new grads, details only non-rejected titles, uses externalPath as id', async () => {
    const calls: string[] = []
    const http: Http = {
      postJson: async (url, body) => {
        const b = body as { appliedFacets: Record<string, string[]>; offset: number; limit: number }
        calls.push(`${url}|${JSON.stringify(b.appliedFacets)}|${b.offset}|${b.limit}`)
        if (Object.keys(b.appliedFacets).length === 0) return { total: 3, jobPostings: [], facets: FACETS }
        if (b.appliedFacets.workerSubType) return { total: 1, jobPostings: [posting('Software Engineer', '/job/a_1')] }
        return {
          total: 2,
          jobPostings: [posting('Software Engineer', '/job/a_1'), posting('Senior Software Engineer', '/job/b_1')]
        }
      },
      getJson: async (url) => {
        calls.push('GET ' + url)
        return {
          jobPostingInfo: {
            jobDescription: '<p>0-2 years</p>',
            location: 'Israel, Haifa',
            additionalLocations: ['USA, Austin'],
            remoteType: 'Hybrid',
            externalUrl: 'https://x.wd5.myworkdayjobs.com/en-US/S/job/a_1',
            startDate: '2026-09-10'
          }
        }
      }
    }
    const jobs = await fetchWorkday(
      { host: 'x.wd5.myworkdayjobs.com', tenant: 'x', site: 'S' },
      { id: 'workday:x', name: 'X', http, delayMs: 0 }
    )
    expect(jobs.map((j) => j.externalId)).toEqual(['/job/a_1', '/job/b_1'])
    expect(jobs[0]).toMatchObject({ country: 'IL', city: 'Haifa', workMode: 'hybrid', seniority: ['entry-level'] })
    expect(jobs[0].description).toContain('0-2 years')
    expect(jobs[1].description).toBeNull() // senior title: no detail call
    expect(calls.filter((c) => c.startsWith('GET')).length).toBe(1)
    expect(calls.some((c) => c.endsWith('|0|20'))).toBe(true)
  })

  it('rejects non-myworkdayjobs hosts and returns [] when the tenant has no Israel location', async () => {
    const http: Http = { getJson: async () => ({}), postJson: async () => ({ total: 0, jobPostings: [], facets: [] }) }
    await expect(
      fetchWorkday({ host: 'evil.example.com', tenant: 'x', site: 'S' }, { id: 'w', name: 'W', http })
    ).rejects.toThrow(/host/)
    expect(
      await fetchWorkday({ host: 'x.wd5.myworkdayjobs.com', tenant: 'x', site: 'S' }, { id: 'w', name: 'W', http })
    ).toEqual([])
  })
})
