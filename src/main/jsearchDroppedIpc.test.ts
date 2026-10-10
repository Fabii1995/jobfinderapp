import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../shared/ipc'
import type { JSearchService } from './sources/jsearch'

vi.mock('electron', async () => (await import('./testing/electron')).electronMock())

import { handlers } from './testing/electron'
import { createDeepRunner, registerJSearchIpc, sanitizeDroppedList } from './jsearchIpc'

const RUN_AT = '2026-10-08T12:00:00.000Z'
const row = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: 'Junior QA',
  company: 'Acme',
  location: 'Tel Aviv',
  reason: 'location',
  score: 55,
  provider: 'jsearch',
  runAt: RUN_AT,
  ...o
})

describe('sanitizeDroppedList', () => {
  it.each([[null], [undefined], ['x'], [42], [{}], [{ length: 3 }]])('non-array %j -> []', (v) => {
    expect(sanitizeDroppedList(v)).toEqual([])
  })

  it('passes a valid row through unchanged', () => {
    expect(sanitizeDroppedList([row()])).toEqual([row()])
  })

  it('keeps all six reasons and both providers', () => {
    const reasons = ['location', 'old', 'noJuniorSignal', 'scoreTooLow', 'duplicate', 'invalid']
    const out = sanitizeDroppedList(reasons.map((r, i) => row({ reason: r, provider: i % 2 ? 'serpapi' : 'jsearch' })))
    expect(out.map((d) => d.reason)).toEqual(reasons)
    expect(out.map((d) => d.provider)).toEqual(['jsearch', 'serpapi', 'jsearch', 'serpapi', 'jsearch', 'serpapi'])
  })

  it.each([
    ['unknown reason', { reason: 'bogus' }],
    ['non-string reason', { reason: 3 }],
    ['missing reason', { reason: undefined }],
    ['prototype-ish reason', { reason: 'constructor' }],
    ['unknown provider', { provider: 'linkedin' }],
    ['missing provider', { provider: undefined }],
    ['missing runAt', { runAt: undefined }],
    ['non-string runAt', { runAt: 12345 }],
    ['unparseable runAt', { runAt: 'yesterday-ish' }]
  ])('skips a row with %s, keeps the neighbours', (_n, patch) => {
    const out = sanitizeDroppedList([row({ company: 'A' }), row(patch), row({ company: 'B' })])
    expect(out.map((d) => d.company)).toEqual(['A', 'B'])
  })

  it.each([[null], [undefined], ['str'], [7], [true]])('skips non-object entry %j', (e) => {
    expect(sanitizeDroppedList([e, row()])).toHaveLength(1)
  })

  it('strips HTML from title, company and location', () => {
    const [d] = sanitizeDroppedList([
      row({ title: '<b>Junior</b> <script>alert(1)</script>QA &amp; Co', company: '<i>Acme</i>', location: '<p>Tel   Aviv</p>' })
    ])
    for (const f of [d.title, d.company, d.location]) expect(f).not.toMatch(/[<>]/)
    expect(d.company).toBe('Acme')
    expect(d.location).toBe('Tel Aviv')
    expect(d.title).toContain('Junior')
    expect(d.title).toContain('& Co')
  })

  it('does not let entity-encoded markup survive decoding', () => {
    const [d] = sanitizeDroppedList([row({ title: '&lt;script&gt;alert(1)&lt;/script&gt;Hello' })])
    expect(d.title).not.toMatch(/<\/?script/i)
    expect(d.title).toContain('Hello')
  })

  it('collapses whitespace/control characters to one line', () => {
    const [d] = sanitizeDroppedList([row({ title: 'A\n\n\tB\u0000C   D' })])
    expect(d.title).toBe('A B C D')
  })

  it('truncates every text field to 160 characters', () => {
    const [d] = sanitizeDroppedList([row({ title: 'T'.repeat(500), company: 'C'.repeat(161), location: 'L'.repeat(160) })])
    expect(d.title).toHaveLength(160)
    expect(d.company).toHaveLength(160)
    expect(d.location).toHaveLength(160)
  })

  it('non-string text fields become empty strings, row is kept', () => {
    const [d] = sanitizeDroppedList([row({ title: 5, company: null, location: { a: 1 } })])
    expect(d).toMatchObject({ title: '', company: '', location: '' })
  })

  it('score: finite numbers kept (0 included), everything else null', () => {
    const out = sanitizeDroppedList([
      row({ score: 0 }),
      row({ score: 72.5 }),
      row({ score: NaN }),
      row({ score: Infinity }),
      row({ score: -Infinity }),
      row({ score: '55' }),
      row({ score: null }),
      row({ score: undefined })
    ])
    expect(out.map((d) => d.score)).toEqual([0, 72.5, null, null, null, null, null, null])
  })

  it('caps at 100 and keeps the first 100 (service order is newest first)', () => {
    const rows = Array.from({ length: 250 }, (_, i) => row({ title: `t${i}` }))
    const out = sanitizeDroppedList(rows)
    expect(out).toHaveLength(100)
    expect(out[0].title).toBe('t0')
    expect(out[99].title).toBe('t99')
  })

  it('invalid rows do not count against the cap', () => {
    const rows = [...Array.from({ length: 50 }, () => row({ reason: 'bad' })), ...Array.from({ length: 120 }, (_, i) => row({ title: `t${i}` }))]
    expect(sanitizeDroppedList(rows)).toHaveLength(100)
  })

  it('returns only the DroppedJob fields (extra properties such as a url or key are dropped)', () => {
    const [d] = sanitizeDroppedList([row({ url: 'https://x', apiKey: 'sekret-key-123', description: 'long text' })])
    expect(Object.keys(d).sort()).toEqual(['company', 'location', 'provider', 'reason', 'runAt', 'score', 'title'])
    expect(JSON.stringify(d)).not.toContain('sekret')
  })

  it('does not mutate its input', () => {
    const input = [row({ title: '<b>x</b>' })]
    const snap = JSON.stringify(input)
    sanitizeDroppedList(input)
    expect(JSON.stringify(input)).toBe(snap)
  })
})

describe('registerJSearchIpc: jsearch:droppedList', () => {
  const call = (...a: unknown[]): unknown => handlers.get(IPC.jsearchDroppedList)!({}, ...a)
  const setup = (getDroppedList: () => unknown): { svc: Record<string, unknown> } => {
    const svc = { getDroppedList: vi.fn(getDroppedList), runDeepRefresh: vi.fn(), clearSeen: vi.fn() }
    const s = svc as unknown as JSearchService
    registerJSearchIpc(s, createDeepRunner(s, vi.fn()))
    return { svc }
  }

  beforeEach(() => {
    handlers.clear()
  })

  it('channel name', () => {
    expect(IPC.jsearchDroppedList).toBe('jsearch:droppedList')
    setup(() => [])
    expect(handlers.has('jsearch:droppedList')).toBe(true)
  })

  it('returns the sanitized service list without touching other service methods', () => {
    const { svc } = setup(() => [row({ title: '<b>Hi</b>', score: NaN }), row({ reason: 'nope' })])
    const out = call() as unknown[]
    expect(out).toEqual([row({ title: 'Hi', score: null })])
    expect(svc.getDroppedList).toHaveBeenCalledTimes(1)
    expect(svc.runDeepRefresh).not.toHaveBeenCalled()
    expect(svc.clearSeen).not.toHaveBeenCalled()
  })

  it.each([[1], ['x'], [undefined], [null], [{}], [1, 2]])('called with args %j -> [] and service untouched', (...args) => {
    const { svc } = setup(() => [row()])
    expect(call(...args)).toEqual([])
    expect(svc.getDroppedList).not.toHaveBeenCalled()
  })

  it('a throwing service yields [] with no error text', () => {
    setup(() => {
      throw new Error('boom with secret-key-xyz')
    })
    const r = call()
    expect(r).toEqual([])
    expect(JSON.stringify(r)).not.toContain('secret')
  })

  it('a service returning garbage yields []', () => {
    setup(() => 'not a list')
    expect(call()).toEqual([])
  })

  it('is read-only: exactly one dropped-list channel, no write/clear channel exists', () => {
    setup(() => [])
    const names = [...handlers.keys()].filter((k) => /dropped/i.test(k))
    expect(names).toEqual(['jsearch:droppedList'])
  })
})
