import { resolveComeetParams } from '../companies/detect'
import { makeCompanyId } from '../companies/validate'
import { normalizeLocation } from '../location'
import { extractExperience } from '../scoring'
import { fetchAmazon } from '../sources/amazon'
import { fetchAshby } from '../sources/ashby'
import { fetchComeet } from '../sources/comeet'
import { fetchGreenhouse } from '../sources/greenhouse'
import { asArray, asRecord, asString, dateToMs, stripHtml } from '../sources/http'
import { fetchLever } from '../sources/lever'
import { fetchSmartRecruiters } from '../sources/smartrecruiters'
import { parseJobPage, sqlinkLocation } from '../sources/sqlink'
import type { ConnectorContext, ConnectorFn, Http, RawJob } from '../sources/types'
import { isBlockedUrl } from './blocked'
import { BlockedError } from './fetcher'
import { extractJsonLdJob } from './jsonld'
import { parsePostingUrl, refIsSafe, type PostingRef } from './postings'
import { manualId, type Example } from './schema'

/** What a resolver produced, before the user's label/reason and the capture time are attached. */
export type ResolvedFields = Omit<Example, 'label' | 'reason' | 'fetchedAt' | 'needsText' | 'experienceText'> & {
  /** Extra experience wording that is not in the description (JSON-LD experienceRequirements). */
  extraExperience?: string
}

type Resolution =
  | { kind: 'resolved'; fields: ResolvedFields }
  /** Nothing was (or may be) fetched: the user must paste the job text. `blocked` = deliberately not fetched. */
  | { kind: 'manual'; reason: string; blocked: boolean }
  | { kind: 'invalid'; reason: string }

type PageHttp = Http & { getText(url: string): Promise<string> }

function fromRaw(raw: RawJob, via: Example['via']): ResolvedFields {
  return {
    id: `${raw.source}:${raw.externalId}`,
    url: raw.url,
    source: raw.source,
    externalId: raw.externalId,
    title: raw.title,
    company: raw.company,
    location: raw.location ?? '',
    country: raw.country,
    city: raw.city,
    workMode: raw.workMode,
    ...(raw.seniority?.length ? { seniority: raw.seniority } : {}),
    postedAt: raw.postedAt,
    description: raw.description ?? '',
    via
  }
}

const NO_DELAY = 0

/** Runs an existing board connector against a stub Http that serves exactly one posting. */
async function runConnector(
  fn: ConnectorFn,
  params: Record<string, string>,
  id: string,
  name: string,
  http: Http
): Promise<RawJob[]> {
  const ctx: ConnectorContext = { id, name, http, delayMs: NO_DELAY }
  return fn(params, ctx)
}

function pickOne(jobs: RawJob[], externalId: string): RawJob {
  const hit = jobs.find((j) => j.externalId === externalId)
  if (!hit) throw new Error('that posting was not found (it may be closed or the id is wrong)')
  return hit
}

async function fetchAts(ref: PostingRef, http: PageHttp): Promise<ResolvedFields> {
  if (!refIsSafe(ref)) throw new Error('unrecognised identifiers in the URL')
  switch (ref.ats) {
    case 'greenhouse': {
      const one = await http.getJson(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(ref.token)}/jobs/${encodeURIComponent(ref.id)}`
      )
      const name = asString(asRecord(one)?.company_name) ?? ref.token
      const stub: Http = { getJson: async () => ({ jobs: [one] }), postJson: http.postJson }
      const id = makeCompanyId('greenhouse', { token: ref.token })
      return fromRaw(pickOne(await runConnector(fetchGreenhouse, { token: ref.token }, id, name, stub), ref.id), 'ats-api')
    }
    case 'lever': {
      const host = ref.region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co'
      const one = await http.getJson(
        `https://${host}/v0/postings/${encodeURIComponent(ref.slug)}/${encodeURIComponent(ref.id)}?mode=json`
      )
      const stub: Http = { getJson: async () => [one], postJson: http.postJson }
      const params = { slug: ref.slug, ...(ref.region ? { region: ref.region } : {}) }
      const id = makeCompanyId('lever', params)
      return fromRaw(pickOne(await runConnector(fetchLever, params, id, ref.slug, stub), ref.id), 'ats-api')
    }
    case 'ashby': {
      // No single-posting endpoint: the public board is one request, then filter by id.
      const id = makeCompanyId('ashby', { name: ref.name })
      return fromRaw(pickOne(await runConnector(fetchAshby, { name: ref.name }, id, ref.name, http), ref.id), 'ats-api')
    }
    case 'smartrecruiters': {
      const detail = await http.getJson(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(ref.company)}/postings/${encodeURIComponent(ref.id)}`
      )
      const d = asRecord(detail)
      const name = asString(asRecord(d?.company)?.name) ?? ref.company
      // The connector lists then fetches detail per posting: serve a one-item list and the detail we already have.
      const stub: Http = {
        getJson: async (url) => (/\/postings\?/.test(url) ? { content: [detail], totalFound: 1 } : detail),
        postJson: http.postJson
      }
      const id = makeCompanyId('smartrecruiters', { id: ref.company })
      return fromRaw(
        pickOne(await runConnector(fetchSmartRecruiters, { id: ref.company }, id, name, stub), ref.id),
        'ats-api'
      )
    }
    case 'amazon': {
      const stub: Http = {
        getJson: (url) =>
          http.getJson(
            url.replace(/\?.*$/, `?base_query=${encodeURIComponent(ref.id)}&result_limit=100&offset=${/offset=(\d+)/.exec(url)?.[1] ?? 0}`)
          ),
        postJson: http.postJson
      }
      const jobs = await runConnector(fetchAmazon, {}, 'amazon', 'Amazon', stub)
      return fromRaw(pickOne(jobs, ref.id), 'ats-api')
    }
    case 'comeet': {
      const { uid, token } = await resolveComeetParams(ref.pageUrl, (u) => http.getText(u))
      const slug = new URL(ref.pageUrl).pathname.split('/').filter(Boolean)
      const name = slug[0] === 'jobs' && slug[1] ? decodeURIComponent(slug[1]) : uid
      const id = makeCompanyId('comeet', { uid, token })
      const jobs = await runConnector(fetchComeet, { uid, token }, id, name, http)
      return fromRaw(pickOne(jobs, ref.positionUid), 'ats-api')
    }
    case 'workday':
      return fetchWorkdayPosting(ref, http)
    case 'sqlink': {
      const html = await http.getText(ref.url)
      const job = parseJobPage(html)
      if (!job || !job.number) throw new Error('could not read a job from that SQLink page')
      return {
        id: 'sqlink:' + job.number,
        url: ref.url,
        source: 'sqlink',
        externalId: job.number,
        title: job.title,
        company: 'SQLink',
        ...sqlinkLocation(job.description),
        postedAt: null,
        description: job.description,
        via: 'ats-api'
      }
    }
  }
}

/** One Workday detail GET (the same endpoint the connector uses per posting). */
async function fetchWorkdayPosting(
  ref: Extract<PostingRef, { ats: 'workday' }>,
  http: Http
): Promise<ResolvedFields> {
  const base = `https://${ref.host}/wday/cxs/${encodeURIComponent(ref.tenant)}/${encodeURIComponent(ref.site)}`
  const data = asRecord(await http.getJson(`${base}${ref.externalPath}`))
  const info = asRecord(data?.jobPostingInfo)
  const title = asString(info?.title)
  if (!info || !title) throw new Error('that posting was not found (it may be closed or the URL is wrong)')
  const html = asString(info.jobDescription)
  const locTexts = [asString(info.location), ...asArray(info.additionalLocations).map((x) => asString(x))].filter(
    (x): x is string => !!x
  )
  const loc = normalizeLocation({
    location: locTexts[0],
    locations: locTexts,
    country: asString(asRecord(info.country)?.descriptor),
    workplaceType: asString(info.remoteType)
  })
  const israeli = locTexts.find((t) => normalizeLocation({ location: t }).country === 'IL')
  const source = makeCompanyId('workday', { tenant: ref.tenant })
  return {
    id: `${source}:${ref.externalPath}`,
    url: asString(info.externalUrl) ?? `https://${ref.host}/en-US/${ref.site}${ref.externalPath}`,
    source,
    externalId: ref.externalPath,
    title,
    company: asString(asRecord(data?.hiringOrganization)?.name) ?? ref.tenant,
    location: israeli ?? locTexts[0] ?? '',
    country: loc.country,
    city: loc.city,
    workMode: loc.workMode,
    postedAt: dateToMs(info.startDate),
    description: html ? stripHtml(html) : '',
    via: 'ats-api'
  }
}

/**
 * Resolves one URL to listing fields. Order of decisions:
 *  1. Blocked site (LinkedIn/Indeed/Glassdoor/...) -> manual, NO request of any kind.
 *  2. Supported ATS posting -> official public endpoint for that single posting.
 *  3. Anything else -> page fetch only if robots.txt allows, then JSON-LD JobPosting; else manual.
 * A refusal (401/403/429/challenge/robots) always ends in `manual`; nothing is retried or bypassed.
 */
export async function resolveUrl(url: string, http: PageHttp): Promise<Resolution> {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return { kind: 'invalid', reason: `not a valid URL: ${url}` }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { kind: 'invalid', reason: `unsupported URL scheme: ${parsed.protocol}` }
  }
  if (isBlockedUrl(parsed.toString())) {
    return {
      kind: 'manual',
      blocked: true,
      reason: `${parsed.hostname} is a blocked site (login/anti-bot/terms; RULES.md forbids fetching it). Nothing was fetched.`
    }
  }
  const failure = (e: unknown, what: string): Resolution => ({
    kind: 'manual',
    blocked: e instanceof BlockedError,
    reason: `${what}: ${e instanceof Error ? e.message : String(e)}`
  })

  const ref = parsePostingUrl(parsed.toString())
  if (ref) {
    try {
      return { kind: 'resolved', fields: await fetchAts(ref, http) }
    } catch (e) {
      return failure(e, `could not read the ${ref.ats} posting`)
    }
  }

  let html: string
  try {
    html = await http.getText(parsed.toString())
  } catch (e) {
    return failure(e, 'page not fetched')
  }
  const ld = extractJsonLdJob(html)
  if (!ld) return { kind: 'manual', blocked: false, reason: 'the page has no JSON-LD JobPosting data' }
  return {
    kind: 'resolved',
    fields: {
      id: manualId(parsed.toString()),
      url: parsed.toString(),
      title: ld.title,
      company: ld.company,
      location: ld.location,
      country: ld.country,
      city: ld.city,
      workMode: ld.workMode,
      postedAt: ld.postedAt,
      description: ld.description,
      via: 'jsonld',
      ...(ld.experienceRequirements ? { extraExperience: ld.experienceRequirements } : {})
    }
  }
}

// ---- experience wording (dev aid only; read-only use of scoring.ts) -----------------------

const EXPERIENCE_SENTENCE =
  /\d\s*\+?\s*(?:[-–]\s*\d+\s*)?(?:years?|yrs?)|(?:years?|yrs?)\s+of|no (?:prior |previous |relevant )?experience|entry[- ]level|fresh graduate|new grad|junior|שנות ניסיון|שנים|שנת ניסיון|ללא ניסיון|ניסיון/i

/** Up to 4 short sentences/lines that talk about experience, plus a parsed summary of the statements scoring sees. */
export function experienceText(description: string, extra?: string): string {
  const parts: string[] = []
  if (extra) parts.push(extra)
  const seen = new Set<string>(parts)
  for (const piece of description.split(/\n+|(?<=[.!?])\s+/)) {
    const s = piece.trim()
    if (s.length < 4 || !EXPERIENCE_SENTENCE.test(s)) continue
    const clipped = s.length > 220 ? s.slice(0, 217) + '...' : s
    if (seen.has(clipped)) continue
    seen.add(clipped)
    parts.push(clipped)
    if (parts.length >= 4) break
  }
  return parts.join(' | ')
}

export function parsedExperience(text: string): string {
  const st = extractExperience(text)
  if (!st.length) return 'none stated'
  return st.map((s) => (s.max === null ? `${s.min}+` : s.max === s.min ? `${s.min}` : `${s.min}-${s.max}`)).join(', ') + ' yrs'
}
