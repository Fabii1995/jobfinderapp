import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { parseAddArgs, runAdd, UsageError, type AddDeps } from './add'
import { isBlockedHost, isBlockedUrl } from './blocked'
import { createPoliteHttp, parseRobots, robotsAllows } from './fetcher'
import { extractJsonLdJob } from './jsonld'
import { parsePostingUrl } from './postings'
import { buildRow, formatReport } from './report'
import { resolveUrl } from './resolve'
import { canonicalUrl, parseExamplesFile, validateExample, ExamplesFileError, type Example } from './schema'
import { loadExamples } from './store'

type Handler = (url: string) => unknown
function mockHttp(handler: Handler): AddDeps['http'] & { calls: string[] } {
  const calls: string[] = []
  const get = async (url: string): Promise<unknown> => {
    calls.push(url)
    return handler(url)
  }
  return {
    calls,
    getJson: get,
    postJson: get,
    getText: async (url: string) => String(await get(url))
  }
}
const explode = (): never => {
  throw new Error('network must not be used')
}
const tmp = (): string => mkdtempSync(join(tmpdir(), 'examples-'))

const GH_JOB = {
  id: 123,
  title: 'Junior QA Engineer',
  absolute_url: 'https://boards.greenhouse.io/acme/jobs/123',
  company_name: 'Acme',
  location: { name: 'Tel Aviv, Israel' },
  content: '&lt;p&gt;0-2 years of experience. Manual and automated testing.&lt;/p&gt;',
  updated_at: '2026-01-01T00:00:00Z'
}

describe('parsePostingUrl', () => {
  it('recognises supported ATS posting URLs', () => {
    expect(parsePostingUrl('https://boards.greenhouse.io/acme/jobs/123?gh_src=x')).toEqual({ ats: 'greenhouse', token: 'acme', id: '123' })
    expect(parsePostingUrl('https://job-boards.eu.greenhouse.io/acme/jobs/9')).toMatchObject({ ats: 'greenhouse', id: '9' })
    const uuid = '53cf2efa-45e6-44d3-af28-0065b0f04aa7'
    expect(parsePostingUrl(`https://jobs.lever.co/cloudinary/${uuid}/apply`)).toEqual({ ats: 'lever', slug: 'cloudinary', id: uuid })
    expect(parsePostingUrl(`https://jobs.ashbyhq.com/acme/${uuid}`)).toMatchObject({ ats: 'ashby', name: 'acme' })
    expect(parsePostingUrl('https://jobs.smartrecruiters.com/Armis/743999654168811-qa-team-leader')).toEqual({ ats: 'smartrecruiters', company: 'Armis', id: '743999654168811' })
    expect(parsePostingUrl('https://www.amazon.jobs/en/jobs/10411334/sde')).toEqual({ ats: 'amazon', id: '10411334' })
    expect(parsePostingUrl('https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Israel-Tel-Aviv/Dev_JR1/apply')).toMatchObject({
      ats: 'workday',
      tenant: 'nvidia',
      site: 'NVIDIAExternalCareerSite',
      externalPath: '/job/Israel-Tel-Aviv/Dev_JR1'
    })
    expect(parsePostingUrl('https://www.comeet.com/jobs/acme/C5.00D/qa-engineer/4A.123')).toMatchObject({ ats: 'comeet', positionUid: '4A.123' })
    expect(parsePostingUrl('https://www.sqlink.com/career/software/dev/some-job/')).toMatchObject({ ats: 'sqlink' })
  })
  it('returns null for board pages and unknown hosts', () => {
    expect(parsePostingUrl('https://boards.greenhouse.io/acme')).toBeNull()
    expect(parsePostingUrl('https://example.com/jobs/1')).toBeNull()
  })
})

describe('never fetch blocked sites', () => {
  it('blocklist covers LinkedIn, Indeed, Glassdoor and country variants', () => {
    for (const h of ['www.linkedin.com', 'il.linkedin.com', 'lnkd.in', 'il.indeed.com', 'indeed.co.il', 'www.glassdoor.com', 'glassdoor.co.uk']) {
      expect(isBlockedHost(h)).toBe(true)
    }
    expect(isBlockedHost('boards.greenhouse.io')).toBe(false)
    expect(isBlockedUrl('not a url')).toBe(true)
  })
  it('resolveUrl makes zero requests and returns a manual stub', async () => {
    const http = mockHttp(explode)
    for (const u of ['https://www.linkedin.com/jobs/view/123456789', 'https://il.indeed.com/viewjob?jk=abc', 'https://www.glassdoor.com/job-listing/x']) {
      const r = await resolveUrl(u, http)
      expect(r).toMatchObject({ kind: 'manual', blocked: true })
    }
    expect(http.calls).toHaveLength(0)
  })
  it('polite http never calls fetch for blocked hosts (not even robots.txt)', async () => {
    const fetchFn = vi.fn()
    const http = createPoliteHttp({ fetchFn: fetchFn as unknown as typeof fetch, delayMs: 0, sleep: async () => {} })
    await expect(http.getText('https://www.linkedin.com/jobs/view/1')).rejects.toThrow(/blocked/)
    await expect(http.getJson('https://il.indeed.com/x')).rejects.toThrow(/blocked/)
    expect(fetchFn).not.toHaveBeenCalled()
  })
  it('polite http re-checks redirect targets', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { status: 200 })
      return new Response('', { status: 302, headers: { location: 'https://www.linkedin.com/jobs/view/1' } })
    })
    const http = createPoliteHttp({ fetchFn: fetchFn as unknown as typeof fetch, delayMs: 0, sleep: async () => {} })
    await expect(http.getText('https://careers.example.com/job/1')).rejects.toThrow(/blocked/)
    expect(fetchFn.mock.calls.some((c) => String(c[0]).includes('linkedin'))).toBe(false)
  })
  it('a 403 stops immediately without retry', async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.endsWith('/robots.txt') ? new Response('', { status: 404 }) : new Response('no', { status: 403 })
    )
    const http = createPoliteHttp({ fetchFn: fetchFn as unknown as typeof fetch, delayMs: 0, sleep: async () => {} })
    await expect(http.getText('https://x.example.com/job')).rejects.toThrow(/refused/)
    expect(fetchFn).toHaveBeenCalledTimes(2) // robots + the page, once
  })
})

describe('robots.txt', () => {
  it('honours Disallow, Allow precedence and wildcards', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.pdf$')
    expect(robotsAllows(rules, '/jobs/1')).toBe(true)
    expect(robotsAllows(rules, '/private/x')).toBe(false)
    expect(robotsAllows(rules, '/private/ok')).toBe(true)
    expect(robotsAllows(rules, '/a.pdf')).toBe(false)
  })
  it('does not fetch a page robots disallows, and treats robots 5xx as disallow', async () => {
    const mk = (robots: Response): ReturnType<typeof vi.fn> =>
      vi.fn(async (url: string) => (url.endsWith('/robots.txt') ? robots.clone() : new Response('<html></html>', { status: 200 })))
    const f1 = mk(new Response('User-agent: *\nDisallow: /', { status: 200 }))
    await expect(createPoliteHttp({ fetchFn: f1 as unknown as typeof fetch, delayMs: 0 }).getText('https://a.example.com/j')).rejects.toThrow(/robots/)
    expect(f1).toHaveBeenCalledTimes(1)
    const f2 = mk(new Response('', { status: 503 }))
    await expect(createPoliteHttp({ fetchFn: f2 as unknown as typeof fetch, delayMs: 0 }).getText('https://b.example.com/j')).rejects.toThrow(/robots/)
  })
})

describe('resolveUrl', () => {
  it('resolves a Greenhouse posting through the existing connector', async () => {
    const http = mockHttp(() => GH_JOB)
    const r = await resolveUrl('https://boards.greenhouse.io/acme/jobs/123', http)
    expect(http.calls).toEqual(['https://boards-api.greenhouse.io/v1/boards/acme/jobs/123'])
    expect(r.kind).toBe('resolved')
    if (r.kind !== 'resolved') return
    expect(r.fields).toMatchObject({ id: 'greenhouse:acme:123', source: 'greenhouse:acme', title: 'Junior QA Engineer', company: 'Acme', country: 'IL', via: 'ats-api' })
    expect(r.fields.description).toContain('0-2 years')
  })
  it('falls back to a manual stub when the ATS call fails', async () => {
    const r = await resolveUrl('https://boards.greenhouse.io/acme/jobs/123', mockHttp(() => { throw new Error('HTTP 404') }))
    expect(r).toMatchObject({ kind: 'manual', blocked: false })
  })
  it('reads JSON-LD from a generic page', async () => {
    const ld = { '@context': 'https://schema.org', '@graph': [{ '@type': 'JobPosting', title: 'Python Developer', description: '<p>Entry level, no experience needed.</p>', hiringOrganization: { name: 'Foo' }, jobLocation: { address: { addressLocality: 'Haifa', addressCountry: 'IL' } }, experienceRequirements: { monthsOfExperience: 0 } }] }
    const html = `<html><script type="application/ld+json">${JSON.stringify(ld)}</script></html>`
    const r = await resolveUrl('https://careers.foo.com/jobs/1', mockHttp(() => html))
    expect(r.kind).toBe('resolved')
    if (r.kind === 'resolved') expect(r.fields).toMatchObject({ via: 'jsonld', title: 'Python Developer', company: 'Foo', country: 'IL', extraExperience: '0 months of experience' })
  })
  it('manual stub when the page has no JSON-LD', async () => {
    expect(await resolveUrl('https://careers.foo.com/jobs/1', mockHttp(() => '<html>hi</html>'))).toMatchObject({ kind: 'manual', blocked: false })
  })
  it('extractJsonLdJob ignores non-job and malformed blocks', () => {
    expect(extractJsonLdJob('<script type="application/ld+json">{oops</script><script type="application/ld+json">{"@type":"Organization"}</script>')).toBeNull()
  })
})

describe('schema validation', () => {
  const ok: Example = { id: 'a:1', url: 'https://x.com/1', label: 'fit', title: 'T', company: 'C', location: 'L', description: 'D', fetchedAt: '2026-01-01T00:00:00Z', via: 'ats-api' }
  it('accepts a valid entry and manual stubs with empty text', () => {
    expect(validateExample(ok)).toEqual([])
    expect(validateExample({ ...ok, via: 'manual', title: '', description: '', needsText: true })).toEqual([])
  })
  it('rejects bad labels, missing fields and empty text for non-manual entries', () => {
    expect(validateExample({ ...ok, label: 'maybe' }).join()).toMatch(/label/)
    expect(validateExample({ ...ok, description: '' }).join()).toMatch(/description/)
    expect(validateExample({ ...ok, url: 'ftp://x' }).join()).toMatch(/url/)
    expect(validateExample('x')).toHaveLength(1)
  })
  it('empty/absent file means no examples; corrupt file throws', () => {
    expect(parseExamplesFile('')).toEqual([])
    expect(parseExamplesFile('[]')).toEqual([])
    expect(() => parseExamplesFile('{')).toThrow(ExamplesFileError)
    expect(() => parseExamplesFile('{}')).toThrow(ExamplesFileError)
    expect(loadExamples(join(tmp(), 'missing.json'))).toEqual([])
  })
  it('canonicalUrl drops tracking, hash, www and trailing slash', () => {
    expect(canonicalUrl('https://WWW.x.com/a/?utm_source=z&gh_jid=5#top')).toBe('https://x.com/a?gh_jid=5')
    expect(canonicalUrl('https://www.linkedin.com/jobs/view/title-at-co-3912345678?trk=x')).toBe('https://linkedin.com/jobs/view/3912345678')
  })
})

describe('parseAddArgs', () => {
  it('defaults label to fit and tracks whether it was given', () => {
    expect(parseAddArgs(['https://a.com/1'])).toMatchObject({ label: 'fit', labelGiven: false })
    expect(parseAddArgs(['x', '--label', 'no-fit', '--reason=too senior'])).toMatchObject({ label: 'no-fit', labelGiven: true, reason: 'too senior' })
    expect(() => parseAddArgs(['x', '--label', 'meh'])).toThrow(UsageError)
    expect(() => parseAddArgs([])).toThrow(UsageError)
  })
})

describe('runAdd', () => {
  const setup = (): { path: string; deps: AddDeps; http: ReturnType<typeof mockHttp> } => {
    const path = join(tmp(), 'examples.json')
    writeFileSync(path, '[]')
    const http = mockHttp(() => GH_JOB)
    return { path, http, deps: { http, examplesPath: path, now: () => new Date('2026-10-07T00:00:00Z') } }
  }
  it('is idempotent and keeps the user label/reason on re-add', async () => {
    const { path, deps } = setup()
    const url = 'https://boards.greenhouse.io/acme/jobs/123'
    await runAdd(parseAddArgs([url, '--label', 'no-fit', '--reason', 'my words']), deps)
    await runAdd(parseAddArgs([url + '?gh_src=abc']), deps) // no label flag: must not flip to default fit
    const list = loadExamples(path)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ label: 'no-fit', reason: 'my words' })
    await runAdd(parseAddArgs([url, '--label', 'fit']), deps)
    expect(loadExamples(path)[0]).toMatchObject({ label: 'fit', reason: 'my words' })
    expect(loadExamples(path)).toHaveLength(1)
  })
  it('default label is fit and never invents a reason', async () => {
    const { path, deps } = setup()
    await runAdd(parseAddArgs(['https://boards.greenhouse.io/acme/jobs/123']), deps)
    const e = loadExamples(path)[0]
    expect(e.label).toBe('fit')
    expect(e).not.toHaveProperty('reason')
  })
  it('LinkedIn: no request, stub written, then --text-file fills it without duplicating', async () => {
    const { path, deps, http } = setup()
    const url = 'https://www.linkedin.com/jobs/view/3912345678'
    const r = await runAdd(parseAddArgs([url]), deps)
    expect(http.calls).toHaveLength(0)
    expect(r.needText).toEqual([url])
    expect(loadExamples(path)[0]).toMatchObject({ via: 'manual', needsText: true })
    const txt = join(tmp(), 'job.txt')
    writeFileSync(txt, 'Junior Python Developer\nTel Aviv, Israel\n0-1 years of experience')
    await runAdd(parseAddArgs([url + '?trk=x', '--text-file', txt]), deps)
    const list = loadExamples(path)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ via: 'manual', title: 'Junior Python Developer' })
    expect(list[0].needsText).toBeUndefined()
    expect(http.calls).toHaveLength(0)
    // a later text-less re-add must not wipe the pasted text
    await runAdd(parseAddArgs([url]), deps)
    expect(loadExamples(path)[0].description).toContain('0-1 years')
  })
  it('does not overwrite a corrupt examples.json', async () => {
    const { path, deps } = setup()
    writeFileSync(path, '{not json')
    await expect(runAdd(parseAddArgs(['https://boards.greenhouse.io/acme/jobs/123']), deps)).rejects.toThrow(/not valid JSON/)
    expect(readFileSync(path, 'utf8')).toBe('{not json')
  })
  it('an id alone needs --db; with --db it is pulled from the database read-only', async () => {
    const { path, deps } = setup()
    const r = await runAdd(parseAddArgs(['4242']), deps)
    expect(r.failed).toEqual(['4242'])
    const dbPath = join(tmp(), 'jobs.sqlite')
    const db = new Database(dbPath)
    db.exec('CREATE TABLE jobs (id INTEGER PRIMARY KEY, source TEXT, external_id TEXT, title TEXT, company TEXT, url TEXT, description TEXT, location TEXT, country TEXT, city TEXT, work_mode TEXT, posted_at INTEGER)')
    db.prepare("INSERT INTO jobs VALUES (7,'lever:acme','abc-1','QA Engineer','Acme','https://jobs.lever.co/acme/abc-1','1-2 years of experience in QA','Tel Aviv','IL','Tel Aviv','hybrid',null)").run()
    db.close()
    await runAdd(parseAddArgs(['abc-1', '--db', dbPath]), deps)
    expect(loadExamples(path)[0]).toMatchObject({ id: 'lever:acme:abc-1', country: 'IL', workMode: 'hybrid', via: 'ats-api' })
    expect(existsSync(dbPath)).toBe(true)
  })
})

describe('report', () => {
  const base: Example = { id: 'a:1', url: 'https://x.com/1', label: 'fit', title: 'Junior QA Engineer', company: 'C', location: 'Tel Aviv, Israel', description: '0-2 years of experience in testing.', fetchedAt: '2026-01-01T00:00:00Z', via: 'ats-api' }
  it('keeps a good junior QA job and flags a liked-but-rejected one', () => {
    expect(buildRow(base)).toMatchObject({ kept: true, mismatch: false })
    const bad = buildRow({ ...base, id: 'a:2', url: 'https://x.com/2', title: 'QA Intern' })
    expect(bad).toMatchObject({ kept: false, mismatch: true })
    expect(bad.reasons.join()).toMatch(/intern/)
    expect(formatReport([base, { ...base, id: 'a:2', url: 'https://x.com/2', title: 'QA Intern' }])).toMatch(/MISMATCH \(liked but we reject\)/)
  })
  it('does not score text-less stubs and handles an empty list', () => {
    const stub: Example = { ...base, title: '', description: '', via: 'manual', needsText: true }
    expect(buildRow(stub)).toMatchObject({ score: null, kept: null, mismatch: false })
    expect(formatReport([])).toMatch(/No examples yet/)
  })
})
