import { describe, expect, it } from 'vitest'
import { stripHtml } from '../sources/http'
import { fetchGreenhouse } from '../sources/greenhouse'
import type { Http, RawJob } from '../sources/types'

const noMarkup = (s: string): void => {
  expect(s).not.toMatch(/<\s*\/?\s*[a-z!][^>]*>/i)
  expect(s.toLowerCase()).not.toContain('<script')
}

describe('stripHtml: tags and scripts do not survive', () => {
  const cases: Record<string, string> = {
    script: 'Hi<script>alert(1)</script>there',
    scriptAttrs: 'Hi<script type="text/javascript" src=x>alert(1)</script>there',
    scriptUpper: 'Hi<SCRIPT>alert(1)</SCRIPT>there',
    scriptMultiline: 'Hi<script>\nalert(1)\n</script>there',
    style: 'Hi<style>body{background:url(javascript:alert(1))}</style>there',
    onerror: '<img src=x onerror=alert(1)>Hi there',
    onclick: '<a href="javascript:alert(1)" onclick="alert(2)">Hi</a> there',
    svg: '<svg onload=alert(1)><circle/></svg>Hi there',
    iframe: '<iframe src="javascript:alert(1)"></iframe>Hi there',
    nested: '<div><p><b><i>Hi</i></b></p></div> there',
    comment: '<!-- hidden -->Hi there'
  }
  for (const [name, input] of Object.entries(cases)) {
    it(name, () => {
      const out = stripHtml(input)
      noMarkup(out)
      expect(out).not.toMatch(/onerror|onclick|onload|javascript:/i)
      expect(out).toMatch(/there/)
    })
  }

  it('script and style bodies are removed entirely', () => {
    expect(stripHtml('Hi<script>alert(1)</script>there')).not.toContain('alert')
    expect(stripHtml('x<style>.a{}</style>y')).not.toContain('.a{}')
  })

  it('block tags become newlines', () => {
    expect(stripHtml('<p>One</p><p>Two<br>Three</p>')).toBe('One\nTwo\nThree')
  })

  it('malformed/unterminated tags: output has no complete tag', () => {
    for (const s of ['<div <p>Hi', '<a href="x>Hi</a>', 'a < b > c x']) {
      noMarkup(stripHtml(s))
    }
  })

  it('split payloads do not reassemble into a script opener', () => {
    for (const p of ['<scr<script>x</script>ipt>alert(1)', '<<b>script>alert(1)<</b>/script>']) {
      expect(stripHtml(p).toLowerCase()).not.toContain('<script')
    }
  })

  // Regression: entity decoding must not turn encoded markup into literal markup.
  it('entity-encoded tags (&lt;script&gt;) do not become literal <script> text', () => {
    expect(stripHtml('&lt;script&gt;alert(1)&lt;/script&gt;')).not.toContain('<script')
  })

  it('numeric/named entities decode to text', () => {
    expect(stripHtml('A&#65;&#x42;&amp;&nbsp;C')).toBe('AAB& C')
  })

  it('unknown entities are left as-is', () => {
    expect(stripHtml('&bogus; &amp;amp;')).toBe('&bogus; &amp;')
  })

  // Regression: out-of-range numeric entities must not throw (one hostile description would otherwise
  // break normalization and the whole source fetch).
  it('out-of-range numeric entity (&#99999999;) does not throw', () => {
    expect(() => stripHtml('a &#99999999; b')).not.toThrow()
  })
  it('out-of-range hex entity (&#xFFFFFFFF;) does not throw', () => {
    expect(() => stripHtml('a &#xFFFFFFFF; b')).not.toThrow()
  })

  it('mojibake nbsp becomes a space', () => {
    expect(stripHtml('aÂ b')).toBe('a b')
    expect(stripHtml('a b')).toBe('a b')
  })

  it('empty, whitespace-only, and huge inputs', () => {
    expect(stripHtml('')).toBe('')
    expect(stripHtml('   \n\t ')).toBe('')
    const big = '<p>' + 'word '.repeat(200_000) + '</p>'
    expect(stripHtml(big).length).toBeGreaterThan(900_000)
  })

  it('many unclosed <script> openers stay fast', () => {
    const t = Date.now()
    stripHtml('<script>'.repeat(20_000))
    expect(Date.now() - t).toBeLessThan(3000)
  })

  it('200k unclosed <script / <style openers are fast and leave no script text', () => {
    for (const tag of ['<script', '<style']) {
      const t = Date.now()
      const out = stripHtml('Hi ' + tag.repeat(200_000))
      expect(Date.now() - t).toBeLessThan(1000)
      expect(out.toLowerCase()).not.toMatch(/script|style/)
    }
  })

  it('well-formed script/style blocks are still removed', () => {
    expect(stripHtml('a<script>x=1</script>b<style>.c{}</style>d<SCRIPT src=q>y</SCRIPT>e')).toBe('a b d e')
    expect(stripHtml('<script>one</script><p>keep</p><script>two</script>')).toBe('keep')
  })

  // Regression (DoS): a run of '<' with no '>' must not be quadratic (it would freeze the main process).
  it('100k unclosed "<" is processed in under 1s', () => {
    const t = Date.now()
    stripHtml('<'.repeat(100_000))
    expect(Date.now() - t).toBeLessThan(1000)
  })
})

describe('source normalizers', () => {
  const gh = async (job: Record<string, unknown>): Promise<RawJob[]> => {
    const http: Http = { getJson: async () => ({ jobs: [job] }), postJson: async () => ({}) }
    return fetchGreenhouse({ token: 'x' }, { id: 'greenhouse:x', name: 'X', http })
  }
  it('descriptions are stripped', async () => {
    const d =
      '&lt;p&gt;Hello&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;<p>Hi</p><script>alert(1)</script><img src=x onerror=alert(2)>'
    const [j] = await gh({ id: 1, title: 't', absolute_url: 'https://x', content: d, location: { name: 'Tel Aviv' } })
    noMarkup(j.description!)
  })

  // Titles are NOT html-stripped (renderer renders text nodes); pinned so innerHTML use is caught in review.
  it('title is stored verbatim; URL schemes are not filtered at ingestion (openJob is the gate)', async () => {
    const [j] = await gh({ id: 1, title: '<img src=x onerror=alert(1)>QA', absolute_url: 'javascript:alert(1)' })
    expect(j.title).toBe('<img src=x onerror=alert(1)>QA')
    expect(j.url).toBe('javascript:alert(1)')
  })
})
