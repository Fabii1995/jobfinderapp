import { normalizeLocation } from '../location'
import { asArray, asRecord, asString, dateToMs, stripHtml } from './http'
import { requireToken } from './params'
import type { ConnectorFn, RawJob } from './types'

/**
 * Greenhouse job board API (keyless): GET boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true.
 * Returns the whole board in one response; `content` is entity-encoded HTML. The location is
 * free text only ({name}); there is no work-mode field (workMode comes from text hints, else unknown).
 * externalId = job id.
 */
export const fetchGreenhouse: ConnectorFn = async (params, ctx) => {
  const token = requireToken(params, 'token')
  const data = asRecord(
    await ctx.http.getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`)
  )
  const out: RawJob[] = []
  for (const item of asArray(data?.jobs)) {
    const j = asRecord(item)
    if (!j || j.id == null) continue
    const title = asString(j.title)
    const url = asString(j.absolute_url)
    if (!title || !url) continue
    const locName = asString(asRecord(j.location)?.name)
    const offices = asArray(j.offices)
      .map((o) => asString(asRecord(o)?.location) ?? asString(asRecord(o)?.name))
      .filter((x): x is string => !!x)
    const loc = normalizeLocation({ location: locName, locations: offices })
    const content = asString(j.content)
    out.push({
      source: ctx.id,
      externalId: String(j.id),
      title,
      company: ctx.name,
      url,
      description: content ? stripHtml(content) : null,
      location: locName,
      ...loc,
      postedAt: dateToMs(j.first_published) ?? dateToMs(j.updated_at)
    })
  }
  return out
}
