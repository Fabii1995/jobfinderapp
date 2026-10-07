import type { Http } from './types'

export const USER_AGENT = 'JobFinderApp/0.1 (personal job-finder desktop app; keyless public ATS APIs)'
export const FETCH_TIMEOUT_MS = 20_000

/** fetch with ONE retry after a short pause on a network-level failure (connection reset, timeout). HTTP statuses are never retried. */
async function fetchRetry(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    await new Promise((r) => setTimeout(r, 400))
    return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  }
}

/** GET a URL and parse JSON. Throws on network error, timeout, non-2xx, or bad JSON. */
export async function fetchJson(url: string): Promise<unknown> {
  const res = await fetchRetry(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`)
  return res.json()
}

/** POST a JSON body and parse the JSON reply. Same failure behavior as fetchJson. */
export async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetchRetry(url, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`)
  return res.json()
}

/** GET a URL as text (used to read a careers page). Same failure behavior as fetchJson. */
export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`)
  return res.text()
}

export const defaultHttp: Http = { getJson: fetchJson, postJson, getText: fetchText }

export const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()

/** Runs fn over items with at most `limit` in flight; results keep input order. fn must not throw. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

/** Code point -> string; invalid, out-of-range, NUL, or surrogate values become U+FFFD. Never throws. */
function safeCodePoint(cp: number): string {
  if (!Number.isInteger(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
    return '�'
  }
  return String.fromCodePoint(cp)
}

/**
 * Replaces each <script>/<style> block (opener through its closing tag) with a space.
 * Linear: one forward pass; each closer search resumes from a cached position, and once a
 * type has no closer left, the unclosed opener drops everything to end of input (as a browser
 * would) instead of rescanning per opener. Case-insensitive, same as the old lazy regex.
 */
function removeScriptStyleBlocks(html: string): string {
  const openers = /<(script|style)/gi
  const closers = { script: /<\/script>/gi, style: /<\/style>/gi }
  const nextCloser = { script: -2, style: -2 } // -2 = not searched yet, -1 = none remains
  let out = ''
  let pos = 0
  let m: RegExpExecArray | null
  while ((m = openers.exec(html)) !== null) {
    const type = m[1].toLowerCase() as 'script' | 'style'
    const from = m.index + m[0].length
    if (nextCloser[type] !== -1 && nextCloser[type] < from) {
      const re = closers[type]
      re.lastIndex = from
      const c = re.exec(html)
      nextCloser[type] = c ? c.index : -1
    }
    out += html.slice(pos, m.index) + ' '
    if (nextCloser[type] === -1) return out // unclosed: drop to end of input
    pos = nextCloser[type] + type.length + 3 // length of "</" + type + ">"
    openers.lastIndex = pos
  }
  return out + html.slice(pos)
}

/** Strips HTML to readable plain text (block tags become newlines, entities decoded). */
export function stripHtml(html: string): string {
  return removeScriptStyleBlocks(html)
    .replace(/<\s*br\s*\/?>|<\/(p|div|li|h[1-6]|tr|ul|ol)>/gi, '\n')
    // [^<>]+ (not [^>]+) keeps this linear: a run of unclosed '<' can't rescan to end of input.
    .replace(/<[^<>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    // Entities are decoded exactly once (no double-decoding), then any markup the decode
    // produced (&lt;script&gt;) is removed. Bare "a < b" / "C++ & Java" are left alone.
    .replace(/<\/?[a-z!?][^<>]*>/gi, ' ')
    .replace(/<(?=\/?[a-z!?])/gi, '')
    .replace(/Â | /g, ' ') // RemoteOK ships mojibake'd nbsp
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Epoch seconds -> epoch ms; null if not a finite positive number. */
export function secondsToMs(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null
}

export type Json = Record<string, unknown>

export function asRecord(v: unknown): Json | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : null
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

/** ISO date/time string (or a 'Month D, YYYY' date) -> epoch ms; null when unparseable. */
export function dateToMs(v: unknown): number | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const t = Date.parse(v.replace(/\s+/g, ' '))
  return Number.isFinite(t) ? t : null
}
