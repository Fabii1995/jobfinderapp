/**
 * README screenshot capture (NOT a test: not matched by Playwright testMatch, not run by npm test).
 * Run:  npm run build && npx tsx e2e/screenshots.capture.ts
 * Seeds a fictional DEMO dataset into a temp --user-data-dir (never the real %APPDATA% data, no keys)
 * and writes PNGs to docs/screenshots/.
 */
import { _electron as electron } from '@playwright/test'
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { makeCompanyEntry } from '../src/main/companies/validate'
import { seedCompanies } from '../src/main/companies/seeds'

const ROOT = resolve(process.cwd())
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const OUT = join(ROOT, 'docs', 'screenshots')

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
const NOW = Date.now()
const COMPANIES: [string, string][] = [
  ['Acme Robotics', 'acmerobotics'], ['Northwind Labs', 'northwindlabs'], ['Globex Systems', 'globexsystems'],
  ['Initech Cloud', 'initechcloud'], ['Umbrella Analytics', 'umbrellaanalytics'], ['Hooli Data', 'hoolidata'],
  ['Stark Software', 'starksoftware'], ['Contoso Security', 'contososecurity'], ['Wonka Digital', 'wonkadigital'],
  ['Pied Piper Tech', 'piedpipertech']
]
const CITIES = ['Tel Aviv', 'Herzliya', 'Haifa', 'Petah Tikva', 'Ramat Gan', "Be'er Sheva", 'Jerusalem', "Ra'anana"]
type Role = 'qa' | 'backend' | 'python' | 'ai' | 'forward-deployed' | 'frontend' | 'fullstack'
// [title, role, score]
const TITLES: [string, Role, number][] = [
  ['Junior QA Automation Engineer', 'qa', 94], ['Junior Backend Developer', 'backend', 91],
  ['Junior Python Developer', 'python', 89], ['Entry-Level AI Solutions Engineer', 'ai', 87],
  ['Junior Forward Deployed Engineer', 'forward-deployed', 85], ['QA Engineer (Junior)', 'qa', 83],
  ['Backend Developer, New Grad', 'backend', 80], ['Junior Full-Stack Developer', 'fullstack', 78],
  ['Python Developer - Entry Level', 'python', 76], ['Junior Machine Learning Engineer', 'ai', 74],
  ['Junior Frontend Developer', 'frontend', 72], ['Manual QA Tester (Junior)', 'qa', 70],
  ['Software Engineer I - Backend', 'backend', 68], ['Junior Data Engineer (Python)', 'python', 66],
  ['Graduate Solutions Engineer', 'forward-deployed', 64], ['Junior Test Automation Developer', 'qa', 62],
  ['Associate Backend Engineer', 'backend', 60], ['Junior AI Application Developer', 'ai', 58],
  ['Junior Software Engineer', 'fullstack', 56], ['Junior DevOps-minded Backend Engineer', 'backend', 54],
  ['Student Developer (Python)', 'python', 52], ['Junior QA Engineer, Mobile', 'qa', 50],
  ['Implementation Engineer (Entry Level)', 'forward-deployed', 48], ['Junior Web Developer', 'frontend', 46],
  ['Junior Software Developer', 'fullstack', 44], ['Junior Backend Engineer, Payments', 'backend', 42],
  ['Junior Python Automation Engineer', 'python', 40], ['Associate QA Engineer', 'qa', 38]
]

const DESCS: Record<Role, string> = {
  qa: 'Build and maintain automated test suites, find bugs early and work closely with developers. No prior experience required.',
  backend: 'Join the platform team building REST services and data pipelines. Great first role for a recent graduate.',
  python: 'Write Python services and scripts that power our analytics products. Mentoring provided.',
  ai: 'Help integrate language models into customer workflows and evaluate their quality. Entry level welcome.',
  'forward-deployed': 'Work directly with customers to deploy and tailor our product. Strong communication skills and curiosity.',
  frontend: 'Build clean React interfaces for our internal tools with a supportive team.',
  fullstack: 'Ship features end to end across a TypeScript and Node stack. Junior-friendly team.'
}

function seedDb(file: string): void {
  const s = new Database(file)
  s.exec(SCHEMA)
  const ins = s.prepare(
    `INSERT INTO jobs (source, external_id, title, company, url, description, location, country, city, work_mode, score, roles, first_seen_at, posted_at, visited_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'IL', ?, ?, ?, ?, ?, ?, ?)`
  )
  TITLES.forEach(([title, role, score], i) => {
    const [company, slug] = COMPANIES[i % COMPANIES.length]
    const city = CITIES[i % CITIES.length]
    const visited = [2, 5, 9, 13].includes(i) // 4 visited, varied cities
    let source = `greenhouse:${slug}`
    let url = `https://example.com/jobs/${slug}/${i}`
    if (i === 4) { source = 'jsearch'; url = `https://www.linkedin.com/jobs/view/${1000 + i}` }
    if (i === 6) { source = 'serpapi'; url = `https://careers.example.com/${slug}/${i}` }
    const seen = NOW - (i % 9) * 0.6 * DAY - i * 3_600_000
    const posted = i % 7 === 6 ? null : NOW - (2 + (i * 5) % 20) * DAY
    ins.run(
      source, `demo-${i}`, title, company, url, DESCS[role], `${city}, Israel`, city,
      i % 3 === 0 ? 'onsite' : 'hybrid', score, JSON.stringify([role]), Math.round(seen),
      posted === null ? null : Math.round(posted), visited ? Math.round(NOW - (i % 5 + 1) * 0.4 * DAY) : null
    )
  })
  s.close()
}

function seedCompaniesFile(dir: string): void {
  const demo = COMPANIES.map(([name, token], i) =>
    makeCompanyEntry({ name, ats: i % 3 === 0 ? 'lever' : 'greenhouse', params: i % 3 === 0 ? { slug: token } : { token }, enabled: i !== 9 })
  )
  // Mark every real seed as already offered so the app does not add real company names to the demo list.
  const seedIds = seedCompanies().map((c) => c.id)
  writeFileSync(join(dir, 'companies.json'), JSON.stringify({ version: 1, companies: demo, seedsApplied: seedIds }, null, 2))
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const userData = mkdtempSync(join(tmpdir(), 'jobfinder-shots-'))
  seedDb(join(userData, 'jobfinder.db'))
  seedCompaniesFile(userData)
  const app = await electron.launch({ args: [MAIN, `--user-data-dir=${userData}`], cwd: ROOT })
  const pid = app.process().pid
  try {
    const win = await app.firstWindow()
    await app.evaluate(({ shell, BrowserWindow }) => {
      shell.openExternal = async () => {}
      const w = BrowserWindow.getAllWindows()[0]
      w.setContentSize(1440, 900)
      w.center()
    })
    await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
    const shot = async (name: string): Promise<void> => {
      await win.waitForTimeout(600)
      await win.screenshot({ path: join(OUT, name) })
      console.log(name, Math.round(statSync(join(OUT, name)).size / 1024), 'KB')
    }
    const rows = win.locator('[data-testid="job-row"]')

    await win.getByRole('tab', { name: /New/ }).click()
    await rows.first().waitFor()
    await shot('01-new-tab.png')

    await win.getByTestId('sort-select').click()
    await win.getByRole('listbox').waitFor()
    await shot('02-new-tab-sort-menu.png')
    await win.keyboard.press('Escape')

    await win.getByRole('tab', { name: /Visited/ }).click()
    await rows.first().waitFor()
    await shot('03-visited-tab.png')

    await win.getByRole('tab', { name: /Companies/ }).click()
    await win.getByTestId('companies-list').waitFor()
    await win.getByTestId('deepsearch').getByText('Off').first().waitFor()
    await shot('05-deep-search-panel.png')

    await win.getByTestId('companies-summary').scrollIntoViewIfNeeded()
    await win.getByTestId('companies-list').scrollIntoViewIfNeeded()
    await win.getByTestId('companies-summary').scrollIntoViewIfNeeded()
    await shot('04-companies-tab.png')
  } finally {
    await app.close().catch(() => {})
    console.log('electron pid', pid)
    rmSync(userData, { recursive: true, force: true })
  }
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
