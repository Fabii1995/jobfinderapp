import { normalizeLocation } from '../location'
import { asArray, asRecord, asString, dateToMs, sleep, stripHtml } from './http'
import type { ConnectorFn, RawJob } from './types'

const PAGE = 100
const MAX_PAGES = 15

/**
 * Amazon jobs: GET www.amazon.jobs/en/search.json?loc_query=Israel&country=ISR&result_limit=100&offset=N.
 * Single instance (connector id "amazon"). `hits` is the total. Fields used: id_icims (externalId; falls
 * back to id), title, description + basic_qualifications (HTML with <br/>; preferred qualifications are
 * skipped on purpose, they are wishes not requirements), city, country_code (ISR), location ("IL, Tel Aviv"
 * - the "IL" is NOT used as a signal, country_code is), locations[] (JSON strings; .type ONSITE/...),
 * job_path, posted_date, is_intern -> seniority 'intern', university_job -> 'entry-level'.
 */
export const fetchAmazon: ConnectorFn = async (_params, ctx) => {
  const out: RawJob[] = []
  let total = Infinity
  for (let page = 0; page < MAX_PAGES && out.length < total; page++) {
    const data = asRecord(
      await ctx.http.getJson(
        `https://www.amazon.jobs/en/search.json?loc_query=Israel&country=ISR&result_limit=${PAGE}&offset=${page * PAGE}&sort=recent`
      )
    )
    if (typeof data?.hits === 'number') total = data.hits
    const jobs = asArray(data?.jobs)
    for (const item of jobs) {
      const j = asRecord(item)
      if (!j) continue
      const id = asString(j.id_icims) ?? asString(j.id)
      const title = asString(j.title)
      const path = asString(j.job_path)
      if (!id || !title || !path) continue
      const locObjs = asArray(j.locations)
        .map((l) => {
          if (typeof l !== 'string') return asRecord(l)
          try {
            return asRecord(JSON.parse(l))
          } catch {
            return null
          }
        })
        .filter((l): l is NonNullable<typeof l> => l !== null)
      const israeli = locObjs.find((l) => /^(?:ISR|IL)$/i.test(asString(l.countryIso3a) ?? asString(l.normalizedCountryCode) ?? ''))
      const loc = normalizeLocation({
        location: asString(j.normalized_location) ?? asString(j.city),
        locations: locObjs.map((l) => asString(l.locationNonStemming)),
        country: asString(j.country_code),
        city: asString(j.city),
        workplaceType: asString(israeli?.type)
      })
      const desc = [asString(j.description), asString(j.basic_qualifications)]
        .filter((x): x is string => !!x)
        .map((h) => stripHtml(h))
        .join('\n\n')
      const seniority: string[] = []
      if (j.is_intern === true) seniority.push('intern')
      else if (j.university_job === true) seniority.push('entry-level')
      out.push({
        source: ctx.id,
        externalId: id,
        title,
        company: ctx.name,
        url: `https://www.amazon.jobs${path}`,
        description: desc || null,
        location: asString(j.normalized_location) ?? asString(j.location),
        ...loc,
        postedAt: dateToMs(j.posted_date),
        ...(seniority.length ? { seniority } : {})
      })
    }
    if (jobs.length < PAGE) break
    await sleep(ctx.delayMs ?? 0)
  }
  return out
}
