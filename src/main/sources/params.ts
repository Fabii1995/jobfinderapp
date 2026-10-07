/** Param guards: config values end up in fetch URLs, so every connector validates them. */

const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/
const WORKDAY_HOST_RE = /^[a-z0-9-]+\.wd\d{1,3}\.myworkdayjobs\.com$/i
const WORKDAY_SITE_RE = /^[A-Za-z0-9_.-]{1,100}$/

export function requireToken(params: Record<string, string>, key: string): string {
  const v = params[key]
  if (typeof v !== 'string' || !TOKEN_RE.test(v)) throw new Error(`invalid or missing param "${key}"`)
  return v
}

export function requireWorkday(params: Record<string, string>): { host: string; tenant: string; site: string } {
  const host = params.host
  if (typeof host !== 'string' || !WORKDAY_HOST_RE.test(host)) {
    throw new Error('invalid workday host (must be <name>.wdN.myworkdayjobs.com)')
  }
  const tenant = requireToken(params, 'tenant')
  const site = params.site
  if (typeof site !== 'string' || !WORKDAY_SITE_RE.test(site)) throw new Error('invalid workday site')
  return { host: host.toLowerCase(), tenant, site }
}

export const isValidToken = (v: unknown): v is string => typeof v === 'string' && TOKEN_RE.test(v)
export const isValidWorkdayHost = (v: unknown): v is string => typeof v === 'string' && WORKDAY_HOST_RE.test(v)
export const isValidWorkdaySite = (v: unknown): v is string => typeof v === 'string' && WORKDAY_SITE_RE.test(v)
