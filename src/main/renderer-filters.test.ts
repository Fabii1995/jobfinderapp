import { describe, expect, it } from 'vitest'
// Pure renderer logic, tested under plain Node (no DOM). Lives here so the existing vitest include applies.
import {
  DEFAULT_FILTERS,
  WORK_MODE_OPTIONS,
  activeFilterCount,
  applyFilters,
  sanitizeFilters,
  type Filters
} from '../renderer/src/lib/filters'
import { ROLES } from '../shared/roles'
import type { Job } from '../shared/ipc'

const job = (o: Partial<Job> & { id: number }): Job => ({
  source: 'greenhouse:x',
  externalId: String(o.id),
  title: 'T' + o.id,
  company: 'Acme',
  url: 'https://e.com/' + o.id,
  description: null,
  location: null,
  country: 'IL',
  city: null,
  workMode: 'onsite',
  postedAt: null,
  score: 50,
  roles: [],
  firstSeenAt: 1,
  visitedAt: null,
  ...o
})
const ids = (js: Job[]): number[] => js.map((j) => j.id)
const f = (o: Partial<Filters> = {}): Filters => ({ ...DEFAULT_FILTERS, ...o })
const r0 = ROLES[0].slug
const r1 = ROLES[1].slug

const JOBS: Job[] = [
  job({ id: 1, company: 'Acme', workMode: 'onsite', score: 90, roles: [r0], title: 'QA Engineer', location: 'Tel Aviv' }),
  job({ id: 2, company: 'Beta', workMode: 'hybrid', score: 60, roles: [r1], title: 'Backend Dev', description: 'Python and SQL' }),
  job({ id: 3, company: 'Beta', workMode: null, score: 35, roles: [], title: 'Support' }),
  job({ id: 4, company: null, workMode: 'unknown', score: null, roles: null as unknown as Job['roles'], title: null }),
  job({ id: 5, company: 'Acme', workMode: 'remote', score: 100, roles: [r0, r1], title: 'Remote one' })
]

describe('applyFilters', () => {
  it('defaults keep everything in order and return a new array', () => {
    const out = applyFilters(JOBS, DEFAULT_FILTERS, '')
    expect(ids(out)).toEqual([1, 2, 3, 4, 5])
    expect(out).not.toBe(JOBS)
  })
  it('company filter is exact and null company only matches ""', () => {
    expect(ids(applyFilters(JOBS, f({ company: 'Beta' }), ''))).toEqual([2, 3])
    expect(ids(applyFilters(JOBS, f({ company: 'beta' }), ''))).toEqual([])
    expect(ids(applyFilters(JOBS, f({ company: 'Bet' }), ''))).toEqual([])
  })
  it('a stale persisted company (not in knownCompanies) is ignored, a known one applies', () => {
    expect(ids(applyFilters(JOBS, f({ company: 'Gone' }), '', ['Acme', 'Beta']))).toEqual([1, 2, 3, 4, 5])
    expect(ids(applyFilters(JOBS, f({ company: 'Acme' }), '', ['Acme', 'Beta']))).toEqual([1, 5])
    expect(ids(applyFilters(JOBS, f({ company: 'Gone' }), '', []))).toEqual([1, 2, 3, 4, 5])
  })
  it('work mode: null work_mode counts as unknown', () => {
    expect(ids(applyFilters(JOBS, f({ workMode: 'unknown' }), ''))).toEqual([3, 4])
    expect(ids(applyFilters(JOBS, f({ workMode: 'onsite' }), ''))).toEqual([1])
    expect(ids(applyFilters(JOBS, f({ workMode: 'hybrid' }), ''))).toEqual([2])
  })
  it('remote rows are only visible under "all" (there is no remote option)', () => {
    expect(WORK_MODE_OPTIONS.map((o) => o.value)).not.toContain('remote')
    expect(ids(applyFilters(JOBS, f(), ''))).toContain(5)
    for (const wm of ['onsite', 'hybrid', 'unknown'] as const) expect(ids(applyFilters(JOBS, f({ workMode: wm }), ''))).not.toContain(5)
  })
  it('roles: OR within roles, tolerant of null roles', () => {
    expect(ids(applyFilters(JOBS, f({ roles: [r0] }), ''))).toEqual([1, 5])
    expect(ids(applyFilters(JOBS, f({ roles: [r0, r1] }), ''))).toEqual([1, 2, 5])
    expect(ids(applyFilters(JOBS, f({ roles: [r1] }), ''))).toEqual([2, 5])
  })
  it('minScore: inclusive threshold, null score counts as 0', () => {
    expect(ids(applyFilters(JOBS, f({ minScore: 30 }), ''))).toEqual([1, 2, 3, 5])
    expect(ids(applyFilters(JOBS, f({ minScore: 50 }), ''))).toEqual([1, 2, 5])
    expect(ids(applyFilters(JOBS, f({ minScore: 70 }), ''))).toEqual([1, 5])
    expect(ids(applyFilters(JOBS, f({ minScore: 0 }), ''))).toEqual([1, 2, 3, 4, 5])
  })
  it('search: case-insensitive over title, company, location, description; trims; null fields safe', () => {
    expect(ids(applyFilters(JOBS, f(), 'qa'))).toEqual([1])
    expect(ids(applyFilters(JOBS, f(), '  PYTHON  '))).toEqual([2])
    expect(ids(applyFilters(JOBS, f(), 'tel aviv'))).toEqual([1])
    expect(ids(applyFilters(JOBS, f(), 'beta'))).toEqual([2, 3])
    expect(ids(applyFilters(JOBS, f(), 'zzz'))).toEqual([])
    expect(ids(applyFilters(JOBS, f(), '   '))).toEqual([1, 2, 3, 4, 5])
  })
  it('search is a plain substring, not a regex', () => {
    expect(ids(applyFilters(JOBS, f(), '.*'))).toEqual([])
    expect(ids(applyFilters([job({ id: 9, title: 'C++ (Linux) dev' })], f(), 'c++ ('))).toEqual([9])
  })
  it('filters combine with AND', () => {
    expect(ids(applyFilters(JOBS, f({ company: 'Acme', roles: [r0], minScore: 70 }), ''))).toEqual([1, 5])
    expect(ids(applyFilters(JOBS, f({ company: 'Acme', roles: [r0], workMode: 'onsite' }), 'qa'))).toEqual([1])
    expect(ids(applyFilters(JOBS, f({ company: 'Acme', workMode: 'hybrid' }), ''))).toEqual([])
  })
  it('never mutates the input jobs (visitedAt untouched) and works on empty input', () => {
    const copy = JSON.stringify(JOBS)
    applyFilters(JOBS, f({ company: 'Acme', minScore: 50 }), 'x')
    expect(JSON.stringify(JOBS)).toBe(copy)
    expect(applyFilters([], f({ company: 'Acme' }), 'x')).toEqual([])
  })
  it('hostile search/company strings are just text', () => {
    for (const s of ["'; DROP TABLE jobs;--", '<script>alert(1)</script>', '../../etc', '\u0000', 'a'.repeat(100000)]) {
      expect(() => applyFilters(JOBS, f({ company: s }), s)).not.toThrow()
      expect(applyFilters(JOBS, f(), s)).toEqual([])
    }
  })
})

describe('sanitizeFilters', () => {
  it('garbage in -> defaults', () => {
    for (const v of [undefined, null, 5, 'x', [], {}, true]) expect(sanitizeFilters(v)).toEqual(DEFAULT_FILTERS)
  })
  it('keeps valid values', () => {
    expect(sanitizeFilters({ company: 'Acme', workMode: 'hybrid', roles: [r0], minScore: 50 })).toEqual({
      company: 'Acme',
      workMode: 'hybrid',
      roles: [r0],
      minScore: 50
    })
  })
  it('drops invalid pieces independently', () => {
    expect(sanitizeFilters({ company: '', workMode: 'remote', roles: ['nope', r1, 5, null], minScore: 45 })).toEqual({
      company: null,
      workMode: 'all',
      roles: [r1],
      minScore: 0
    })
    expect(sanitizeFilters({ company: 'x'.repeat(201) }).company).toBeNull()
    expect(sanitizeFilters({ company: 'x'.repeat(200) }).company).toHaveLength(200)
    expect(sanitizeFilters({ company: 5, roles: 'qa', workMode: ['onsite'], minScore: '50' })).toEqual(DEFAULT_FILTERS)
  })
  it('workMode "all" and each option survive; prototype pollution payloads are inert', () => {
    for (const o of WORK_MODE_OPTIONS) expect(sanitizeFilters({ workMode: o.value }).workMode).toBe(o.value)
    const out = sanitizeFilters(JSON.parse('{"__proto__":{"company":"x"},"constructor":{"x":1},"minScore":70}'))
    expect(out).toEqual({ ...DEFAULT_FILTERS, minScore: 70 })
    expect(({} as Record<string, unknown>).company).toBeUndefined()
  })
})

describe('activeFilterCount', () => {
  it('counts each active dimension once, search included', () => {
    expect(activeFilterCount(DEFAULT_FILTERS, '')).toBe(0)
    expect(activeFilterCount(f({ company: 'A' }), '')).toBe(1)
    expect(activeFilterCount(f({ roles: [r0, r1] }), '')).toBe(1)
    expect(activeFilterCount(f({ company: 'A', workMode: 'onsite', roles: [r0], minScore: 30 }), 'q')).toBe(5)
    expect(activeFilterCount(DEFAULT_FILTERS, '   ')).toBe(0)
  })
})
