import { describe, expect, it } from 'vitest'
import {
  INTERN_TITLE_CAP,
  WEIGHTS,
  bodyJuniorStrength,
  bodyRequiresExperience,
  extractExperience,
  isHardRejectTitle,
  normalizeTitle,
  scoreJob
} from './scoring'
import { MIN_SCORE } from './ingest/refresh'
import type { RawJob } from './sources/types'
import { rawJob, scoreTitle } from './testing/fixtures'

const job = (title: string, extra: Partial<RawJob> = {}): RawJob => rawJob({ title, ...extra })

describe('experience-requirement rules (user decisions)', () => {
  const s = scoreTitle
  const BASE = 'Software Engineer'

  it('no experience stated at all: a plain software title lands at MIN_SCORE, below clear junior titles', () => {
    expect(scoreJob(job(BASE))).toBe(MIN_SCORE)
    expect(s(BASE, 'We build great products. Join our team in Tel Aviv.')).toBe(MIN_SCORE)
    expect(scoreJob(job('Junior Software Engineer'))).toBeGreaterThan(scoreJob(job(BASE)))
    expect(scoreJob(job('Graduate Software Engineer'))).toBeGreaterThan(scoreJob(job(BASE)) + 10)
    // strong role titles get the same baseline on top of 30
    expect(scoreJob(job('Python Developer'))).toBe(MIN_SCORE + WEIGHTS.noExperienceBaseline)
  })

  it('baseline is not additive with a junior signal and not part of the confirmation bonus', () => {
    expect(scoreJob(job('Junior Backend Developer'))).toBe(30 + WEIGHTS.juniorTitle)
    expect(s(BASE, 'entry level')).toBe(20 + WEIGHTS.bodyStrong)
  })

  it('"1+ years" counts as junior (moderate) and beats the no-experience case', () => {
    expect(extractExperience('1+ years of experience')).toEqual([{ min: 1, max: null }])
    expect(bodyJuniorStrength('1+ years of experience')).toBe('moderate')
    expect(bodyJuniorStrength('at least 1 year of experience')).toBe('moderate')
    expect(bodyJuniorStrength('1 year of experience in QA')).toBe('moderate')
    expect(s(BASE, '1+ years of experience')).toBe(20 + WEIGHTS.bodyModerate)
    expect(s(BASE, '1+ years of experience')).toBeGreaterThan(s(BASE, null))
  })

  it('"2+ years" gives no bonus and no baseline, and costs exactly WEIGHTS.twoYearsBody (-10) on a non-junior title', () => {
    expect(WEIGHTS.twoYearsBody).toBe(-10)
    expect(bodyJuniorStrength('2+ years of experience')).toBe(null)
    expect(bodyJuniorStrength('2 years of experience')).toBe(null)
    expect(s(BASE, '2+ years of experience')).toBe(10) // bare general title 20, no baseline, -10
    expect(s('Backend Developer', '2+ years of experience')).toBe(20) // bare strong title 30, -10
    expect(s(BASE, '2+ years of experience')).toBeLessThan(s(BASE, null))
    expect(s(BASE, '2+ years of experience')).toBeLessThan(MIN_SCORE)
  })

  it('3+ years still penalised; senior titles still 0 whatever the body says', () => {
    expect(s('Backend Developer', '3+ years of experience')).toBe(5)
    expect(s('Senior Backend Developer', 'no experience required, 0-2 years')).toBe(0)
    expect(scoreJob(job('Software Team Lead'))).toBe(0)
    expect(scoreJob(job('Backend Developer Intern'))).toBeLessThanOrEqual(INTERN_TITLE_CAP)
  })

  it('penalty detection widened: up to 5 words between "N years" and "experience"', () => {
    for (const d of [
      '5 years of hands-on Python backend development experience',
      '4 years of proven professional software engineering experience',
      '3 years working with distributed cloud experience'
    ]) {
      expect(bodyRequiresExperience(d), d).toBe(true)
      expect(s('Backend Developer', d), d).toBeLessThan(30)
    }
  })

  it('"years ... user experience" is not a requirement', () => {
    const d = 'We have 10 years building the best user experience for shoppers'
    expect(extractExperience(d)).toEqual([])
    expect(s('Backend Developer', d)).toBeGreaterThanOrEqual(30) // no 3+ penalty (the baseline is withheld conservatively)
  })

  it('number words and unparsed duration wording withhold the baseline', () => {
    expect(extractExperience('three years of experience')).toEqual([{ min: 3, max: null }])
    expect(extractExperience('Three-plus years experience')).toEqual([{ min: 3, max: null }])
    expect(extractExperience('experience of 4 years')).toEqual([{ min: 4, max: null }])
    expect(s(BASE, 'Several years of professional experience required')).toBe(20)
  })

  it('Hebrew experience phrasing: reversed order, one year, two years, number words', () => {
    expect(extractExperience('ניסיון של 2 שנים ומעלה')).toEqual([{ min: 2, max: null }])
    expect(extractExperience('ניסיון של 0-2 שנים')).toEqual([{ min: 0, max: 2 }])
    expect(extractExperience('שנה ניסיון בפיתוח')).toEqual([{ min: 1, max: null }])
    expect(extractExperience('שנתיים ניסיון')).toEqual([{ min: 2, max: null }])
    expect(extractExperience('ניסיון של שנתיים')).toEqual([{ min: 2, max: null }])
    expect(extractExperience('שלוש שנות ניסיון')).toEqual([{ min: 3, max: null }])
    expect(extractExperience('4 שנות ניסיון בפיתוח')).toEqual([{ min: 4, max: null }])
    expect(bodyJuniorStrength('שנה ניסיון בפיתוח')).toBe('moderate')
    expect(s('מפתח backend', '- 3 שנים ניסיון בפיתוח Backend')).toBeLessThan(MIN_SCORE)
    expect(s(BASE, 'נדרשות מספר שנים של ניסיון')).toBe(20) // unparsed duration wording: no baseline
  })

  it('Hebrew junior title words and gender-marked titles', () => {
    expect(scoreJob(job("מפתח/ת Backend ג'וניור"))).toBeGreaterThanOrEqual(MIN_SCORE + 40)
    expect(scoreJob(job('מפתח/ת Python בוגר/ת תואר'))).toBeGreaterThanOrEqual(MIN_SCORE + 40)
    expect(scoreJob(job('מפתח/ת תוכנה התחלתי'))).toBeGreaterThanOrEqual(MIN_SCORE + 20)
    expect(scoreJob(job('בודק/ת תוכנה'))).toBeGreaterThanOrEqual(MIN_SCORE)
    expect(scoreJob(job('מהנדס/ת תוכנה'))).toBe(MIN_SCORE)
    expect(scoreJob(job('תוכניתן/ית Java'))).toBe(MIN_SCORE)
    expect(scoreJob(job('מפתח/ת בכיר/ה'))).toBe(0)
    expect(scoreJob(job('ארכיטקטית תוכנה'))).toBe(0)
    expect(isHardRejectTitle('מנהל/ת פיתוח')).toBe(true)
    expect(normalizeTitle('בודק/ת תוכנה')).toBe('בודק תוכנה')
    // "בוגר" in a BODY (holds a degree) is not a junior signal
    expect(bodyJuniorStrength('דרוש בוגר/ת תואר במדעי המחשב')).toBe(null)
  })

  it('firmware / embedded software / driver titles are software roles; hardware ones are not', () => {
    for (const t of ['Firmware Engineer', 'Embedded Software Engineer', 'Linux Device Driver Developer', 'Kernel Driver Engineer']) {
      expect(scoreJob(job(t)), t).toBeGreaterThanOrEqual(MIN_SCORE)
    }
    expect(scoreJob(job('Junior Firmware Engineer'))).toBeGreaterThanOrEqual(MIN_SCORE + 10)
    // bare "driver" is not software
    expect(scoreJob(job('Delivery Driver'))).toBeLessThan(MIN_SCORE)
    expect(scoreJob(job('Junior Delivery Driver'))).toBeLessThan(MIN_SCORE)
    // chip / physical-design titles stay out (no baseline for hardware titles)
    for (const t of ['Physical Design Engineer', 'STA Engineer', 'DFT Engineer', 'ASIC Verification Engineer']) {
      expect(scoreJob(job(t)), t).toBeLessThan(MIN_SCORE)
    }
    expect(scoreJob(job('Hardware Firmware Engineer'))).toBe(20) // hardware title: no baseline
  })

  it('bare "software" alone does not earn the baseline (software sales/support)', () => {
    for (const t of ['Software Sales Representative', 'Software Support Specialist', 'Software Licensing Manager']) {
      expect(scoreJob(job(t)), t).toBeLessThan(MIN_SCORE)
    }
  })

  it('student / intern still excluded even with no experience stated', () => {
    expect(scoreJob(job('Software Engineer Intern'))).toBeLessThanOrEqual(INTERN_TITLE_CAP)
    expect(scoreJob(job('Student Software Developer'))).toBeLessThanOrEqual(INTERN_TITLE_CAP)
  })

  it('mid-level title/tag and senior tag withhold the baseline', () => {
    expect(scoreJob(job('Software Engineer II'))).toBeLessThan(MIN_SCORE)
    expect(scoreJob(job(BASE, { seniority: ['mid-level'] }))).toBeLessThan(MIN_SCORE)
    expect(scoreJob(job(BASE, { seniority: ['senior'] }))).toBeLessThan(MIN_SCORE)
  })
})

describe('experience rules: largest minimum wins, Hebrew hardware-test titles', () => {
  it('a "1+" bullet next to a "2+" bullet is not junior (the larger minimum wins)', () => {
    const d = '- 2+ years of non-internship professional software development experience\n- 1+ years of non-internship design experience'
    expect(bodyJuniorStrength(d)).toBe(null)
    // general title 20, no baseline (experience stated), twoYearsBody -10 (largest minimum is 2)
    expect(scoreJob(job('Software Development Engineer', { description: d }))).toBe(10)
  })
  it('hardware-test titles in Hebrew are not software QA (no bare "מהנדס בדיקות" keyword)', () => {
    expect(scoreJob(job('מהנדס/ת בדיקות ועיבוד אותות'))).toBeLessThan(MIN_SCORE)
  })
})

describe('experience rules: Hebrew tech tokens and "user experience" false positives', () => {
  const BASE = 'Software Engineer'
  const s = scoreTitle
  it('Hebrew tech tokens with digits do not suppress the baseline', () => {
    expect(s(BASE, 'ניסיון ב-K8s ו-AWS S3, Python 3, Angular 2+, ES6, 24/7')).toBe(30)
    expect(s(BASE, 'ניסיון בפיתוח ב-EC2')).toBe(30)
    expect(s(BASE, 'ידע בשנה האחרונה ניסיון')).toBeGreaterThanOrEqual(0) // sanity: no throw on prefixed word forms
    // a real duration word still suppresses it
    expect(s(BASE, 'נדרש ניסיון של מספר שנים')).toBe(20)
  })
  it('"N years ... user experience" no longer withholds the baseline', () => {
    expect(s('Backend Developer', 'We have 10 years building the best user experience for shoppers')).toBe(
      s('Backend Developer', 'Great team.')
    )
  })
})
