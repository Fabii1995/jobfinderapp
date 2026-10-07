import { describe, expect, it, vi } from 'vitest'
import { memDb } from '../testing/db'
import { jobs } from '../db/schema'
import { openJob } from './open'
import { getJobById } from './queries'

const db = memDb()
const add = (url: string): number =>
  db
    .insert(jobs)
    .values({ source: 'remoteok', externalId: url, url, firstSeenAt: 1 })
    .returning({ id: jobs.id })
    .get().id


describe('openJob', () => {
  it('opens https and http URLs, then marks visited', async () => {
    for (const url of ['https://example.com/a', 'http://example.com/b']) {
      const id = add(url)
      const open = vi.fn().mockResolvedValue(undefined)
      const res = await openJob(db, id, open)
      expect(open).toHaveBeenCalledWith(new URL(url).toString())
      expect(res!.visitedAt).toBeTypeOf('number')
    }
  })

  it('rejects non-http(s) URLs without opening or marking', async () => {
    for (const url of ['javascript:alert(1)', 'file:///c:/windows/system32/calc.exe', 'ftp://x.com/a', 'not a url']) {
      const id = add(url)
      const open = vi.fn().mockResolvedValue(undefined)
      await expect(openJob(db, id, open), url).rejects.toThrow()
      expect(open).not.toHaveBeenCalled()
      expect(getJobById(db, id)!.visitedAt).toBeNull()
    }
  })

  it('does not mark visited when openExternal fails', async () => {
    const id = add('https://example.com/fail')
    await expect(openJob(db, id, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(getJobById(db, id)!.visitedAt).toBeNull()
  })

  it('rejects non-integer ids; unknown id returns null without opening', async () => {
    const open = vi.fn().mockResolvedValue(undefined)
    for (const bad of ['1', 1.5, null, undefined, {}]) {
      await expect(openJob(db, bad, open)).rejects.toThrow(/integer/)
    }
    expect(await openJob(db, 9999, open)).toBeNull()
    expect(open).not.toHaveBeenCalled()
  })
})
