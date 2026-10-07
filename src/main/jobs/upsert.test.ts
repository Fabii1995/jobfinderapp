import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { openDb, type Db } from '../db'
import { jobs } from '../db/schema'
import { buildUpsertStatement, upsertJobs, UPDATABLE_LISTING_FIELDS, type ScoredJob } from './upsert'
import { getJobById, markVisited } from './queries'

const base: ScoredJob = {
  source: 'arbeitnow',
  externalId: 'abc-1',
  title: 'Junior QA Engineer',
  company: 'Acme',
  url: 'https://example.com/1',
  description: 'old description',
  location: 'Berlin',
  country: 'IL',
  city: null,
  workMode: 'unknown',
  postedAt: 1_000,
  score: 70,
  roles: ['qa']
}

let db: Db
let close: () => void
beforeEach(() => {
  ;({ db, close } = openDb(':memory:'))
})
afterEach(() => close())

describe('upsert preserves visitedAt', () => {
  it('refreshing an already-visited job does not clear visitedAt or firstSeenAt', () => {
    upsertJobs(db, [base])
    const id = db.select().from(jobs).get()!.id
    const visited = markVisited(db, id)!
    expect(visited.visitedAt).toBeTypeOf('number')
    const before = getJobById(db, id)!

    const res = upsertJobs(db, [
      {
        ...base,
        title: 'Junior QA Automation Engineer',
        score: 95,
        roles: ['qa', 'python'],
        description: 'new',
        url: 'https://example.com/1b'
      }
    ])
    expect(res).toEqual({ inserted: 0, updated: 1 })

    const after = getJobById(db, id)!
    expect(after.visitedAt).not.toBeNull()
    expect(after.visitedAt).toBe(before.visitedAt)
    expect(after.firstSeenAt).toBe(before.firstSeenAt)
    // listing fields really were refreshed
    expect(after.title).toBe('Junior QA Automation Engineer')
    expect(after.score).toBe(95)
    expect(after.roles).toEqual(['qa', 'python'])
    expect(after.description).toBe('new')
    expect(after.url).toBe('https://example.com/1b')
    expect(db.select().from(jobs).all()).toHaveLength(1)
  })

  it('survives repeated refreshes, including in-batch duplicates', () => {
    upsertJobs(db, [base])
    const id = db.select().from(jobs).get()!.id
    const v = markVisited(db, id)!.visitedAt
    for (let i = 0; i < 3; i++) upsertJobs(db, [{ ...base, score: 10 + i }, { ...base, score: 50 + i }])
    expect(getJobById(db, id)!.visitedAt).toBe(v)
  })

  it('a not-visited job stays not visited after refresh', () => {
    upsertJobs(db, [base])
    upsertJobs(db, [{ ...base, score: 1 }])
    expect(db.select().from(jobs).get()!.visitedAt).toBeNull()
  })

  it('generated SQL never writes visited_at/first_seen_at in DO UPDATE SET', () => {
    const { sql } = buildUpsertStatement(db, base, 123).toSQL()
    const idx = sql.toLowerCase().indexOf('do update set')
    expect(idx).toBeGreaterThan(-1)
    const setClause = sql.slice(idx)
    expect(setClause).not.toMatch(/visited_at/i)
    expect(setClause).not.toMatch(/first_seen_at/i)
    expect(setClause).toMatch(/"title" = /)
    expect(setClause).toMatch(/"score" = /)
  })

  it('UPDATABLE_LISTING_FIELDS excludes visitedAt and firstSeenAt (and identity keys)', () => {
    const fields: readonly string[] = UPDATABLE_LISTING_FIELDS
    expect(fields).not.toContain('visitedAt')
    expect(fields).not.toContain('firstSeenAt')
    expect(fields).not.toContain('source')
    expect(fields).not.toContain('externalId')
    expect([...fields].sort()).toEqual(
      ['title', 'company', 'url', 'description', 'location', 'country', 'city', 'workMode', 'postedAt', 'score', 'roles'].sort()
    )
  })

  it('markVisited is write-once: a second call keeps the original visitedAt', async () => {
    upsertJobs(db, [base])
    const id = db.select().from(jobs).get()!.id
    const first = markVisited(db, id)!.visitedAt!
    await new Promise((r) => setTimeout(r, 15))
    const second = markVisited(db, id)!.visitedAt!
    expect(second).toBe(first)
    expect(db.select().from(jobs).where(eq(jobs.id, id)).get()!.visitedAt).toBe(first)
  })

  it('markVisited returns null for an unknown id', () => {
    expect(markVisited(db, 9999)).toBeNull()
  })
})
