import { normalizeLocation } from '../location'
import { asArray, asRecord, asString, stripHtml } from './http'
import { requireToken } from './params'
import type { ConnectorFn, RawJob } from './types'

/**
 * Lever postings API: GET api.lever.co/v0/postings/{slug}?mode=json (EU tenants: api.eu.lever.co,
 * params.region = "eu"). Fields: text (title), categories.location / allLocations, workplaceType
 * (onsite|hybrid|remote), descriptionPlain + lists + additionalPlain, createdAt (epoch ms),
 * hostedUrl. externalId = posting id.
 */
export const fetchLever: ConnectorFn = async (params, ctx) => {
  const slug = requireToken(params, 'slug')
  const host = params.region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co'
  const data = asArray(await ctx.http.getJson(`https://${host}/v0/postings/${encodeURIComponent(slug)}?mode=json`))
  const out: RawJob[] = []
  for (const item of data) {
    const j = asRecord(item)
    if (!j) continue
    const id = asString(j.id)
    const title = asString(j.text)
    const url = asString(j.hostedUrl)
    if (!id || !title || !url) continue
    const cats = asRecord(j.categories)
    const location = asString(cats?.location)
    const all = asArray(cats?.allLocations).filter((x): x is string => typeof x === 'string')
    const lists = asArray(j.lists)
      .map((l) => {
        const r = asRecord(l)
        return `${asString(r?.text) ?? ''}\n${typeof r?.content === 'string' ? stripHtml(r.content) : ''}`
      })
      .join('\n')
    const description = [asString(j.descriptionPlain), lists.trim(), asString(j.additionalPlain)]
      .filter(Boolean)
      .join('\n\n')
    const loc = normalizeLocation({
      location,
      locations: all,
      country: asString(j.country),
      workplaceType: asString(j.workplaceType)
    })
    out.push({
      source: ctx.id,
      externalId: id,
      title,
      company: ctx.name,
      url,
      description: description || null,
      location: location ?? (all.join('; ') || null),
      ...loc,
      postedAt: typeof j.createdAt === 'number' && j.createdAt > 0 ? j.createdAt : null
    })
  }
  return out
}
