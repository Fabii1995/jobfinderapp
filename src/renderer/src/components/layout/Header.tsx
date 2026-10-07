import { ThemeToggle } from '@renderer/components/ThemeToggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useStatsQuery } from '@renderer/hooks/useJobs'
import { useNow } from '@renderer/hooks/useNow'
import { formatAbsolute, formatRelative } from '@renderer/lib/time'
import { RefreshButton } from './RefreshButton'

interface Props {
  refreshing: boolean
  refreshError: boolean
  onRefresh: () => void
}

function LastRefreshLabel(): React.JSX.Element {
  const { data: stats } = useStatsQuery()
  const now = useNow()
  const at = stats?.lastRefreshAt
  const text = !stats ? '' : at == null ? 'Never refreshed' : `Last refreshed ${formatRelative(at, now)}`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="last-refresh"
          className="hidden text-xs text-muted-foreground min-[1000px]:inline"
        >
          {text}
        </span>
      </TooltipTrigger>
      {at != null && <TooltipContent>{formatAbsolute(at)}</TooltipContent>}
    </Tooltip>
  )
}

export function Header({ refreshing, refreshError, onRefresh }: Props): React.JSX.Element {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center justify-between px-4 min-[1100px]:px-6">
        <h1 className="text-base font-semibold">Job Finder</h1>
        <div className="flex items-center gap-3">
          <LastRefreshLabel />
          <RefreshButton loading={refreshing} error={refreshError} onClick={onRefresh} />
          <ThemeToggle />
        </div>
      </div>
      {/* 2px reserved so the progress bar never shifts layout */}
      <div className="h-0.5" aria-hidden="true">
        {refreshing && (
          <div
            data-testid="refresh-progress"
            className="h-full w-full animate-pulse bg-primary motion-reduce:animate-none"
          />
        )}
      </div>
    </header>
  )
}
