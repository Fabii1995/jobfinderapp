import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC, MAX_COMPANY_NAME_LENGTH, MAX_URL_LENGTH } from '../shared/ipc'
import { memDb, tempDirs } from './testing/db'
import { upsertJobs, type ScoredJob } from './jobs/upsert'
import { COMPANIES_FILE, loadCompanies } from './companies/store'
import { isValidToken, isValidWorkdayHost, isValidWorkdaySite } from './sources/params'
import type { CompanyEntry } from './companies/types'

vi.mock('electron', async () => (await import('./testing/electron')).electronMock())

import { handlers } from './testing/electron'
import { addCompanyFromUrl, prettifyIdentifier, registerCompaniesIpc, UNSUPPORTED_MESSAGE } from './companiesIpc'

type Res = { ok: boolean; error?: string; company?: CompanyEntry }
const makeDir = tempDirs()
let dir: string
const db = memDb()
const probe = vi.fn<(e: CompanyEntry) => Promise<unknown>>()
const resolveComeet = vi.fn<(u: string) => Promise<{ uid: string; token: string }>>()
const deps = (): Parameters<typeof addCompanyFromUrl>[0] => ({ db, dir, probe, resolveComeet })
const add = (url: unknown, name?: unknown): Promise<Res> =>
  addCompanyFromUrl(deps(), { url, ...(name === undefined ? {} : { name }) }) as Promise<Res>
const call = (ch: string, ...args: unknown[]): unknown => handlers.get(ch)!({}, ...args)
const stored = (): CompanyEntry[] => loadCompanies(dir).companies
const hasId = (id: string): boolean => stored().some((c) => c.id === id)
const fileText = (): string => readFileSync(join(dir, COMPANIES_FILE), 'utf8')

beforeEach(() => {
  handlers.clear()
  dir = makeDir('jf-cipc-')
  probe.mockReset().mockResolvedValue([])
  resolveComeet.mockReset().mockResolvedValue({ uid: 'AB.123', token: 'ABCDEF1234567890' })
  registerCompaniesIpc(deps())
})

describe('addCompanyFromUrl: supported boards', () => {
  it('Greenhouse: derives id, default name, probes once, persists', async () => {
    const r = await add('https://boards.greenhouse.io/acme-labs/jobs/123')
    expect(r).toMatchObject({ ok: true, company: { id: 'greenhouse:acme-labs', name: 'Acme Labs', ats: 'greenhouse', enabled: true } })
    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe.mock.calls[0][0].params).toEqual({ token: 'acme-labs' })
    expect(hasId('greenhouse:acme-labs')).toBe(true)
  })
  it('Lever (incl. EU region)', async () => {
    expect(await add('https://jobs.lever.co/zzcorp')).toMatchObject({ ok: true, company: { id: 'lever:zzcorp', params: { slug: 'zzcorp' } } })
    const eu = await add('https://jobs.eu.lever.co/zzeu')
    expect(eu).toMatchObject({ ok: true, company: { id: 'lever:zzeu', params: { slug: 'zzeu', region: 'eu' } } })
  })
  it('Ashby', async () => {
    expect(await add('https://jobs.ashbyhq.com/zzashby')).toMatchObject({ ok: true, company: { id: 'ashby:zzashby', ats: 'ashby' } })
  })
  it('SmartRecruiters (id lowercased in the company id, case preserved in params)', async () => {
    const r = await add('https://careers.smartrecruiters.com/ZzCorp')
    expect(r).toMatchObject({ ok: true, company: { id: 'smartrecruiters:zzcorp', params: { id: 'ZzCorp' } } })
  })
  it('Workday: host/tenant/site, locale skipped', async () => {
    const r = await add('https://zzco.wd3.myworkdayjobs.com/en-US/ZzSite/job/x')
    expect(r).toMatchObject({
      ok: true,
      company: { id: 'workday:zzco', ats: 'workday', params: { host: 'zzco.wd3.myworkdayjobs.com', tenant: 'zzco', site: 'ZzSite' } }
    })
  })
  it('Comeet goes through resolveComeet and uses the resolved uid/token', async () => {
    const r = await add('https://www.comeet.com/jobs/zz-comeet/AB.123')
    expect(resolveComeet).toHaveBeenCalledWith('https://www.comeet.com/jobs/zz-comeet/AB.123')
    expect(r).toMatchObject({
      ok: true,
      company: { id: 'comeet:ab.123', name: 'Zz Comeet', params: { uid: 'AB.123', token: 'ABCDEF1234567890' } }
    })
  })
  it('Comeet resolver failure -> ok:false and nothing saved or probed', async () => {
    resolveComeet.mockRejectedValue(new Error('no Comeet configuration'))
    const r = await add('https://www.comeet.com/jobs/zzfail/AB.123')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Comeet/)
    expect(probe).not.toHaveBeenCalled()
    expect(stored().some((c) => c.ats === 'comeet' && c.name === 'Zzfail')).toBe(false)
  })
  it('a custom display name wins and is trimmed; blank name falls back to the derived one', async () => {
    expect(await add('https://boards.greenhouse.io/zzname', '  My Co  ')).toMatchObject({ ok: true, company: { name: 'My Co' } })
    expect(await add('https://boards.greenhouse.io/zzblank', '   ')).toMatchObject({ ok: true, company: { name: 'Zzblank' } })
    expect(await add('https://boards.greenhouse.io/zznull', null)).toMatchObject({ ok: true, company: { name: 'Zznull' } })
  })
  it('prettifyIdentifier', () => {
    expect(prettifyIdentifier('wizinc')).toBe('Wizinc')
    expect(prettifyIdentifier('acme-labs_x.y')).toBe('Acme Labs X Y')
    expect(prettifyIdentifier('a'.repeat(300))).toHaveLength(MAX_COMPANY_NAME_LENGTH)
  })
})

describe('addCompanyFromUrl: rejections', () => {
  it('duplicate: second add of the same board is refused, not re-probed, not duplicated', async () => {
    expect((await add('https://boards.greenhouse.io/zzdup')).ok).toBe(true)
    probe.mockClear()
    const r = await add('https://job-boards.greenhouse.io/zzdup/jobs/9')
    expect(r).toMatchObject({ ok: false })
    expect(r.error).toMatch(/Already in your list/)
    expect(probe).not.toHaveBeenCalled()
    expect(stored().filter((c) => c.id === 'greenhouse:zzdup')).toHaveLength(1)
  })
  it('duplicate is case-insensitive on the identifier (ids are lowercased)', async () => {
    expect((await add('https://careers.smartrecruiters.com/ZzCase')).ok).toBe(true)
    expect((await add('https://careers.smartrecruiters.com/zzcase')).ok).toBe(false)
  })
  it('unsupported / custom careers sites', async () => {
    for (const u of [
      'https://www.example.com/careers',
      'https://careers.google.com/jobs',
      'https://www.linkedin.com/company/x/jobs',
      'https://evil.example/boards.greenhouse.io/wizinc',
      'https://boards.greenhouse.io.evil.com/wizinc',
      'https://notmyworkdayjobs.com/x',
      'ftp://boards.greenhouse.io/x',
      'javascript:alert(1)',
      'file:///C:/Windows/win.ini'
    ]) {
      const r = await add(u)
      expect(r, u).toMatchObject({ ok: false, error: UNSUPPORTED_MESSAGE })
    }
    expect(probe).not.toHaveBeenCalled()
  })
  it('SQLink cannot be added through a URL (only via the seed list)', async () => {
    for (const u of ['https://www.sqlink.com/career/', 'https://sqlink.com/', 'https://www.sqlink.co.il/jobs']) {
      expect(await add(u), u).toMatchObject({ ok: false, error: UNSUPPORTED_MESSAGE })
    }
    expect(probe).not.toHaveBeenCalled()
  })
  it('amazon cannot be added through a URL either', async () => {
    expect((await add('https://www.amazon.jobs/en/search?loc_query=Israel')).ok).toBe(false)
  })
  it('garbage and non-string urls', async () => {
    for (const u of ['', '   ', 'not a url', 'http://', '://x', undefined, null, 5, {}, [], ['https://boards.greenhouse.io/x'], true]) {
      const r = await add(u)
      expect(r.ok, String(u)).toBe(false)
      expect(r.error).toBeTruthy()
    }
    for (const req of [undefined, null, 'str', 5, [], {}]) {
      expect(await addCompanyFromUrl(deps(), req)).toMatchObject({ ok: false })
    }
    expect(probe).not.toHaveBeenCalled()
  })
  it('url length boundary: 2048 reaches detection, 2049 is rejected as too long', async () => {
    const base = 'https://boards.greenhouse.io/zzlen?x='
    const at = base + 'a'.repeat(MAX_URL_LENGTH - base.length)
    expect(at).toHaveLength(MAX_URL_LENGTH)
    expect((await add(at)).ok).toBe(true)
    const over = base + 'a'.repeat(MAX_URL_LENGTH + 1 - base.length)
    const r = await add(over)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/too long/)
    expect((await add('x'.repeat(100000))).error).toMatch(/too long/)
  })
  it('name length boundary: 100 accepted, 101 rejected before any network/probe', async () => {
    expect((await add('https://boards.greenhouse.io/zzn100', 'n'.repeat(100))).ok).toBe(true)
    probe.mockClear()
    const r = await add('https://boards.greenhouse.io/zzn101', 'n'.repeat(101))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/too long/)
    expect(probe).not.toHaveBeenCalled()
    expect(hasId('greenhouse:zzn101')).toBe(false)
  })
  it('non-string name is rejected', async () => {
    for (const n of [5, {}, [], true, ['x']]) {
      const r = await add('https://boards.greenhouse.io/zzbadname', n)
      expect(r, JSON.stringify(n)).toMatchObject({ ok: false, error: 'Company name must be text.' })
    }
    expect(hasId('greenhouse:zzbadname')).toBe(false)
  })
  it('an unreachable board (probe throws) is NOT saved and the error names the ats', async () => {
    probe.mockRejectedValue(new Error('HTTP 404 Not Found for https://x'))
    const r = await add('https://boards.greenhouse.io/zzdead')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Could not reach that greenhouse board.*404/)
    expect(hasId('greenhouse:zzdead')).toBe(false)
    // and a later successful probe can add it (nothing half-saved)
    probe.mockResolvedValue([])
    expect((await add('https://boards.greenhouse.io/zzdead')).ok).toBe(true)
  })
  it('non-Error probe rejection is reported, not crashed on', async () => {
    probe.mockRejectedValue('boom')
    expect(await add('https://boards.greenhouse.io/zzstr')).toMatchObject({ ok: false })
  })
  it('corrupt companies.json: refused with the file error, probe not called, bytes untouched', async () => {
    writeFileSync(join(dir, COMPANIES_FILE), '{ this is not json', 'utf8')
    const before = fileText()
    const r = await add('https://boards.greenhouse.io/zzcorrupt')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/unreadable/)
    expect(probe).not.toHaveBeenCalled()
    expect(fileText()).toBe(before)
  })
  it('companies.json with the wrong shape is also treated as corrupt (never overwritten)', async () => {
    writeFileSync(join(dir, COMPANIES_FILE), '{"companies":"nope"}', 'utf8')
    expect((await add('https://boards.greenhouse.io/zzshape')).ok).toBe(false)
    expect(fileText()).toBe('{"companies":"nope"}')
  })
})

describe('addCompanyFromUrl: hostile strings never reach params unvalidated', () => {
  const HOSTILE = [
    "https://boards.greenhouse.io/x'; DROP TABLE jobs;--",
    'https://boards.greenhouse.io/<script>alert(1)</script>',
    'https://boards.greenhouse.io/..%2F..%2Fetc%2Fpasswd',
    'https://boards.greenhouse.io/%2e%2e/%2e%2e/etc',
    'https://boards.greenhouse.io/../../etc',
    'https://boards.greenhouse.io/embed/job_board?for=../../x',
    "https://boards.greenhouse.io/embed/job_board?for=a'b",
    'https://jobs.lever.co/a b',
    'https://jobs.lever.co/%00',
    'https://jobs.ashbyhq.com/a%2Fb',
    'https://jobs.ashbyhq.com/..',
    'https://careers.smartrecruiters.com/' + 'a'.repeat(150),
    'https://evil.wd5.myworkdayjobs.com/en-US/..%2Fx',
    'https://evil.wd5.myworkdayjobs.com/a%20b',
    'https://-.wd5.myworkdayjobs.com/Site',
    'https://a.b.wd5.myworkdayjobs.com/Site',
    'https://x.wd5.myworkdayjobs.com/',
    'https://x.wd5.myworkdayjobs.com:8443@evil.com/Site',
    'https://user:pw@boards.greenhouse.io@evil.com/x'
  ]
  it('every hostile url either fails or yields only validated params (probe + file)', async () => {
    for (const u of HOSTILE) {
      let r: Res
      try {
        r = await add(u)
      } catch (e) {
        throw new Error(`threw for ${u}: ${String(e)}`)
      }
      if (r.ok) {
        const p = r.company!.params
        for (const [k, v] of Object.entries(p)) {
          const okVal = k === 'host' ? isValidWorkdayHost(v) : k === 'site' ? isValidWorkdaySite(v) : k === 'region' ? v === 'eu' : isValidToken(v)
          expect(okVal, `${u} -> ${k}=${v}`).toBe(true)
        }
      }
    }
    for (const [e] of probe.mock.calls) {
      for (const [k, v] of Object.entries(e.params)) {
        const okVal = k === 'host' ? isValidWorkdayHost(v) : k === 'site' ? isValidWorkdaySite(v) : k === 'region' ? v === 'eu' : isValidToken(v)
        expect(okVal, `probe param ${k}=${v}`).toBe(true)
      }
    }
    // every stored entry survives the strict re-validation done on load (nothing skipped)
    const raw = JSON.parse(fileText()) as { companies: unknown[] }
    expect(stored()).toHaveLength(raw.companies.length)
    expect(fileText()).not.toMatch(/DROP TABLE|<script|\.\.\//)
  })
  // Regression: an unguarded decodeURIComponent used to make addCompanyFromUrl reject with a URIError.
  it('malformed percent-escapes return ok:false instead of throwing', async () => {
    for (const u of [
      'https://careers.smartrecruiters.com/%E0%A4%A',
      'https://boards.greenhouse.io/%',
      'https://jobs.lever.co/%zz',
      'https://x.wd5.myworkdayjobs.com/%E0%A4%A'
    ]) {
      expect(await add(u), u).toMatchObject({ ok: false })
    }
  })
  it('the clearly-hostile ones are outright rejected', async () => {
    for (const u of HOSTILE.filter((x) => /DROP|<script|%2F|%00|a b|embed|\.\.%2F|%20|@evil|a\.b\.wd5|-\.wd5|:8443/.test(x))) {
      expect((await add(u)).ok, u).toBe(false)
    }
  })
  it('Comeet resolver returning hostile uid/token is rejected, never probed or stored', async () => {
    for (const bad of [
      { uid: "'; DROP TABLE jobs;--", token: 'ABCDEF1234567890' },
      { uid: 'AB.123', token: '../../x' },
      { uid: '<b>', token: '<script>' },
      { uid: '', token: '' },
      { uid: 'a'.repeat(200), token: 'ABCDEF1234567890' },
      { uid: 5, token: 6 } as unknown as { uid: string; token: string }
    ]) {
      resolveComeet.mockResolvedValue(bad)
      const r = await add('https://www.comeet.com/jobs/zzhostile/AB.123')
      expect(r.ok, JSON.stringify(bad)).toBe(false)
    }
    expect(probe).not.toHaveBeenCalled()
    expect(stored().some((c) => c.ats === 'comeet' && /DROP|\.\./.test(JSON.stringify(c)))).toBe(false)
  })
  it('hostile display names are stored verbatim as text only (not as params / ids)', async () => {
    const r = await add('https://boards.greenhouse.io/zzhtml', "<img src=x onerror=alert(1)>'; DROP TABLE jobs;--")
    // names are free text by design (React escapes them); the id/params stay validated
    expect(r.ok).toBe(true)
    expect(r.company!.id).toBe('greenhouse:zzhtml')
    expect(r.company!.params).toEqual({ token: 'zzhtml' })
  })
})

describe('channel registration and handlers', () => {
  it('registers counts + four company channels', () => {
    for (const ch of [IPC.companyCounts, IPC.companiesList, IPC.companiesAdd, IPC.companiesRemove, IPC.companiesSetEnabled]) {
      expect(handlers.has(ch), ch).toBe(true)
    }
    expect(handlers.size).toBe(5)
  })
  it('companies:list returns the (seeded) list, no error', () => {
    const res = call(IPC.companiesList) as { companies: CompanyEntry[]; error?: string }
    expect(res.error).toBeUndefined()
    expect(res.companies.length).toBeGreaterThan(0)
    expect(existsSync(join(dir, COMPANIES_FILE))).toBe(true)
  })
  it('companies:list surfaces a corrupt-file error and does not overwrite the file', () => {
    writeFileSync(join(dir, COMPANIES_FILE), 'garbage', 'utf8')
    const res = call(IPC.companiesList) as { companies: CompanyEntry[]; error?: string }
    expect(res.error).toMatch(/unreadable/)
    expect(res.companies.length).toBeGreaterThan(0)
    expect(fileText()).toBe('garbage')
  })
  it('companies:add handler delegates to addCompanyFromUrl', async () => {
    const r = (await call(IPC.companiesAdd, { url: 'https://jobs.lever.co/zzhandler' })) as Res
    expect(r.ok).toBe(true)
    expect(hasId('lever:zzhandler')).toBe(true)
    expect(await call(IPC.companiesAdd, 'nonsense')).toMatchObject({ ok: false })
  })

  describe('remove / setEnabled', () => {
    beforeEach(async () => {
      await add('https://jobs.lever.co/zzmut')
    })
    const BAD_IDS: unknown[] = [undefined, null, '', 5, {}, [], ['lever:zzmut'], true, 'x'.repeat(201)]
    it('remove rejects malformed ids without touching the file', () => {
      const before = fileText()
      for (const id of BAD_IDS) expect(call(IPC.companiesRemove, id), String(id)).toEqual({ ok: false, error: 'Invalid company id.' })
      expect(fileText()).toBe(before)
    })
    it('remove: unknown / hostile ids -> not found (as data, never as a path or SQL)', () => {
      const before = fileText()
      for (const id of ['../../etc/passwd', "'; DROP TABLE jobs;--", '<script>', 'lever:ZZMUT ', 'x'.repeat(200)]) {
        expect(call(IPC.companiesRemove, id), id).toEqual({ ok: false, error: 'Company not found.' })
      }
      expect(fileText()).toBe(before)
    })
    it('remove works for a valid id and a second remove reports not found', () => {
      expect(call(IPC.companiesRemove, 'lever:zzmut')).toEqual({ ok: true })
      expect(hasId('lever:zzmut')).toBe(false)
      expect(call(IPC.companiesRemove, 'lever:zzmut')).toEqual({ ok: false, error: 'Company not found.' })
    })
    it('setEnabled rejects malformed ids', () => {
      for (const id of BAD_IDS) expect(call(IPC.companiesSetEnabled, id, true), String(id)).toEqual({ ok: false, error: 'Invalid company id.' })
    })
    it('setEnabled rejects non-boolean flags and changes nothing', () => {
      const before = fileText()
      for (const flag of [undefined, null, 0, 1, 'true', 'false', '', {}, [], [true]]) {
        expect(call(IPC.companiesSetEnabled, 'lever:zzmut', flag), String(flag)).toEqual({ ok: false, error: 'Invalid enabled flag.' })
      }
      expect(fileText()).toBe(before)
    })
    it('setEnabled toggles and persists; unknown id -> not found', () => {
      expect(call(IPC.companiesSetEnabled, 'lever:zzmut', false)).toEqual({ ok: true })
      expect(stored().find((c) => c.id === 'lever:zzmut')!.enabled).toBe(false)
      expect(call(IPC.companiesSetEnabled, 'lever:zzmut', true)).toEqual({ ok: true })
      expect(stored().find((c) => c.id === 'lever:zzmut')!.enabled).toBe(true)
      expect(call(IPC.companiesSetEnabled, 'lever:nope', true)).toEqual({ ok: false, error: 'Company not found.' })
    })
    it('with a corrupt file, remove/setEnabled return the file error (no throw) and leave the bytes alone', () => {
      writeFileSync(join(dir, COMPANIES_FILE), '[[[', 'utf8')
      const r1 = call(IPC.companiesRemove, 'lever:zzmut') as Res
      const r2 = call(IPC.companiesSetEnabled, 'lever:zzmut', false) as Res
      expect(r1.ok).toBe(false)
      expect(r1.error).toMatch(/unreadable/)
      expect(r2.ok).toBe(false)
      expect(r2.error).toMatch(/unreadable/)
      expect(fileText()).toBe('[[[')
    })
  })
})

describe('jobs:companyCounts', () => {
  const row = (id: string, company: string | null, visited = false): ScoredJob => ({
    source: 'greenhouse:x',
    externalId: id,
    title: id,
    company: company as string,
    url: 'https://e.com/' + id,
    description: null,
    location: null,
    country: 'IL',
    city: null,
    workMode: 'onsite',
    postedAt: null,
    score: visited ? 50 : 60,
    roles: []
  })
  it('groups by company over new + visited rows; empty DB -> {}', () => {
    expect(call(IPC.companyCounts)).toEqual({})
    upsertJobs(db, [row('1', 'A'), row('2', 'A'), row('3', 'B'), row('4', null)])
    expect(call(IPC.companyCounts)).toEqual({ A: 2, B: 1, '': 1 })
  })
  it('ignores args', () => {
    upsertJobs(db, [row('1', 'A')])
    expect(call(IPC.companyCounts, "'; DROP", {})).toEqual({ A: 1 })
  })
})
