import { USER_AGENT } from '../sources/http'
import type { Http } from '../sources/types'
import { isBlockedUrl } from './blocked'

export const EXAMPLES_USER_AGENT = USER_AGENT.replace('personal job-finder desktop app', 'personal job-finder dev tool, single-posting lookup')
export const MAX_REDIRECTS = 4
const ROBOTS_TOKEN = 'jobfinderapp'

/** The site refused us or put up a challenge. Never retried, never bypassed. */
export class BlockedError extends Error {}

const CHALLENGE = /just a moment|cf-chl|captcha|are you a robot|access denied|attention required|px-captcha|verify you are human/i

export type FetchFn = typeof fetch

interface RobotsRule {
  allow: boolean
  pattern: RegExp
  length: number
}

function ruleRegex(path: string): RegExp {
  const anchored = path.endsWith('$')
  const body = (anchored ? path.slice(0, -1) : path)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp('^' + body + (anchored ? '$' : ''))
}

/** Parses robots.txt into the rules that apply to us (our token's group, else `*`). */
export function parseRobots(text: string): RobotsRule[] {
  const groups: Array<{ agents: string[]; rules: RobotsRule[] }> = []
  let cur: { agents: string[]; rules: RobotsRule[] } | null = null
  let lastWasAgent = false
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim()
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] }
        groups.push(cur)
      }
      cur.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!cur || (key !== 'allow' && key !== 'disallow')) continue
    if (!value) continue // empty Disallow = allow everything; empty Allow = no-op
    cur.rules.push({ allow: key === 'allow', pattern: ruleRegex(value), length: value.length })
  }
  const own = groups.filter((g) => g.agents.some((a) => a !== '*' && ROBOTS_TOKEN.includes(a)))
  const chosen = own.length ? own : groups.filter((g) => g.agents.includes('*'))
  return chosen.flatMap((g) => g.rules)
}

/** Longest matching rule wins; Allow wins a tie; no match = allowed. */
export function robotsAllows(rules: RobotsRule[], pathAndQuery: string): boolean {
  let best: RobotsRule | null = null
  for (const r of rules) {
    if (!r.pattern.test(pathAndQuery)) continue
    if (!best || r.length > best.length || (r.length === best.length && r.allow && !best.allow)) best = r
  }
  return best ? best.allow : true
}

export interface PoliteOptions {
  fetchFn?: FetchFn
  sleep?: (ms: number) => Promise<void>
  /** Minimum gap between requests to the same host. Tests pass 0. */
  delayMs?: number
  timeoutMs?: number
}

export interface PoliteHttp extends Http {
  getText(url: string): Promise<string>
  /** Number of requests actually made (tests assert it stays 0 for blocked sites). */
  readonly requests: number
}

/**
 * Http for the dev tool: descriptive UA, per-host spacing, blocklist + refusal handling.
 *  - getJson/postJson hit official public ATS API endpoints (no robots.txt check, same as the app's connectors).
 *  - getText is for HTML pages and ALSO requires robots.txt to allow the path (4xx robots = allowed;
 *    5xx/network failure = treated as disallowed).
 *  - Redirects are followed manually (max MAX_REDIRECTS); every hop is re-checked against the blocklist (and robots for pages).
 *  - 401/403/429 or a challenge page throws BlockedError immediately. No retries, no evasion.
 */
export function createPoliteHttp(opts: PoliteOptions = {}): PoliteHttp {
  const fetchFn = opts.fetchFn ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const delayMs = opts.delayMs ?? 1000
  const timeoutMs = opts.timeoutMs ?? 20_000
  const lastHit = new Map<string, number>()
  const robotsCache = new Map<string, RobotsRule[] | 'deny'>()
  let requests = 0

  async function raw(url: string, init: RequestInit): Promise<Response> {
    if (isBlockedUrl(url)) throw new BlockedError(`refusing to fetch blocked site: ${url}`)
    const host = new URL(url).host
    const wait = (lastHit.get(host) ?? 0) + delayMs - Date.now()
    if (wait > 0) await sleep(wait)
    lastHit.set(host, Date.now())
    requests++
    return fetchFn(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': EXAMPLES_USER_AGENT, ...(init.headers as Record<string, string> | undefined) }
    })
  }

  async function robotsRules(origin: string): Promise<RobotsRule[] | 'deny'> {
    const cached = robotsCache.get(origin)
    if (cached) return cached
    let result: RobotsRule[] | 'deny'
    try {
      const res = await raw(`${origin}/robots.txt`, { headers: { Accept: 'text/plain' } })
      if (res.status >= 500 || res.status === 401 || res.status === 403) result = 'deny'
      else if (res.status >= 300 && res.status < 400) result = 'deny'
      else if (res.status >= 400) result = []
      else result = parseRobots(await res.text())
    } catch {
      result = 'deny'
    }
    robotsCache.set(origin, result)
    return result
  }

  async function request(url: string, init: RequestInit, page: boolean): Promise<Response> {
    let current = url
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (isBlockedUrl(current)) throw new BlockedError(`refusing to fetch blocked site: ${current}`)
      const u = new URL(current)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new BlockedError(`unsupported URL: ${current}`)
      if (page) {
        const rules = await robotsRules(u.origin)
        if (rules === 'deny' || !robotsAllows(rules, u.pathname + u.search)) {
          throw new BlockedError(`robots.txt of ${u.host} does not allow fetching ${u.pathname}`)
        }
      }
      const res = await raw(current, init)
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) throw new Error(`HTTP ${res.status} without Location for ${current}`)
        current = new URL(loc, current).toString()
        continue
      }
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        throw new BlockedError(`site refused the request (HTTP ${res.status}) for ${current}`)
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${current}`)
      return res
    }
    throw new Error(`too many redirects for ${url}`)
  }

  return {
    get requests() {
      return requests
    },
    async getJson(url) {
      return (await request(url, { headers: { Accept: 'application/json' } }, false)).json()
    },
    async postJson(url, body) {
      const res = await request(
        url,
        { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        false
      )
      return res.json()
    },
    async getText(url) {
      const text = await (await request(url, { headers: { Accept: 'text/html,*/*' } }, true)).text()
      if (CHALLENGE.test(text.slice(0, 6000)) && text.length < 20000) {
        throw new BlockedError(`bot challenge page served for ${url} (not bypassed)`)
      }
      return text
    }
  }
}
