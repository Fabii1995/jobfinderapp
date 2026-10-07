import { ROLES, type Role } from '../shared/roles'
import type { RawJob } from './sources/types'

/**
 * Multi-label role classification from title AND description. Pure; no I/O.
 * Human-readable spec: .claude/skills/job-relevance-scoring/SKILL.md (keep in sync).
 *
 * Precision over recall: an empty role list beats a wrong tag. A role counts when
 *   1. its keywords appear in the TITLE (always wins; "Full Stack | AI" stays multi-label), or
 *   2. its BODY keywords appear at least MIN_BODY_MENTIONS times in the description
 *      (first BODY_SCAN_CHARS), after discarding mentions that are not real evidence:
 *        - mentions inside an enumerated list of >= LIST_MIN_DISCIPLINES team/discipline words
 *          ("backend, frontend, product, design"), and
 *        - "React Native" (mobile; neither title nor body evidence for frontend).
 * There is no "description head" shortcut: company-intro boilerplate ("first AI-native...",
 * "X is an AI research company") must not tag a role. `ai` additionally uses a narrower body
 * keyword list (AI_BODY_KEYWORDS: role-ish phrases, not bare "AI"); the broad AI_KEYWORDS
 * apply to the title only. Because every body mention needs MIN_BODY_MENTIONS, a job whose
 * title already names a role only gains other roles from repeated, non-list description evidence.
 * "python" is a role like any other.
 */

export const MIN_BODY_MENTIONS = 2
/** Bounds regex cost on huge postings. */
export const BODY_SCAN_CHARS = 20000
/** A mention is "in a list" when its window holds >= this many distinct discipline words. */
export const LIST_MIN_DISCIPLINES = 3
/**
 * Short, ambiguous keywords: a mention that is just one item of a comma enumeration of
 * >= ENUM_MIN_COMMAS ("scripting, troubleshooting, QA, data analysis, ...", "React, Vue,
 * TypeScript, ...") is a skills/tools list entry, not role evidence, and is discarded.
 * Strong keywords (python, backend, frontend, ...) are NOT subject to this.
 */
export const WEAK_BODY_KEYWORDS = ['qa', 'react', 'angular', 'vue', 'vue.js']
export const ENUM_MIN_COMMAS = 2
export const ENUM_ITEM_MAX_WORDS = 3
/** Chars either side of a mention (clipped at sentence/line ends) inspected for list-ness. */
export const LIST_WINDOW_CHARS = 80

// ---- keyword lists (lowercase; matched case-insensitively on word boundaries) --------------

export const QA_KEYWORDS = [
  'בודק תוכנה',
  'בודקת תוכנה',
  'qa',
  'quality assurance',
  'quality engineer',
  'sdet',
  'test engineer',
  'test automation',
  'software tester',
  'tester',
  'manual testing',
  'testautomatisierung',
  'softwaretest',
  'softwaretester',
  'qualitätssicherung',
  'qualitaetssicherung',
  'testmanager'
]

export const BACKEND_KEYWORDS = [
  'בקאנד',
  'backend',
  'back-end',
  'back end',
  'server-side',
  'serverside',
  'serverseitig',
  'api developer',
  'api engineer',
  'microservices',
  'backendentwickler'
]

export const PYTHON_KEYWORDS = ['python', 'פייתון', 'django', 'fastapi', 'flask']

export const AI_KEYWORDS = [
  'ai',
  'a.i.',
  'artificial intelligence',
  'machine learning',
  'ml',
  'llm',
  'llms',
  'generative ai',
  'genai',
  'deep learning',
  'nlp',
  'data scientist',
  'ki',
  'künstliche intelligenz',
  'maschinelles lernen'
]

export const FORWARD_DEPLOYED_KEYWORDS = [
  'forward deployed',
  'forward-deployed',
  'fde',
  'solutions engineer',
  'solutions engineering',
  'implementation engineer',
  'integration engineer',
  'customer engineer',
  'deployment engineer'
]

export const FRONTEND_KEYWORDS = [
  'frontend',
  'front-end',
  'front end',
  'frontendentwickler',
  'react',
  'angular',
  'vue',
  'vue.js',
  'ui developer'
]

export const FULLSTACK_KEYWORDS = ['full stack', 'full-stack', 'fullstack']

/**
 * `ai` keywords for the DESCRIPTION. Role-ish phrases only: bare "AI"/"ML"/"artificial
 * intelligence" are company-intro boilerplate far more often than job content.
 */
export const AI_BODY_KEYWORDS = [
  'machine learning',
  'deep learning',
  'llm',
  'llms',
  'large language model',
  'large language models',
  'generative ai',
  'genai',
  'nlp',
  'ml engineer',
  'ml engineers',
  'ai engineer',
  'ai engineers',
  'ai developer',
  'ai/ml',
  'ai agent',
  'ai agents',
  'prompt engineering',
  'model training',
  'model deployment',
  'maschinelles lernen',
  'künstliche intelligenz'
]

/** Per-role DESCRIPTION keywords; defaults to the title list. */
export const BODY_KEYWORD_OVERRIDES: Partial<Record<Role, string[]>> = { ai: AI_BODY_KEYWORDS }

/** Words that make a comma/slash/"and" enumeration a list of teams or disciplines. */
export const DISCIPLINE_WORDS = [
  'backend', 'back-end', 'frontend', 'front-end', 'front end', 'fullstack', 'full-stack',
  'product', 'design', 'ux', 'ui', 'qa', 'quality assurance', 'testing', 'devops', 'data',
  'ml', 'ai', 'machine learning', 'engineering', 'infrastructure', 'security', 'mobile',
  'sales', 'marketing', 'support', 'operations', 'research', 'analytics', 'platform',
  'sre', 'finance', 'legal', 'hr', 'people', 'recruiting', 'customer success', 'growth'
]

/** Discarded from `ai` body evidence when followed by these ("LLM startup", "ML lab"). */
export const AI_INTRO_FOLLOWERS = /^\s+(?:company|companies|startup|start-up|lab|labs|firm|research)\b/i

export const ROLE_KEYWORDS: Record<Role, string[]> = {
  qa: QA_KEYWORDS,
  backend: BACKEND_KEYWORDS,
  python: PYTHON_KEYWORDS,
  ai: AI_KEYWORDS,
  'forward-deployed': FORWARD_DEPLOYED_KEYWORDS,
  frontend: FRONTEND_KEYWORDS,
  fullstack: FULLSTACK_KEYWORDS
}

// ---- matching ------------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Longest alternatives first so "vue.js" wins over "vue". Global: used for counting. */
function buildMatcher(words: string[]): RegExp {
  const alts = [...words].sort((a, b) => b.length - a.length).map(escapeRe)
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'giu')
}

const TITLE_MATCHERS: Record<Role, RegExp> = Object.fromEntries(
  ROLES.map((r) => [r.slug, buildMatcher(ROLE_KEYWORDS[r.slug])])
) as Record<Role, RegExp>

const BODY_MATCHERS: Record<Role, RegExp> = Object.fromEntries(
  ROLES.map((r) => [r.slug, buildMatcher(BODY_KEYWORD_OVERRIDES[r.slug] ?? ROLE_KEYWORDS[r.slug])])
) as Record<Role, RegExp>

const DISCIPLINE_MATCHER = buildMatcher(DISCIPLINE_WORDS)
const DISCIPLINE_SET = new Set(DISCIPLINE_WORDS)
const REACT_NATIVE_TAIL = /^[\s-]*native(?![\p{L}\p{N}])/iu
const LIST_SEPARATORS = /,|\/|&|\band\b|\bund\b|\bor\b/gi
const SENTENCE_BREAK = /[.!?;\n•]/

/** Block-level tags become line breaks (so list bullets stay separable); other tags vanish. */
function toText(s: string): string {
  return s
    .replace(/<\/?(?:p|div|li|ul|ol|br|h[1-6]|tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t\r\f]+/g, ' ')
    .replace(/ ?\n[ \n]*/g, '\n')
}

interface Hit {
  keyword: string
  index: number
}

function findHits(re: RegExp, text: string): Hit[] {
  return Array.from(text.matchAll(re), (m) => ({ keyword: m[0].toLowerCase(), index: m.index ?? 0 }))
}

/** "React Native" is mobile: not evidence for frontend, in the title or the body. */
function isReactNative(h: Hit, text: string): boolean {
  return h.keyword === 'react' && REACT_NATIVE_TAIL.test(text.slice(h.index + h.keyword.length))
}

/** The +-LIST_WINDOW_CHARS neighbourhood of a hit, clipped to its sentence/line/bullet. */
function windowAround(h: Hit, text: string): { win: string; rel: number } {
  let from = Math.max(0, h.index - LIST_WINDOW_CHARS)
  for (let i = h.index - 1; i >= from; i--) {
    if (SENTENCE_BREAK.test(text[i])) {
      from = i + 1
      break
    }
  }
  const end = h.index + h.keyword.length
  let to = Math.min(text.length, end + LIST_WINDOW_CHARS)
  for (let i = end; i < to; i++) {
    if (SENTENCE_BREAK.test(text[i])) {
      to = i
      break
    }
  }
  return { win: text.slice(from, to), rel: h.index - from }
}

/** True when a WEAK keyword is one short item of a comma enumeration (skills/tools list). */
function inWeakEnumeration(h: Hit, text: string): boolean {
  if (!WEAK_BODY_KEYWORDS.includes(h.keyword)) return false
  const { win, rel } = windowAround(h, text)
  if ((win.match(/,/g) ?? []).length < ENUM_MIN_COMMAS) return false
  const before = win.slice(0, rel)
  const after = win.slice(rel + h.keyword.length)
  const item = before.slice(before.lastIndexOf(',') + 1) + h.keyword + after.split(',')[0]
  return item.trim().split(/\s+/).length <= ENUM_ITEM_MAX_WORDS
}

/**
 * True when the hit is a discipline word inside an enumeration of >= LIST_MIN_DISCIPLINES
 * distinct discipline words ("backend, frontend, product, design"), within its sentence/line.
 */
function inDisciplineList(h: Hit, text: string): boolean {
  if (!DISCIPLINE_SET.has(h.keyword)) return false
  const { win } = windowAround(h, text)
  const words = new Set(findHits(DISCIPLINE_MATCHER, win).map((x) => x.keyword))
  const separators = (win.match(LIST_SEPARATORS) ?? []).length
  return words.size >= LIST_MIN_DISCIPLINES && separators >= LIST_MIN_DISCIPLINES - 1
}

export type RoleEvidenceWhere = 'title' | 'description-repeated'

export interface RoleEvidence {
  role: Role
  where: RoleEvidenceWhere
  /** Matched keywords (lowercased) that counted, at that location. */
  keywords: string[]
}

/** Same decision as classifyRoles, plus why. Ordered like ROLES. */
export function explainRoles(job: Pick<RawJob, 'title' | 'description'>): RoleEvidence[] {
  // "Penetration Tester" is security, not QA.
  const title = (job.title ?? '').replace(/penetration test\w*/gi, ' ')
  const body = toText((job.description ?? '').slice(0, BODY_SCAN_CHARS * 2)).slice(0, BODY_SCAN_CHARS)
  const out: RoleEvidence[] = []
  for (const { slug } of ROLES) {
    const inTitle = findHits(TITLE_MATCHERS[slug], title).filter((h) => !isReactNative(h, title))
    if (inTitle.length) {
      out.push({ role: slug, where: 'title', keywords: inTitle.map((h) => h.keyword) })
      continue
    }
    const counted = findHits(BODY_MATCHERS[slug], body).filter((h) => {
      if (isReactNative(h, body) || inDisciplineList(h, body) || inWeakEnumeration(h, body)) {
        return false
      }
      if (slug === 'ai' && AI_INTRO_FOLLOWERS.test(body.slice(h.index + h.keyword.length))) return false
      return true
    })
    if (counted.length >= MIN_BODY_MENTIONS) {
      out.push({ role: slug, where: 'description-repeated', keywords: counted.map((h) => h.keyword) })
    }
  }
  // A title that names a non-frontend role (Python backend, QA...) is not also "frontend" just
  // because the description repeats React/Angular (requirements, "work with the front-end team").
  const titleNamesOtherRole = out.some(
    (e) => e.where === 'title' && e.role !== 'frontend' && e.role !== 'fullstack'
  )
  if (titleNamesOtherRole) {
    return out.filter((e) => !(e.role === 'frontend' && e.where === 'description-repeated'))
  }
  return out
}

export function classifyRoles(job: Pick<RawJob, 'title' | 'description'>): Role[] {
  return explainRoles(job).map((e) => e.role)
}
