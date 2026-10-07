import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchJson, postJson } from '../sources/http'

type Handler = (url: string) => Response | Promise<Response>
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>
function stubFetch(h: Handler): void {
  fetchMock = vi.fn((url: string | URL) => Promise.resolve(h(String(url))))
  vi.stubGlobal('fetch', fetchMock)
}
afterEach(() => vi.unstubAllGlobals())

describe('fetchJson', () => {
  it('throws a clear error on HTTP 500 and 404', async () => {
    for (const s of [500, 404]) {
      stubFetch(() => new Response('nope', { status: s, statusText: 'X' }))
      await expect(fetchJson('https://a.test/x')).rejects.toThrow(new RegExp(`HTTP ${s}`))
    }
  })
  it('rejects on malformed JSON', async () => {
    stubFetch(() => new Response('{not json', { status: 200 }))
    await expect(fetchJson('https://a.test/x')).rejects.toThrow()
  })
  it('propagates network errors and timeouts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(fetchJson('https://a.test/x')).rejects.toThrow('fetch failed')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    )
    await expect(fetchJson('https://a.test/x')).rejects.toThrow('timed out')
  })
  it('passes an abort signal (timeout) and a User-Agent', async () => {
    stubFetch(() => json({}))
    await fetchJson('https://a.test/x')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/JobFinderApp/)
  })
})

describe('postJson', () => {
  it('POSTs a JSON body and throws on non-2xx', async () => {
    stubFetch(() => json({ ok: 1 }))
    expect(await postJson('https://a.test/x', { a: 1 })).toEqual({ ok: 1 })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"a":1}')
    stubFetch(() => new Response('no', { status: 500, statusText: 'Boom' }))
    await expect(postJson('https://a.test/x', {})).rejects.toThrow(/HTTP 500/)
  })
})
