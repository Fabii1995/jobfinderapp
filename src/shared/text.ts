/** Tiny plain-text sanitizer shared by main (IPC re-sanitize) and renderer (display). Not a general HTML parser. */

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

function codePoint(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return ' '
  return String.fromCodePoint(n)
}

/** Strips tags, decodes entities once, removes any markup the decode produced, collapses whitespace to one line. */
export function stripHtmlLine(input: string): string {
  return input
    .replace(/<[^<>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => codePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED[name.toLowerCase()] ?? m)
    .replace(/<\/?[a-z!?][^<>]*>/gi, ' ')
    .replace(/<(?=\/?[a-z!?])/gi, '')
    .replace(/[\u0000-\u001f\u007f\u00a0]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
