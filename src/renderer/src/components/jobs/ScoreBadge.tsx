import { Badge } from '@renderer/components/ui/badge'
import { SCORE_MAX, TIER_LABEL, tierOf, type Tier } from '@renderer/lib/score'
import { cn } from '@renderer/lib/utils'

const TIER_CLASS: Record<Tier, string> = {
  strong: 'bg-score-strong-bg text-score-strong-fg',
  possible: 'bg-score-possible-bg text-score-possible-fg',
  weak: 'bg-score-weak-bg text-score-weak-fg'
}

export function ScoreBadge({ score }: { score: number | null }): React.JSX.Element {
  if (score == null) {
    return (
      <Badge variant="outline" className="min-w-10 tabular-nums" data-testid="score-badge" aria-label="No score">
        -
      </Badge>
    )
  }
  const rounded = Math.round(score)
  const tier = tierOf(score)
  return (
    <Badge
      className={cn('min-w-10 tabular-nums', TIER_CLASS[tier])}
      data-testid="score-badge"
      data-tier={tier}
      title={TIER_LABEL[tier]}
      aria-label={`Score ${rounded} of ${SCORE_MAX}, ${TIER_LABEL[tier].toLowerCase()}`}
    >
      {rounded}
    </Badge>
  )
}
