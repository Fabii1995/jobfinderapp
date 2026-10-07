import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach } from 'vitest'
import { openDb, type Db } from '../db'

/**
 * Registers beforeEach/afterEach hooks that open a fresh in-memory DB per test and close it afterwards.
 * Returns a stable handle that always forwards to the current test's DB, so it can be captured once at
 * module level (`const db = memDb()`) and passed to code under test.
 */
export function memDb(): Db {
  let current: { db: Db; close: () => void } | null = null
  beforeEach(() => {
    current = openDb(':memory:')
  })
  afterEach(() => {
    current?.close()
    current = null
  })
  return new Proxy({} as Db, {
    get(_t, prop) {
      if (!current) throw new Error('memDb(): DB used outside a test')
      const v = Reflect.get(current.db, prop)
      return typeof v === 'function' ? v.bind(current.db) : v
    }
  })
}

/**
 * Registers an afterEach that deletes every temp dir created through the returned function.
 * `const tempDir = tempDirs(); const dir = tempDir('jf-x-')`.
 */
export function tempDirs(): (prefix?: string) => string {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  return (prefix = 'jf-') => {
    const d = mkdtempSync(join(tmpdir(), prefix))
    dirs.push(d)
    return d
  }
}

/** Column list shared by the "old schema" DB fixtures (country/city/work_mode were added later). */
export const OLD_JOBS_COLUMNS = `id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, external_id TEXT NOT NULL,
  title TEXT, company TEXT, url TEXT NOT NULL, description TEXT, location TEXT,
  posted_at INTEGER, score REAL DEFAULT 0, first_seen_at INTEGER NOT NULL, visited_at INTEGER`

export interface OldJobSeed {
  source: string
  id: string
  first: number
  visited: number | null
}

/**
 * Creates a file-backed DB in the pre-migration shape (no country/city/work_mode; `roles` only when
 * `withRoles`), seeded with `rows`. `extraCols` is appended to the column list (e.g. ', country TEXT').
 */
export function makeOldDb(
  dir: string,
  rows: OldJobSeed[],
  opts: { withRoles?: boolean; extraCols?: string } = {}
): string {
  const file = join(dir, 'old.db')
  const s = new Database(file)
  const roles = opts.withRoles ? ", roles TEXT NOT NULL DEFAULT '[]'" : ''
  s.exec(`CREATE TABLE jobs (${OLD_JOBS_COLUMNS}${roles}${opts.extraCols ?? ''});
    CREATE UNIQUE INDEX jobs_source_external_id_uq ON jobs (source, external_id);`)
  const ins = s.prepare('INSERT INTO jobs (source, external_id, title, url, first_seen_at, visited_at) VALUES (?,?,?,?,?,?)')
  for (const r of rows) ins.run(r.source, r.id, `${r.source}/${r.id}`, `https://e.com/${r.source}/${r.id}`, r.first, r.visited)
  s.close()
  return file
}
