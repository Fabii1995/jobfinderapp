import { describe, expect, it } from 'vitest'
import { effectiveDate, sanitizeSort, sortJobs, sortLabel } from './sort'
import type { Job } from '../../../shared/ipc'

const job = (o: Partial<Job> & { id: number }): Job => ({
  source: 'greenhouse:x',
  externalId: String(o.id),
  title: 'T' + o.id,
  company: 'Acme',
  url: 'https://e.com/' + o.id,
  description: null,
  location: null,
  country: 'IL',
  city: null,
  workMode: 'onsite',
  postedAt: null,
  score: 50,
  roles: [],
  firstSeenAt: 1000,
  visitedAt: null,
  ...o
})
const ids = (js: Job[]): number[] => js.map((j) => j.id)

describe('sortJobs', () => {
  const jobs = [
    job({ id: 1, postedAt: 100, firstSeenAt: 9000 }),
    job({ id: 2, postedAt: 300 }),
    job({ id: 3, postedAt: null, firstSeenAt: 200 }), // falls back to firstSeenAt
    job({ id: 4, postedAt: null, firstSeenAt: 500 })
  ]

  it('default keeps the input order and instance', () => {
    expect(sortJobs(jobs, 'default')).toBe(jobs)
  })
  it('latest: newest first, postedAt preferred over firstSeenAt, null postedAt uses firstSeenAt', () => {
    expect(ids(sortJobs(jobs, 'latest'))).toEqual([4, 2, 3, 1])
  })
  it('oldest: reverse date order', () => {
    expect(ids(sortJobs(jobs, 'oldest'))).toEqual([1, 3, 2, 4])
  })
  it('jobs with no usable date are last in both directions', () => {
    const noDate = job({ id: 9, postedAt: null, firstSeenAt: NaN })
    const list = [noDate, ...jobs]
    expect(effectiveDate(noDate)).toBeNull()
    expect(ids(sortJobs(list, 'latest')).at(-1)).toBe(9)
    expect(ids(sortJobs(list, 'oldest')).at(-1)).toBe(9)
  })
  it('ties break by score desc then id desc, in both directions', () => {
    const t = [
      job({ id: 1, postedAt: 10, score: 50 }),
      job({ id: 2, postedAt: 10, score: 80 }),
      job({ id: 3, postedAt: 10, score: 50 })
    ]
    expect(ids(sortJobs(t, 'latest'))).toEqual([2, 3, 1])
    expect(ids(sortJobs(t, 'oldest'))).toEqual([2, 3, 1])
  })
  it('does not mutate the input', () => {
    const copy = [...jobs]
    sortJobs(jobs, 'latest')
    expect(jobs).toEqual(copy)
  })
})

describe('sort helpers', () => {
  it('sanitizeSort falls back to default', () => {
    expect(sanitizeSort('latest')).toBe('latest')
    expect(sanitizeSort('nope')).toBe('default')
    expect(sanitizeSort(undefined)).toBe('default')
  })
  it('labels depend on tab for default', () => {
    expect(sortLabel('default', 'new')).toBe('Best match')
    expect(sortLabel('default', 'visited')).toBe('Recently visited')
    expect(sortLabel('latest', 'new')).toBe('Latest first')
  })
})
