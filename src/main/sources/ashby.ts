import { normalizeLocation } from '../location'
import { asArray, asRecord, asString, dateToMs } from './http'
import { requireToken } from './params'
import type { ConnectorFn, RawJob } from './types'

/**
 * Ashby public job board: GET api.ashbyhq.com/posting-api/job-board/{name}. Fields: title,
 * location + secondaryLocations[].location (+ address.postalAddress.addressCountry),
 * workplaceType (OnSite|Hybrid|Remote), isRemote, descriptionPlain, publishedAt, jobUrl.
 * Unlisted postings (isListed=false) are skipped. externalId = posting id.
 */
export const fetchAshby: ConnectorFn = async (params, ctx) => {
  const name = requireToken(params, 'name')
  const data = asRecord(
    await ctx.http.getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(name)}`)
  )
  const out: RawJob[] = []
  for (const item of asArray(data?.jobs)) {
    const j = asRecord(item)
    if (!j || j.isListed === false) continue
    const id = asString(j.id)
    const title = asString(j.title)
    const url = asString(j.jobUrl)
    if (!id || !title || !url) continue
    const secondary = asArray(j.secondaryLocations).map((s) => asRecord(s))
    const locs = secondary.map((s) => asString(s?.location))
    const countries = [
      asString(asRecord(asRecord(j.address)?.postalAddress)?.addressCountry),
      ...secondary.map((s) => asString(asRecord(asRecord(s?.address)?.postalAddress)?.addressCountry))
    ]
    const location = asString(j.location)
    const loc = normalizeLocation({
      location,
      locations: [...locs, ...countries],
      workplaceType: asString(j.workplaceType),
      isRemote: typeof j.isRemote === 'boolean' ? j.isRemote : null
    })
    out.push({
      source: ctx.id,
      externalId: id,
      title,
      company: ctx.name,
      url,
      description: asString(j.descriptionPlain),
      location: [location, ...locs].filter(Boolean).join('; ') || null,
      ...loc,
      postedAt: dateToMs(j.publishedAt)
    })
  }
  return out
}
