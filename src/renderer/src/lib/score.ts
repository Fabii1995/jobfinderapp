export const SCORE_MAX = 100
const TIERS = { strong: 70, possible: 40 } as const // >=70 strong, 40-69 possible, <40 weak

export type Tier = 'strong' | 'possible' | 'weak'

export const TIER_LABEL: Record<Tier, string> = {
  strong: 'Strong match',
  possible: 'Possible match',
  weak: 'Weak match'
}

export function tierOf(score: number): Tier {
  if (score >= TIERS.strong) return 'strong'
  if (score >= TIERS.possible) return 'possible'
  return 'weak'
}

export const MIN_SCORE_OPTIONS = [0, 30, 50, 70] as const
export type MinScore = (typeof MIN_SCORE_OPTIONS)[number]
