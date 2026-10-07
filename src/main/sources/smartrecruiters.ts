import { normalizeLocation } from '../location'
import { isHardRejectTitle } from '../scoring'
import { asArray, asRecord, asString, dateToMs, mapLimit, sleep, stripHtml } from './http'
import { requireToken } from './params'
import type { ConnectorFn, RawJob } from './types'

/** Detail calls (one per posting) run this many at a time. */
const DETAIL_CONCURRENCY = 2
const PAGE = 100
const MAX_PAGES = 20

/**
 * SmartRecruiters public API: GET api.smartrecruiters.com/v1/companies/{id}/postings?country=il
 * (paged by limit/offset). The LIST has no description, so a detail GET (postings/{id}) supplies
 * jobAd.sections text; it is skipped for titles scoring would reject anyway (senior/intern).
 * location {city,country,remote,hybrid,fullLocation}; experienceLevel.id (entry_level, internship,
 * associate, mid_senior_level, ...) feeds the seniority tags. externalId = posting id.
 */
export const fetchSmartRecruiters: ConnectorFn = async (params, ctx) => {
  const id = requireToken(params, 'id')
  const listed: Record<string, unknown>[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = asRecord(
      await ctx.http.getJson(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(id)}/postings?country=il&limit=${PAGE}&offset=${page * PAGE}`
      )
    )
    const content = asArray(data?.content)
    for (const c of content) {
      const r = asRecord(c)
      if (r) listed.push(r)
    }
    const total = Number(data?.totalFound ?? 0)
    if (content.length < PAGE || listed.length >= total) break
    await sleep(ctx.delayMs ?? 0)
  }

  const jobs = await mapLimit(listed, DETAIL_CONCURRENCY, async (j): Promise<RawJob | null> => {
    const pid = asString(j.id)
    const title = asString(j.name)
    if (!pid || !title) return null
    const lvl = asString(asRecord(j.experienceLevel)?.id)?.toLowerCase() ?? ''
    const seniority: string[] = []
    if (lvl === 'entry_level') seniority.push('entry-level')
    else if (lvl === 'internship') seniority.push('intern')
    else if (lvl === 'director' || lvl === 'executive') seniority.push('senior')

    let description: string | null = null
    let postingUrl: string | null = null
    if (!isHardRejectTitle(title)) {
      try {
        const d = asRecord(
          await ctx.http.getJson(
            `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(id)}/postings/${encodeURIComponent(pid)}`
          )
        )
        const sections = asRecord(asRecord(d?.jobAd)?.sections)
        const html = ['jobDescription', 'qualifications']
          .map((k) => asString(asRecord(sections?.[k])?.text))
          .filter((x): x is string => !!x)
          .join('\n')
        description = html ? stripHtml(html) : null
        postingUrl = asString(d?.postingUrl)
      } catch {
        // a failed detail call keeps the job without a description
      }
      await sleep(ctx.delayMs ?? 0)
    }
    const l = asRecord(j.location)
    const fullLocation = asString(l?.fullLocation)
    const city = asString(l?.city)
    const workplaceType = l?.hybrid === true ? 'hybrid' : l?.remote === true ? 'remote' : null
    const loc = normalizeLocation({
      location: fullLocation ?? city,
      country: asString(l?.country),
      city,
      workplaceType
    })
    return {
      source: ctx.id,
      externalId: pid,
      title,
      company: ctx.name,
      url: postingUrl ?? `https://jobs.smartrecruiters.com/${encodeURIComponent(id)}/${encodeURIComponent(pid)}`,
      description,
      location: fullLocation ?? city,
      ...loc,
      postedAt: dateToMs(j.releasedDate),
      ...(seniority.length ? { seniority } : {})
    }
  })
  return jobs.filter((j): j is RawJob => j !== null)
}
