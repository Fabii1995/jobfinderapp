import { describe, expect, it } from 'vitest'
import { effectiveDate, sanitizeSort, SORT_MODES, sortJobs, sortLabel } from './sort'
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

describe('sortJobs: posted', () => {
  const jobs = [
    job({ id: 1, postedAt: 100, firstSeenAt: 9000 }),
    job({ id: 2, postedAt: 300 }),
    job({ id: 3, postedAt: null, firstSeenAt: 200 }), // falls back to firstSeenAt
    job({ id: 4, postedAt: null, firstSeenAt: 500 })
  ]

  it('default keeps the input order and instance', () => {
    expect(sortJobs(jobs, 'default')).toBe(jobs)
  })
  it('posted-desc: postedAt preferred over firstSeenAt, null postedAt uses firstSeenAt', () => {
    expect(ids(sortJobs(jobs, 'posted-desc'))).toEqual([4, 2, 3, 1])
  })
  it('posted-asc: reverse date order', () => {
    expect(ids(sortJobs(jobs, 'posted-asc'))).toEqual([1, 3, 2, 4])
  })
  it('jobs with no usable date are last in both directions', () => {
    const noDate = job({ id: 9, postedAt: null, firstSeenAt: NaN })
    const list = [noDate, ...jobs]
    expect(effectiveDate(noDate)).toBeNull()
    expect(ids(sortJobs(list, 'posted-desc')).at(-1)).toBe(9)
    expect(ids(sortJobs(list, 'posted-asc')).at(-1)).toBe(9)
  })
  it('ties break by score desc then id desc, in both directions', () => {
    const t = [
      job({ id: 1, postedAt: 10, score: 50 }),
      job({ id: 2, postedAt: 10, score: 80 }),
      job({ id: 3, postedAt: 10, score: 50 })
    ]
    expect(ids(sortJobs(t, 'posted-desc'))).toEqual([2, 3, 1])
    expect(ids(sortJobs(t, 'posted-asc'))).toEqual([2, 3, 1])
  })
  it('does not mutate the input', () => {
    const copy = [...jobs]
    sortJobs(jobs, 'posted-desc')
    expect(jobs).toEqual(copy)
  })
})

describe('sortJobs: added (firstSeenAt)', () => {
  it('orders by firstSeenAt and ignores postedAt as the primary key', () => {
    const js = [
      job({ id: 1, firstSeenAt: 100, postedAt: 9999 }),
      job({ id: 2, firstSeenAt: 300, postedAt: 1 }),
      job({ id: 3, firstSeenAt: 200, postedAt: null })
    ]
    expect(ids(sortJobs(js, 'added-desc'))).toEqual([2, 3, 1])
    expect(ids(sortJobs(js, 'added-asc'))).toEqual([1, 3, 2])
  })
  it('equal firstSeenAt (big first refresh) breaks by postedAt in the same direction', () => {
    const js = [
      job({ id: 1, firstSeenAt: 500, postedAt: 10 }),
      job({ id: 2, firstSeenAt: 500, postedAt: 30 }),
      job({ id: 3, firstSeenAt: 500, postedAt: 20 })
    ]
    expect(ids(sortJobs(js, 'added-desc'))).toEqual([2, 3, 1])
    expect(ids(sortJobs(js, 'added-asc'))).toEqual([1, 3, 2])
  })
  it('missing postedAt goes last within equal firstSeenAt, in both directions', () => {
    const js = [
      job({ id: 1, firstSeenAt: 500, postedAt: null, score: 99 }),
      job({ id: 2, firstSeenAt: 500, postedAt: 30 }),
      job({ id: 3, firstSeenAt: 500, postedAt: 20 })
    ]
    expect(ids(sortJobs(js, 'added-desc'))).toEqual([2, 3, 1])
    expect(ids(sortJobs(js, 'added-asc'))).toEqual([3, 2, 1])
  })
  it('then score desc, then id desc', () => {
    const js = [
      job({ id: 1, firstSeenAt: 5, postedAt: 7, score: 50 }),
      job({ id: 2, firstSeenAt: 5, postedAt: 7, score: 80 }),
      job({ id: 3, firstSeenAt: 5, postedAt: 7, score: 50 })
    ]
    expect(ids(sortJobs(js, 'added-desc'))).toEqual([2, 3, 1])
    expect(ids(sortJobs(js, 'added-asc'))).toEqual([2, 3, 1])
  })
  it('jobs with no firstSeenAt go last in both directions', () => {
    const js = [
      job({ id: 9, firstSeenAt: NaN, postedAt: 99999 }),
      job({ id: 1, firstSeenAt: 1 }),
      job({ id: 2, firstSeenAt: 2 })
    ]
    expect(ids(sortJobs(js, 'added-desc'))).toEqual([2, 1, 9])
    expect(ids(sortJobs(js, 'added-asc'))).toEqual([1, 2, 9])
  })
  it('does not mutate the input', () => {
    const js = [job({ id: 1, firstSeenAt: 1 }), job({ id: 2, firstSeenAt: 2 })]
    const copy = [...js]
    sortJobs(js, 'added-desc')
    expect(js).toEqual(copy)
  })
})

describe('sort helpers', () => {
  it('sanitizeSort accepts every mode and falls back to default', () => {
    for (const m of SORT_MODES) expect(sanitizeSort(m)).toBe(m)
    expect(sanitizeSort('latest')).toBe('default')
    expect(sanitizeSort('nope')).toBe('default')
    expect(sanitizeSort(undefined)).toBe('default')
  })
  it('labels', () => {
    expect(sortLabel('default', 'new')).toBe('Best match')
    expect(sortLabel('default', 'visited')).toBe('Recently visited')
    expect(sortLabel('added-desc', 'new')).toBe('Recently added')
    expect(sortLabel('added-asc', 'new')).toBe('Oldest added')
    expect(sortLabel('posted-desc', 'new')).toBe('Newest posted')
    expect(sortLabel('posted-asc', 'visited')).toBe('Oldest posted')
  })
})
