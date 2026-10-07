import { normalizeLocation } from '../location'
import { asRecord, asString, dateToMs, stripHtml, type Json } from '../sources/http'
import type { WorkMode } from '../sources/types'

interface JsonLdJob {
  title: string
  company: string
  location: string
  country: string | null
  city: string | null
  workMode: WorkMode
  postedAt: number | null
  description: string
  experienceRequirements: string | null
}

const LD_SCRIPT = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi

function isJobPosting(r: Json): boolean {
  const t = r['@type']
  return t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))
}

function* nodes(v: unknown, depth = 0): Generator<Json> {
  if (depth > 6) return
  if (Array.isArray(v)) {
    for (const x of v) yield* nodes(x, depth + 1)
    return
  }
  const r = asRecord(v)
  if (!r) return
  yield r
  if (r['@graph']) yield* nodes(r['@graph'], depth + 1)
}

/** Raw HTML (NOT stripped: stripHtml removes <script>) -> first JobPosting JSON-LD, or null. */
export function extractJsonLdJob(html: string): JsonLdJob | null {
  const re = new RegExp(LD_SCRIPT.source, LD_SCRIPT.flags)
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    let data: unknown
    try {
      data = JSON.parse(m[1].trim())
    } catch {
      continue
    }
    for (const r of nodes(data)) {
      if (isJobPosting(r)) {
        const job = mapJobPosting(r)
        if (job) return job
      }
    }
  }
  return null
}

function orgName(v: unknown): string | null {
  return asString(v) ?? asString(asRecord(v)?.name)
}

function mapJobPosting(r: Json): JsonLdJob | null {
  const title = asString(r.title) ?? asString(r.name)
  const descHtml = asString(r.description)
  if (!title || !descHtml) return null
  const places = Array.isArray(r.jobLocation) ? r.jobLocation : r.jobLocation ? [r.jobLocation] : []
  const texts: string[] = []
  const countries: string[] = []
  for (const p of places) {
    const addr = asRecord(asRecord(p)?.address) ?? asRecord(p)
    const country = asString(addr?.addressCountry) ?? asString(asRecord(addr?.addressCountry)?.name)
    if (country) countries.push(country)
    const parts = [asString(addr?.addressLocality), asString(addr?.addressRegion), country].filter(Boolean)
    if (parts.length) texts.push(parts.join(', '))
  }
  const remote = /telecommute/i.test(asString(r.jobLocationType) ?? '')
  const loc = normalizeLocation({
    location: texts[0] ?? null,
    locations: texts.slice(1),
    country: countries.find((c) => /^(?:il|isr|israel)$/i.test(c)) ?? countries[0] ?? null,
    workplaceType: remote ? 'remote' : null
  })
  const exp = asRecord(r.experienceRequirements)
  const months = exp && typeof exp.monthsOfExperience === 'number' ? exp.monthsOfExperience : null
  const experienceRequirements =
    asString(r.experienceRequirements) ??
    asString(exp?.description) ??
    (months !== null ? `${months} months of experience` : null)
  return {
    title,
    company: orgName(r.hiringOrganization) ?? '',
    location: texts.join('; '),
    country: loc.country,
    city: loc.city,
    workMode: loc.workMode,
    postedAt: dateToMs(r.datePosted),
    description: stripHtml(descHtml),
    experienceRequirements
  }
}
