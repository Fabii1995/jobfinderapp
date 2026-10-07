import type { Ats } from './types'

const ATS_NAMES: Record<Ats, string> = {
  greenhouse: 'Greenhouse',
  comeet: 'Comeet',
  lever: 'Lever',
  smartrecruiters: 'SmartRecruiters',
  ashby: 'Ashby',
  workday: 'Workday',
  amazon: 'Amazon',
  sqlink: 'SQLink'
}

export function atsLabel(ats: Ats): string {
  return ATS_NAMES[ats] ?? ats
}

/**
 * Display label for a source (connector) id. Prefers a known company name; otherwise
 * falls back to the identifier after the colon ('greenhouse:wizinc' -> 'wizinc'), never the raw id
 * with a capitalised ATS prefix.
 */
export function sourceLabel(source: string, names?: Record<string, string>): string {
  const known = names?.[source]
  if (known) return known
  const i = source.indexOf(':')
  const ident = i >= 0 ? source.slice(i + 1) : source
  return ident ? ident.charAt(0).toUpperCase() + ident.slice(1) : source
}
