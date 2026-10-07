import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

/** Fresh-DB schema. Existing DB files are upgraded by the idempotent steps in migrate(). */
const MIGRATION = `
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT,
  company TEXT,
  url TEXT NOT NULL,
  description TEXT,
  location TEXT,
  posted_at INTEGER,
  country TEXT,
  city TEXT,
  work_mode TEXT,
  score REAL DEFAULT 0,
  roles TEXT NOT NULL DEFAULT '[]',
  first_seen_at INTEGER NOT NULL,
  visited_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_source_external_id_uq ON jobs (source, external_id);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

type SqliteDb = InstanceType<typeof Database>

function jobsCounts(sqlite: SqliteDb): { rows: number; visited: number } | null {
  const exists = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'jobs'")
    .get()
  if (!exists) return null
  return sqlite
    .prepare('SELECT COUNT(*) AS rows, COUNT(visited_at) AS visited FROM jobs')
    .get() as { rows: number; visited: number }
}

function jobsColumns(sqlite: SqliteDb): string[] {
  return (sqlite.pragma('table_info(jobs)') as Array<{ name: string }>).map((c) => c.name)
}

/** Remote-only boards removed; their UNVISITED rows are purged, visited ones kept. */
const REMOVED_SOURCES = ['arbeitnow', 'remoteok', 'himalayas']
const ADDED_COLUMNS: Array<[string, string]> = [
  ['country', 'TEXT'],
  ['city', 'TEXT'],
  ['work_mode', 'TEXT']
]

interface MigrationReport {
  columnsAdded: string[]
  /** Unvisited rows deleted from the removed remote sources. */
  removedUnvisited: number
  /** Visited rows from the removed sources that were kept (history). */
  keptVisited: number
}

/**
 * Idempotent, additive-only migration. NEVER drops or recreates `jobs`: visited_at is
 * real user data (RULES.md).
 */
function migrate(sqlite: SqliteDb): MigrationReport {
  const before = jobsCounts(sqlite)
  sqlite.exec(MIGRATION)
  let added = false
  if (!jobsColumns(sqlite).includes('roles')) {
    sqlite.exec("ALTER TABLE jobs ADD COLUMN roles TEXT NOT NULL DEFAULT '[]'")
    added = true
  }
  const columnsAdded: string[] = []
  for (const [name, type] of ADDED_COLUMNS) {
    if (!jobsColumns(sqlite).includes(name)) {
      sqlite.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`)
      columnsAdded.push(name)
    }
  }
  // The ONLY delete in the app's migrations: never-visited rows of the removed remote sources.
  // visited_at IS NULL is in the WHERE clause, so a visited row can never match. Idempotent.
  const marks = REMOVED_SOURCES.map(() => '?').join(',')
  const removedUnvisited = sqlite
    .prepare(`DELETE FROM jobs WHERE visited_at IS NULL AND source IN (${marks})`)
    .run(...REMOVED_SOURCES).changes
  const keptVisited = (
    sqlite
      .prepare(`SELECT COUNT(*) AS n FROM jobs WHERE visited_at IS NOT NULL AND source IN (${marks})`)
      .get(...REMOVED_SOURCES) as { n: number }
  ).n
  const after = jobsCounts(sqlite)
  console.log(
    `[db] migrate: roles column ${added ? 'ADDED' : 'already present'}; ` +
      `before=${before ? JSON.stringify(before) : 'no jobs table'} after=${JSON.stringify(after)}`
  )
  console.log(`[db] migrate: added ${columnsAdded.join(',') || 'no'} columns; removed ${removedUnvisited} unvisited remote-source rows; kept ${keptVisited} visited ones`)
  console.log(`[db] jobs columns: ${jobsColumns(sqlite).join(', ')}`)
  return { columnsAdded, removedUnvisited, keptVisited }
}

/** Opens (and migrates) a SQLite DB. No Electron imports; pass ':memory:' in tests. */
export function openDb(filePath: string): { db: Db; close: () => void; migration: MigrationReport } {
  const sqlite = new Database(filePath)
  sqlite.pragma('journal_mode = WAL')
  const migration = migrate(sqlite)
  const db = drizzle(sqlite, { schema })
  return { db, close: () => sqlite.close(), migration }
}
