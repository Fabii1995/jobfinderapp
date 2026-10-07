import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { memDb } from '../testing/db'
import { jobs } from '../db/schema'
import { upsertJobs, type ScoredJob } from '../jobs/upsert'
import { scoredJob } from '../testing/fixtures'
import { getJobById, getStats, listJobs, markVisited } from '../jobs/queries'

const db = memDb()

const job = (externalId: string, o: Partial<ScoredJob> = {}): ScoredJob =>
  scoredJob({ source: 'remoteok', externalId, title: 't', company: 'c', url: 'https://e.com/x', description: 'd', location: 'l', postedAt: 1, ...o })

const tableNames = (): string[] =>
  (
    db.all(sql`select name from sqlite_master where type='table' and name not like 'sqlite_%'`) as {
      name: string
    }[]
  )
    .map((r) => r.name)
    .sort()

const INJECTION = "'; DROP TABLE jobs;--"
const hostile: Record<string, string> = {
  injection: INJECTION,
  quotes: `"double" 'single' \`tick\` \\ back`,
  union: "' UNION SELECT key, value FROM meta --",
  nullByte: 'before\u0000after',
  emoji: 'Dev 👩‍💻 🚀 \u{1F600} 日本語 العربية Ω',
  empty: '',
  controlChars: 'a\r\n\t\u0007b'
}

describe('hostile content round-trips through upsert unchanged', () => {
  for (const [name, value] of Object.entries(hostile)) {
    it(`${name} in every text field`, () => {
      const row = job('h-' + name, {
        title: value,
        company: value,
        url: 'https://e.com/?q=' + value,
        description: value,
        location: value
      })
      const before = tableNames()
      expect(upsertJobs(db, [row])).toEqual({ inserted: 1, updated: 0 })
      const got = listJobs(db, { visited: false })[0]
      expect(got.title).toBe(value)
      expect(got.company).toBe(value)
      expect(got.url).toBe('https://e.com/?q=' + value)
      expect(got.description).toBe(value)
      expect(got.location).toBe(value)
      expect(tableNames()).toEqual(before)
      expect(getStats(db).newCount).toBe(1)
    })
  }

  it('hostile externalId does not break the unique-key upsert', () => {
    const r = job(INJECTION, { title: 'one' })
    upsertJobs(db, [r])
    expect(upsertJobs(db, [{ ...r, title: 'two' }])).toEqual({ inserted: 0, updated: 1 })
    const all = listJobs(db, { visited: false })
    expect(all).toHaveLength(1)
    expect(all[0].externalId).toBe(INJECTION)
    expect(all[0].title).toBe('two')
  })

  it('1MB description round-trips exactly', () => {
    const big = 'x'.repeat(1024 * 1024)
    upsertJobs(db, [job('big', { description: big, title: 'T'.repeat(100_000) })])
    const got = listJobs(db, { visited: false })[0]
    expect(got.description).toHaveLength(big.length)
    expect(got.description === big).toBe(true)
    expect(got.title).toHaveLength(100_000)
  })

  it('1MB of hostile unicode round-trips exactly', () => {
    const big = "👩‍💻'; DROP TABLE jobs;--\u0000".repeat(40_000)
    upsertJobs(db, [job('bigu', { description: big })])
    expect(listJobs(db, { visited: false })[0].description === big).toBe(true)
  })

  it('visited job keeps visitedAt across a hostile refresh', () => {
    upsertJobs(db, [job('v')])
    const id = listJobs(db, { visited: false })[0].id
    const v = markVisited(db, id)!.visitedAt
    upsertJobs(db, [job('v', { title: INJECTION, description: 'a\u0000b' })])
    const after = getJobById(db, id)!
    expect(after.visitedAt).toBe(v)
    expect(after.title).toBe(INJECTION)
  })

  it('NaN / Infinity scores neither throw nor lose the row', () => {
    upsertJobs(db, [job('nan', { score: NaN }), job('inf', { score: Infinity })])
    expect(listJobs(db, { visited: false })).toHaveLength(2)
    expect(tableNames()).toContain('jobs')
  })
})

describe('listJobs / markVisited with hostile inputs', () => {
  beforeEach(() => {
    upsertJobs(db, [job('a'), job('b')])
  })

  it('listJobs uses the filter by truthiness only; never touches SQL text', () => {
    for (const bad of [INJECTION, 'true', 1, {}, [], null, undefined, NaN]) {
      const res = listJobs(db, { visited: bad as unknown as boolean })
      expect(Array.isArray(res)).toBe(true)
    }
    expect(tableNames()).toContain('jobs')
  })

  it('listJobs ignores unexpected extra options', () => {
    const res = listJobs(db, { visited: false, where: INJECTION, limit: -1 } as never)
    expect(res).toHaveLength(2)
  })

  it('markVisited with unknown / negative / huge / fractional ids returns null and changes nothing', () => {
    for (const id of [0, -1, 999999, Number.MAX_SAFE_INTEGER, 1.5]) {
      expect(markVisited(db, id)).toBeNull()
    }
    expect(getStats(db).visitedCount).toBe(0)
  })

  it('markVisited with string injection ids never drops tables, mass-updates or visits any row', () => {
    for (const payload of [INJECTION, '1 OR 1=1']) {
      let r: unknown
      try {
        r = markVisited(db, payload as unknown as number)
      } catch (e) {
        r = e // throwing is acceptable
      }
      expect(r === null || r instanceof Error, payload).toBe(true)
      expect(tableNames()).toContain('jobs')
      expect(getStats(db).visitedCount, payload).toBe(0)
    }
  })

  it('empty-string externalId/url insert works', () => {
    db.insert(jobs).values({ source: 's', externalId: '', url: '', firstSeenAt: 1 }).run()
    expect(listJobs(db, { visited: false }).some((j) => j.externalId === '')).toBe(true)
  })
})
