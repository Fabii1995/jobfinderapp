import { describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { memDb } from '../testing/db'
import { jobs } from '../db/schema'
import { getLastRefresh, getStats, listJobs, markVisited, saveLastRefresh } from './queries'

const db = memDb()

function add(externalId: string, o: Partial<typeof jobs.$inferInsert> = {}): number {
  return db
    .insert(jobs)
    .values({
      source: 'remoteok',
      externalId,
      url: 'https://e.com/' + externalId,
      title: externalId,
      firstSeenAt: 1,
      ...o
    })
    .returning({ id: jobs.id })
    .get().id
}


describe('listJobs', () => {
  it('New: only unvisited, ordered by score desc then postedAt desc (nulls last)', () => {
    add('low', { score: 10, postedAt: 5 })
    add('hi-old', { score: 90, postedAt: 1 })
    add('hi-new', { score: 90, postedAt: 9 })
    add('hi-null', { score: 90, postedAt: null })
    markVisited(db, add('visited', { score: 99 }))
    expect(listJobs(db, { visited: false }).map((j) => j.title)).toEqual([
      'hi-new',
      'hi-old',
      'hi-null',
      'low'
    ])
  })

  it('Visited: only visited, most recently visited first', () => {
    const a = add('a')
    const b = add('b')
    add('c')
    db.update(jobs).set({ visitedAt: 100 }).where(eq(jobs.id, a)).run()
    db.update(jobs).set({ visitedAt: 200 }).where(eq(jobs.id, b)).run()
    expect(listJobs(db, { visited: true }).map((j) => j.title)).toEqual(['b', 'a'])
  })
})

describe('getStats', () => {
  it('empty db', () => {
    expect(getStats(db)).toMatchObject({
      newCount: 0,
      visitedCount: 0,
      lastRefreshAt: null,
      lastRefresh: null
    })
  })

  it('counts new/visited and reads lastRefresh from meta', () => {
    add('1')
    add('2', { source: 'arbeitnow' })
    markVisited(db, add('3', { source: 'arbeitnow' }))
    saveLastRefresh(db, {
      at: 12345,
      inserted: 2,
      updated: 1,
      sources: [{ source: 'arbeitnow', ok: true, count: 2 }]
    })
    const s = getStats(db)
    expect(s.newCount).toBe(2)
    expect(s.visitedCount).toBe(1)
    expect(s.lastRefreshAt).toBe(12345)
    expect(s.lastRefresh).toMatchObject({ at: 12345, inserted: 2, updated: 1 })
  })

  it('saveLastRefresh overwrites; a corrupt meta value yields null', () => {
    saveLastRefresh(db, { at: 1, inserted: 0, updated: 0, sources: [] })
    saveLastRefresh(db, { at: 2, inserted: 0, updated: 0, sources: [] })
    expect(getLastRefresh(db)!.at).toBe(2)
    db.run(sql`UPDATE meta SET value = 'not json'`)
    expect(getLastRefresh(db)).toBeNull()
  })
})
