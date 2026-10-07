import type { RawJob, WorkMode } from './sources/types'

/**
 * Location normalization + the Israel/work-mode ingest filter. Pure; no I/O.
 *
 * Israel is recognised ONLY by
 *   1. a country signal: the word "Israel" / "ישראל" in text, or a structured country field that
 *      is exactly IL / ISR / Israel, or
 *   2. an allowlist of Israeli cities (English + Hebrew spellings).
 * A bare "IL" token in free text is NEVER a signal ("Chicago, IL" is Illinois). Amazon's
 * "IL, Tel Aviv" matches through the city / its structured country_code ISR, not the "IL".
 */

export interface NormalizedLocation {
  /** 'IL' when any listed location is in Israel; otherwise the structured 2-letter country if given, else null. */
  country: string | null
  city: string | null
  workMode: WorkMode
}

export interface LocationInput {
  /** Free-text location(s). */
  location?: string | null
  /** Additional free-text locations (multi-location postings). */
  locations?: Array<string | null | undefined>
  /** Structured country (ISO-2, ISO-3 or name). */
  country?: string | null
  /** Structured city. */
  city?: string | null
  /** Structured work arrangement: 'Hybrid', 'On-site', 'Remote', 'onsite', 'flex', ... */
  workplaceType?: string | null
  /** Source "remote" boolean. Only used when no workplaceType is given. */
  isRemote?: boolean | null
}

/** Canonical English name -> spellings (lowercase). Hebrew included. Matched on letter boundaries. */
const CITY_SPELLINGS: Record<string, string[]> = {
  'Tel Aviv': ['tel aviv', 'tel-aviv', 'tel aviv-yafo', 'tel aviv yafo', 'תל אביב', 'תל-אביב', 'תל אביב-יפו'],
  Jerusalem: ['jerusalem', 'ירושלים'],
  Haifa: ['haifa', 'חיפה'],
  Herzliya: ['herzliya', 'herzlia', 'herzeliya', 'הרצליה'],
  "Ra'anana": ["ra'anana", 'raanana', 'ra’anana', 'רעננה'],
  'Petah Tikva': ['petah tikva', 'petach tikva', 'petah-tikva', 'petah tikvah', 'פתח תקווה', 'פתח תקוה'],
  'Ramat Gan': ['ramat gan', 'ramat-gan', 'רמת גן'],
  Netanya: ['netanya', 'natanya', 'נתניה'],
  "Be'er Sheva": ["be'er sheva", 'beer sheva', 'beersheba', "be'er-sheva", 'beer-sheva', 'באר שבע'],
  Yokneam: ['yokneam', 'yokne’am', 'yoqneam', 'יוקנעם'],
  Rehovot: ['rehovot', 'rehovoth', 'רחובות'],
  'Kfar Saba': ['kfar saba', 'kfar sava', 'kfar-saba', 'כפר סבא'],
  Holon: ['holon', 'חולון'],
  'Rishon LeZion': ['rishon lezion', 'rishon le zion', 'rishon le-zion', 'rishon-lezion', 'ראשון לציון'],
  Givatayim: ['givatayim', 'giv’atayim', "giv'atayim", 'גבעתיים'],
  'Hod Hasharon': ['hod hasharon', 'hod ha-sharon', 'הוד השרון'],
  Modiin: ["modi'in", 'modiin', 'modi’in', 'מודיעין'],
  Ashdod: ['ashdod', 'אשדוד'],
  Ashkelon: ['ashkelon', 'אשקלון'],
  Caesarea: ['caesarea', 'קיסריה'],
  'Bnei Brak': ['bnei brak', 'bene beraq', 'בני ברק'],
  'Rosh HaAyin': ['rosh haayin', "rosh ha'ayin", 'rosh ha-ayin', 'ראש העין'],
  'Airport City': ['airport city'],
  'Or Yehuda': ['or yehuda', 'אור יהודה'],
  'Nes Ziona': ['nes ziona', 'נס ציונה'],
  Hadera: ['hadera', 'חדרה'],
  Afula: ['afula', 'עפולה'],
  Eilat: ['eilat', 'אילת'],
  'Beit Shemesh': ['beit shemesh', 'בית שמש'],
  'Zichron Yaakov': ['zichron yaakov', 'zikhron yaakov', 'זכרון יעקב'],
  Yavne: ['yavne', 'יבנה'],
  'Migdal HaEmek': ['migdal haemek', 'migdal ha-emek', 'מגדל העמק'],
  'Tirat Carmel': ['tirat carmel', 'tirat hacarmel', 'טירת כרמל'],
  Karmiel: ['karmiel', 'כרמיאל'],
  'Even Yehuda': ['even yehuda', 'אבן יהודה'],
  'Kiryat Gat': ['kiryat gat', 'qiryat gat', 'קריית גת'],
  'Kiryat Shmona': ['kiryat shmona', 'קריית שמונה']
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const LB = '(?<![\\p{L}\\p{N}])'
const LA = '(?![\\p{L}\\p{N}])'

/**
 * Hebrew attaches prepositions to the next word ("ברמת גן" = in Ramat Gan, "מתל אביב" = from Tel Aviv),
 * so Hebrew spellings accept up to two prefix letters (ו ב ל מ ה כ ש) before the city.
 */
const HE_PREFIX = '[ובלמהכש]{0,2}'
const HAS_HEBREW = /[֐-׿]/

const CITY_ENTRIES: Array<{ name: string; re: RegExp }> = Object.entries(CITY_SPELLINGS).map(
  ([name, spellings]) => {
    const sorted = [...spellings].sort((a, b) => b.length - a.length)
    const alt = (list: string[]): string => list.map(escapeRe).join('|')
    const he = sorted.filter((x) => HAS_HEBREW.test(x))
    const en = sorted.filter((x) => !HAS_HEBREW.test(x))
    const parts = [
      en.length ? `${LB}(?:${alt(en)})${LA}` : '',
      he.length ? `${LB}${HE_PREFIX}(?:${alt(he)})${LA}` : ''
    ].filter(Boolean)
    return { name, re: new RegExp(parts.join('|'), 'iu') }
  }
)

/** The word Israel (English, Hebrew). Deliberately has no "IL" alternative. */
const ISRAEL_WORD = new RegExp(`${LB}(?:israel|${HE_PREFIX}ישראל)${LA}`, 'iu')

/** True when a structured country value denotes Israel (exact values only). */
export function isIsraelCountryCode(v: string | null | undefined): boolean {
  if (!v) return false
  return /^(?:il|isr|israel|ישראל)$/i.test(v.trim())
}

/** The Israeli city mentioned EARLIEST in the text (so "Israel, Yokneam; Tel Aviv" gives Yokneam). */
function firstIsraeliCity(text: string): string | null {
  let best: { name: string; at: number } | null = null
  for (const c of CITY_ENTRIES) {
    const m = c.re.exec(text)
    if (m && (best === null || m.index < best.at)) best = { name: c.name, at: m.index }
  }
  return best?.name ?? null
}

/** True when free text names Israel or an allowlisted Israeli city. Never matches a bare "IL". */
export function isIsraelText(text: string | null | undefined): boolean {
  if (!text) return false
  return ISRAEL_WORD.test(text) || firstIsraeliCity(text) !== null
}

/** Work arrangement from a structured value ('Hybrid', 'On-site', 'Remote', 'flex', ...). */
export function parseWorkMode(v: string | null | undefined): WorkMode {
  if (!v) return 'unknown'
  const t = v.toLowerCase()
  if (/hybrid|flex/.test(t)) return 'hybrid'
  if (/on[\s_-]?site|in[\s_-]?office|office/.test(t)) return 'onsite'
  if (/remote|telecommut|work from home|wfh|distributed/.test(t)) return 'remote'
  return 'unknown'
}

function isOnsiteWord(text: string): boolean {
  return /\bon[\s-]?site\b|\bin[\s-]?office\b/i.test(text)
}

/** Work arrangement hinted by free location text ("Remote - Israel", "Tel Aviv (Hybrid)"). */
function workModeFromText(text: string): WorkMode {
  if (/\bhybrid\b/i.test(text)) return 'hybrid'
  if (isOnsiteWord(text)) return 'onsite'
  if (/\bremote\b|\bwork from home\b|\bwfh\b/i.test(text)) return 'remote'
  return 'unknown'
}

/**
 * Text hints judged per location, looking only at the Israeli ones when any are identifiable:
 * "Tel Aviv; Remote (US)" is not remote-only, "Remote - Israel" is.
 */
function workModeFromTexts(texts: string[]): WorkMode {
  const israeli = texts.filter((t) => isIsraelText(t))
  const pool = israeli.length > 0 ? israeli : texts
  const modes = pool.map(workModeFromText)
  if (modes.includes('hybrid')) return 'hybrid'
  if (modes.includes('onsite')) return 'onsite'
  if (modes.length > 0 && modes.every((m) => m === 'remote')) return 'remote'
  return 'unknown'
}

function canonicalCity(raw: string): string {
  return firstIsraeliCity(raw) ?? raw.trim()
}

/**
 * Normalizes a posting's location. Multi-location: Israel if ANY listed location is in Israel
 * (the city is then the first Israeli one). Work mode: a structured workplaceType wins; else the
 * isRemote flag; else hints in the text; else 'unknown'. isRemote=true alone never overrides an
 * explicit workplaceType (Comeet reports is_remote=true for hybrid postings, and must not be used
 * on its own to exclude).
 */
export function normalizeLocation(input: LocationInput): NormalizedLocation {
  const texts = [input.location, ...(input.locations ?? [])].filter(
    (t): t is string => typeof t === 'string' && t.trim().length > 0
  )
  const joined = texts.join(' ; ')
  const structuredCity = typeof input.city === 'string' && input.city.trim() ? input.city.trim() : null

  const inIsrael =
    isIsraelCountryCode(input.country) || isIsraelText(joined) || (!!structuredCity && isIsraelText(structuredCity))
  const city = inIsrael
    ? firstIsraeliCity(joined) ?? (structuredCity ? canonicalCity(structuredCity) : null)
    : structuredCity

  let workMode = parseWorkMode(input.workplaceType)
  if (workMode === 'unknown' && input.isRemote === true) workMode = 'remote'
  if (workMode === 'unknown') workMode = workModeFromTexts(texts)

  let country: string | null = null
  if (inIsrael) country = 'IL'
  else if (input.country && /^[a-z]{2}$/i.test(input.country.trim())) country = input.country.trim().toUpperCase()
  return { country, city, workMode }
}

/** The ingest rule: located in Israel (any listed location) and not remote-only. 'unknown' is kept. */
export function isKeepableLocation(job: Pick<RawJob, 'country' | 'workMode'>): boolean {
  return job.country === 'IL' && job.workMode !== 'remote'
}
