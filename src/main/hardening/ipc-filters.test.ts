import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC, MAX_COMPANY_NAME_LENGTH } from '../../shared/ipc'
import { openDb, type Db } from '../db'
import { upsertJobs, type ScoredJob } from '../jobs/upsert'
import { markVisited } from '../jobs/queries'
import type { Job } from '../db/schema'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) },
  shell: { openExternal: vi.fn() }
}))

import { registerJobsIpc } from '../ipc'

let db: Db
let close: () => void
const mk = (id: string, company: string, workMode: ScoredJob['workMode'], score = 50): ScoredJob => ({
  source: 'greenhouse:x',
  externalId: id,
  title: id,
  company,
  url: 'https://e.com/' + id,
  description: null,
  location: null,
  country: 'IL',
  city: 'Tel Aviv',
  workMode,
  postedAt: null,
  score,
  roles: []
})
const list = (req: unknown): Job[] => handlers.get(IPC.list)!({}, req) as Job[]
const titles = (req: unknown): string[] => list(req).map((j) => j.title ?? '').sort()

beforeEach(() => {
  handlers.clear()
  ;({ db, close } = openDb(':memory:'))
  upsertJobs(db, [
    mk('a-on', 'Acme', 'onsite'),
    mk('a-hy', 'Acme', 'hybrid'),
    mk('b-on', 'Beta', 'onsite'),
    mk('b-un', 'Beta', 'unknown'),
    mk('c-re', 'Gamma', 'remote')
  ])
  registerJobsIpc({ db, refresh: vi.fn() })
})
afterEach(() => close())

describe('jobs:list workMode coercion', () => {
  it('valid values pass through (including remote and unknown)', () => {
    expect(titles({ visited: false, workMode: 'onsite' })).toEqual(['a-on', 'b-on'])
    expect(titles({ visited: false, workMode: 'hybrid' })).toEqual(['a-hy'])
    expect(titles({ visited: false, workMode: 'unknown' })).toEqual(['b-un'])
    expect(titles({ visited: false, workMode: 'remote' })).toEqual(['c-re'])
  })
  it('invalid values are ignored (full list), never thrown', () => {
    const all = ['a-hy', 'a-on', 'b-on', 'b-un', 'c-re']
    for (const wm of ['REMOTE', 'Onsite', 'onsite ', ' onsite', '', 'all', 'none', 5, null, true, {}, [], ['onsite'], "'; DROP TABLE jobs;--", '<script>', '../../x', 'onsite\u0000']) {
      expect(titles({ visited: false, workMode: wm }), JSON.stringify(wm)).toEqual(all)
    }
  })
})

describe('jobs:list company coercion', () => {
  it('valid company passes through (exact, case-sensitive)', () => {
    expect(titles({ visited: false, company: 'Acme' })).toEqual(['a-hy', 'a-on'])
    expect(titles({ visited: false, company: 'acme' })).toEqual([])
  })
  it('non-string / empty company is ignored', () => {
    for (const c of ['', 5, null, true, {}, [], ['Acme'], undefined]) {
      expect(titles({ visited: false, company: c }), JSON.stringify(c)).toHaveLength(5)
    }
  })
  it('over-long company (>100) is ignored; exactly 100 is applied (matches nothing)', () => {
    expect(titles({ visited: false, company: 'x'.repeat(MAX_COMPANY_NAME_LENGTH + 1) })).toHaveLength(5)
    expect(titles({ visited: false, company: 'x'.repeat(MAX_COMPANY_NAME_LENGTH) })).toEqual([])
  })
  it('hostile strings are bound as data: they match nothing and never widen the result', () => {
    for (const c of ["' OR '1'='1", "Acme' --", "Acme'); DROP TABLE jobs;--", 'Acme%', 'Acme\\', '%', '_cme', '<img src=x>', '../../etc/passwd', 'Acme\u0000']) {
      expect(titles({ visited: false, company: c }), c).toEqual([])
    }
    expect(titles({ visited: false })).toHaveLength(5) // table intact
  })
  it('combines with workMode (AND) and with the visited tab', () => {
    expect(titles({ visited: false, company: 'Acme', workMode: 'hybrid' })).toEqual(['a-hy'])
    expect(titles({ visited: false, company: 'Acme', workMode: 'remote' })).toEqual([])
    const id = list({ visited: false, company: 'Beta', workMode: 'onsite' })[0].id
    markVisited(db, id)
    expect(titles({ visited: true, company: 'Beta' })).toEqual(['b-on'])
    expect(titles({ visited: true, company: 'Acme' })).toEqual([])
    expect(titles({ visited: false, company: 'Beta' })).toEqual(['b-un'])
  })
  it('non-object requests still fall back to the plain New list', () => {
    for (const req of [undefined, null, 'x', 5, [], {}]) expect(list(req)).toHaveLength(5)
  })
})
