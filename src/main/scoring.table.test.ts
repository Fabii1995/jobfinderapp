import { describe, expect, it } from 'vitest'
import { MIN_SCORE } from './ingest/refresh'
import { WEIGHTS } from './scoring'
import { scoreTitle } from './testing/fixtures'

const s = scoreTitle

/** One regression row. Bounds are inclusive and deliberately loose: they pin the user's RULE, not an exact weight. */
interface Row {
  rule: string
  title: string
  desc?: string | null
  min: number
  max: number
  tags?: string[]
}

const ROWS: Row[] = [
  // --- 'senior' (sr, בכיר, lead, manager...) in the TITLE = 0 whatever the body says
  { rule: 'senior title, no-experience body', title: 'Senior Backend Developer', desc: 'No experience required. 0-2 years. Entry level.', min: 0, max: 0 },
  { rule: 'sr. title, new-grad body', title: 'Sr. Python Developer', desc: 'new grad welcome', min: 0, max: 0 },
  { rule: 'sr in parentheses', title: 'Software Engineer (Sr)', min: 0, max: 0 },
  { rule: 'senior QA', title: 'Senior QA Engineer', min: 0, max: 0 },
  { rule: 'senior + entry-level tag', title: 'Senior Software Engineer', desc: 'entry level', tags: ['entry-level'], min: 0, max: 0 },
  { rule: 'Hebrew בכיר title, ללא ניסיון body', title: 'מפתח Backend בכיר', desc: 'ללא ניסיון', min: 0, max: 0 },
  { rule: 'Hebrew בכיר QA', title: 'בודק תוכנה בכיר', min: 0, max: 0 },
  { rule: 'staff / principal / team lead / manager', title: 'Staff Software Engineer', min: 0, max: 0 },
  { rule: 'principal', title: 'Principal Engineer', min: 0, max: 0 },
  { rule: 'team lead', title: 'Software Team Lead', min: 0, max: 0 },
  { rule: 'Hebrew team lead', title: 'ראש צוות פיתוח', min: 0, max: 0 },
  { rule: 'engineering manager', title: 'Engineering Manager', min: 0, max: 0 },
  { rule: 'Engineer III', title: 'Software Engineer III', min: 0, max: 0 },

  // --- experience rules in the body
  { rule: '1+ years counts as junior (moderate)', title: 'QA Engineer', desc: '1+ years of experience in manual testing', min: 45, max: 60 },
  { rule: '"1 year of experience" counts', title: 'QA Engineer', desc: '1 year of experience in testing', min: 45, max: 60 },
  { rule: '0-2 years is a strong junior signal', title: 'Backend Developer', desc: '0-2 years of experience', min: 55, max: 80 },
  { rule: '0-3 years moderate', title: 'Backend Developer', desc: '0-3 years of experience', min: 45, max: 60 },
  { rule: '2+ years is neutral: equal to the bare strong title (30)', title: 'QA Engineer', desc: '2+ years of experience in testing', min: 30, max: 30 },
  { rule: '2 years is neutral', title: 'QA Engineer', desc: '2 years of experience', min: 30, max: 30 },
  { rule: '2+ years with a bare general title stays below MIN_SCORE', title: 'Software Engineer', desc: '2+ years of experience', min: 0, max: MIN_SCORE - 1 },
  { rule: '3+ years penalised', title: 'Backend Developer', desc: '3+ years of experience with Python', min: 0, max: 10 },
  { rule: '5 years penalised', title: 'Backend Developer', desc: '5 years of experience', min: 0, max: 10 },
  { rule: '3-5 years penalised', title: 'Python Developer', desc: '3-5 years of experience', min: 0, max: 10 },
  { rule: '3+ years on a general title is rejected outright', title: 'Software Engineer', desc: '3+ years of experience', min: 0, max: 0 },
  { rule: 'junior title with 3+ years loses weight', title: 'Junior Python Developer', desc: '3+ years of experience', min: 30, max: 60 },
  { rule: 'DevOps "at least 4 years"', title: 'DevOps Engineer', desc: 'at least 4 years of experience', min: 0, max: 10 },

  // --- no experience stated at all: software title 30-40
  { rule: 'plain Software Engineer, no body', title: 'Software Engineer', min: 30, max: 40 },
  { rule: 'plain Software Engineer, generic body', title: 'Software Engineer', desc: 'Join our team. We build great products in Tel Aviv.', min: 30, max: 40 },
  { rule: 'Backend Developer, culture-only body', title: 'Backend Developer', desc: 'Great culture, snacks, and a view.', min: 30, max: 40 },
  { rule: 'Embedded Software Engineer, no body', title: 'Embedded Software Engineer', min: 30, max: 40 },
  { rule: 'Forward Deployed Engineer, no body', title: 'Forward Deployed Engineer', min: 30, max: 45 },
  { rule: 'AI Solutions Engineer, no body', title: 'AI Solutions Engineer', min: 30, max: 45 },
  { rule: 'Hebrew מפתח/ת Backend, no body', title: 'מפתח/ת Backend', min: 30, max: 45 },
  { rule: 'Hebrew בודק/ת תוכנה, no body', title: 'בודק/ת תוכנה', min: 30, max: 45 },

  // --- junior / new grad / early career / entry level (full weight)
  { rule: 'Junior Python Developer', title: 'Junior Python Developer', min: 60, max: 100 },
  { rule: 'Junior Forward Deployed Engineer', title: 'Junior Forward Deployed Engineer', min: 60, max: 100 },
  { rule: 'new grad counts', title: 'New Grad Software Engineer', min: 50, max: 100 },
  { rule: 'new grad in the middle of the title', title: 'Software Engineer, New Grad 2026', min: 50, max: 100 },
  { rule: 'university graduate', title: 'Software Engineer - University Graduate', min: 50, max: 100 },
  { rule: 'graduate program title', title: 'Graduate Software Engineer', desc: 'Join our graduate program', min: 50, max: 100 },
  { rule: 'early career', title: 'Early Career Software Engineer', min: 50, max: 100 },
  { rule: 'entry level in title', title: 'Software Engineer - Entry Level', min: 50, max: 100 },
  { rule: 'Python Developer (Graduate)', title: 'Python Developer (Graduate)', min: 60, max: 100 },
  { rule: 'trainee', title: 'Trainee Software Developer', min: 50, max: 100 },
  { rule: 'entry-level seniority tag (Workday new grad)', title: 'Software Engineer', tags: ['entry-level'], min: 55, max: 100 },
  { rule: '"entry level" in body only', title: 'QA Automation Engineer', desc: 'Entry level', min: 55, max: 100 },
  { rule: 'recent graduates in body', title: 'SDET', desc: 'recent graduates welcome', min: 55, max: 100 },
  { rule: '"junior position" + no prior experience', title: 'Software Engineer', desc: 'This is a junior position, no prior experience needed.', min: 45, max: 100 },

  // --- student / intern excluded (below MIN_SCORE even with junior words)
  { rule: 'intern title', title: 'Software Engineer Intern', min: 0, max: MIN_SCORE - 1 },
  { rule: 'intern + no experience body', title: 'Backend Developer Intern', desc: 'no experience required', min: 0, max: MIN_SCORE - 1 },
  { rule: 'student title', title: 'Software Engineering Student', min: 0, max: MIN_SCORE - 1 },
  { rule: 'working student', title: 'Working Student - Python', min: 0, max: MIN_SCORE - 1 },
  { rule: 'graduate student', title: 'Graduate Student Software Developer', min: 0, max: MIN_SCORE - 1 },
  { rule: 'QA student', title: 'QA Student', min: 0, max: MIN_SCORE - 1 },
  { rule: 'Hebrew student title', title: 'סטודנט/ית לפיתוח תוכנה', min: 0, max: MIN_SCORE - 1 },
  { rule: 'intern seniority tag', title: 'Software Engineer', tags: ['intern'], min: 0, max: MIN_SCORE - 1 },
  { rule: 'student mentioned in a body is NOT a penalty', title: 'Backend Developer', desc: 'Students are welcome to apply', min: 30, max: 45 },
  { rule: '"Internal"/"International" are not intern', title: 'Internal Tools Software Engineer', min: 30, max: 40 },
  { rule: '"International" is not intern', title: 'International Software Engineer', min: 30, max: 40 },

  // --- Associate: moderate
  { rule: 'Associate Software Engineer is moderate: above a plain title, below a Junior one', title: 'Associate Software Engineer', min: 35, max: 55 },
  { rule: 'Associate Backend Developer', title: 'Associate Backend Developer', min: 45, max: 60 },

  // --- "mentor junior engineers" is not a junior role
  { rule: 'mentor junior engineers + lead (no junior credit)', title: 'Software Engineer', desc: 'You will mentor junior engineers and lead the team.', min: 30, max: 30 },
  { rule: 'mentor junior developers', title: 'Software Engineer', desc: 'Mentor junior developers', min: 30, max: 30 },
  { rule: 'work with junior and senior engineers', title: 'Software Engineer', desc: 'You will work with junior and senior engineers', min: 30, max: 30 },
  { rule: 'help junior developers grow', title: 'Backend Developer', desc: 'We help junior developers grow', min: 40, max: 40 },

  // --- Hebrew
  { rule: 'Hebrew ג\'וניור in title', title: "מפתח Python ג'וניור", min: 60, max: 100 },
  { rule: 'Hebrew מתחיל', title: 'מפתח/ת תוכנה מתחיל/ה', min: 50, max: 100 },
  { rule: 'Hebrew בוגר/ת', title: 'בוגר/ת תואר מפתח', min: 50, max: 100 },
  { rule: 'Hebrew 0-2 שנים ניסיון', title: 'מפתח/ת פייתון', desc: 'ניסיון של 0-2 שנים', min: 55, max: 100 },
  { rule: 'Hebrew ללא ניסיון', title: 'מהנדס/ת תוכנה', desc: 'ללא ניסיון', min: 45, max: 100 },
  { rule: 'Hebrew 5 years penalty', title: 'מהנדס תוכנה', desc: 'נדרש ניסיון של 5 שנים', min: 0, max: 10 },
  { rule: 'Hebrew שנתיים is neutral (general title bare score)', title: 'מפתח תוכנה', desc: 'שנתיים ניסיון', min: 20, max: 20 },
  { rule: 'Hebrew 3 שנות ניסיון penalty', title: 'מפתח תוכנה', desc: '3 שנות ניסיון בפיתוח', min: 0, max: 0 },
  { rule: 'Hebrew manager title', title: 'מנהל פיתוח', min: 0, max: 0 },

  // --- hardware / chip titles do not match backend/test/automation; below MIN_SCORE
  { rule: 'Physical Design Backend Engineer', title: 'Physical Design Backend Engineer', min: 0, max: MIN_SCORE - 1 },
  { rule: 'ASIC Verification Engineer', title: 'ASIC Verification Engineer', min: 0, max: MIN_SCORE - 1 },
  { rule: 'IC Test Engineer', title: 'IC Test Engineer', min: 0, max: MIN_SCORE - 1 },
  { rule: 'RTL Design Engineer + no experience', title: 'RTL Design Engineer', desc: 'no experience required', min: 0, max: MIN_SCORE - 1 },
  { rule: 'Design Automation Engineer', title: 'Design Automation Engineer', min: 0, max: MIN_SCORE - 1 },
  { rule: 'Analog Layout Engineer', title: 'Analog Layout Engineer', min: 0, max: MIN_SCORE - 1 },
  { rule: 'FPGA Engineer', title: 'FPGA Engineer', min: 0, max: MIN_SCORE - 1 },
  { rule: 'Junior Physical Design Backend Engineer', title: 'Junior Physical Design Backend Engineer', min: 0, max: MIN_SCORE - 1 },
  { rule: 'Junior ASIC Engineer', title: 'Junior ASIC Engineer', desc: 'no experience', min: 0, max: MIN_SCORE - 1 },
  { rule: 'Junior Hardware Engineer', title: 'Junior Hardware Engineer', min: 0, max: MIN_SCORE - 1 },

  // --- non-software titles below 30
  { rule: 'Delivery Driver (no body)', title: 'Delivery Driver', min: 0, max: MIN_SCORE - 1 },
  { rule: 'Delivery Driver + junior body', title: 'Delivery Driver', desc: 'no experience required, entry level', min: 0, max: MIN_SCORE - 1 },
  { rule: 'bare Driver + junior body', title: 'Driver', desc: 'Junior position, no experience', min: 0, max: MIN_SCORE - 1 },
  { rule: 'Junior Business Developer is sales', title: 'Junior Business Developer', desc: 'entry level', min: 0, max: MIN_SCORE - 1 },
  { rule: 'Junior Sales Representative', title: 'Junior Sales Representative', desc: 'no experience', min: 0, max: MIN_SCORE - 1 },
  { rule: 'Junior Marketing Manager', title: 'Junior Marketing Manager', min: 0, max: MIN_SCORE - 1 },
  { rule: 'Customer Support Specialist + no experience', title: 'Customer Support Specialist', desc: 'no experience required', min: 0, max: MIN_SCORE - 1 },

  // --- folded in from the former scoring.test.ts (unique cases only)
  { rule: 'SENIOR in upper case', title: 'SENIOR qa engineer', min: 0, max: 0 },
  { rule: 'Sr QA without a dot', title: 'Sr QA Engineer', min: 0, max: 0 },
  { rule: 'Hebrew senior developer', title: 'מפתח בכיר', min: 0, max: 0 },
  { rule: 'Lead Python Developer', title: 'Lead Python Developer', min: 0, max: 0 },
  { rule: 'Principal QA Engineer', title: 'Principal QA Engineer', min: 0, max: 0 },
  { rule: 'Senior Director with 10+ years and a senior tag', title: 'Senior Director', desc: '10+ years', tags: ['Senior'], min: 0, max: 0 },
  { rule: 'empty title scores 0', title: '', min: 0, max: 0 },
  { rule: 'score clamps at 100', title: 'Junior QA Engineer', desc: 'entry-level, 0-2 years', tags: ['Entry-level'], min: 100, max: 100 },
  { rule: 'Junior QA Engineer passes MIN_SCORE', title: 'Junior QA Engineer', min: MIN_SCORE, max: 100 },
  { rule: 'Entry Level Backend Developer passes MIN_SCORE', title: 'Entry Level Backend Developer', min: MIN_SCORE, max: 100 },
  { rule: 'New College Graduate passes MIN_SCORE', title: 'New College Graduate, Software Engineer', min: MIN_SCORE, max: 100 },
  { rule: 'SDE titles count as general software roles', title: '2026 Graduate Software Dev Engineer', min: MIN_SCORE, max: 100 },
  { rule: 'Software QA Engineer gets exactly the no-experience baseline', title: 'Software QA Engineer', min: MIN_SCORE + WEIGHTS.noExperienceBaseline, max: MIN_SCORE + WEIGHTS.noExperienceBaseline },
  { rule: 'Software Engineering Internship', title: 'Software Engineering Internship', desc: 'entry level, 0-2 years', min: 0, max: MIN_SCORE - 1 },
  { rule: 'Werkstudent', title: 'Werkstudent Backend', desc: 'entry level, 0-2 years', min: 0, max: MIN_SCORE - 1 },
  { rule: 'Junior QA Student', title: 'Junior QA Student', desc: 'entry level, 0-2 years', min: 0, max: MIN_SCORE - 1 },
  { rule: 'Penetration Tester is not software QA', title: 'Penetration Tester & Security Researcher', min: 0, max: MIN_SCORE - 1 },
  { rule: 'Junior Business Development Representative is sales', title: 'Junior Business Development Representative', min: 0, max: MIN_SCORE - 1 },

  // --- mid-level
  { rule: 'Engineer II', title: 'Software Engineer II', min: 0, max: MIN_SCORE - 1 },
  { rule: 'Mid-Level Python Developer', title: 'Mid-Level Python Developer', min: 0, max: MIN_SCORE - 1 }
]

describe('scoring regression table (user rules)', () => {
  it('has at least 40 rows', () => expect(ROWS.length).toBeGreaterThanOrEqual(40))
  for (const r of ROWS) {
    it(`${r.rule}: "${r.title}"${r.desc ? ` / "${r.desc.slice(0, 40)}"` : ''} in [${r.min}, ${r.max}]`, () => {
      const got = s(r.title, r.desc ?? null, r.tags ? { seniority: r.tags } : {})
      expect(got).toBeGreaterThanOrEqual(r.min)
      expect(got).toBeLessThanOrEqual(r.max)
      expect(Number.isInteger(got)).toBe(true)
    })
  }
})

describe('scoring: relational rules', () => {
  it('"Up to 2 years" in the body scores strictly above the same title with no experience language', () => {
    expect(s('Backend Developer', 'Up to 2 years experience')).toBeGreaterThan(s('Backend Developer', 'Great team'))
  })
  const BASE = 'Software Engineer'
  it('a senior title stays 0 for every body/tag combination', () => {
    for (const d of [null, '', 'no experience required', '0-2 years', 'entry level new grad', '1+ years', 'junior position']) {
      for (const t of ['Senior ', 'Sr. ', 'Lead ', 'Principal ']) expect(s(t + 'Python Developer', d), `${t}/${d}`).toBe(0)
    }
  })
  it('ordering: 3+ penalty < 2+ neutral < no-experience baseline <= 1+ moderate < junior title', () => {
    const pen = s('Backend Developer', '3+ years of experience')
    const two = s('Backend Developer', '2+ years of experience')
    const none = s('Backend Developer')
    const one = s('Backend Developer', '1+ years of experience')
    const junior = s('Junior Backend Developer')
    expect(pen).toBeLessThan(two)
    expect(two).toBeLessThan(none)
    expect(none).toBeLessThan(one)
    expect(one).toBeLessThan(junior)
  })
  it('mentoring junior staff in the body never beats the same posting without that sentence', () => {
    const neutral = s(BASE, 'We build products.')
    for (const d of ['You will mentor junior engineers.', 'Coach junior developers and review their code.', 'Guide junior team members.', 'Work with senior and junior engineers.']) {
      expect(s(BASE, 'We build products. ' + d), d).toBe(neutral)
    }
  })
  it('student/intern words in the body do not change a score', () => {
    expect(s(BASE, 'Students are welcome. We also run an internship program.')).toBe(s(BASE, null))
  })
  it('new grad body phrasing counts for a general title', () => {
    for (const d of ['new college graduates welcome', 'We hire recent graduates', 'fresh graduates']) {
      expect(s(BASE, d), d).toBeGreaterThan(s(BASE, null))
    }
  })
  it('Associate sits between a plain title and Junior', () => {
    expect(s('Associate ' + BASE)).toBeGreaterThan(s(BASE))
    expect(s('Associate ' + BASE)).toBeLessThan(s('Junior ' + BASE))
  })
  it('Intern/Student is always below any no-experience plain software title', () => {
    for (const w of ['Intern', 'Student', 'Working Student', 'Internship']) {
      expect(s(`${BASE} ${w}`, 'no experience required, entry level, new grad')).toBeLessThan(MIN_SCORE)
    }
  })
  it('score is always an integer within 0..100', () => {
    for (const r of ROWS) {
      const v = s(r.title, r.desc ?? null)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })
  it('hostile / huge input does not throw or hang', () => {
    expect(() => s('x'.repeat(5000), 'junior '.repeat(20000))).not.toThrow()
    expect(s("<script>alert(1)</script>'; DROP TABLE jobs;--", '\u0000')).toBeLessThan(MIN_SCORE)
  })
})

describe('scoring: Hebrew apostrophe variants (regression)', () => {
  // Regression: Hebrew text normally uses the geresh U+05F3 (ג׳וניור) or a curly apostrophe U+2019, not the
  // ASCII apostrophe; these must score as junior (>= 60), not like an unmarked title.
  it('Hebrew junior with geresh U+05F3 is recognised as junior (title)', () => {
    expect(s('בודק תוכנה ג׳וניור')).toBeGreaterThanOrEqual(60)
  })
  it('Hebrew junior with curly apostrophe U+2019 is recognised as junior (title)', () => {
    expect(s('בודק תוכנה ג’וניור')).toBeGreaterThanOrEqual(60)
  })
  it('Hebrew junior with geresh U+05F3 in the body counts as junior-role language', () => {
    expect(s('Software Engineer', 'This is a ג׳וניור position')).toBeGreaterThan(s('Software Engineer'))
  })
})
