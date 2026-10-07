import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../db'
import { jobs } from '../db/schema'
import { upsertJobs, type ScoredJob } from './upsert'
import { getCompanyCounts, getStats, listJobs, markVisited } from './queries'

let db: Db
let close: () => void
const mk = (source: string, id: string, company: string | null, workMode: ScoredJob['workMode'], score = 50): ScoredJob => ({
  source,
  externalId: id,
  title: id,
  company: company as string,
  url: 'https://e.com/' + id,
  description: null,
  location: null,
  country: 'IL',
  city: null,
  workMode,
  postedAt: null,
  score,
  roles: []
})
const snapshot = (): Array<[number, number, number | null]> =>
  db.select().from(jobs).orderBy(jobs.id).all().map((j) => [j.id, j.firstSeenAt, j.visitedAt])

beforeEach(() => {
  ;({ db, close } = openDb(':memory:'))
  upsertJobs(db, [
    mk('greenhouse:a', '1', 'Acme', 'onsite', 80),
    mk('greenhouse:a', '2', 'Acme', 'hybrid', 70),
    mk('lever:b', '3', 'Beta', 'onsite', 60),
    mk('lever:b', '4', 'Beta', 'unknown', 90),
    mk('amazon', '5', 'Amazon', 'hybrid', 40),
    mk('amazon', '6', null, 'onsite', 35)
  ])
})
afterEach(() => close())

describe('listJobs filters (real DB)', () => {
  it('workMode filter', () => {
    expect(listJobs(db, { visited: false, workMode: 'onsite' }).map((j) => j.title)).toEqual(['1', '3', '6'])
    expect(listJobs(db, { visited: false, workMode: 'hybrid' }).map((j) => j.title)).toEqual(['2', '5'])
    expect(listJobs(db, { visited: false, workMode: 'unknown' }).map((j) => j.title)).toEqual(['4'])
    expect(listJobs(db, { visited: false, workMode: 'remote' })).toEqual([])
  })
  it('company filter is exact; null-company rows only appear unfiltered', () => {
    expect(listJobs(db, { visited: false, company: 'Beta' }).map((j) => j.title)).toEqual(['4', '3'])
    expect(listJobs(db, { visited: false, company: 'Bet' })).toEqual([])
    expect(listJobs(db, { visited: false, company: 'beta' })).toEqual([])
    expect(listJobs(db, { visited: false })).toHaveLength(6)
  })
  it('combined filters AND together; empty-string filters are treated as absent', () => {
    expect(listJobs(db, { visited: false, company: 'Acme', workMode: 'hybrid' }).map((j) => j.title)).toEqual(['2'])
    expect(listJobs(db, { visited: false, company: '', workMode: '' })).toHaveLength(6)
  })
  it('ordering is preserved under filters (score desc)', () => {
    expect(listJobs(db, { visited: false, workMode: 'onsite' }).map((j) => j.score)).toEqual([80, 60, 35])
  })
  it('filters apply per tab and never change visitedAt / firstSeenAt', () => {
    const id = listJobs(db, { visited: false, company: 'Acme', workMode: 'onsite' })[0].id
    const visited = markVisited(db, id)!
    const before = snapshot()
    for (const o of [
      { visited: false, workMode: 'onsite' },
      { visited: true, workMode: 'onsite' },
      { visited: true, company: 'Acme' },
      { visited: false, company: 'Acme' },
      { visited: true, company: 'Nope', workMode: 'remote' }
    ]) listJobs(db, o)
    expect(snapshot()).toEqual(before)
    expect(listJobs(db, { visited: true, workMode: 'onsite' }).map((j) => j.visitedAt)).toEqual([visited.visitedAt])
    expect(listJobs(db, { visited: true, workMode: 'hybrid' })).toEqual([])
    expect(listJobs(db, { visited: false, company: 'Acme' }).map((j) => j.title)).toEqual(['2'])
  })
  it('a visited job whose work mode changes on refresh moves between filters but stays visited', () => {
    const id = listJobs(db, { visited: false, company: 'Acme', workMode: 'onsite' })[0].id
    markVisited(db, id)
    upsertJobs(db, [mk('greenhouse:a', '1', 'Acme', 'hybrid', 80)])
    expect(listJobs(db, { visited: true, workMode: 'hybrid' }).map((j) => j.id)).toEqual([id])
    expect(listJobs(db, { visited: true, workMode: 'onsite' })).toEqual([])
  })
})

describe('getCompanyCounts / getStats.bySource', () => {
  it('counts per company over new + visited, null company as ""', () => {
    markVisited(db, listJobs(db, { visited: false, company: 'Acme' })[0].id)
    expect(getCompanyCounts(db)).toEqual({ Acme: 2, Beta: 2, Amazon: 1, '': 1 })
  })
  it('bySource counts per connector id, new + visited together', () => {
    markVisited(db, listJobs(db, { visited: false, company: 'Amazon' })[0].id)
    expect(getStats(db)).toMatchObject({ newCount: 5, visitedCount: 1, bySource: { 'greenhouse:a': 2, 'lever:b': 2, amazon: 2 } })
  })
  it('empty DB', () => {
    db.delete(jobs).run()
    expect(getCompanyCounts(db)).toEqual({})
    expect(getStats(db)).toMatchObject({ newCount: 0, visitedCount: 0, bySource: {}, lastRefreshAt: null })
  })
})
