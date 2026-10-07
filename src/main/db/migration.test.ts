import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb } from './index'
import { jobs } from './schema'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A pre-roles DB file with one visited and one new row. */
function oldDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jf-mig-'))
  dirs.push(dir)
  const file = join(dir, 'old.db')
  const s = new Database(file)
  s.exec(`CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, external_id TEXT NOT NULL,
    title TEXT, company TEXT, url TEXT NOT NULL, description TEXT, location TEXT,
    posted_at INTEGER, score REAL DEFAULT 0, first_seen_at INTEGER NOT NULL, visited_at INTEGER);
    CREATE UNIQUE INDEX jobs_source_external_id_uq ON jobs (source, external_id);`)
  s.prepare(
    "INSERT INTO jobs (source, external_id, title, url, score, first_seen_at, visited_at) VALUES ('remoteok','1','Visited one','https://e.com/1',50,111,222)"
  ).run()
  s.prepare(
    "INSERT INTO jobs (source, external_id, title, url, score, first_seen_at) VALUES ('remoteok','2','New one','https://e.com/2',40,333)"
  ).run()
  s.close()
  return file
}

describe('migration', () => {
  it('adds country/city/work_mode, deletes UNVISITED removed-source rows only, keeps visited ones untouched', () => {
    const file = oldDb()
    const { migration, db, close } = openDb(file)
    try {
      expect(migration).toMatchObject({ removedUnvisited: 1, keptVisited: 1 })
      expect(migration.columnsAdded).toEqual(['country', 'city', 'work_mode'])
      const rows = db.select().from(jobs).all()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ title: 'Visited one', visitedAt: 222, firstSeenAt: 111, country: null, workMode: null })
    } finally {
      close()
    }
    const again = openDb(file) // idempotent
    try {
      expect(again.migration).toMatchObject({ removedUnvisited: 0, keptVisited: 1, columnsAdded: [] })
    } finally {
      again.close()
    }
  })

  it('does not delete unvisited rows from current (non-removed) sources', () => {
    const file = oldDb()
    const raw = new Database(file)
    raw.prepare("INSERT INTO jobs (source, external_id, title, url, first_seen_at) VALUES ('greenhouse:x','9','Keep','https://e.com/9',1)").run()
    raw.close()
    const { db, close } = openDb(file)
    try {
      expect(db.select().from(jobs).all().map((r) => r.title).sort()).toEqual(['Keep', 'Visited one'])
    } finally {
      close()
    }
  })

  it('adds the roles column with default [] and preserves rows incl. visited_at', () => {
    const file = oldDb()
    const { db, close } = openDb(file)
    try {
      const rows = db.select().from(jobs).orderBy(jobs.id).all()
      expect(rows).toHaveLength(1) // the unvisited remoteok row is purged by the Phase 7b cleanup
      expect(rows[0]).toMatchObject({ title: 'Visited one', visitedAt: 222, firstSeenAt: 111, roles: [] })
    } finally {
      close()
    }
    const raw = new Database(file, { readonly: true })
    try {
      const cols = (raw.pragma('table_info(jobs)') as Array<{ name: string }>).map((c) => c.name)
      expect(cols).toContain('roles')
      expect(raw.prepare("SELECT 1 FROM sqlite_master WHERE name='meta'").get()).toBeTruthy()
      expect(raw.prepare('SELECT roles FROM jobs').pluck().all()).toEqual(['[]'])
    } finally {
      raw.close()
    }
  })

  it('is idempotent: reopening keeps data', () => {
    const file = oldDb()
    openDb(file).close()
    const { db, close } = openDb(file)
    try {
      expect(db.select().from(jobs).all()).toHaveLength(1)
    } finally {
      close()
    }
  })
})
