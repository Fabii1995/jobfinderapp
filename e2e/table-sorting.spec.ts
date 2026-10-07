import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

/**
 * Table sorting e2e. Requires `npm run build` (launches out/main/index.js) in an isolated
 * --user-data-dir with a seeded DB. Walks every sortable header through its click cycle in New
 * and Visited at normal and compact (<1100px) widths and compares row order + aria-sort against
 * the committed golden file (e2e/table-sorting.golden.json). Set UPDATE_GOLDEN=1 to rewrite it.
 */
const ROOT = resolve(__dirname, '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const GOLDEN = join(__dirname, 'table-sorting.golden.json')

const SCHEMA = `
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, external_id TEXT NOT NULL,
  title TEXT, company TEXT, url TEXT NOT NULL, description TEXT, location TEXT,
  country TEXT, city TEXT, work_mode TEXT,
  posted_at INTEGER, score REAL DEFAULT 0, roles TEXT NOT NULL DEFAULT '[]',
  first_seen_at INTEGER NOT NULL, visited_at INTEGER);
CREATE UNIQUE INDEX jobs_source_external_id_uq ON jobs (source, external_id);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`

const DAY = 86_400_000
const BASE = Date.UTC(2026, 5, 1)
// [title, city, location, workMode, score, postedDaysAgo|null, visitedDaysAgo|null]
type Row = [string | null, string | null, string | null, string | null, number, number | null, number | null]
const ROWS: Row[] = [
  ['Junior QA Engineer', 'Tel Aviv', 'Tel Aviv, Israel', 'hybrid', 90, 1, null],
  ['backend trainee', 'Haifa', 'Haifa, Israel', 'onsite', 80, 3, null],
  ['Python Developer', null, 'Herzliya, Israel', 'hybrid', 80, null, null],
  ['Alpha Support Engineer', 'Jerusalem', 'Jerusalem, Israel', null, 70, 2, null],
  ['Zeta Data Intern', 'Tel Aviv', 'Tel Aviv, Israel', 'onsite', 70, 2, null],
  ['Beta Automation', null, null, 'hybrid', 60, null, null],
  ['  Gamma Solutions  ', 'Haifa', 'Haifa, Israel', null, 60, 5, null],
  [null, 'Beer Sheva', 'Beer Sheva, Israel', 'onsite', 50, 4, null],
  ['Delta FDE', 'Tel Aviv', 'Tel Aviv, Israel', 'hybrid', 50, 4, null],
  ['Epsilon QA', 'Rehovot', 'Rehovot, Israel', 'hybrid', 40, null, null],
  ['Eta Backend', 'Netanya', 'Netanya, Israel', 'onsite', 40, 6, null],
  ['Theta Junior Dev', 'Tel Aviv', 'Tel Aviv, Israel', 'hybrid', 30, 7, null],
  ['Iota Python', 'Haifa', 'Haifa, Israel', 'onsite', 30, 7, null],
  ['Kappa Tester', null, null, null, 20, null, null],
  ['Lambda Dev', 'Ramat Gan', 'Ramat Gan, Israel', 'hybrid', 20, 1, null],
  // visited
  ['V Junior QA', 'Tel Aviv', 'Tel Aviv, Israel', 'hybrid', 85, 1, 5],
  ['V Backend', 'Haifa', 'Haifa, Israel', 'onsite', 75, 2, 3],
  ['V Python', null, 'Herzliya, Israel', 'hybrid', 75, null, 3],
  ['V Support', 'Jerusalem', 'Jerusalem, Israel', null, 55, 3, 9],
  ['V Zeta', 'Tel Aviv', 'Tel Aviv, Israel', 'onsite', 55, null, 1],
  ['v alpha', null, null, 'hybrid', 45, 4, 7],
  ['V Delta', 'Rehovot', 'Rehovot, Israel', 'hybrid', 35, 5, 2],
  ['V Eta', 'Netanya', 'Netanya, Israel', 'onsite', 35, 5, 2]
]

let userData: string
let dbFile: string

test.beforeAll(() => {
  userData = mkdtempSync(join(tmpdir(), 'jobfinder-sort-'))
  dbFile = join(userData, 'jobfinder.db')
  const s = new Database(dbFile)
  s.exec(SCHEMA)
  const ins = s.prepare(
    `INSERT INTO jobs (source, external_id, title, company, url, description, location, country, city, work_mode, score, roles, first_seen_at, posted_at, visited_at)
     VALUES ('greenhouse:sortco', ?, ?, 'Sort Co', ?, 'seeded', ?, 'IL', ?, ?, ?, '[]', ?, ?, ?)`
  )
  ROWS.forEach(([title, city, loc, wm, score, pd, vd], i) =>
    ins.run(
      `s-${i}`,
      title,
      `https://example.com/s-${i}`,
      loc,
      city,
      wm,
      score,
      1000 + i,
      pd == null ? null : BASE - pd * DAY,
      vd == null ? null : BASE - vd * DAY
    )
  )
  s.close()
})

test.afterAll(() => {
  rmSync(userData, { recursive: true, force: true })
})

async function launch(): Promise<ElectronApplication> {
  const app = await electron.launch({ args: [MAIN, `--user-data-dir=${userData}`], cwd: ROOT })
  await app.evaluate(({ shell }) => {
    shell.openExternal = async () => {}
  })
  return app
}

async function resize(app: ElectronApplication, win: Page, width: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, w) => {
    const bw = BrowserWindow.getAllWindows()[0]
    bw.setMinimumSize(300, 400)
    bw.setContentSize(w, 800)
  }, width)
  await expect.poll(() => win.evaluate(() => window.innerWidth)).toBe(width)
}

async function snap(win: Page): Promise<string> {
  const order = await win
    .locator('[data-testid="job-row"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-job-id')))
  const sorts = await win
    .locator('thead th')
    .evaluateAll((els) => els.map((e) => `${e.textContent?.trim()}=${e.getAttribute('aria-sort')}`))
  const caption = await win.locator('caption').textContent()
  return `${order.join(',')} | ${sorts.join(' ')} | ${caption}`
}

test('header sort cycle, row order, aria-sort and focus match the golden record', async () => {
  const out: Record<string, string[]> = {}
  const app = await launch()
  try {
    const win = await app.firstWindow()
    for (const width of [1200, 900]) {
      await resize(app, win, width)
      for (const tab of ['New', 'Visited']) {
        await win.getByRole('tab', { name: new RegExp(tab) }).click()
        await expect(win.locator('[data-testid="job-row"]').first()).toBeVisible()
        const log: string[] = [`initial: ${await snap(win)}`]
        const headers = await win.locator('thead th').allTextContents()
        for (const h of headers) {
          const btn = win.locator('thead th', { hasText: h.trim() }).getByRole('button')
          for (let i = 1; i <= 4; i++) {
            await btn.click()
            log.push(`${h.trim()} click ${i}: ${await snap(win)}`)
          }
        }
        // Keyboard navigation over the (currently sorted) list.
        await win.locator('[data-job-open]').first().focus()
        const kb: string[] = []
        for (const k of ['ArrowDown', 'ArrowDown', 'End', 'ArrowUp', 'Home']) {
          await win.keyboard.press(k)
          kb.push(`${k}->${await win.evaluate(() => document.activeElement?.getAttribute('data-testid'))}`)
        }
        log.push(`keys: ${kb.join(' ')}`)
        out[`${tab}@${width}`] = log
      }
    }

    // Focus after opening a job from New (sorted by title): lands on the next row in that order.
    await resize(app, win, 1200)
    await win.getByRole('tab', { name: /New/ }).click()
    await win.locator('thead th', { hasText: 'Job' }).getByRole('button').click()
    const before = await snap(win)
    const third = win.locator('[data-testid="job-row"]').nth(2)
    const openedId = await third.getAttribute('data-job-id')
    await third.locator('[data-job-open]').first().click()
    await expect(win.locator(`[data-job-id="${openedId}"]`)).toHaveCount(0)
    await win.waitForTimeout(300)
    const focused = await win.evaluate(() => document.activeElement?.getAttribute('data-testid'))
    out['openFocus'] = [before, `opened ${openedId}`, `focus ${focused}`]
  } finally {
    await app.close()
  }

  if (process.env.UPDATE_GOLDEN || !existsSync(GOLDEN)) {
    writeFileSync(GOLDEN, JSON.stringify(out, null, 2) + '\n')
    return
  }
  expect(out).toEqual(JSON.parse(readFileSync(GOLDEN, 'utf8')))
})
