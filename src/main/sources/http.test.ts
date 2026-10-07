import { describe, expect, it } from 'vitest'
import { stripHtml } from './http'

describe('stripHtml: non-breaking spaces', () => {
  it('normalizes NBSP and the UTF-8-misdecoded "Â" + NBSP pair to a plain space', () => {
    expect(stripHtml('aÂ b')).toBe('a b')
    expect(stripHtml('a b')).toBe('a b')
    expect(stripHtml('aÂ  b')).toBe('a b')
  })
})
