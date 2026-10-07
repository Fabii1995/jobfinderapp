import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

/**
 * Persistence e2e. Requires `npm run build` (launches out/main/index.js).
 * The app derives its DB path from app.getPath('userData') (src/main/index.ts), and Electron
 * honors --user-data-dir, so each run is isolated in a temp dir and never touches the real DB.
 * Only the instances launched here are closed (no process killing).
 */
const ROOT = resolve(__dirname, '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')

const SCHEMA = `
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, external_id TEXT NOT NULL,
  title TEXT, company TEXT, url TEXT NOT NULL, description TEXT, location TEXT,
  country TEXT, city TEXT, work_mode TEXT,
  posted_at INTEGER, score REAL DEFAULT 0, roles TEXT NOT NULL DEFAULT '[]',
  first_seen_at INTEGER NOT NULL, visited_at INTEGER);
CREATE UNIQUE INDEX jobs_source_external_id_uq ON jobs (source, external_id);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`

const TITLES = ['E2E Alpha Junior QA Engineer', 'E2E Bravo Junior Python Developer', 'E2E Charlie Backend Trainee']

let userData: string
let dbFile: string

test.beforeAll(() => {
  userData = mkdtempSync(join(tmpdir(), 'jobfinder-e2e-'))
  dbFile = join(userData, 'jobfinder.db')
  const s = new Database(dbFile)
  s.exec(SCHEMA)
  const ins = s.prepare(
    `INSERT INTO jobs (source, external_id, title, company, url, description, location, country, city, work_mode, score, roles, first_seen_at, posted_at)
     VALUES ('greenhouse:e2eco', ?, ?, 'E2E Co', ?, 'seeded', 'Tel Aviv, Israel', 'IL', 'Tel Aviv', 'hybrid', ?, '["qa"]', ?, ?)`
  )
  TITLES.forEach((t, i) => ins.run(`e2e-${i}`, t, `https://example.com/e2e-${i}`, 90 - i * 10, 1000 + i, Date.now()))
  s.close()
})

test.afterAll(() => {
  rmSync(userData, { recursive: true, force: true })
})

async function launch(): Promise<ElectronApplication> {
  const app = await electron.launch({ args: [MAIN, `--user-data-dir=${userData}`], cwd: ROOT })
  // Never open a real browser from a test: stub shell.openExternal in the main process.
  await app.evaluate(({ shell }) => {
    shell.openExternal = async () => {}
  })
  return app
}

test('a visited job is still in Visited after the app is closed and relaunched on the same DB file', async () => {
  const visitedTitle = TITLES[1]

  // ---- first run: visit one job via the UI ----
  let app = await launch()
  try {
    const win = await app.firstWindow()
    // sanity: the isolated DB is the one in use
    expect(await app.evaluate(({ app: a }) => a.getPath('userData'))).toBe(userData)

    for (const t of TITLES) await expect(win.getByRole('button', { name: new RegExp(t) })).toBeVisible()
    await win.getByRole('button', { name: new RegExp(visitedTitle) }).click()
    // it leaves New ...
    await expect(win.getByRole('button', { name: new RegExp(visitedTitle) })).toHaveCount(0)
    // ... and shows in Visited
    await win.getByRole('tab', { name: /Visited/ }).click()
    await expect(win.getByRole('button', { name: new RegExp(visitedTitle) })).toBeVisible()
  } finally {
    await app.close()
  }

  // ---- DB file on disk reflects it (proves persistence, not client state) ----
  const raw = new Database(dbFile, { readonly: true })
  try {
    const rows = raw.prepare('SELECT title, visited_at FROM jobs ORDER BY id').all() as Array<{
      title: string
      visited_at: number | null
    }>
    expect(rows.filter((r) => r.visited_at !== null).map((r) => r.title)).toEqual([visitedTitle])
  } finally {
    raw.close()
  }

  // ---- second run: fresh process, same DB file ----
  app = await launch()
  try {
    const win = await app.firstWindow()
    // New tab (default): the other two are present, the visited one is not
    await expect(win.getByRole('button', { name: new RegExp(TITLES[0]) })).toBeVisible()
    await expect(win.getByRole('button', { name: new RegExp(visitedTitle) })).toHaveCount(0)
    await win.getByRole('tab', { name: /Visited/ }).click()
    await expect(win.getByRole('button', { name: new RegExp(visitedTitle) })).toBeVisible()
    await expect(win.getByRole('button', { name: new RegExp(TITLES[0]) })).toHaveCount(0)
  } finally {
    await app.close()
  }
})
