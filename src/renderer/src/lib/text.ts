const EXCERPT_MAX = 280

/**
 * Plain-text excerpt of a description that may contain HTML. DOMParser builds an inert
 * document (scripts never run); we only read textContent. Never inject the result as HTML.
 */
export function toExcerpt(html: string | null | undefined): string {
  if (!html) return ''
  let text: string
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    doc.querySelectorAll('script, style, template').forEach((el) => el.remove())
    text = doc.body.textContent ?? ''
  } catch {
    text = ''
  }
  text = text.replace(/\s+/g, ' ').trim()
  return text.length > EXCERPT_MAX ? text.slice(0, EXCERPT_MAX).trimEnd() + '…' : text
}
