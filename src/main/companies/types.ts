export const ATS_KINDS = [
  'greenhouse',
  'comeet',
  'lever',
  'smartrecruiters',
  'ashby',
  'workday',
  'amazon',
  'sqlink'
] as const
export type Ats = (typeof ATS_KINDS)[number]

/**
 * One configured company/connector. `id` is the connector id and is stored as `jobs.source`;
 * it is always `makeCompanyId(ats, params)` (never derived from the display name).
 * params per ats:
 *   greenhouse {token}  lever {slug, region?:'eu'}  ashby {name}  smartrecruiters {id}
 *   comeet {uid, token}  workday {host, tenant, site}  amazon {}  sqlink {} (Israeli recruiter, sitemap + HTML job pages)
 */
export interface CompanyEntry {
  id: string
  name: string
  ats: Ats
  params: Record<string, string>
  enabled: boolean
}
