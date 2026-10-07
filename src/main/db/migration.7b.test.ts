import { join } from 'path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { openDb } from './index'
import { makeOldDb, tempDirs, type OldJobSeed } from '../testing/db'
import { scoredJob } from '../testing/fixtures'
import { jobs } from './schema'
import { upsertJobs } from '../jobs/upsert'
import { getStats, listJobs } from '../jobs/queries'

const tempDir = tempDirs()
const makeOld = (rows: OldJobSeed[], extraCols = ''): string =>
  makeOldDb(tempDir('jf-mig-'), rows, { withRoles: true, extraCols })
type Seed = OldJobSeed

const cols = (file: string): string[] => {
  const raw = new Database(file, { readonly: true })
  try {
    return (raw.pragma('table_info(jobs)') as Array<{ name: string }>).map((c) => c.name)
  } finally {
    raw.close()
  }
}

describe('migration: purge scope (unvisited non-Israel removed, visited kept)', () => {
  const rows: Seed[] = [
    { source: 'arbeitnow', id: 'u', first: 10, visited: null },
    { source: 'arbeitnow', id: 'v', first: 11, visited: 111 },
    { source: 'remoteok', id: 'u', first: 12, visited: null },
    { source: 'remoteok', id: 'v', first: 13, visited: 113 },
    { source: 'himalayas', id: 'u', first: 14, visited: null },
    { source: 'himalayas', id: 'v', first: 15, visited: 115 },
    { source: 'greenhouse:wizinc', id: 'u', first: 16, visited: null },
    { source: 'greenhouse:wizinc', id: 'v', first: 17, visited: 117 },
    { source: 'amazon', id: 'u', first: 18, visited: null },
    { source: 'amazon', id: 'v', first: 19, visited: 119 },
    // look-alike names must NOT be purged (exact source match only)
    { source: 'remoteok2', id: 'u', first: 20, visited: null },
    { source: 'RemoteOK', id: 'u', first: 21, visited: null },
    { source: 'arbeitnow:x', id: 'u', first: 22, visited: null }
  ]

  it('deletes only UNVISITED rows of arbeitnow/remoteok/himalayas; keeps every visited row and all other sources', () => {
    const file = makeOld(rows)
    const { db, close, migration } = openDb(file)
    try {
      expect(migration).toMatchObject({ removedUnvisited: 3, keptVisited: 3 })
      const left = db.select().from(jobs).all().map((r) => `${r.source}/${r.externalId}`).sort()
      expect(left).toEqual(
        [
          'arbeitnow/v',
          'remoteok/v',
          'himalayas/v',
          'greenhouse:wizinc/u',
          'greenhouse:wizinc/v',
          'amazon/u',
          'amazon/v',
          'remoteok2/u',
          'RemoteOK/u',
          'arbeitnow:x/u'
        ].sort()
      )
    } finally {
      close()
    }
  })

  it('visitedAt and firstSeenAt of every surviving row are byte-for-byte unchanged', () => {
    const file = makeOld(rows)
    const { db, close } = openDb(file)
    try {
      const survivors = db.select().from(jobs).all()
      for (const r of survivors) {
        const seed = rows.find((s) => s.source === r.source && s.id === r.externalId)!
        expect([r.source, r.externalId, r.firstSeenAt, r.visitedAt]).toEqual([seed.source, seed.id, seed.first, seed.visited])
      }
      expect(getStats(db).visitedCount).toBe(rows.filter((r) => r.visited !== null).length)
    } finally {
      close()
    }
  })

  it('visited rows from removed sources stay visible in the Visited tab; none leak into New', () => {
    const file = makeOld(rows)
    const { db, close } = openDb(file)
    try {
      const visited = listJobs(db, { visited: true }).map((j) => j.source).sort()
      expect(visited).toEqual(['amazon', 'arbeitnow', 'greenhouse:wizinc', 'himalayas', 'remoteok'])
      const fresh = listJobs(db, { visited: false }).map((j) => j.source)
      expect(fresh).not.toContain('arbeitnow')
      expect(fresh).not.toContain('himalayas')
    } finally {
      close()
    }
  })

  it('a visited row is never deleted, no matter how many times the DB is reopened', () => {
    const file = makeOld(rows)
    for (let i = 0; i < 4; i++) {
      const { db, close, migration } = openDb(file)
      try {
        if (i > 0) expect(migration).toMatchObject({ removedUnvisited: 0, keptVisited: 3, columnsAdded: [] })
        expect(db.select().from(jobs).all().filter((r) => r.visitedAt !== null)).toHaveLength(5)
      } finally {
        close()
      }
    }
  })

  it('a removed-source unvisited row that appears AFTER migration is purged on the next open (idempotent re-run)', () => {
    const file = makeOld([])
    openDb(file).close()
    const raw = new Database(file)
    raw.prepare("INSERT INTO jobs (source, external_id, url, first_seen_at) VALUES ('himalayas','late','https://e.com/l',1)").run()
    raw.close()
    const { migration, close } = openDb(file)
    close()
    expect(migration.removedUnvisited).toBe(1)
  })

  it('an empty old DB and a brand-new file both migrate without error', () => {
    const empty = makeOld([])
    const e = openDb(empty)
    expect(e.migration).toMatchObject({ removedUnvisited: 0, keptVisited: 0 })
    e.close()
    const fresh = openDb(join(tempDir('jf-mig-new-'), 'new.db'))
    expect(fresh.migration).toEqual({ columnsAdded: [], removedUnvisited: 0, keptVisited: 0 })
    fresh.close()
  })
})

describe('migration: additive columns on old schemas', () => {
  it('adds exactly the missing columns on a partial schema (country present, city/work_mode absent)', () => {
    const file = makeOld([{ source: 'amazon', id: '1', first: 5, visited: 55 }], ', country TEXT')
    const raw = new Database(file)
    raw.prepare("UPDATE jobs SET country = 'IL'").run()
    raw.close()
    const { migration, db, close } = openDb(file)
    try {
      expect(migration.columnsAdded).toEqual(['city', 'work_mode'])
      expect(db.select().from(jobs).all()[0]).toMatchObject({ country: 'IL', city: null, workMode: null, visitedAt: 55, firstSeenAt: 5 })
    } finally {
      close()
    }
    expect(cols(file).filter((c) => ['country', 'city', 'work_mode'].includes(c))).toHaveLength(3)
  })

  it('adds all three on a legacy table and reports them once (second open adds nothing)', () => {
    const file = makeOld([{ source: 'amazon', id: '1', first: 5, visited: null }])
    const a = openDb(file)
    expect(a.migration.columnsAdded).toEqual(['country', 'city', 'work_mode'])
    a.close()
    const b = openDb(file)
    expect(b.migration.columnsAdded).toEqual([])
    b.close()
    expect(cols(file).filter((c) => c === 'country' || c === 'city' || c === 'work_mode')).toHaveLength(3)
  })

  it('old rows read back with null country/city/work_mode and still list in New', () => {
    const file = makeOld([{ source: 'greenhouse:x', id: '1', first: 5, visited: null }])
    const { db, close } = openDb(file)
    try {
      const [r] = listJobs(db, { visited: false })
      expect(r).toMatchObject({ country: null, city: null, workMode: null })
    } finally {
      close()
    }
  })

  it('missing roles column AND missing 7b columns together (oldest schema) migrate in one open', () => {
    const file = makeOldDb(tempDir('jf-mig-oldest-'), [{ source: 'amazon', id: '1', first: 7, visited: 77 }]) // no roles column
    const { db, close, migration } = openDb(file)
    try {
      expect(migration.columnsAdded).toEqual(['country', 'city', 'work_mode'])
      expect(db.select().from(jobs).all()[0]).toMatchObject({ roles: [], visitedAt: 77, firstSeenAt: 7 })
    } finally {
      close()
    }
  })
})

describe('upsert of a visited Israel job with changed workMode/city (file-backed)', () => {
  const base = scoredJob({
    source: 'greenhouse:acme',
    externalId: '42',
    title: 'QA Engineer',
    company: 'Acme',
    url: 'https://e.com/42',
    description: 'd',
    location: 'Tel Aviv',
    city: 'Tel Aviv',
    workMode: 'onsite',
    score: 60
  })

  it('updates workMode/city/country but keeps visitedAt and firstSeenAt, across a reopen', () => {
    const file = join(tempDir('jf-mig-up-'), 'a.db')
    const a = openDb(file)
    upsertJobs(a.db, [base])
    const id = a.db.select().from(jobs).get()!.id
    a.db.update(jobs).set({ visitedAt: 999, firstSeenAt: 123 }).run() // simulate an earlier visit
    a.close()

    const b = openDb(file)
    try {
      const res = upsertJobs(b.db, [{ ...base, workMode: 'hybrid', city: 'Herzliya', location: 'Herzliya (Hybrid)', score: 75 }])
      expect(res).toEqual({ inserted: 0, updated: 1 })
      const row = b.db.select().from(jobs).all()[0]
      expect(row).toMatchObject({ id, workMode: 'hybrid', city: 'Herzliya', score: 75, country: 'IL', visitedAt: 999, firstSeenAt: 123 })
      // and once more with a nulled-out city and unknown mode: still never touches visitedAt
      upsertJobs(b.db, [{ ...base, workMode: 'unknown', city: null }])
      expect(b.db.select().from(jobs).all()[0]).toMatchObject({ workMode: 'unknown', city: null, visitedAt: 999, firstSeenAt: 123 })
      expect(listJobs(b.db, { visited: true }).map((j) => j.id)).toEqual([id])
      expect(listJobs(b.db, { visited: false })).toEqual([])
    } finally {
      b.close()
    }
  })

  it('upserting an old pre-country/workMode visited row (null country/work_mode) fills the new columns and keeps visitedAt', () => {
    const file = makeOld([{ source: 'greenhouse:acme', id: '42', first: 5, visited: 500 }])
    const { db, close } = openDb(file)
    try {
      upsertJobs(db, [base])
      expect(db.select().from(jobs).all()[0]).toMatchObject({ country: 'IL', workMode: 'onsite', city: 'Tel Aviv', visitedAt: 500, firstSeenAt: 5 })
    } finally {
      close()
    }
  })
})
