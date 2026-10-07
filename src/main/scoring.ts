import type { RawJob } from './sources/types'

// Role classification lives in ./roles (pure, also title+description); re-exported for convenience.
export { classifyRoles, explainRoles } from './roles'

/**
 * Default keyword heuristics for junior/entry-level fit. Pure; no I/O.
 * Human-readable spec: .claude/skills/job-relevance-scoring/SKILL.md (keep in sync).
 * Works with training-data/examples.json empty or absent (it is not read here).
 * Score is an integer 0..100.
 */

// ---- keyword lists (lowercase; matched on Unicode letter boundaries) -----------------------

/** Core target roles: QA, backend, Python, AI solutions, FDE. */
export const STRONG_ROLE_KEYWORDS = [
  'qa',
  'quality assurance',
  'sdet',
  'test engineer',
  'test automation',
  'automation engineer',
  'software tester',
  'tester',
  'backend',
  'back-end',
  'back end',
  'python',
  'ai solutions',
  'solutions engineer',
  'forward deployed',
  'forward-deployed',
  'fde',
  'implementation engineer',
  'integration engineer',
  // Hebrew
  'בודק תוכנה',
  'בודקת תוכנה',
  'בקאנד',
  'פייתון'
]

/** Adjacent general software roles. */
export const GENERAL_ROLE_KEYWORDS = [
  'software engineer',
  'software developer',
  'developer',
  'programmer',
  'full stack',
  'full-stack',
  'fullstack',
  'application engineer',
  'web developer',
  'web development',
  'software development',
  'api engineer',
  'devops',
  'machine learning engineer',
  'ml engineer',
  'ai engineer',
  'software dev engineer',
  'software development engineer',
  'sde',
  // Firmware / embedded software / drivers are software roles (physical-design style hardware
  // titles are excluded through HARDWARE_TITLE_RE). Bare "driver" is NOT a keyword ("Delivery Driver").
  'firmware',
  'embedded software',
  'embedded developer',
  'device driver',
  'device drivers',
  'kernel driver',
  'kernel drivers',
  'driver developer',
  'driver engineer',
  'drivers developer',
  'drivers engineer',
  'software',
  // Hebrew
  'מפתח',
  'מפתחת',
  'מהנדס תוכנה',
  'מהנדסת תוכנה',
  'תוכניתן',
  'תוכניתנית',
  'מתכנת',
  'מתכנתת'
]

/** The bare word "software" alone is too weak to earn the no-experience baseline ("Software Sales Rep"). */
const BARE_GENERAL_KEYWORDS = ['software']

/**
 * Title phrases removed before role matching: "developer" here is sales/marketing, not software
 * ("Junior Business Developer" must not read as a software role).
 */
export const NON_SOFTWARE_TITLE_PHRASES =
  /(?<![\p{L}\p{N}])(?:business|sales|market|marketing|partner|partnerships|partnership|recruit\w*|content|learning|curriculum|real estate|channel|account|talent)\s+(?:developers?|development)(?![\p{L}\p{N}])/giu

/**
 * Hardware/chip-design titles: "Physical Design Backend Engineer" (chip back-end), "IC Test Engineer"
 * and "Design Automation" are not software backend/QA. In such titles the generic strong keywords
 * (backend, test engineer, automation engineer, tester) are ignored; python/QA-software still count.
 */
export const HARDWARE_TITLE_RE =
  /(?<![\p{L}\p{N}])(?:physical design|asic|rtl|vlsi|soc|ic|silicon|analog|mixed[- ]signal|layout|fpga|dft|sta|hardware|rf|post[- ]silicon|pre[- ]silicon|design automation)(?![\p{L}\p{N}])/iu
const HARDWARE_IGNORED_KEYWORDS =
  /(?<![\p{L}\p{N}])(?:backend|back-end|back end|test engineer|test automation|automation engineer|tester)(?![\p{L}\p{N}])/giu

/** Title signals that the role is junior/entry level (full junior weight). */
export const JUNIOR_TITLE_KEYWORDS = [
  'junior',
  'jr',
  'entry level',
  'entry-level',
  'graduate',
  'graduates',
  'new grad',
  'new grads',
  'new college grad',
  'new college graduate',
  'early career',
  'trainee',
  'apprentice',
  'apprenticeship',
  'engineer i',
  'developer i',
  'level 1',
  // Hebrew
  "ג'וניור",
  'גוניור',
  "ג'וניורית",
  'מתחיל',
  'מתחילה',
  'מתחילים',
  // Title only: in a body "בוגר/ת תואר" just means "has a degree", so these are not body signals.
  'בוגר',
  'בוגרת',
  'בוגרים',
  'בוגרות',
  'התחלתי',
  'התחלתית',
  'ללא ניסיון'
]

/** "Associate" titles: a moderate junior signal (JUNIOR_TITLE_KEYWORDS carry the full weight). */
export const ASSOCIATE_TITLE_KEYWORDS = ['associate']

/**
 * Titles that are intern / student roles. They are NOT junior-positive: the score is capped at
 * INTERN_TITLE_CAP (< MIN_SCORE) even when a junior/graduate word is also present
 * ("Graduate Student", "QA Intern"). Title only: "students welcome" in a body is not a penalty.
 * Confirmed by the user (2026-10-07): intern/student/working-student roles do NOT count as junior;
 * they are part-time or temporary placements, not the junior full-time roles the user wants.
 */
export const INTERN_TITLE_KEYWORDS = [
  'intern',
  'interns',
  'internship',
  'student',
  'students',
  'working student',
  'werkstudent',
  'praktikum',
  'praktikant',
  'סטודנט',
  'סטודנטית',
  'סטודנטים',
  'מתמחה',
  'התמחות'
]

/** Title signals of seniority (disqualifying). */
export const SENIOR_TITLE_KEYWORDS = [
  'senior',
  'sr',
  'staff',
  'principal',
  'lead',
  'manager',
  'director',
  'head of',
  'vp',
  'vice president',
  'chief',
  'architect',
  'expert',
  'engineer iii',
  'engineer iv',
  'developer iii',
  'developer iv',
  // Hebrew
  'בכיר',
  'בכירה',
  'ראש צוות',
  'ראשת צוות',
  'מנהל',
  'מנהלת',
  'מנהלים',
  'בכירים',
  'ארכיטקט',
  'ארכיטקטית'
]

/** Title signals of mid-level (mild penalty). */
export const MID_TITLE_KEYWORDS = ['engineer ii', 'developer ii', 'mid-level', 'mid level']

/** Source seniority tags (lowercase) treated as strong signals. */
export const ENTRY_SENIORITY_TAGS = ['entry-level']
export const SENIOR_SENIORITY_TAGS = ['senior', 'manager', 'director', 'executive']
export const INTERN_SENIORITY_TAGS = ['intern', 'internship']

// ---- body (description) experience language ------------------------------------------------

/** Explicit "no experience needed" style language (strong junior signal). */
export const STRONG_BODY_PATTERNS: RegExp[] = [
  /\bno (?:prior |previous |relevant |professional |work |industry )*experience\b/i,
  /\b(?:0|zero) years?(?: of)? (?:\w+ ){0,2}experience/i,
  /(?<!\bnot (?:an? )?)(?<!\bnon[- ])\bentry[- ]level\b/i,
  /\b(?:recent|fresh) (?:college |university )?graduates?\b/i,
  /\bnew (?:college |university )?grads?\b/i,
  /\bnew college graduates?\b/i,
  // Hebrew: "no experience", "no experience required", "experience not required"
  /ללא ניסיון/,
  /אין צורך בניסיון/,
  /לא נדרש ניסיון/,
  /ניסיון קודם אינו נדרש/
]

/**
 * "junior" in a description counts only when it describes the ROLE. It does not count when a
 * mentoring/supervising verb precedes it in the same clause ("mentor junior engineers"), when it
 * is followed by a plural people noun, or inside "junior and senior"/"from junior to senior".
 */
const JUNIOR_WORD = /(?<![\p{L}\p{N}])(?:junior|ג'וניור)(?![\p{L}\p{N}])/giu
const JUNIOR_SUPERVISE_BEFORE =
  /\b(?:mentor\w*|coach\w*|guid\w*|support\w*|manag\w*|lead\w*|train\w*|supervis\w*|teach\w*|onboard\w*|develop\w*|grow\w*|help\w*|assist\w*|oversee\w*|work(?:ing)? with|collaborat\w* with|alongside|review\w*|upskill\w*)\b(?:\W+\w+){0,3}\W*$/i
const JUNIOR_PEOPLE_AFTER =
  /^\W*(?:and|or|to|&|\/|-|–)?\W*(?:senior|mid)\b|^\W*(?:engineers|developers|devs|team members|colleagues|staff|employees|talent|members|people|analysts|programmers|testers)\b/i
const JUNIOR_PEOPLE_BEFORE = /\b(?:senior|mid(?:-level)?)\W*(?:and|or|to|&|\/|-|–)?\W*$/i
/** Singular role phrasing after "junior" ("junior position/role/level/developer"): stronger. */
const JUNIOR_ROLE_AFTER = /^\W*(?:position|role|level|opening|opportunity|developer|engineer|candidate|software)\b/i

/** Hebrew experience range / minimum (the digits come first in the English forms too). */
const HE_RANGE = /(\d{1,2})\s*(?:-|–|עד|ל)\s*(\d{1,2})\s*שנ(?:ים|ות|ה)(?: של)? ניסיון/g
const HE_UPTO = /עד (\d{1,2}) שנ(?:ים|ות|ה)(?: של)? ניסיון/g
const HE_MIN = /(\d{1,2})\s*\+?\s*שנ(?:ים|ות|ה)(?: של)? ניסיון/g
/** Reversed Hebrew order: "ניסיון של 0-2 שנים", "ניסיון של 2 שנים ומעלה", "ניסיון של לפחות 3 שנים". */
const HE_RANGE_AFTER = /ניסיון(?:\s+\p{L}+){0,2}?\s+של\s+(\d{1,2})\s*(?:-|–|עד)\s*(\d{1,2})\s*שנ(?:ים|ות|ה)/gu
const HE_MIN_AFTER = /ניסיון(?:\s+\p{L}+){0,2}?\s+(?:של|לפחות)\s+(?:לפחות\s+)?(\d{1,2})\s*\+?\s*שנ(?:ים|ות|ה)/gu

const RANGE_RE = /(?<![\d.])(\d{1,2})\s*\+?\s*(?:-|–|—|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/gi
const UPTO_RE = /\b(?:up to|less than|under|maximum of|max(?:imum)?\.?)\s*(\d{1,2})\s*(?:years?|yrs?)\b/gi
const MIN_PLUS_RE = /(?<![\d.-])(\d{1,2})\s*\+\s*(?:years?|yrs?)\b(?!\s+ago)/gi
const MIN_AT_LEAST_RE =
  /\b(?:at least|minimum(?: of)?|min\.?|over|more than)\s*(\d{1,2})\s*(?:years?|yrs?)\b/gi
const MIN_EXP_OF_RE = /\bexperience\s*(?:of|:|-|–)\s*(?:at least\s*)?(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/gi
/**
 * "N years ... experience" with up to 5 words in between ("5 years of hands-on Python development
 * experience"). "user/customer/developer/... experience" is a product phrase, not a requirement
 * ("10 years building the best user experience").
 */
const MIN_PLAIN_RE =
  /(?<![\d.+-])(\d{1,2})\s*(?:years?|yrs?)(?:'|’)?\s*(?:of\s+)?(?:\w+[\s,/-]+){0,5}(?<!\b(?:user|customer|client|developer|candidate|employee|guest|shopper|player|ux|cx|buyer|patient)s?[\s-])(?:experience|background)\b/gi

const EN_NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10
}
const HE_NUMBER_WORDS: Record<string, number> = {
  שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5, שש: 6, שישה: 6, שבע: 7, שבעה: 7,
  שמונה: 8, תשע: 9, תשעה: 9, עשר: 10, עשרה: 10
}

/**
 * Number words become digits so the regexes see them: "three years" -> "3 years",
 * Hebrew "שנתיים ניסיון" -> "2 שנים ניסיון", "שנה ניסיון" -> "1 שנה ניסיון", "שלוש שנות ניסיון" -> "3 ...".
 */
function normalizeExperienceText(text: string): string {
  return text
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)(?=[\s-]*(?:\+|plus)?[\s-]*(?:years?|yrs?)\b)/gi, (w) => String(EN_NUMBER_WORDS[w.toLowerCase()]))
    .replace(/(\d)[\s-]*plus\s+(?=years?|yrs?)/gi, '$1+ ')
    .replace(/(?<![\p{L}\p{N}])שנתיים(?![\p{L}\p{N}])/gu, '2 שנים')
    .replace(/(?<![\p{L}\p{N}])שנה(?:\s+אחת)?(?=\s+(?:של\s+)?ניסיון)/gu, '1 שנה')
    .replace(/(?<=ניסיון(?:\s+\p{L}+){0,2}?\s+(?:של|לפחות)\s+)שנה(?![\p{L}\p{N}])/gu, '1 שנה')
    .replace(/(?<![\p{L}\p{N}])(שלושה?|ארבעה?|חמישה?|חמש|שש|שישה|שבעה?|שמונה|תשעה?|עשרה?)(?=\s+שנ(?:ים|ות))/gu, (w) => String(HE_NUMBER_WORDS[w]))
}

/**
 * Any duration-of-experience wording, parsed or not. Used to withhold the no-experience baseline
 * when the posting talks about years of experience in a shape extractExperience missed.
 */
const EXPERIENCE_WORDING_RE =
  /(?:\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|several|multiple|many|proven|extensive|significant)\b)[^.\n]{0,40}(?:years?|yrs?)[^.\n]{0,40}(?<!\b(?:user|customer|client|developer|candidate|employee|guest|shopper|player|ux|cx|buyer|patient)s?[\s-])experience|years?\s+of\s+(?:\w+\s+){0,4}experience|experience[^.\n]{0,40}\d+\s*\+?\s*(?:years?|yrs?)|(?<![\p{L}\p{N}])(?:שנה|שנתיים|שנות|שנים)(?![\p{L}\p{N}])[^.\n]{0,30}ניסיון|ניסיון[^.\n]{0,40}(?<![\p{L}\p{N}])(?:שנה|שנתיים|שנות|שנים)(?![\p{L}\p{N}])/iu

/** One experience statement found in a description. max=null means open-ended ("3+"). */
export interface ExperienceStatement {
  min: number
  max: number | null
}

/**
 * Extracts experience statements. Ranges are consumed first (so "0-3 years" is not also read as
 * "3 years"), then "up to N", "N+", "at least N", and a bare "N years of ... experience".
 * "5 years ago" and bare tenure statements are not requirements.
 */
export function bodyStatesExperienceDuration(body: string): boolean {
  return extractExperience(body).length > 0 || EXPERIENCE_WORDING_RE.test(normalizeExperienceText(body))
}

export function extractExperience(text: string): ExperienceStatement[] {
  const out: ExperienceStatement[] = []
  let rest = normalizeExperienceText(text)
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => ExperienceStatement | null): void => {
    rest = rest.replace(re, (...args) => {
      const m = args.slice(0, args.length - 2) as unknown as RegExpMatchArray
      const st = fn(m)
      if (st) out.push(st)
      return ' '
    })
  }
  take(RANGE_RE, (m) => {
    const a = Number(m[1])
    const b = Number(m[2])
    return { min: Math.min(a, b), max: Math.max(a, b) }
  })
  take(HE_RANGE, (m) => ({ min: Math.min(+m[1], +m[2]), max: Math.max(+m[1], +m[2]) }))
  take(HE_RANGE_AFTER, (m) => ({ min: Math.min(+m[1], +m[2]), max: Math.max(+m[1], +m[2]) }))
  take(UPTO_RE, (m) => ({ min: 0, max: Number(m[1]) }))
  take(HE_UPTO, (m) => ({ min: 0, max: Number(m[1]) }))
  take(MIN_PLUS_RE, (m) => ({ min: Number(m[1]), max: null }))
  take(MIN_AT_LEAST_RE, (m) => ({ min: Number(m[1]), max: null }))
  take(MIN_EXP_OF_RE, (m) => ({ min: Number(m[1]), max: null }))
  take(HE_MIN_AFTER, (m) => ({ min: Number(m[1]), max: null }))
  take(HE_MIN, (m) => ({ min: Number(m[1]), max: null }))
  take(MIN_PLAIN_RE, (m) => ({ min: Number(m[1]), max: null }))
  return out
}

/** Junior strength of the description: 'strong' | 'moderate' | 'weak' | null. */
export type BodyJunior = 'strong' | 'moderate' | 'weak' | null

const RANK: Record<Exclude<BodyJunior, null>, number> = { weak: 1, moderate: 2, strong: 3 }

function juniorWordInBody(body: string): 'role' | 'word' | null {
  let best: 'role' | 'word' | null = null
  for (const m of body.matchAll(JUNIOR_WORD)) {
    const idx = m.index ?? 0
    const before = body.slice(Math.max(0, idx - 48), idx)
    // Clause start: only look at text since the last sentence break.
    const clause = before.slice(Math.max(before.lastIndexOf('.'), before.lastIndexOf('\n'), before.lastIndexOf(';')) + 1)
    const after = body.slice(idx + m[0].length, idx + m[0].length + 40)
    if (JUNIOR_SUPERVISE_BEFORE.test(clause)) continue
    if (JUNIOR_PEOPLE_AFTER.test(after) || JUNIOR_PEOPLE_BEFORE.test(clause)) continue
    if (JUNIOR_ROLE_AFTER.test(after)) return 'role'
    best = 'word'
  }
  return best
}

export function bodyJuniorStrength(body: string): BodyJunior {
  let best: BodyJunior = null
  const bump = (s: Exclude<BodyJunior, null>): void => {
    if (best === null || RANK[s] > RANK[best]) best = s
  }
  if (STRONG_BODY_PATTERNS.some((p) => p.test(body))) bump('strong')
  const statements = extractExperience(body)
  // A stated "2+" (or higher) elsewhere in the posting outranks a "1+" bullet (Amazon: "2+ years ... software
  // development" next to "1+ years ... design"): the real requirement is the larger one.
  const highestMin = Math.max(0, ...statements.map((st) => st.min))
  for (const st of statements) {
    if (st.min === 0 && st.max !== null) {
      if (st.max <= 2) bump('strong')
      else if (st.max === 3) bump('moderate')
      else if (st.max <= 5) bump('weak')
    } else if (st.min === 1 && st.max !== null) {
      if (st.max <= 2) bump('moderate')
      else if (st.max === 3) bump('weak')
    } else if (st.min === 0 && st.max === null) {
      bump('strong') // "0+ years"
    } else if (st.min === 1 && st.max === null && highestMin <= 1) {
      bump('moderate') // "1+ years" / "1 year of experience" counts (user decision); "2+" does not
    }
  }
  const j = juniorWordInBody(body)
  if (j === 'role') bump('moderate')
  else if (j === 'word') bump('weak')
  return best
}

/** A stated minimum of >= MIN_YEARS_PENALTY years ("3+", "3-5", "at least 4", "5 years of experience"). */
export const MIN_YEARS_PENALTY = 3
export function bodyRequiresExperience(body: string): boolean {
  return extractExperience(body).some((s) => s.min >= MIN_YEARS_PENALTY)
}

// ---- weights -------------------------------------------------------------------------------

export const WEIGHTS = {
  strongRoleTitle: 30,
  generalRoleTitle: 20,
  roleInBodyOnly: 5,
  juniorTitle: 40,
  associateTitle: 20,
  entryTag: 35,
  /** Description junior language, by strength (see bodyJuniorStrength). */
  bodyStrong: 30,
  bodyModerate: 20,
  bodyWeak: 8,
  /**
   * Software-role title whose posting states NO experience requirement at all: a junior-ish signal
   * sized so a plain "Software Engineer" (general 20) lands exactly at MIN_SCORE (30). Competes via
   * max() with the title/body junior points (never additive), is not part of juniorConfirm, and is
   * withheld when any experience duration is stated ("2+ years" included), for hardware titles,
   * and for mid/senior tags.
   */
  noExperienceBaseline: 10,
  /** Extra when BOTH the title and a strong/moderate description say junior. */
  juniorConfirm: 10,
  midTag: -10,
  midTitle: -15,
  seniorTag: -60,
  seniorBody: -25
} as const

/** Max score for a title with no target-role keyword: junior-but-irrelevant (e.g. junior marketing) must stay below MIN_SCORE in refresh.ts. */
export const NO_ROLE_TITLE_CAP = 25

/**
 * Max score for a title whose only role evidence is a GENERAL software word (developer, software
 * engineer, devops...). A junior Java/.NET developer is a fine junior software role but must not
 * tie with a junior QA/backend/Python title; strong-role titles can reach 100, these top out here.
 */
export const GENERAL_ROLE_ONLY_CAP = 65

/** Intern/student titles: below MIN_SCORE (30) whatever else matched. */
export const INTERN_TITLE_CAP = 20

/**
 * Senior-keyword titles (senior, sr, staff, principal, lead, head of, manager, director,
 * architect, Hebrew בכיר...) are an unconditional hard reject: score 0, checked before any
 * description/tag junior signal. Only the TITLE counts.
 */
export const SENIOR_TITLE_SCORE = 0

// ---- helpers -------------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildMatcher(words: string[]): RegExp {
  const alts = [...words].sort((a, b) => b.length - a.length).map(escapeRe)
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'iu')
}

const STRONG_ROLE_RE = buildMatcher(STRONG_ROLE_KEYWORDS)
const GENERAL_ROLE_RE = buildMatcher(GENERAL_ROLE_KEYWORDS)
const GENERAL_ROLE_NONBARE_RE = buildMatcher(GENERAL_ROLE_KEYWORDS.filter((k) => !BARE_GENERAL_KEYWORDS.includes(k)))
const JUNIOR_TITLE_RE = buildMatcher(JUNIOR_TITLE_KEYWORDS)
const ASSOCIATE_TITLE_RE = buildMatcher(ASSOCIATE_TITLE_KEYWORDS)
const INTERN_TITLE_RE = buildMatcher(INTERN_TITLE_KEYWORDS)
const SENIOR_TITLE_RE = buildMatcher(SENIOR_TITLE_KEYWORDS)
const MID_TITLE_RE = buildMatcher(MID_TITLE_KEYWORDS)

/** Bounds regex cost on huge postings; requirements usually sit well inside this. */
const BODY_CHARS = 12000

/**
 * Hebrew postings write gender as "בודק/ת", "מפתח/ית", "מהנדס/ת", "מפתח(ת)": strip the marker so the
 * phrase keywords ("בודק תוכנה", "מהנדס תוכנה") match.
 */
const HE_APOSTROPHE_VARIANTS = /(?<=\p{Script=Hebrew})[׳’‘ʼ′´`](?=\p{Script=Hebrew})/gu

/** Maps geresh / curly apostrophes between Hebrew letters to ASCII ' so ג׳וניור == ג'וניור. */
function normalizeHebrewApostrophes(text: string): string {
  return text.replace(HE_APOSTROPHE_VARIANTS, "'")
}

export function normalizeTitle(title: string): string {
  return normalizeHebrewApostrophes(title)
    .replace(/(?<=\p{L})\s*\/\s*(?:ת|ית|ה|ים|ות)(?![\p{L}\p{N}])/gu, '')
    .replace(/(?<=\p{L})\s*\((?:ת|ית|ה)\)/gu, '')
}

/** True for titles scoring can never accept (senior keyword or intern/student): connectors may skip detail fetches. */
export function isHardRejectTitle(title: string): boolean {
  const t = normalizeTitle(title)
  return INTERN_TITLE_RE.test(t) || SENIOR_TITLE_RE.test(t)
}

/** True when the title names a target/general software role (same cleanup scoreJob applies). Cheap pre-filter for connectors. */
export function titleHasSoftwareRole(title: string): boolean {
  const t = normalizeTitle(title).replace(NON_SOFTWARE_TITLE_PHRASES, ' ').replace(/penetration test\w*/gi, ' ')
  return STRONG_ROLE_RE.test(t) || GENERAL_ROLE_RE.test(t)
}

// ---- scoring -------------------------------------------------------------------------------

export function scoreJob(raw: RawJob): number {
  const title = normalizeTitle(raw.title ?? '')
  if (SENIOR_TITLE_RE.test(title)) return SENIOR_TITLE_SCORE
  let roleTitle = title.replace(NON_SOFTWARE_TITLE_PHRASES, ' ').replace(/penetration test\w*/gi, ' ')
  if (HARDWARE_TITLE_RE.test(roleTitle)) roleTitle = roleTitle.replace(HARDWARE_IGNORED_KEYWORDS, ' ')
  const body = normalizeHebrewApostrophes((raw.description ?? '').slice(0, BODY_CHARS))
  const tags = (raw.seniority ?? []).map((t) => t.toLowerCase())

  const hasEntryTag = tags.some((t) => ENTRY_SENIORITY_TAGS.includes(t))
  const hasInternTag = tags.some((t) => INTERN_SENIORITY_TAGS.includes(t))
  const hasSeniorTag = !hasEntryTag && tags.some((t) => SENIOR_SENIORITY_TAGS.includes(t))
  const hasMidTag = tags.includes('mid-level')

  let score = 0

  // Role relevance (title). Without it a junior posting still isn't a target role.
  const strongTitle = STRONG_ROLE_RE.test(roleTitle)
  const generalTitle = !strongTitle && GENERAL_ROLE_RE.test(roleTitle)
  if (strongTitle) score += WEIGHTS.strongRoleTitle
  else if (generalTitle) score += WEIGHTS.generalRoleTitle
  else if (STRONG_ROLE_RE.test(body)) score += WEIGHTS.roleInBodyOnly

  // Junior signals: best of title / description, plus a confirmation bonus when both agree.
  const titlePts = JUNIOR_TITLE_RE.test(title)
    ? WEIGHTS.juniorTitle
    : ASSOCIATE_TITLE_RE.test(title)
      ? WEIGHTS.associateTitle
      : 0
  const bodyStrength = bodyJuniorStrength(body)
  const bodyPts =
    bodyStrength === 'strong'
      ? WEIGHTS.bodyStrong
      : bodyStrength === 'moderate'
        ? WEIGHTS.bodyModerate
        : bodyStrength === 'weak'
          ? WEIGHTS.bodyWeak
          : 0
  const baselinePts =
    (strongTitle || GENERAL_ROLE_NONBARE_RE.test(roleTitle)) &&
    !HARDWARE_TITLE_RE.test(roleTitle) &&
    !hasMidTag &&
    !hasSeniorTag &&
    !MID_TITLE_RE.test(title) &&
    !bodyStatesExperienceDuration(body)
      ? WEIGHTS.noExperienceBaseline
      : 0
  score += Math.max(titlePts, bodyPts, baselinePts)
  if (titlePts > 0 && bodyPts >= WEIGHTS.bodyModerate) score += WEIGHTS.juniorConfirm
  if (hasEntryTag) score += WEIGHTS.entryTag

  // Senior / experience penalties.
  if (hasSeniorTag) score += WEIGHTS.seniorTag
  else {
    if (hasMidTag) score += WEIGHTS.midTag
    if (MID_TITLE_RE.test(title)) score += WEIGHTS.midTitle
    if (bodyRequiresExperience(body)) score += WEIGHTS.seniorBody
  }

  const titleHasRole = strongTitle || generalTitle
  if (!titleHasRole) score = Math.min(score, NO_ROLE_TITLE_CAP)
  else if (!strongTitle) score = Math.min(score, GENERAL_ROLE_ONLY_CAP)
  if (hasSeniorTag) score = Math.min(score, 15)
  if (INTERN_TITLE_RE.test(title) || hasInternTag) score = Math.min(score, INTERN_TITLE_CAP)
  return Math.max(0, Math.min(100, Math.round(score)))
}
