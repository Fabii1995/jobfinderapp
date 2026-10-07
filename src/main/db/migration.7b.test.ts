import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb } from './index'
import { jobs } from './schema'
import { upsertJobs, type ScoredJob } from '../jobs/upsert'
import { getStats, listJobs } from '../jobs/queries'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const OLD_COLS = `id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, external_id TEXT NOT NULL,
  title TEXT, company TEXT, url TEXT NOT NULL, description TEXT, location TEXT,
  posted_at INTEGER, score REAL DEFAULT 0, roles TEXT NOT NULL DEFAULT '[]', first_seen_at INTEGER NOT NULL, visited_at INTEGER`

interface Seed {
  source: string
  id: string
  first: number
  visited: number | null
}

function makeOld(rows: Seed[], extraCols = ''): string {
  const dir = mkdtempSync(join(tmpdir(), 'jf-mig7b-'))
  dirs.push(dir)
  const file = join(dir, 'old.db')
  const s = new Database(file)
  s.exec(`CREATE TABLE jobs (${OLD_COLS}${extraCols});
    CREATE UNIQUE INDEX jobs_source_external_id_uq ON jobs (source, external_id);`)
  const ins = s.prepare('INSERT INTO jobs (source, external_id, title, url, first_seen_at, visited_at) VALUES (?,?,?,?,?,?)')
  for (const r of rows) ins.run(r.source, r.id, `${r.source}/${r.id}`, `https://e.com/${r.source}/${r.id}`, r.first, r.visited)
  s.close()
  return file
}

const cols = (file: string): string[] => {
  const raw = new Database(file, { readonly: true })
  try {
    return (raw.pragma('table_info(jobs)') as Array<{ name: string }>).map((c) => c.name)
  } finally {
    raw.close()
  }
}

describe('Phase 7b migration: purge scope', () => {
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
    const dir = mkdtempSync(join(tmpdir(), 'jf-mig7b-new-'))
    dirs.push(dir)
    const fresh = openDb(join(dir, 'new.db'))
    expect(fresh.migration).toEqual({ columnsAdded: [], removedUnvisited: 0, keptVisited: 0 })
    fresh.close()
  })
})

describe('Phase 7b migration: additive columns', () => {
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
      // an 'unknown' work-mode filter also matches NULL work_mode rows (renderer treats null as unknown)
      expect(listJobs(db, { visited: false, workMode: 'unknown' }).map((j) => j.id)).toEqual([r.id])
      expect(listJobs(db, { visited: false, workMode: 'onsite' })).toEqual([])
    } finally {
      close()
    }
  })

  it('missing roles column AND missing 7b columns together (oldest schema) migrate in one open', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jf-mig7b-oldest-'))
    dirs.push(dir)
    const file = join(dir, 'o.db')
    const s = new Database(file)
    s.exec(`CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, external_id TEXT NOT NULL,
      title TEXT, company TEXT, url TEXT NOT NULL, description TEXT, location TEXT, posted_at INTEGER, score REAL DEFAULT 0,
      first_seen_at INTEGER NOT NULL, visited_at INTEGER);
      CREATE UNIQUE INDEX jobs_source_external_id_uq ON jobs (source, external_id);
      INSERT INTO jobs (source, external_id, url, first_seen_at, visited_at) VALUES ('amazon','1','https://e.com/1',7,77);`)
    s.close()
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
  const base: ScoredJob = {
    source: 'greenhouse:acme',
    externalId: '42',
    title: 'QA Engineer',
    company: 'Acme',
    url: 'https://e.com/42',
    description: 'd',
    location: 'Tel Aviv',
    country: 'IL',
    city: 'Tel Aviv',
    workMode: 'onsite',
    postedAt: null,
    score: 60,
    roles: []
  }

  it('updates workMode/city/country but keeps visitedAt and firstSeenAt, across a reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jf-mig7b-up-'))
    dirs.push(dir)
    const file = join(dir, 'a.db')
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

  it('upserting an old pre-7b visited row (null country/work_mode) fills the new columns and keeps visitedAt', () => {
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
