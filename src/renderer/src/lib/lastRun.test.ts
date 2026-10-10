import { describe, expect, it } from 'vitest'
import { formatLastRun } from './jsearch'
import type { JSearchRunSummary } from './types'

const base: JSearchRunSummary = { fetched: 40, kept: 5, inserted: 3, updated: 2, skippedDuplicates: 20, requests: 6 }
const zeroDrops = { location: 0, old: 0, noJuniorSignal: 0, scoreTooLow: 0, duplicate: 0, invalid: 0 }
const bad = /NaN|undefined|null|\[object/

const all = (s: JSearchRunSummary, p?: 'jsearch' | 'serpapi' | null): string => {
  const r = formatLastRun(s, p)
  return `${r.headerTail} ${r.filtering ?? ''} ${r.kept}`
}

describe('formatLastRun: new summary', () => {
  it('formats header, filtering funnel and kept line', () => {
    const r = formatLastRun({
      ...base,
      provider: 'jsearch',
      seenSkipped: 12,
      dropped: { location: 8, old: 3, noJuniorSignal: 6, scoreTooLow: 4, duplicate: 2, invalid: 0 }
    })
    expect(r.headerTail).toBe(' via JSearch: 40 found, 6 requests.')
    expect(r.filtering).toBe('Skipped 12 already seen. Dropped: 8 location, 3 old, 6 no junior signal, 4 score too low, 2 duplicate.')
    expect(r.kept).toBe('Kept 5: 3 new, 2 updated.')
  })

  it('serpapi provider is named SerpApi', () => {
    expect(formatLastRun({ ...base, provider: 'serpapi', seenSkipped: 0, dropped: zeroDrops }).headerTail).toBe(
      ' via SerpApi: 40 found, 6 requests.'
    )
  })

  it('zero drops and zero seen -> filtering is null, kept line still shown', () => {
    const r = formatLastRun({ ...base, seenSkipped: 0, dropped: zeroDrops, provider: 'jsearch' })
    expect(r.filtering).toBeNull()
    expect(r.kept).toBe('Kept 5: 3 new, 2 updated.')
  })

  it('only non-zero reasons are listed, in fixed order regardless of key order', () => {
    const r = formatLastRun({
      ...base,
      seenSkipped: 0,
      dropped: { invalid: 1, duplicate: 2, scoreTooLow: 0, noJuniorSignal: 0, old: 4, location: 0 }
    })
    expect(r.filtering).toBe('Dropped: 4 old, 2 duplicate, 1 invalid.')
  })

  it('seen only (no drops) and drops only', () => {
    expect(formatLastRun({ ...base, seenSkipped: 9, dropped: zeroDrops }).filtering).toBe('Skipped 9 already seen.')
    expect(formatLastRun({ ...base, seenSkipped: 0, dropped: { ...zeroDrops, location: 2 } }).filtering).toBe('Dropped: 2 location.')
  })

  it('kept 0 still reads naturally', () => {
    const r = formatLastRun({ fetched: 0, kept: 0, inserted: 0, updated: 0, skippedDuplicates: 0, requests: 0, seenSkipped: 0, dropped: zeroDrops })
    expect(r.headerTail).toBe(': 0 found, 0 requests.')
    expect(r.filtering).toBeNull()
    expect(r.kept).toBe('Kept 0: 0 new, 0 updated.')
  })
})

describe('formatLastRun: provider fallback', () => {
  it('uses the summary provider over the fallback', () => {
    expect(formatLastRun({ ...base, provider: 'serpapi' }, 'jsearch').headerTail).toContain('via SerpApi')
  })
  it('uses fallbackProvider when the summary has none; omits "via" when neither', () => {
    expect(formatLastRun(base, 'jsearch').headerTail).toContain('via JSearch')
    expect(formatLastRun(base, null).headerTail).toBe(': 40 found, 6 requests.')
    expect(formatLastRun(base).headerTail).toBe(': 40 found, 6 requests.')
  })
})

describe('formatLastRun: old summary (no seenSkipped / dropped)', () => {
  it('falls back to a merged legacy line and no filtering line', () => {
    const r = formatLastRun(base)
    expect(r.filtering).toBeNull()
    expect(r.kept).toBe('5 kept, 3 new, 2 updated, 20 duplicates skipped.')
  })

  it('omits duplicates when skippedDuplicates is missing', () => {
    const { skippedDuplicates: _s, ...rest } = base
    void _s
    const r = formatLastRun(rest as unknown as JSearchRunSummary)
    expect(r.kept).toBe('5 kept, 3 new, 2 updated.')
    expect(all(rest as unknown as JSearchRunSummary)).not.toMatch(bad)
  })
})

describe('formatLastRun: partial / malformed fields', () => {
  it('seenSkipped present but dropped missing is treated as new format', () => {
    const r = formatLastRun({ ...base, seenSkipped: 4 })
    expect(r.filtering).toBe('Skipped 4 already seen.')
    expect(r.kept).toBe('Kept 5: 3 new, 2 updated.')
  })

  it('dropped present but seenSkipped missing is treated as new format', () => {
    const r = formatLastRun({ ...base, dropped: { ...zeroDrops, old: 2 } })
    expect(r.filtering).toBe('Dropped: 2 old.')
  })

  it('partial dropped object: missing, negative, NaN and string counts are ignored', () => {
    const r = formatLastRun({
      ...base,
      seenSkipped: 0,
      dropped: { location: 3, old: -1, noJuniorSignal: Number.NaN, scoreTooLow: '4' } as unknown as JSearchRunSummary['dropped']
    })
    expect(r.filtering).toBe('Dropped: 3 location.')
  })

  it('non-object dropped and garbage numbers never print NaN/undefined/null', () => {
    const weird = {
      fetched: Number.NaN,
      kept: undefined,
      inserted: -2,
      updated: 'x',
      skippedDuplicates: null,
      requests: Infinity,
      seenSkipped: Number.NaN,
      dropped: 'nope'
    } as unknown as JSearchRunSummary
    const r = formatLastRun(weird)
    expect(all(weird)).not.toMatch(bad)
    expect(r.headerTail).toBe(': 0 found, 0 requests.')
    expect(r.filtering).toBeNull()
    expect(r.kept).toBe('0 kept, 0 new, 0 updated.') // both new fields unusable -> legacy line
  })

  it('fractional counts are truncated', () => {
    expect(formatLastRun({ ...base, fetched: 7.9, seenSkipped: 2.7, dropped: zeroDrops }).headerTail).toBe(': 7 found, 6 requests.')
  })

  it.each([
    ['empty summary', {}],
    ['only dropped:null', { dropped: null }],
    ['only seenSkipped:null', { seenSkipped: null }]
  ])('%s does not crash or print junk', (_n, s) => {
    expect(() => formatLastRun(s as unknown as JSearchRunSummary)).not.toThrow()
    expect(all(s as unknown as JSearchRunSummary)).not.toMatch(bad)
  })
})
