/**
 * Sites the tool must NEVER request (RULES.md: no LinkedIn/Indeed/Glassdoor scraping; these also require
 * login or actively block automation). Checked on the parsed hostname before any request, including
 * robots.txt, and again on every redirect hop.
 */
const BLOCKED_DOMAINS = [
  'linkedin.com',
  'lnkd.in',
  'indeed.com',
  'glassdoor.com',
  'ziprecruiter.com',
  'monster.com',
  'facebook.com',
  'fb.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  't.me',
  'whatsapp.com'
]
/** `indeed.<anything>` / `glassdoor.<anything>` country sites (indeed.co.il, glassdoor.co.uk, il.indeed.com). */
const BLOCKED_LABELS = ['indeed', 'glassdoor']

export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (BLOCKED_DOMAINS.some((d) => host === d || host.endsWith('.' + d))) return true
  return host.split('.').slice(0, -1).some((label) => BLOCKED_LABELS.includes(label))
}

/** True for an unparseable URL too: when in doubt, do not fetch. */
export function isBlockedUrl(url: string): boolean {
  try {
    return isBlockedHost(new URL(url).hostname)
  } catch {
    return true
  }
}
