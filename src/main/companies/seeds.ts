import { makeCompanyEntry } from './validate'
import type { CompanyEntry } from './types'

type Seed = [name: string, ats: string, params: Record<string, string>, enabled?: boolean]

const GREENHOUSE: Array<[string, string]> = [
  ['Wiz', 'wizinc'],
  ['Cato Networks', 'catonetworks'],
  ['Similarweb', 'similarweb'],
  ['Payoneer', 'payoneer'],
  ['JFrog', 'jfrog'],
  ['Taboola', 'taboola'],
  ['NICE', 'nice'],
  ['Gong', 'gongio'],
  ['Transmit Security', 'transmitsecurity'],
  ['AppsFlyer', 'appsflyer'],
  ['Riskified', 'riskified'],
  ['Melio', 'melio'],
  ['Axonius', 'axonius'],
  ['Forter', 'forter'],
  ['Yotpo', 'yotpo'],
  ['Island', 'island'],
  // Each verified live (2026-10-06) to list Israel postings.
  ['Torq', 'torq'],
  ['Apiiro', 'apiiro'],
  ['Cymulate', 'cymulate'],
  ['Salt Security', 'saltsecurity'],
  ['Orca Security', 'orcasecurity'],
  ['BigID', 'bigid'],
  ['Optimove', 'optimove'],
  ['Innovid', 'innovid'],
  // EU-hosted board (job-boards.eu.greenhouse.io/wedev); the keyless boards-api answers for it (verified 200).
  ['WeDev', 'wedev'],
  // Each board answered HTTP 200 on boards-api.greenhouse.io (2026-10-15, PDL company probe).
  ['Connecteam', 'connecteam'],
  ['Mixtiles', 'mixtiles'],
  ['MyHeritage', 'myheritage'],
  ['QuantHealth', 'quanthealth'],
  ['Beamup', 'beamup'],
  ['accessiBe', 'accessibe'],
  ['Sweet Security', 'sweetsecurity']
]

const SEEDS: Seed[] = [
  ...GREENHOUSE.map(([name, token]): Seed => [name, 'greenhouse', { token }]),
  ['Pentera', 'comeet', { uid: 'C5.00D', token: '5CD1D013435289B343501D012E682E68289B' }],
  ['Silverfort', 'comeet', { uid: '54.007', token: '45715B315B38AE22B8D051A0A457D051E61' }],
  ['Cloudinary', 'lever', { slug: 'cloudinary' }],
  ['WalkMe', 'lever', { slug: 'walkme' }],
  ['Armis', 'smartrecruiters', { id: 'armis' }],
  ['ServiceNow', 'smartrecruiters', { id: 'ServiceNow' }],
  ['TenenGroup', 'smartrecruiters', { id: 'TenenGroup' }],
  ['Kueez', 'smartrecruiters', { id: 'Kueez' }],
  ['Rapydo', 'smartrecruiters', { id: 'Rapydo' }],
  ['Play-perfect', 'smartrecruiters', { id: 'Play-perfect' }],
  ['Oktopost', 'lever', { slug: 'oktopost' }],
  ['Moon Active', 'ashby', { name: 'moonactive' }],
  ['Loora', 'ashby', { name: 'loora' }],
  ['Incrmntal', 'ashby', { name: 'incrmntal' }],
  ['Stigg', 'ashby', { name: 'stigg' }],
  ['Amazon', 'amazon', {}],
  ['Lemonade', 'ashby', { name: 'lemonade' }],
  ['Finout', 'ashby', { name: 'finout' }],
  // OFF by default: sqlink.com answers every automated request (even robots.txt) with a Cloudflare challenge
  // (HTTP 403). The connector stops on 403 and never bypasses it. Re-enable in the Companies tab if it recovers.
  ['SQLink', 'sqlink', {}, false],
  ['NVIDIA', 'workday', { host: 'nvidia.wd5.myworkdayjobs.com', tenant: 'nvidia', site: 'NVIDIAExternalCareerSite' }],
  ['Intel', 'workday', { host: 'intel.wd1.myworkdayjobs.com', tenant: 'intel', site: 'External' }],
  ['Salesforce', 'workday', { host: 'salesforce.wd12.myworkdayjobs.com', tenant: 'salesforce', site: 'External_Career_Site' }]
]

/**
 * Seed ids shipped before the additive seed merge (the first 26). Existing companies.json files without
 * `seedsApplied` are assumed to have been offered exactly these, so a removed legacy seed is not
 * resurrected. Hardcoded on purpose: never derive from SEEDS, which grows.
 */
export const LEGACY_SEED_IDS: readonly string[] = [
  'greenhouse:wizinc', 'greenhouse:catonetworks', 'greenhouse:similarweb', 'greenhouse:payoneer',
  'greenhouse:jfrog', 'greenhouse:taboola', 'greenhouse:nice', 'greenhouse:gongio',
  'greenhouse:transmitsecurity', 'greenhouse:appsflyer', 'greenhouse:riskified', 'greenhouse:melio',
  'greenhouse:axonius', 'greenhouse:forter', 'greenhouse:yotpo', 'greenhouse:island',
  'comeet:c5.00d', 'comeet:54.007', 'lever:cloudinary', 'lever:walkme',
  'smartrecruiters:armis', 'smartrecruiters:servicenow', 'amazon',
  'workday:nvidia', 'workday:intel', 'workday:salesforce'
]

/** The first-run company list (all enabled except SQLink, see above). Built through the same validation as user entries. */
export function seedCompanies(): CompanyEntry[] {
  return SEEDS.map(([name, ats, params, enabled]) => makeCompanyEntry({ name, ats, params, enabled }))
}
