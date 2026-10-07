import { describe, expect, it } from 'vitest'
import {
  GENERAL_ROLE_ONLY_CAP,
  INTERN_TITLE_CAP,
  NO_ROLE_TITLE_CAP,
  WEIGHTS,
  bodyJuniorStrength,
  extractExperience,
  scoreJob
} from './scoring'
import { MIN_SCORE } from './ingest/refresh'
import { classifyRoles } from './roles'
import type { RawJob } from './sources/types'

const job = (title: string, extra: Partial<RawJob> = {}): RawJob => ({
  source: 'greenhouse:x',
  externalId: 'x',
  title,
  company: 'Co',
  url: 'https://example.com',
  description: null,
  location: null,
  country: 'IL',
  city: null,
  workMode: 'unknown',
  postedAt: null,
  ...extra
})

describe('scoreJob', () => {
  it('junior target-role titles pass MIN_SCORE', () => {
    for (const t of [
      'Junior QA Engineer',
      'Junior Python Developer',
      'Entry Level Backend Developer',
      'Graduate Software Engineer',
      'New Grad Backend Engineer',
      'New College Graduate, Software Engineer'
    ]) {
      expect(scoreJob(job(t)), t).toBeGreaterThanOrEqual(MIN_SCORE)
    }
  })

  it('senior titles are an immediate reject (score 0)', () => {
    for (const t of [
      'Senior Backend Engineer',
      'Sr. Python Developer',
      'Sr QA Engineer',
      'Staff Software Engineer',
      'Lead Python Developer',
      'Principal QA Engineer',
      'מפתח בכיר',
      'SENIOR qa engineer'
    ]) {
      expect(scoreJob(job(t)), t).toBe(0)
    }
  })

  it('a senior title is never rescued by a junior-looking description or tag', () => {
    const rescue = {
      description: 'No experience required. Entry level. 0-2 years. Recent graduates welcome.',
      seniority: ['entry-level']
    }
    expect(scoreJob(job('Senior QA Engineer', rescue))).toBe(0)
    expect(scoreJob(job('Senior Associate QA', rescue))).toBe(0)
    expect(scoreJob(job('Junior Senior Backend Developer', rescue))).toBe(0)
  })

  it('only the title counts for "senior": the word in the body does not matter', () => {
    const plain = scoreJob(job('Junior QA Engineer'))
    expect(scoreJob(job('Junior QA Engineer', { description: 'Great seniority path; mentor with senior colleagues.' }))).toBeGreaterThanOrEqual(plain)
    expect(scoreJob(job('Seniority Analyst QA'))).toBeGreaterThan(0) // "Seniority" is not "senior"
  })

  it('junior outranks mid-level for the same role', () => {
    expect(scoreJob(job('Junior Backend Engineer'))).toBeGreaterThan(scoreJob(job('Backend Engineer II')))
  })

  it('score is an integer clamped to 0..100', () => {
    const hi = scoreJob(
      job('Junior QA Engineer', { description: 'entry-level, 0-2 years', seniority: ['Entry-level'] })
    )
    expect(hi).toBe(100)
    expect(scoreJob(job('Senior Director', { description: '10+ years', seniority: ['Senior'] }))).toBe(0)
  })

  it('a strong-role title with a stated non-junior experience requirement sits exactly at MIN_SCORE; with none stated it gets the baseline', () => {
    expect(scoreJob(job('Backend Engineer', { description: '2+ years of experience' }))).toBe(MIN_SCORE)
    expect(scoreJob(job('Backend Engineer'))).toBe(MIN_SCORE + WEIGHTS.noExperienceBaseline)
  })

  it('NO_ROLE_TITLE_CAP: junior-but-irrelevant titles are capped and below MIN_SCORE', () => {
    const s = scoreJob(
      job('Junior Marketing Specialist', { description: 'entry-level', seniority: ['Entry-level'] })
    )
    expect(s).toBeLessThanOrEqual(NO_ROLE_TITLE_CAP)
    expect(NO_ROLE_TITLE_CAP).toBeLessThan(MIN_SCORE)
    expect(scoreJob(job('Junior Graphic Designer'))).toBeLessThanOrEqual(NO_ROLE_TITLE_CAP)
  })

  it('"Junior Business Developer" (sales) is not a software role', () => {
    expect(scoreJob(job('Junior Business Developer'))).toBeLessThan(MIN_SCORE)
    expect(scoreJob(job('Junior Business Development Representative'))).toBeLessThan(MIN_SCORE)
  })

  it('junior Java/.NET (general-role-only) is capped below a junior strong-role title', () => {
    const java = scoreJob(job('Junior Java Developer', { description: '0-2 years', seniority: ['entry-level'] }))
    expect(java).toBe(GENERAL_ROLE_ONLY_CAP)
    expect(java).toBeGreaterThanOrEqual(MIN_SCORE)
    expect(scoreJob(job('Junior Python Developer'))).toBeGreaterThan(
      scoreJob(job('Junior Java Developer'))
    )
  })

  it('"associate" is a moderate junior signal', () => {
    const assoc = scoreJob(job('Associate Backend Engineer'))
    expect(assoc).toBeGreaterThan(MIN_SCORE)
    expect(assoc).toBeLessThan(scoreJob(job('Junior Backend Engineer')))
  })

  it('intern / student titles are not junior-positive and fall below MIN_SCORE', () => {
    for (const t of [
      'QA Intern',
      'Backend Developer Intern',
      'Software Engineering Internship',
      'Working Student Python Developer',
      'Werkstudent Backend',
      'Graduate Student Software Engineer',
      'Junior QA Student',
      'סטודנט לפיתוח backend'
    ]) {
      expect(scoreJob(job(t, { description: 'entry level, 0-2 years' })), t).toBeLessThanOrEqual(INTERN_TITLE_CAP)
    }
    expect(INTERN_TITLE_CAP).toBeLessThan(MIN_SCORE)
    // "students" in the body is not a penalty
    expect(scoreJob(job('Junior QA Engineer', { description: 'Students welcome to apply' }))).toBeGreaterThanOrEqual(MIN_SCORE)
    // "International" / "internal" are not intern
    expect(scoreJob(job('International Backend Engineer'))).toBe(MIN_SCORE + WEIGHTS.noExperienceBaseline)
  })

  it('intern seniority tag (Amazon is_intern) also caps', () => {
    expect(scoreJob(job('Software Engineer', { seniority: ['intern'] }))).toBeLessThanOrEqual(INTERN_TITLE_CAP)
  })

  it('hardware/chip titles and penetration testers are not software backend/QA', () => {
    for (const t of ['Physical Design Backend Engineer', 'IC Test Engineer', 'Penetration Tester & Security Researcher']) {
      expect(scoreJob(job(t)), t).toBeLessThan(MIN_SCORE)
    }
    expect(classifyRoles({ title: 'Penetration Tester', description: null })).not.toContain('qa')
    expect(scoreJob(job('Software QA Engineer'))).toBe(MIN_SCORE + WEIGHTS.noExperienceBaseline)
  })

  it('SDE titles count as general software roles', () => {
    expect(scoreJob(job('2026 Graduate Software Dev Engineer'))).toBeGreaterThanOrEqual(MIN_SCORE)
  })

  it('works with an empty title', () => {
    expect(scoreJob(job(''))).toBe(0)
  })
})

describe('description experience language', () => {
  const s = (t: string, d: string): number => scoreJob(job(t, { description: d }))

  it('range from 0 / "up to" with upper bound <=2 is strong, 3 moderate, 4-5 weak', () => {
    expect(bodyJuniorStrength('0-2 years of experience')).toBe('strong')
    expect(bodyJuniorStrength('0 to 1 years')).toBe('strong')
    expect(bodyJuniorStrength('up to 2 years of experience')).toBe('strong')
    expect(bodyJuniorStrength('0-3 years')).toBe('moderate')
    expect(bodyJuniorStrength('up to 3 years')).toBe('moderate')
    expect(bodyJuniorStrength('0-4 years')).toBe('weak')
    expect(bodyJuniorStrength('up to 5 years')).toBe('weak')
    expect(bodyJuniorStrength('0-7 years')).toBe(null)
  })

  it('no-experience, entry-level, fresh/recent graduate phrases are strong', () => {
    for (const d of [
      'No experience required.',
      'no prior experience necessary',
      'This is an entry level position',
      'Fresh graduates are welcome',
      'recent graduate or new grad',
      'ללא ניסיון קודם',
      'אין צורך בניסיון'
    ]) {
      expect(bodyJuniorStrength(d), d).toBe('strong')
    }
    expect(bodyJuniorStrength('This is not an entry-level role')).toBe(null)
  })

  it('Hebrew experience ranges', () => {
    expect(bodyJuniorStrength('0-2 שנות ניסיון')).toBe('strong')
    expect(extractExperience('3+ שנות ניסיון')).toEqual([{ min: 3, max: null }])
  })

  it('"mentor junior engineers" is not a junior role', () => {
    for (const d of [
      'You will mentor junior engineers on the team.',
      'Guide and coach junior developers',
      'work with senior and junior engineers',
      'Support junior colleagues'
    ]) {
      expect(bodyJuniorStrength(d), d).toBe(null)
    }
    expect(bodyJuniorStrength('This is a junior position.')).toBe('moderate')
    expect(s('Software Engineer', 'You will mentor junior engineers.')).toBe(
      s('Software Engineer', 'Great team.')
    )
  })

  it('description can make a no-junior-word title pass', () => {
    expect(s('Software Engineer', 'Requirements: 0-2 years of experience.')).toBeGreaterThanOrEqual(MIN_SCORE + 10)
    expect(s('Backend Developer', 'Up to 2 years experience')).toBeGreaterThan(s('Backend Developer', 'Great team'))
  })

  it('a stated minimum of 3+ years stays a penalty; "0-3" is not read as 3', () => {
    const plain = s('Backend Developer', 'Great team.')
    for (const d of ['3+ years of experience', '5+ years', '3-5 years experience', 'at least 4 years', '5 years of Python experience']) {
      expect(s('Backend Developer', d), d).toBeLessThan(plain)
    }
    expect(extractExperience('0-3 years')).toEqual([{ min: 0, max: 3 }])
    expect(s('Backend Developer', '0-3 years')).toBeGreaterThan(plain)
    expect(s('Backend Developer', 'founded 10+ years ago')).toBe(plain)
  })

  it('Workday New College Graduate tag (entry-level) is a junior signal', () => {
    expect(s('Software Engineer', 'x')).toBeLessThan(
      scoreJob(job('Software Engineer', { description: 'x', seniority: ['entry-level'] }))
    )
  })
})

describe('role tagging false positives', () => {
  it('a Python backend job is not tagged frontend by repeated React mentions', () => {
    const roles = classifyRoles({
      title: 'Junior Python Backend Developer',
      description: 'We use React and React Query on the client. Nice to have: Angular, Angular Material.'
    })
    expect(roles).toContain('python')
    expect(roles).toContain('backend')
    expect(roles).not.toContain('frontend')
  })
  it('a frontend title keeps frontend', () => {
    expect(classifyRoles({ title: 'Junior Frontend Developer', description: null })).toContain('frontend')
  })
})
