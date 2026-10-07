import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { openDb } from './index'
import { makeOldDb, tempDirs } from '../testing/db'
import { jobs } from './schema'

const tempDir = tempDirs()

/** A pre-roles DB file with one visited and one new row. */
const oldDb = (): string =>
  makeOldDb(tempDir('jf-mig-'), [
    { source: 'remoteok', id: '1', first: 111, visited: 222 },
    { source: 'remoteok', id: '2', first: 333, visited: null }
  ])

describe('migration (old schema to current)', () => {
  it('adds country/city/work_mode, deletes UNVISITED removed-source rows only, keeps visited ones untouched', () => {
    const file = oldDb()
    const { migration, db, close } = openDb(file)
    try {
      expect(migration).toMatchObject({ removedUnvisited: 1, keptVisited: 1 })
      expect(migration.columnsAdded).toEqual(['country', 'city', 'work_mode'])
      const rows = db.select().from(jobs).all()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ title: 'remoteok/1', visitedAt: 222, firstSeenAt: 111, country: null, workMode: null })
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

  it('adds the roles column with default [] and preserves rows incl. visited_at', () => {
    const file = oldDb()
    const { db, close } = openDb(file)
    try {
      const rows = db.select().from(jobs).orderBy(jobs.id).all()
      expect(rows).toHaveLength(1) // the unvisited remoteok row is purged by the non-Israel cleanup
      expect(rows[0]).toMatchObject({ title: 'remoteok/1', visitedAt: 222, firstSeenAt: 111, roles: [] })
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
})
