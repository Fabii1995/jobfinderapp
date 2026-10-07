import { describe, expect, it } from 'vitest'
import { isIsraelText, isKeepableLocation, normalizeLocation } from './location'

describe('normalizeLocation: Israel detection', () => {
  it('matches the country word and allowlisted cities (English and Hebrew)', () => {
    for (const l of ['Israel', 'Tel Aviv', 'Tel Aviv-Yafo, Israel', "Ra'anana", 'Petah Tikva', 'Be’er Sheva'.replace('’', "'"), 'תל אביב', 'ישראל', 'הרצליה, ישראל', 'Haifa']) {
      expect(normalizeLocation({ location: l }).country, l).toBe('IL')
    }
  })

  it('NEVER matches a bare IL token', () => {
    for (const l of ['Chicago, IL', 'Springfield, IL', 'IL', 'Remote - IL', 'Naperville IL, United States']) {
      expect(normalizeLocation({ location: l }).country, l).toBeNull()
      expect(isIsraelText(l)).toBe(false)
    }
  })

  it('structured country codes IL / ISR / Israel count; others do not', () => {
    expect(normalizeLocation({ country: 'IL' }).country).toBe('IL')
    expect(normalizeLocation({ country: 'ISR' }).country).toBe('IL')
    expect(normalizeLocation({ country: 'Israel' }).country).toBe('IL')
    expect(normalizeLocation({ country: 'US', location: 'Chicago, IL' }).country).toBe('US')
    expect(normalizeLocation({ country: 'GB' }).country).toBe('GB')
  })

  it('Amazon style "IL, Tel Aviv" with ISR is kept via the structured country and the city', () => {
    const n = normalizeLocation({ location: 'IL, Tel Aviv', country: 'ISR', city: 'Tel Aviv' })
    expect(n).toMatchObject({ country: 'IL', city: 'Tel Aviv' })
    // without the structured country the city still matches (not the "IL")
    expect(normalizeLocation({ location: 'IL, Tel Aviv' }).country).toBe('IL')
    expect(normalizeLocation({ location: 'IL, Chicago' }).country).toBeNull()
  })

  it('picks the earliest-mentioned Israeli city', () => {
    expect(normalizeLocation({ location: 'Israel, Yokneam', locations: ['Israel, Tel Aviv'] }).city).toBe('Yokneam')
  })

  it('multi-location: Israel if ANY location is Israeli', () => {
    const n = normalizeLocation({ location: 'London, UK', locations: ['New York, NY', 'Tel Aviv, Israel'] })
    expect(n).toMatchObject({ country: 'IL', city: 'Tel Aviv' })
    expect(normalizeLocation({ location: 'London, UK; Berlin' }).country).toBeNull()
  })
})

describe('normalizeLocation: work mode', () => {
  it('structured workplace type wins', () => {
    expect(normalizeLocation({ location: 'Tel Aviv', workplaceType: 'Hybrid' }).workMode).toBe('hybrid')
    expect(normalizeLocation({ location: 'Tel Aviv', workplaceType: 'On-site' }).workMode).toBe('onsite')
    expect(normalizeLocation({ location: 'Tel Aviv', workplaceType: 'Remote' }).workMode).toBe('remote')
  })

  it('is_remote alone does not override an explicit workplace type (Comeet hybrid + is_remote)', () => {
    expect(normalizeLocation({ location: 'Tel Aviv', workplaceType: 'Hybrid', isRemote: true }).workMode).toBe('hybrid')
    expect(normalizeLocation({ location: 'Tel Aviv', isRemote: true }).workMode).toBe('remote')
  })

  it('text hints; default is unknown', () => {
    expect(normalizeLocation({ location: 'Remote - Israel' }).workMode).toBe('remote')
    expect(normalizeLocation({ location: 'Tel Aviv (Hybrid)' }).workMode).toBe('hybrid')
    expect(normalizeLocation({ location: 'Tel Aviv' }).workMode).toBe('unknown')
    // an on-site Israeli location is not remote just because another listed place is
    expect(normalizeLocation({ location: 'Tel Aviv', locations: ['Remote - US'] }).workMode).toBe('unknown')
  })
})

describe('isKeepableLocation', () => {
  it('keeps Israel onsite/hybrid/unknown, drops remote and non-Israel', () => {
    expect(isKeepableLocation({ country: 'IL', workMode: 'onsite' })).toBe(true)
    expect(isKeepableLocation({ country: 'IL', workMode: 'hybrid' })).toBe(true)
    expect(isKeepableLocation({ country: 'IL', workMode: 'unknown' })).toBe(true)
    expect(isKeepableLocation({ country: 'IL', workMode: 'remote' })).toBe(false)
    expect(isKeepableLocation({ country: 'US', workMode: 'onsite' })).toBe(false)
    expect(isKeepableLocation({ country: null, workMode: 'onsite' })).toBe(false)
  })
})

describe('Hebrew prefixed city names', () => {
  it('"ברמת גן", "מתל אביב", "בישראל" resolve; unrelated words do not', () => {
    expect(normalizeLocation({ location: 'ארגון ציבורי ברמת גן' })).toMatchObject({ country: 'IL', city: 'Ramat Gan' })
    expect(normalizeLocation({ location: 'משרדים בתל אביב' })).toMatchObject({ country: 'IL', city: 'Tel Aviv' })
    expect(normalizeLocation({ location: 'סטארטאפ בישראל' }).country).toBe('IL')
    expect(normalizeLocation({ location: 'ובחיפה' }).city).toBe('Haifa')
    expect(normalizeLocation({ location: 'Chicago, IL' }).country).toBeNull()
  })
})
