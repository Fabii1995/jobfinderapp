import { describe, expect, it } from 'vitest'
import {
  cleanDroppedText,
  DROPPED_FILTER_OPTIONS,
  droppedLiveText,
  filterDropped,
  formatDroppedScore,
  formatDroppedTime,
  reasonLabel
} from './jsearch'
import type { DroppedJob } from './types'
import { stripHtmlLine } from '../../../shared/text'
import { DROPPED_REASONS } from '../../../shared/jsearch'

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0)
const mk = (reason: DroppedJob['reason'], title: string = reason): DroppedJob => ({
  title,
  company: 'Acme',
  location: 'Tel Aviv',
  reason,
  score: null,
  provider: 'jsearch',
  runAt: new Date(NOW).toISOString()
})
const LIST: DroppedJob[] = [mk('invalid', 'a'), mk('location', 'b'), mk('old', 'c'), mk('location', 'd'), mk('duplicate', 'e')]

describe('DROPPED_FILTER_OPTIONS / reasonLabel', () => {
  it('lists All first, then every reason exactly once, in spec order', () => {
    expect(DROPPED_FILTER_OPTIONS.map((o) => o.value)).toEqual(['all', 'location', 'old', 'noJuniorSignal', 'scoreTooLow', 'duplicate', 'invalid'])
    expect(DROPPED_FILTER_OPTIONS.map((o) => o.label)).toEqual(['All', 'Location', 'Too old', 'No junior signal', 'Score too low', 'Duplicate', 'Invalid'])
  })

  it('covers every shared DROPPED_REASON', () => {
    for (const r of DROPPED_REASONS) expect(DROPPED_FILTER_OPTIONS.some((o) => o.value === r)).toBe(true)
    expect(DROPPED_FILTER_OPTIONS).toHaveLength(DROPPED_REASONS.length + 1)
  })

  it('reasonLabel matches the select wording and falls back to the raw key', () => {
    for (const o of DROPPED_FILTER_OPTIONS) expect(reasonLabel(o.value)).toBe(o.label)
    expect(reasonLabel('mystery' as never)).toBe('mystery')
  })
})

describe('filterDropped', () => {
  it('all returns a copy of everything, in order', () => {
    const out = filterDropped(LIST, 'all')
    expect(out.map((d) => d.title)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(out).not.toBe(LIST)
  })

  it('filters by reason and keeps order', () => {
    expect(filterDropped(LIST, 'location').map((d) => d.title)).toEqual(['b', 'd'])
    expect(filterDropped(LIST, 'old').map((d) => d.title)).toEqual(['c'])
  })

  it('a reason with no rows gives []', () => {
    expect(filterDropped(LIST, 'scoreTooLow')).toEqual([])
  })

  it('null/undefined/non-array lists give []', () => {
    expect(filterDropped(null, 'all')).toEqual([])
    expect(filterDropped(undefined, 'location')).toEqual([])
    expect(filterDropped('x' as never, 'all')).toEqual([])
  })

  it('does not mutate the input', () => {
    const copy = JSON.stringify(LIST)
    filterDropped(LIST, 'location')
    expect(JSON.stringify(LIST)).toBe(copy)
  })
})

describe('formatDroppedScore', () => {
  it('rounds finite numbers', () => {
    expect(formatDroppedScore(72)).toBe('Score 72')
    expect(formatDroppedScore(72.6)).toBe('Score 73')
  })
  it('0 is a real score', () => {
    expect(formatDroppedScore(0)).toBe('Score 0')
  })
  it.each([[null], [undefined], [NaN], [Infinity], ['55' as never]])('%j -> No score', (v) => {
    expect(formatDroppedScore(v as number | null | undefined)).toBe('No score')
  })
})

describe('formatDroppedTime', () => {
  it('relative to now', () => {
    expect(formatDroppedTime(new Date(NOW).toISOString(), NOW)).toBe('just now')
    expect(formatDroppedTime(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toMatch(/3 hours ago/)
    expect(formatDroppedTime(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toMatch(/2 days ago/)
  })
  it.each([[''], ['not a date'], ['2026-13-45']])('unparseable %j -> empty string', (v) => {
    expect(formatDroppedTime(v, NOW)).toBe('')
  })
})

describe('cleanDroppedText', () => {
  it('strips markup and collapses to one line', () => {
    expect(cleanDroppedText('<b>Junior</b>\n  QA   &amp; Co')).toBe('Junior QA & Co')
    expect(cleanDroppedText('<script>alert(1)</script>Hi')).not.toMatch(/[<>]/)
  })
  it('matches stripHtmlLine for strings', () => {
    const s = '<i>x</i> &lt;b&gt;y&lt;/b&gt; z'
    expect(cleanDroppedText(s)).toBe(stripHtmlLine(s))
  })
  it('does not leave re-formed tags after entity decoding', () => {
    expect(cleanDroppedText('&lt;img src=x onerror=alert(1)&gt;ok')).not.toMatch(/<img/i)
  })
  it.each([[null], [undefined], [5], [{}], [[]]])('non-string %j -> empty', (v) => {
    expect(cleanDroppedText(v)).toBe('')
  })
})

describe('droppedLiveText', () => {
  it('plural, singular and zero', () => {
    expect(droppedLiveText(5, 5, 'all', true)).toBe('5 recently dropped jobs')
    expect(droppedLiveText(1, 1, 'all', false)).toBe('1 recently dropped job')
    expect(droppedLiveText(0, 0, 'all', true)).toBe('0 recently dropped jobs')
  })
  it('shows "Showing X of N" only while a filter is active and the panel is open', () => {
    expect(droppedLiveText(5, 2, 'location', true)).toBe('Showing 2 of 5 dropped jobs')
    expect(droppedLiveText(5, 2, 'location', false)).toBe('5 recently dropped jobs')
    expect(droppedLiveText(5, 5, 'all', true)).toBe('5 recently dropped jobs')
  })
  it('never prints NaN/undefined', () => {
    expect(droppedLiveText(3, 0, 'old', true)).not.toMatch(/NaN|undefined/)
  })
})
