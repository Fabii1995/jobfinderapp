import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectAtsFromUrl, parseComeetVar, resolveComeetParams } from './detect'
import { LEGACY_SEED_IDS, seedCompanies } from './seeds'
import {
  COMPANIES_FILE,
  addCompany,
  loadCompanies,
  removeCompany,
  setCompanyEnabled
} from './store'
import { makeCompanyEntry } from './validate'

describe('detectAtsFromUrl', () => {
  it('greenhouse variants', () => {
    for (const u of [
      'https://boards.greenhouse.io/wizinc',
      'https://job-boards.greenhouse.io/wizinc/jobs/123',
      'https://job-boards.eu.greenhouse.io/wizinc',
      'https://boards.greenhouse.io/embed/job_board?for=wizinc'
    ]) {
      expect(detectAtsFromUrl(u), u).toEqual({ ats: 'greenhouse', params: { token: 'wizinc' } })
    }
  })
  it('lever, ashby, smartrecruiters', () => {
    expect(detectAtsFromUrl('https://jobs.lever.co/cloudinary/abc-123')).toEqual({ ats: 'lever', params: { slug: 'cloudinary' } })
    expect(detectAtsFromUrl('https://jobs.eu.lever.co/acme')).toEqual({ ats: 'lever', params: { slug: 'acme', region: 'eu' } })
    expect(detectAtsFromUrl('https://jobs.ashbyhq.com/ashby')).toEqual({ ats: 'ashby', params: { name: 'ashby' } })
    expect(detectAtsFromUrl('https://careers.smartrecruiters.com/ServiceNow')).toEqual({
      ats: 'smartrecruiters',
      params: { id: 'ServiceNow' }
    })
  })
  it('workday host/tenant/site, skipping the locale segment', () => {
    const want = { ats: 'workday', params: { host: 'nvidia.wd5.myworkdayjobs.com', tenant: 'nvidia', site: 'NVIDIAExternalCareerSite' } }
    expect(detectAtsFromUrl('https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite')).toEqual(want)
    expect(detectAtsFromUrl('https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/x')).toEqual(want)
  })
  it('comeet needs a fetch', () => {
    expect(detectAtsFromUrl('https://www.comeet.com/jobs/pentera/C5.00D')).toMatchObject({ ats: 'comeet', needsFetch: true })
  })
  it('hostname is parsed, not substring-matched; junk returns null', () => {
    expect(detectAtsFromUrl('https://evil.example/boards.greenhouse.io/wizinc')).toBeNull()
    expect(detectAtsFromUrl('https://boards.greenhouse.io.evil.com/wizinc')).toBeNull()
    expect(detectAtsFromUrl('https://evilmyworkdayjobs.com/x')).toBeNull()
    expect(detectAtsFromUrl('javascript:alert(1)')).toBeNull()
    expect(detectAtsFromUrl('not a url')).toBeNull()
    expect(detectAtsFromUrl('https://boards.greenhouse.io/')).toBeNull()
  })
  it('parses comeetvar and resolves via an injected fetcher', async () => {
    const html = 'var comeetvar = {"comeet_token":"5CD1D013435289B343501D012E682E68289B","comeet_uid":"C5.00D"};'
    expect(parseComeetVar(html)).toEqual({ uid: 'C5.00D', token: '5CD1D013435289B343501D012E682E68289B' })
    expect(await resolveComeetParams('https://pentera.io/careers', async () => html)).toMatchObject({ uid: 'C5.00D' })
    await expect(resolveComeetParams('https://x.test/', async () => '<html/>')).rejects.toThrow(/comeetvar/)
  })
})

describe('companies store', () => {
  const dirs: string[] = []
  const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'jf-co-'))
    dirs.push(d)
    return d
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('seeds on first run and ids follow the ats:identifier scheme', () => {
    const dir = tmp()
    const r = loadCompanies(dir)
    expect(r.seeded).toBe(true)
    expect(existsSync(join(dir, COMPANIES_FILE))).toBe(true)
    const ids = r.companies.map((c) => c.id)
    expect(ids).toContain('greenhouse:wizinc')
    expect(ids).toContain('amazon')
    expect(ids).toContain('workday:nvidia')
    expect(ids).toContain('comeet:c5.00d')
    expect(new Set(ids).size).toBe(ids.length)
    // every seed is enabled except SQLink (Cloudflare challenge, off by default)
    expect(r.companies.length).toBe(37)
    expect(r.companies.find((c) => c.id === 'sqlink')?.enabled).toBe(false)
    expect(r.companies.filter((c) => c.enabled).length).toBe(36)
    expect(r.companies.filter((c) => !c.enabled).map((c) => c.id)).toEqual(['sqlink'])
    const disk = JSON.parse(readFileSync(join(dir, COMPANIES_FILE), 'utf8')) as { companies: { id: string; enabled: boolean }[] }
    expect(disk.companies.find((c) => c.id === 'sqlink')?.enabled).toBe(false)
  })

  it('never overwrites user edits on a later load', () => {
    const dir = tmp()
    loadCompanies(dir)
    removeCompany(dir, 'greenhouse:wizinc')
    setCompanyEnabled(dir, 'amazon', false)
    addCompany(dir, { name: 'Acme', ats: 'lever', params: { slug: 'acme' } })
    const again = loadCompanies(dir).companies
    expect(again.find((c) => c.id === 'greenhouse:wizinc')).toBeUndefined()
    expect(again.find((c) => c.id === 'amazon')?.enabled).toBe(false)
    expect(again.find((c) => c.id === 'lever:acme')).toBeTruthy()
    expect(again.filter((c) => c.enabled).find((c) => c.id === 'amazon')).toBeUndefined()
  })

  it('rejects duplicates and invalid params', () => {
    const dir = tmp()
    loadCompanies(dir)
    expect(() => addCompany(dir, { name: 'W', ats: 'greenhouse', params: { token: 'wizinc' } })).toThrow(/already/)
    expect(() => addCompany(dir, { name: 'X', ats: 'greenhouse', params: { token: '../etc' } })).toThrow(/invalid/)
    expect(() => addCompany(dir, { name: 'X', ats: 'workday', params: { host: 'evil.com', tenant: 'a', site: 'b' } })).toThrow(/invalid/)
    expect(() => addCompany(dir, { name: 'X', ats: 'nope', params: {} })).toThrow(/unknown ats/)
  })

  it('a corrupt file is not overwritten: seeds in memory + error, mutations refuse', () => {
    const dir = tmp()
    const file = join(dir, COMPANIES_FILE)
    writeFileSync(file, '{not json')
    const r = loadCompanies(dir)
    expect(r.error).toBeTruthy()
    expect(r.companies.length).toBe(seedCompanies().length)
    expect(() => removeCompany(dir, 'amazon')).toThrow()
    expect(readFileSync(file, 'utf8')).toBe('{not json')
  })

  describe('additive seed merge', () => {
    const newIds = (): string[] => seedCompanies().map((c) => c.id).filter((id) => !LEGACY_SEED_IDS.includes(id))
    const legacyFile = (dir: string, ids: readonly string[]): string => {
      const file = join(dir, COMPANIES_FILE)
      const companies = seedCompanies().filter((c) => ids.includes(c.id))
      writeFileSync(file, JSON.stringify({ version: 1, companies }))
      return file
    }
    const onDisk = (file: string): { companies: { id: string; enabled?: boolean }[]; seedsApplied?: string[] } =>
      JSON.parse(readFileSync(file, 'utf8'))

    it('legacy list is 26 ids, all still in seeds; 11 new', () => {
      const all = seedCompanies().map((c) => c.id)
      expect(LEGACY_SEED_IDS.length).toBe(26)
      expect(LEGACY_SEED_IDS.every((id) => all.includes(id))).toBe(true)
      expect(newIds().length).toBe(11)
      expect(newIds()).toContain('sqlink')
    })

    it('fresh install records every seed in seedsApplied', () => {
      const dir = tmp()
      loadCompanies(dir)
      expect(onDisk(join(dir, COMPANIES_FILE)).seedsApplied?.sort()).toEqual(seedCompanies().map((c) => c.id).sort())
    })

    it('legacy file without seedsApplied gets only the new seeds; removed legacy seed stays removed', () => {
      const dir = tmp()
      const kept = LEGACY_SEED_IDS.filter((id) => id !== 'greenhouse:wizinc')
      const file = legacyFile(dir, kept)
      const r = loadCompanies(dir)
      const ids = r.companies.map((c) => c.id)
      expect(ids).not.toContain('greenhouse:wizinc')
      for (const id of newIds()) expect(ids).toContain(id)
      expect(ids.length).toBe(kept.length + 11)
      expect(r.companies.filter((c) => newIds().includes(c.id) && c.id !== 'sqlink').every((c) => c.enabled)).toBe(true)
      expect(r.companies.find((c) => c.id === 'sqlink')?.enabled).toBe(false)
      expect(onDisk(file).companies.find((c) => c.id === 'sqlink')?.enabled).toBe(false)
      expect(onDisk(file).seedsApplied?.length).toBe(seedCompanies().length)
    })

    it('a seed removed after being applied is never re-added', () => {
      const dir = tmp()
      loadCompanies(dir)
      removeCompany(dir, 'sqlink')
      expect(loadCompanies(dir).companies.some((c) => c.id === 'sqlink')).toBe(false)
      expect(onDisk(join(dir, COMPANIES_FILE)).seedsApplied).toContain('sqlink')
    })

    it('an existing enabled sqlink entry stays enabled through the merge', () => {
      const dir = tmp()
      const file = join(dir, COMPANIES_FILE)
      const on = { ...seedCompanies().find((c) => c.id === 'sqlink')!, enabled: true }
      // legacy file (no seedsApplied) and a file that already lists sqlink as applied
      writeFileSync(file, JSON.stringify({ version: 1, companies: [on] }))
      expect(loadCompanies(dir).companies.find((c) => c.id === 'sqlink')?.enabled).toBe(true)
      expect(onDisk(file).companies.find((c) => c.id === 'sqlink')?.enabled).toBe(true)
      writeFileSync(file, JSON.stringify({ version: 1, companies: [on], seedsApplied: ['sqlink'] }))
      expect(loadCompanies(dir).companies.find((c) => c.id === 'sqlink')?.enabled).toBe(true)
    })

    it('preserves edits and non-seed entries while merging', () => {
      const dir = tmp()
      const file = join(dir, COMPANIES_FILE)
      const edited = { ...seedCompanies().find((c) => c.id === 'amazon')!, name: 'My Amazon', enabled: false }
      const custom = makeCompanyEntry({ name: 'Acme', ats: 'lever', params: { slug: 'acme' } })
      writeFileSync(file, JSON.stringify({ version: 1, companies: [edited, custom] }))
      const r = loadCompanies(dir)
      expect(r.companies.find((c) => c.id === 'amazon')).toMatchObject({ name: 'My Amazon', enabled: false })
      expect(r.companies.find((c) => c.id === 'lever:acme')).toBeTruthy()
      expect(r.companies.some((c) => c.id === 'sqlink')).toBe(true)
    })

    it('is idempotent and mutations keep seedsApplied', () => {
      const dir = tmp()
      const file = legacyFile(dir, LEGACY_SEED_IDS)
      loadCompanies(dir)
      const first = readFileSync(file, 'utf8')
      loadCompanies(dir)
      expect(readFileSync(file, 'utf8')).toBe(first)
      setCompanyEnabled(dir, 'amazon', false)
      expect(onDisk(file).seedsApplied?.length).toBe(seedCompanies().length)
    })

    it('a corrupt file with seeds pending is left untouched', () => {
      const dir = tmp()
      const file = join(dir, COMPANIES_FILE)
      writeFileSync(file, '{"companies": [')
      expect(loadCompanies(dir).error).toBeTruthy()
      expect(readFileSync(file, 'utf8')).toBe('{"companies": [')
    })
  })

  it('makeCompanyEntry derives the id (ignores any supplied id)', () => {
    expect(makeCompanyEntry({ name: 'N', ats: 'workday', params: { host: 'a.wd1.myworkdayjobs.com', tenant: 'T', site: 'S' } }).id).toBe('workday:t')
  })
})
