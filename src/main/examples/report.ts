import { MIN_SCORE } from '../ingest/refresh'
import { isKeepableLocation, normalizeLocation } from '../location'
import type { Role } from '../../shared/roles'
import {
  INTERN_SENIORITY_TAGS,
  INTERN_TITLE_KEYWORDS,
  SENIOR_SENIORITY_TAGS,
  SENIOR_TITLE_KEYWORDS,
  bodyRequiresExperience,
  classifyRoles,
  normalizeTitle,
  scoreJob,
  titleHasSoftwareRole
} from '../scoring'
import type { RawJob } from '../sources/types'
import { parsedExperience } from './resolve'
import type { Example } from './schema'

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const kwRe = (list: string[]): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'iu')
const INTERN_RE = kwRe(INTERN_TITLE_KEYWORDS)
const SENIOR_RE = kwRe(SENIOR_TITLE_KEYWORDS)

export interface ReportRow {
  example: Example
  /** null when the entry has no job text yet (not scored). */
  score: number | null
  kept: boolean | null
  /** 'ok' | 'rejected' | 'not-checked' (location unknown, e.g. a pasted job without a location). */
  location: 'ok' | 'rejected' | 'not-checked'
  reasons: string[]
  roles: Role[]
  experience: string
  parsedExperience: string
  mismatch: boolean
}

export function exampleToRawJob(e: Example): RawJob {
  const loc =
    e.country === undefined && e.workMode === undefined && e.location
      ? normalizeLocation({ location: e.location })
      : null
  return {
    source: e.source ?? 'example',
    externalId: e.externalId ?? e.id,
    title: e.title,
    company: e.company,
    url: e.url,
    description: e.description || null,
    location: e.location || null,
    country: e.country ?? loc?.country ?? null,
    city: e.city ?? loc?.city ?? null,
    workMode: e.workMode ?? loc?.workMode ?? 'unknown',
    postedAt: e.postedAt ?? null,
    ...(e.seniority?.length ? { seniority: e.seniority } : {})
  }
}

/** Why the CURRENT scoring/ingest rules would drop this job (empty when kept). Mirrors scoring.ts; derived from its exports. */
export function rejectionReasons(job: RawJob, score: number, location: ReportRow['location']): string[] {
  const reasons: string[] = []
  if (location === 'rejected') {
    reasons.push(`location filter: country=${job.country ?? 'unknown'}, workMode=${job.workMode} (ingest keeps Israel, non-remote)`)
  }
  const title = normalizeTitle(job.title)
  const tags = (job.seniority ?? []).map((t) => t.toLowerCase())
  if (SENIOR_RE.test(title)) reasons.push('senior-type title (hard reject, score 0)')
  if (INTERN_RE.test(title) || tags.some((t) => INTERN_SENIORITY_TAGS.includes(t))) {
    reasons.push('intern/student title or tag (capped at 20; confirmed not junior)')
  }
  if (tags.some((t) => SENIOR_SENIORITY_TAGS.includes(t)) && !tags.includes('entry-level')) {
    reasons.push('senior/manager source seniority tag (-60, cap 15)')
  }
  if (!titleHasSoftwareRole(job.title)) reasons.push('no target/software role keyword in the title (cap 25)')
  if (bodyRequiresExperience(job.description ?? '')) reasons.push('description states a 3+ year minimum (-25)')
  if (score < MIN_SCORE && reasons.every((r) => r.startsWith('location'))) {
    reasons.push(`junior/experience signals too weak (score ${score} < ${MIN_SCORE})`)
  }
  return score >= MIN_SCORE && location !== 'rejected' ? [] : reasons
}

export function buildRow(e: Example): ReportRow {
  const experience = e.experienceText ?? ''
  const hasText = !!e.description.trim() && !!e.title.trim()
  if (!hasText) {
    return {
      example: e,
      score: null,
      kept: null,
      location: 'not-checked',
      reasons: ['NEEDS TEXT: no job text yet, not scored (paste it with --text-file)'],
      roles: [],
      experience,
      parsedExperience: 'n/a',
      mismatch: false
    }
  }
  const job = exampleToRawJob(e)
  const score = scoreJob(job)
  const locationKnown = job.country !== null || job.workMode !== 'unknown' || !!e.location
  const location: ReportRow['location'] = !locationKnown ? 'not-checked' : isKeepableLocation(job) ? 'ok' : 'rejected'
  const kept = score >= MIN_SCORE && location !== 'rejected'
  return {
    example: e,
    score,
    kept,
    location,
    reasons: rejectionReasons(job, score, location),
    roles: classifyRoles(job),
    experience,
    parsedExperience: parsedExperience(e.description),
    mismatch: e.label === 'fit' ? !kept : kept
  }
}

export function formatReport(examples: Example[]): string {
  if (!examples.length) {
    return 'No examples yet (training-data/examples.json is empty). Add some with: npm run examples:add -- <url-or-id>...'
  }
  const rows = examples.map(buildRow)
  const lines: string[] = []
  const scored = rows.filter((r) => r.kept !== null)
  // Mismatches first so they cannot be missed.
  const ordered = [...rows].sort((a, b) => Number(b.mismatch) - Number(a.mismatch))
  for (const r of ordered) {
    const e = r.example
    const verdict = r.kept === null ? 'NOT SCORED' : r.kept ? 'KEPT' : 'REJECTED'
    const tag = r.mismatch ? (e.label === 'fit' ? 'MISMATCH (liked but we reject)' : 'MISMATCH (no-fit but we keep)') : 'ok'
    lines.push(`[${e.label}] ${verdict}  score=${r.score ?? '-'}  ${tag}`)
    lines.push(`  ${e.title || '(no title)'} @ ${e.company || '(no company)'}   ${e.id}`)
    lines.push(`  location: ${e.location || 'unknown'} (${r.location})   via: ${e.via}   url: ${e.url}`)
    if (e.reason) lines.push(`  user reason: ${e.reason}`)
    if (r.reasons.length) lines.push(`  rejection: ${r.reasons.join('; ')}`)
    lines.push(`  roles: ${r.roles.length ? r.roles.join(', ') : 'none'}`)
    lines.push(`  experience: ${r.parsedExperience}${r.experience ? `  <- ${r.experience}` : ''}`)
    lines.push('')
  }
  const count = (label: string, kept: boolean): number => scored.filter((r) => r.example.label === label && r.kept === kept).length
  lines.push(
    `Summary: ${rows.length} examples, ${rows.length - scored.length} not scored (need text).`,
    `  fit:    kept ${count('fit', true)}, rejected ${count('fit', false)}   <- rejected fits are the ones to tune for`,
    `  no-fit: kept ${count('no-fit', true)}, rejected ${count('no-fit', false)}`,
    `  mismatches: ${rows.filter((r) => r.mismatch).length}   (MIN_SCORE = ${MIN_SCORE})`
  )
  return lines.join('\n')
}
