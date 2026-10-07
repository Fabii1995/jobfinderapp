import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../../shared/ipc'
import { memDb } from '../testing/db'
import { upsertJobs, type ScoredJob } from '../jobs/upsert'
import { scoredJob } from '../testing/fixtures'
import { markVisited } from '../jobs/queries'
import type { Job } from '../db/schema'

vi.mock('electron', async () => (await import('../testing/electron')).electronMock())

import { registerJobsIpc } from '../ipc'
import { handlers } from '../testing/electron'

const db = memDb()
const mk = (id: string, company: string, workMode: ScoredJob['workMode'], score = 50): ScoredJob =>
  scoredJob({ source: 'greenhouse:x', externalId: id, title: id, company, url: 'https://e.com/' + id, city: 'Tel Aviv', workMode, score })
const list = (req: unknown): Job[] => handlers.get(IPC.list)!({}, req) as Job[]
const titles = (req: unknown): string[] => list(req).map((j) => j.title ?? '').sort()

beforeEach(() => {
  handlers.clear()
  upsertJobs(db, [
    mk('a-on', 'Acme', 'onsite'),
    mk('a-hy', 'Acme', 'hybrid'),
    mk('b-on', 'Beta', 'onsite'),
    mk('b-un', 'Beta', 'unknown'),
    mk('c-re', 'Gamma', 'remote')
  ])
  registerJobsIpc({ db, refresh: vi.fn() })
})

describe('jobs:list ignores unknown request fields', () => {
  it('legacy workMode/company fields no longer filter and never throw', () => {
    for (const extra of [{ workMode: 'onsite' }, { company: 'Acme' }, { workMode: 5, company: {} }, { company: "' OR '1'='1" }]) {
      expect(titles({ visited: false, ...extra }), JSON.stringify(extra)).toHaveLength(5)
    }
    expect(titles({ visited: false })).toHaveLength(5) // table intact
  })
  it('visited tab is still driven only by `visited`', () => {
    const id = list({ visited: false })[0].id
    markVisited(db, id)
    expect(list({ visited: true, company: 'Nope' })).toHaveLength(1)
    expect(list({ visited: false, company: 'Nope' })).toHaveLength(4)
  })
  it('non-object requests still fall back to the plain New list', () => {
    for (const req of [undefined, null, 'x', 5, [], {}]) expect(list(req)).toHaveLength(5)
  })
})
