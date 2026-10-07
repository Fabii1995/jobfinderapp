import { AlertTriangle, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import { useStatsQuery } from '@renderer/hooks/useJobs'
import { useNow } from '@renderer/hooks/useNow'
import { useUiStore } from '@renderer/store/ui'
import { sourceLabel } from '@renderer/lib/sources'
import type { SourceOutcome } from '@renderer/lib/types'
import { formatRelative } from '@renderer/lib/time'

/** Collapsed "N companies failed" summary; the per-company reasons sit behind a native disclosure. */
function FailureDetails({ failed, label }: { failed: SourceOutcome[]; label: string }): React.JSX.Element {
  return (
    <details data-testid="failure-details" className="text-sm">
      <summary className="cursor-pointer rounded-sm font-medium">{label}</summary>
      <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto pr-2 text-xs">
        {failed.map((f) => (
          <li key={f.source} className="break-words">
            <span className="font-medium">{f.name ?? sourceLabel(f.source)}</span>: {f.error ?? 'failed'}
          </li>
        ))}
      </ul>
    </details>
  )
}

const countLabel = (n: number): string => `${n} ${n === 1 ? 'company' : 'companies'} failed`

interface Props {
  onRetry: () => void
  retrying: boolean
}

/**
 * Failure banners. Driven by the persisted last-refresh summary (so scheduled runs surface
 * too) plus the in-session `refreshFailure` when the refresh call itself rejected.
 */
export function ErrorBanner({ onRetry, retrying }: Props): React.JSX.Element | null {
  const { data: stats } = useStatsQuery()
  const refreshFailure = useUiStore((s) => s.refreshFailure)
  const dismissedAt = useUiStore((s) => s.dismissedBannerAt)
  const dismiss = useUiStore((s) => s.dismissBanner)
  const now = useNow()

  const last = stats?.lastRefresh ?? null
  const failed = (last?.sources ?? []).filter((s) => !s.ok)
  const allFailed = !!last && last.sources.length > 0 && failed.length === last.sources.length
  const hasRows = !!stats && stats.newCount + stats.visitedCount > 0

  const total = refreshFailure != null || allFailed
  if (!total && !(failed.length > 0 && dismissedAt !== last?.at)) return null

  if (total) {
    return (
      <Alert variant="destructive" data-testid="error-banner">
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>Refresh failed</AlertTitle>
        <AlertDescription>
          {refreshFailure != null ? (
            <p>{refreshFailure}</p>
          ) : (
            <>
              <p>No company could be reached.</p>
              <FailureDetails failed={failed} label="Show details" />
            </>
          )}
          {hasRows && last && (
            <p>Showing results from {formatRelative(last.at, now)} or earlier.</p>
          )}
          <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert data-testid="error-banner" className="pr-12 text-score-possible-fg">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>{countLabel(failed.length)}</AlertTitle>
      <AlertDescription>
        <p>Results from the other companies were saved.</p>
        <FailureDetails failed={failed} label="Show details" />
      </AlertDescription>
      <Button
        variant="ghost"
        size="icon-xs"
        className="absolute top-2.5 right-2.5"
        aria-label="Dismiss"
        onClick={() => last && dismiss(last.at)}
      >
        <X aria-hidden="true" />
      </Button>
    </Alert>
  )
}
