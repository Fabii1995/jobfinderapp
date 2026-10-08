import { describe, expect, it } from 'vitest'
import { isDeepSearchJob, isJSearchJob, isLinkedInJob, isLinkedInUrl, isSerpapiJob, nextMonthStart, providerName } from './jsearch'
import { sourceLabel } from './sources'

describe('isLinkedInUrl', () => {
  it.each([
    'https://linkedin.com/jobs/view/1',
    'https://www.linkedin.com/jobs/view/1',
    'https://il.linkedin.com/jobs/view/1',
    'HTTPS://WWW.LINKEDIN.COM/x'
  ])('true for %s', (u) => expect(isLinkedInUrl(u)).toBe(true))

  it.each([
    'https://notlinkedin.com/x',
    'https://linkedin.com.evil.io/x',
    'https://evil.io/?u=https://linkedin.com',
    'https://evil.io/linkedin.com',
    'https://user@evil.io/',
    'not a url',
    '',
    null,
    undefined
  ])('false for %s', (u) => expect(isLinkedInUrl(u as string | null | undefined)).toBe(false))
})

describe('isJSearchJob / isLinkedInJob', () => {
  it('requires a jsearch source and a LinkedIn host', () => {
    expect(isJSearchJob({ source: 'jsearch' })).toBe(true)
    expect(isJSearchJob({ source: 'greenhouse:x' })).toBe(false)
    expect(isLinkedInJob({ source: 'jsearch', url: 'https://www.linkedin.com/jobs/1' })).toBe(true)
    expect(isLinkedInJob({ source: 'greenhouse:x', url: 'https://www.linkedin.com/jobs/1' })).toBe(false)
    expect(isLinkedInJob({ source: 'jsearch', url: 'https://acme.com/1' })).toBe(false)
  })
})

describe('nextMonthStart', () => {
  it('returns the first of the next month (UTC)', () => {
    expect(nextMonthStart('2026-10')).toBe(Date.UTC(2026, 10, 1))
    expect(nextMonthStart('2026-01')).toBe(Date.UTC(2026, 1, 1))
  })
  it('rolls December into next year', () => {
    expect(nextMonthStart('2026-12')).toBe(Date.UTC(2027, 0, 1))
  })
  it.each(['', '2026-1', '26-10', '2026/10', 'garbage'])('null for unparseable %j', (m) => {
    expect(nextMonthStart(m)).toBeNull()
  })
})

describe('isSerpapiJob / isDeepSearchJob', () => {
  it('isSerpapiJob only for serpapi sources', () => {
    expect(isSerpapiJob({ source: 'serpapi' })).toBe(true)
    expect(isSerpapiJob({ source: 'jsearch' })).toBe(false)
    expect(isSerpapiJob({ source: 'greenhouse:x' })).toBe(false)
  })
  it('isDeepSearchJob is true for jsearch and serpapi, false for ATS sources', () => {
    expect(isDeepSearchJob({ source: 'jsearch' })).toBe(true)
    expect(isDeepSearchJob({ source: 'serpapi' })).toBe(true)
    expect(isDeepSearchJob({ source: 'comeet:acme' })).toBe(false)
    expect(isDeepSearchJob({ source: '' })).toBe(false)
  })
  it('isJSearchJob stays false for serpapi', () => {
    expect(isJSearchJob({ source: 'serpapi' })).toBe(false)
  })
})

describe('isLinkedInJob with serpapi source', () => {
  it('badge only when the host is linkedin.com', () => {
    expect(isLinkedInJob({ source: 'serpapi', url: 'https://www.linkedin.com/jobs/view/1' })).toBe(true)
    expect(isLinkedInJob({ source: 'serpapi', url: 'https://il.linkedin.com/jobs/view/1' })).toBe(true)
    expect(isLinkedInJob({ source: 'serpapi', url: 'https://acme.com/careers/1' })).toBe(false)
    expect(isLinkedInJob({ source: 'serpapi', url: 'https://linkedin.com.evil.io/x' })).toBe(false)
    expect(isLinkedInJob({ source: 'serpapi', url: 'https://evil.io/?u=linkedin.com' })).toBe(false)
    expect(isLinkedInJob({ source: 'greenhouse:x', url: 'https://www.linkedin.com/jobs/1' })).toBe(false)
  })
})

describe('providerName / sourceLabel', () => {
  it('providerName', () => {
    expect(providerName('serpapi')).toBe('SerpApi')
    expect(providerName('jsearch')).toBe('JSearch')
  })
  it('sourceLabel maps the aggregator sources', () => {
    expect(sourceLabel('serpapi')).toBe('SerpApi')
    expect(sourceLabel('jsearch')).toBe('JSearch')
  })
})
