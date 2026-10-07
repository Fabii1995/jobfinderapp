import { normalizeLocation } from '../location'
import { isHardRejectTitle } from '../scoring'
import { asArray, asRecord, asString, dateToMs, mapLimit, sleep, stripHtml } from './http'
import { requireWorkday } from './params'
import type { ConnectorContext, ConnectorFn, RawJob } from './types'

const PAGE = 20 // Workday rejects larger limits on some tenants
const MAX_PAGES = 80
const DETAIL_CONCURRENCY = 3

const ISRAEL_FACET = /(?<![\p{L}\p{N}])(?:israel|ישראל)(?![\p{L}\p{N}])/iu
const NEW_GRAD_FACET = /new college grad|new grad|early career|university grad/i

export interface FacetFilter {
  /** Facet parameter name, e.g. "locationHierarchy1", "locations". */
  param: string
  ids: string[]
}

interface FacetNode {
  facetParameter?: string
  descriptor?: string
  id?: string
  values?: FacetNode[]
}

function* walkLeaves(node: FacetNode, param: string | undefined): Generator<{ param: string; leaf: FacetNode }> {
  for (const v of node.values ?? []) {
    if (Array.isArray(v.values)) yield* walkLeaves(v, v.facetParameter ?? param)
    else if (param && v.id) yield { param, leaf: v }
  }
}

/**
 * Finds the Israel location facet in an UNFILTERED /jobs response (facets differ by tenant:
 * NVIDIA locationHierarchy1 > "Israel"; Intel/Salesforce locationMainGroup > locations > "Israel, X").
 * Walks every facet and nested group, picks one facet parameter (location-ish names first) and returns
 * all its Israel value ids. Null when the tenant has no Israel location.
 */
export function findIsraelFacet(facets: unknown): FacetFilter | null {
  const found = new Map<string, string[]>()
  for (const f of asArray(facets)) {
    const node = f as FacetNode
    for (const { param, leaf } of walkLeaves(node, node.facetParameter)) {
      if (leaf.descriptor && ISRAEL_FACET.test(leaf.descriptor)) {
        found.set(param, [...(found.get(param) ?? []), leaf.id as string])
      }
    }
  }
  const params = [...found.keys()]
  const pick = params.find((p) => /location/i.test(p)) ?? params[0]
  return pick ? { param: pick, ids: found.get(pick)! } : null
}

/** The workerSubType value id for new-college-graduate postings, if the tenant has one. */
export function findNewGradFacet(facets: unknown): FacetFilter | null {
  for (const f of asArray(facets)) {
    const node = f as FacetNode
    if (node.facetParameter !== 'workerSubType') continue
    for (const { param, leaf } of walkLeaves(node, node.facetParameter)) {
      if (leaf.descriptor && NEW_GRAD_FACET.test(leaf.descriptor)) return { param, ids: [leaf.id as string] }
    }
  }
  return null
}

interface Listing {
  title: string
  externalPath: string
  locationsText: string | null
}

async function listAll(
  ctx: ConnectorContext,
  base: string,
  applied: Record<string, string[]>
): Promise<Listing[]> {
  const out: Listing[] = []
  let total = Infinity
  for (let page = 0; page < MAX_PAGES && out.length < total; page++) {
    const data = asRecord(
      await ctx.http.postJson(`${base}/jobs`, { appliedFacets: applied, limit: PAGE, offset: page * PAGE, searchText: '' })
    )
    // Workday reports `total` on the first page only (0 afterwards).
    if (page === 0 && typeof data?.total === 'number') total = data.total
    const postings = asArray(data?.jobPostings)
    for (const p of postings) {
      const r = asRecord(p)
      const title = asString(r?.title)
      const externalPath = asString(r?.externalPath)
      if (title && externalPath) out.push({ title, externalPath, locationsText: asString(r?.locationsText) })
    }
    if (postings.length === 0) break
    await sleep(ctx.delayMs ?? 0)
  }
  return out
}

/** "/job/Israel-Tel-Aviv/Title_JR123" -> "Israel Tel Aviv" (used only when no detail call was made). */
function locationFromPath(path: string): string | null {
  const m = /^\/job\/([^/]+)\//.exec(path)
  return m ? m[1].replace(/-+/g, ' ').trim() : null
}

/**
 * Generic Workday connector. params: host (<name>.wdN.myworkdayjobs.com), tenant, site.
 *  1. POST {base}/jobs with no filter, limit 1 -> facets; discover the Israel location facet and the
 *     "New College Graduate" workerSubType facet (a tenant may lack either).
 *  2. Page (limit 20) through the Israel-filtered list. Multi-location postings ("5 Locations") qualify
 *     because the facet means ANY location is in Israel; country is set to IL from the facet.
 *  3. A second filtered query (Israel + new-grad subtype) gives the externalPaths to tag 'entry-level'.
 *  4. Detail GET ({base}{externalPath}) for each job whose title is not a hard reject: description,
 *     location + additionalLocations (Israel chosen from them), remoteType, startDate, externalUrl.
 * externalId = externalPath (NOT the requisition id: one requisition can back several postings).
 */
export const fetchWorkday: ConnectorFn = async (params, ctx) => {
  const { host, tenant, site } = requireWorkday(params)
  const base = `https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}`

  const first = asRecord(await ctx.http.postJson(`${base}/jobs`, { appliedFacets: {}, limit: 1, offset: 0, searchText: '' }))
  const israel = findIsraelFacet(first?.facets)
  if (!israel) return [] // tenant has no Israel location
  const applied: Record<string, string[]> = { [israel.param]: israel.ids }
  const listings = await listAll(ctx, base, applied)

  const newGrad = findNewGradFacet(first?.facets)
  const newGradPaths = new Set<string>()
  if (newGrad) {
    try {
      for (const l of await listAll(ctx, base, { ...applied, [newGrad.param]: newGrad.ids })) {
        newGradPaths.add(l.externalPath)
      }
    } catch {
      // the subtype query is a bonus signal; keep going without it
    }
  }

  const jobs = await mapLimit(listings, DETAIL_CONCURRENCY, async (l): Promise<RawJob> => {
    const seniority = newGradPaths.has(l.externalPath) ? ['entry-level'] : undefined
    let description: string | null = null
    let locTexts: string[] = []
    let remoteType: string | null = null
    let url = `https://${host}/en-US/${site}${l.externalPath}`
    let postedAt: number | null = null
    if (!isHardRejectTitle(l.title)) {
      try {
        const d = asRecord(await ctx.http.getJson(`${base}${l.externalPath}`))
        const info = asRecord(d?.jobPostingInfo)
        const html = asString(info?.jobDescription)
        description = html ? stripHtml(html) : null
        locTexts = [asString(info?.location), ...asArray(info?.additionalLocations).map((x) => asString(x))].filter(
          (x): x is string => !!x
        )
        remoteType = asString(info?.remoteType)
        url = asString(info?.externalUrl) ?? url
        postedAt = dateToMs(info?.startDate)
      } catch {
        // detail failure keeps the listing (country still known from the facet)
      }
      await sleep(ctx.delayMs ?? 0)
    }
    const hint = locationFromPath(l.externalPath)
    const loc = normalizeLocation({ location: locTexts[0] ?? hint, locations: locTexts, workplaceType: remoteType })
    const israeli = locTexts.find((t) => normalizeLocation({ location: t }).country === 'IL')
    return {
      source: ctx.id,
      externalId: l.externalPath,
      title: l.title,
      company: ctx.name,
      url,
      description,
      location: israeli ?? locTexts[0] ?? l.locationsText ?? hint,
      // The facet guarantees an Israel location even when the text is "5 Locations".
      country: 'IL',
      city: loc.country === 'IL' ? loc.city : (hint ? normalizeLocation({ location: hint }).city : null),
      workMode: loc.workMode,
      postedAt,
      ...(seniority ? { seniority } : {})
    }
  })
  return jobs
}
