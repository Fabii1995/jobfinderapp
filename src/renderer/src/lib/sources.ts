import type { SourceOutcome } from './types'

const ATS_NAMES: Record<string, string> = {
  greenhouse: 'Greenhouse',
  comeet: 'Comeet',
  lever: 'Lever',
  smartrecruiters: 'SmartRecruiters',
  ashby: 'Ashby',
  workday: 'Workday',
  amazon: 'Amazon',
  sqlink: 'SQLink'
}

export function atsLabel(ats: string): string {
  return ATS_NAMES[ats] ?? ats
}

/** Connector ids look like 'greenhouse:wizinc' (or just 'amazon'). */
export function atsOfSource(source: string): string {
  return source.split(':')[0]
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

/** id -> company name from the last refresh outcomes (fallback source of names). */
export function namesFromOutcomes(outcomes: SourceOutcome[] | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const o of outcomes ?? []) if (o.name) out[o.source] = o.name
  return out
}
