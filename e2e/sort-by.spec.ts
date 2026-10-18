import { _electron as electron, expect, test } from '@playwright/test'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

/**
 * "Sort by" e2e: Recently added orders New rows by firstSeenAt (not posting date), with postedAt
 * as the tie-break. Requires `npm run build`. Uses an isolated --user-data-dir with a seeded DB.
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

const T = Date.UTC(2026, 5, 1)
// [letter, score, firstSeenAt, postedAt]. Best match (score) order is deliberately different.
const ROWS: [string, number, number, number | null][] = [
  ['a', 90, T + 1000, T - 9_000], // added first, high score
  ['b', 80, T + 3000, T - 5_000], // same add time as c and e; posted later than c
  ['c', 70, T + 3000, T - 7_000],
  ['d', 60, T + 2000, T - 1_000], // posted most recently, added in the middle
  ['e', 50, T + 3000, null] // same add time, no posting date: last among the ties
]

let userData: string

test.beforeAll(() => {
  userData = mkdtempSync(join(tmpdir(), 'jobfinder-sortby-'))
  const s = new Database(join(userData, 'jobfinder.db'))
  s.exec(SCHEMA)
  const ins = s.prepare(
    `INSERT INTO jobs (source, external_id, title, company, url, description, location, country, city, work_mode, score, roles, first_seen_at, posted_at)
     VALUES ('greenhouse:sortby', ?, ?, 'SortBy Co', ?, 'seeded', 'Tel Aviv, Israel', 'IL', 'Tel Aviv', 'hybrid', ?, '[]', ?, ?)`
  )
  for (const [id, score, seen, posted] of ROWS) {
    ins.run(id, `Junior ${id}`, `https://example.com/${id}`, score, seen, posted)
  }
  s.close()
})

test.afterAll(() => rmSync(userData, { recursive: true, force: true }))

test('Sort by orders New rows by firstSeenAt (postedAt tie-break) or by posting date', async () => {
  const app = await electron.launch({ args: [MAIN, `--user-data-dir=${userData}`], cwd: ROOT })
  try {
    await app.evaluate(({ shell }) => {
      shell.openExternal = async () => {}
    })
    const win = await app.firstWindow()
    await win.getByRole('tab', { name: /New/ }).click()
    const rows = win.locator('[data-testid="job-row"]')
    await expect(rows).toHaveCount(ROWS.length)
    const order = async (): Promise<string> =>
      (
        await rows.evaluateAll((els) => els.map((e) => /Junior ([a-e])/.exec(e.textContent ?? '')?.[1] ?? '?'))
      ).join('')

    expect(await order()).toBe('abcde') // Best match = score desc

    const pick = async (name: string): Promise<void> => {
      await win.getByTestId('sort-select').click()
      await win.getByRole('option', { name, exact: true }).click()
      await expect(win.getByTestId('sort-select')).toContainText(name)
    }

    await pick('Recently added')
    expect(await order()).toBe('bceda') // b,c,e share firstSeenAt: posted desc, null last; then d, a
    await pick('Oldest added')
    expect(await order()).toBe('adcbe') // a, d, then c,b (posted asc), e (null last)
    await pick('Newest posted')
    expect(await order()).toBe('edbca') // e has no postedAt so uses firstSeenAt (newest)
    await pick('Oldest posted')
    expect(await order()).toBe('acbde')
    await pick('Best match')
    expect(await order()).toBe('abcde')
  } finally {
    await app.close()
  }
})
