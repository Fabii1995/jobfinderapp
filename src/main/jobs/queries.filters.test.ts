import { beforeEach, describe, expect, it } from 'vitest'
import { memDb } from '../testing/db'
import { jobs } from '../db/schema'
import { upsertJobs, type ScoredJob } from './upsert'
import { scoredJob } from '../testing/fixtures'
import { getCompanyCounts, getStats, listJobs, markVisited } from './queries'

const db = memDb()
const mk = (source: string, id: string, company: string | null, workMode: ScoredJob['workMode'], score = 50): ScoredJob =>
  scoredJob({ source, externalId: id, title: id, company: company as string, url: 'https://e.com/' + id, workMode, score })
const snapshot = (): Array<[number, number, number | null]> =>
  db.select().from(jobs).orderBy(jobs.id).all().map((j) => [j.id, j.firstSeenAt, j.visitedAt])

beforeEach(() => {
  upsertJobs(db, [
    mk('greenhouse:a', '1', 'Acme', 'onsite', 80),
    mk('greenhouse:a', '2', 'Acme', 'hybrid', 70),
    mk('lever:b', '3', 'Beta', 'onsite', 60),
    mk('lever:b', '4', 'Beta', 'unknown', 90),
    mk('amazon', '5', 'Amazon', 'hybrid', 40),
    mk('amazon', '6', null, 'onsite', 35)
  ])
})

describe('listJobs (real DB)', () => {
  it('orders New by score desc and lists every row', () => {
    expect(listJobs(db, { visited: false }).map((j) => j.score)).toEqual([90, 80, 70, 60, 40, 35])
  })
  it('list calls never change visitedAt / firstSeenAt', () => {
    markVisited(db, listJobs(db, { visited: false })[0].id)
    const before = snapshot()
    listJobs(db, { visited: false })
    listJobs(db, { visited: true })
    expect(snapshot()).toEqual(before)
  })
  it('a visited job whose work mode changes on refresh stays visited', () => {
    const id = listJobs(db, { visited: false }).find((j) => j.title === '1')!.id
    markVisited(db, id)
    upsertJobs(db, [mk('greenhouse:a', '1', 'Acme', 'hybrid', 80)])
    expect(listJobs(db, { visited: true }).map((j) => j.id)).toEqual([id])
    expect(listJobs(db, { visited: false }).map((j) => j.id)).not.toContain(id)
  })
})

describe('getCompanyCounts / getStats', () => {
  it('counts per company over new + visited, null company as ""', () => {
    markVisited(db, listJobs(db, { visited: false })[0].id)
    expect(getCompanyCounts(db)).toEqual({ Acme: 2, Beta: 2, Amazon: 1, '': 1 })
    expect(getStats(db)).toMatchObject({ newCount: 5, visitedCount: 1 })
  })
  it('empty DB', () => {
    db.delete(jobs).run()
    expect(getCompanyCounts(db)).toEqual({})
    expect(getStats(db)).toMatchObject({ newCount: 0, visitedCount: 0, lastRefreshAt: null })
  })
})
