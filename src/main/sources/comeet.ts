import { normalizeLocation } from '../location'
import { asArray, asRecord, asString, dateToMs, stripHtml } from './http'
import { requireToken } from './params'
import type { ConnectorFn, RawJob } from './types'

/**
 * Comeet careers API: GET www.comeet.co/careers-api/2.0/company/{uid}/positions?token={token}&details=true
 * (uid like "C5.00D", token a hex string; both come from `comeetvar` on the company's careers page).
 * Fields: name, location {name,country,city,is_remote}, workplace_type (Hybrid|On-site|Remote),
 * details[] {name,value(html)}, time_updated, url_active_page. `location.is_remote` is NOT used
 * (it is true for hybrid postings); workplace_type decides when present, else text hints/unknown.
 * externalId = position uid.
 */
export const fetchComeet: ConnectorFn = async (params, ctx) => {
  const uid = requireToken(params, 'uid')
  const token = requireToken(params, 'token')
  const data = asArray(
    await ctx.http.getJson(
      `https://www.comeet.co/careers-api/2.0/company/${encodeURIComponent(uid)}/positions?token=${encodeURIComponent(token)}&details=true`
    )
  )
  const out: RawJob[] = []
  for (const item of data) {
    const j = asRecord(item)
    if (!j) continue
    const id = asString(j.uid)
    const title = asString(j.name)
    const url = asString(j.url_active_page) ?? asString(j.url_comeet_hosted_page)
    if (!id || !title || !url) continue
    const l = asRecord(j.location)
    const locName = asString(l?.name)
    const city = asString(l?.city)
    const locText = [city, locName].filter(Boolean).join(', ') || null
    const loc = normalizeLocation({
      location: locText,
      country: asString(l?.country),
      city,
      workplaceType: asString(j.workplace_type)
    })
    const description = asArray(j.details)
      .map((d) => asString(asRecord(d)?.value))
      .filter((x): x is string => !!x)
      .map((h) => stripHtml(h))
      .join('\n\n')
    out.push({
      source: ctx.id,
      externalId: id,
      title,
      company: ctx.name,
      url,
      description: description || null,
      location: locText,
      ...loc,
      postedAt: dateToMs(j.time_updated)
    })
  }
  return out
}
