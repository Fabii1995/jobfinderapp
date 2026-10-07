/** Shared text helpers for the keyword matchers (scoring, roles, location, workday). Pure; no I/O. */

/** Escapes regex metacharacters so `s` matches literally. */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Lookbehind / lookahead for a Unicode letter-or-digit boundary (works for Hebrew, unlike \b). */
export const WORD_START = '(?<![\\p{L}\\p{N}])'
export const WORD_END = '(?![\\p{L}\\p{N}])'

/**
 * One regex matching any of `words` as a whole word (Unicode letter/digit boundaries). Longest
 * alternatives first so "vue.js" wins over "vue". `flags` must include `u`; pass `giu` for a
 * global matcher (counting with matchAll) and `iu` for a plain test() matcher: a global regex
 * carries lastIndex state, so never use test() on one.
 */
export function wordMatcher(words: string[], flags = 'iu'): RegExp {
  const alts = [...words].sort((a, b) => b.length - a.length).map(escapeRe)
  return new RegExp(`${WORD_START}(?:${alts.join('|')})${WORD_END}`, flags)
}
