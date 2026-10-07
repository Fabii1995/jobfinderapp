import {
  isValidToken,
  isValidWorkdayHost,
  isValidWorkdaySite
} from '../sources/params'
import { ATS_KINDS, type Ats, type CompanyEntry } from './types'

/** Required params for each ATS (validated; these end up in fetch URLs). */
const REQUIRED: Record<Ats, string[]> = {
  greenhouse: ['token'],
  lever: ['slug'],
  ashby: ['name'],
  smartrecruiters: ['id'],
  comeet: ['uid', 'token'],
  workday: ['host', 'tenant', 'site'],
  amazon: [],
  sqlink: []
}

/** Connector id: `<ats>:<identifier>` lowercased; `amazon` alone. Stable and unique per ATS identity. */
export function makeCompanyId(ats: Ats, params: Record<string, string>): string {
  switch (ats) {
    case 'greenhouse':
      return `greenhouse:${params.token}`.toLowerCase()
    case 'lever':
      return `lever:${params.slug}`.toLowerCase()
    case 'ashby':
      return `ashby:${params.name}`.toLowerCase()
    case 'smartrecruiters':
      return `smartrecruiters:${params.id}`.toLowerCase()
    case 'comeet':
      return `comeet:${params.uid}`.toLowerCase()
    case 'workday':
      return `workday:${params.tenant}`.toLowerCase()
    case 'amazon':
      return 'amazon'
    case 'sqlink':
      return 'sqlink'
  }
}

/** Builds a validated entry (throws a descriptive Error on bad input). The id is always derived. */
export function makeCompanyEntry(input: {
  name: string
  ats: string
  params: Record<string, unknown>
  enabled?: boolean
}): CompanyEntry {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 100) throw new Error('company name is required (max 100 chars)')
  if (!(ATS_KINDS as readonly string[]).includes(input.ats)) throw new Error(`unknown ats "${input.ats}"`)
  const ats = input.ats as Ats
  const raw = input.params && typeof input.params === 'object' ? input.params : {}
  const params: Record<string, string> = {}
  for (const key of REQUIRED[ats]) {
    const v = raw[key]
    const ok =
      ats === 'workday' && key === 'host'
        ? isValidWorkdayHost(v)
        : ats === 'workday' && key === 'site'
          ? isValidWorkdaySite(v)
          : isValidToken(v)
    if (!ok) throw new Error(`${ats}: invalid or missing param "${key}"`)
    params[key] = v as string
  }
  if (ats === 'lever' && raw.region === 'eu') params.region = 'eu'
  return { id: makeCompanyId(ats, params), name, ats, params, enabled: input.enabled !== false }
}

/** Validates an unknown value read from disk. Returns null when it is not a valid entry. */
export function parseCompanyEntry(v: unknown): CompanyEntry | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  try {
    return makeCompanyEntry({
      name: o.name as string,
      ats: o.ats as string,
      params: (o.params ?? {}) as Record<string, unknown>,
      enabled: o.enabled === false ? false : true
    })
  } catch {
    return null
  }
}
