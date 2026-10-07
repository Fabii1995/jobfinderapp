import { AlertTriangle } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Card } from '@renderer/components/ui/card'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useStatsQuery } from '@renderer/hooks/useJobs'
import { useCompanyCountsQuery } from '@renderer/hooks/useCompanies'
import { useNow } from '@renderer/hooks/useNow'
import { useUiStore } from '@renderer/store/ui'
import { formatAbsolute, formatRelative } from '@renderer/lib/time'
import { cn } from '@renderer/lib/utils'

const CARD =
  'gap-1 px-4 py-3 [@media(max-height:700px)]:flex-row [@media(max-height:700px)]:flex-wrap [@media(max-height:700px)]:items-center [@media(max-height:700px)]:gap-x-2 [@media(max-height:700px)]:py-2'
const LABEL = 'text-xs text-muted-foreground'
const VALUE = 'text-2xl font-semibold leading-none tabular-nums [@media(max-height:700px)]:text-xl'

function TabCard({
  label,
  value,
  tab,
  testId
}: {
  label: string
  value: number | undefined
  tab: 'new' | 'visited'
  testId: string
}): React.JSX.Element {
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  return (
    <Card className={cn(CARD, 'relative')}>
      <button
        type="button"
        data-testid={testId}
        onClick={() => setActiveTab(tab)}
        className="absolute inset-0 rounded-xl"
        aria-label={`${label}: ${value ?? 'loading'}. Show ${label} jobs`}
      />
      <div className={LABEL}>{label}</div>
      {value == null ? <Skeleton className="h-7 w-12" /> : <div className={VALUE}>{value}</div>}
    </Card>
  )
}

export function StatsRow(): React.JSX.Element {
  const { data: stats } = useStatsQuery()
  const now = useNow()
  const filters = useUiStore((s) => s.filters)
  const setCompany = useUiStore((s) => s.setCompany)
  const { data: counts } = useCompanyCountsQuery()
  const last = stats?.lastRefresh ?? null

  const MAX_CHIPS = 8
  const companies = Object.entries(counts ?? {})
    .filter(([name]) => name !== '')
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const shown = companies.slice(0, MAX_CHIPS)
  // A company selected via the filter bar must stay visible even if it is not in the top N.
  if (filters.company && !shown.some(([n]) => n === filters.company)) {
    const sel = companies.find(([n]) => n === filters.company)
    if (sel) shown.push(sel)
  }
  const hidden = companies.length - shown.length
  const failed = new Map(
    (last?.sources ?? []).filter((s) => !s.ok && s.name).map((s) => [s.name as string, s.error])
  )

  return (
    <section
      aria-label="Summary"
      className="grid grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.6fr)] gap-3"
    >
      <TabCard label="New" value={stats?.newCount} tab="new" testId="stat-new" />
      <TabCard label="Visited" value={stats?.visitedCount} tab="visited" testId="stat-visited" />
      <Card className={CARD} data-testid="stat-last-refresh">
        <div className={LABEL}>Last refresh</div>
        {!stats ? (
          <Skeleton className="h-6 w-20" />
        ) : stats.lastRefreshAt == null ? (
          <div className="text-lg leading-none font-semibold">Never</div>
        ) : (
          <>
            <div
              className="text-lg leading-none font-semibold"
              title={formatAbsolute(stats.lastRefreshAt)}
            >
              {formatRelative(stats.lastRefreshAt, now)}
            </div>
            {last && (
              <div className={cn(LABEL, '[@media(max-height:700px)]:hidden')}>
                {last.inserted} new, {last.updated} updated
              </div>
            )}
          </>
        )}
      </Card>
      <Card className={CARD}>
        <div className={LABEL}>
          By company <span className="[@media(max-height:700px)]:hidden">(all jobs, new + visited)</span>
        </div>
        {!stats ? (
          <Skeleton className="h-6 w-40" />
        ) : !counts ? (
          <Skeleton className="h-6 w-40" />
        ) : companies.length === 0 ? (
          <div className="text-sm text-muted-foreground">No jobs yet</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {shown.map(([name, n]) => {
              const pressed = filters.company === name
              const err = failed.get(name)
              const chip = (
                <Badge
                  asChild
                  variant={pressed ? 'default' : 'outline'}
                  className="cursor-pointer gap-1 py-0.5"
                >
                  <button
                    type="button"
                    aria-pressed={pressed}
                    data-testid={`stat-company-${name}`}
                    onClick={() => setCompany(pressed ? null : name)}
                  >
                    {failed.has(name) && <AlertTriangle aria-label="last refresh failed" />}
                    <span className="max-w-[10rem] truncate">{name}</span>{' '}
                    <span className="tabular-nums">{n}</span>
                  </button>
                </Badge>
              )
              return failed.has(name) ? (
                <Tooltip key={name}>
                  <TooltipTrigger asChild>{chip}</TooltipTrigger>
                  <TooltipContent>Last refresh failed: {err ?? 'unknown error'}</TooltipContent>
                </Tooltip>
              ) : (
                <span key={name}>{chip}</span>
              )
            })}
            {hidden > 0 && (
              <span className="self-center text-xs text-muted-foreground">+{hidden} more</span>
            )}
          </div>
        )}
      </Card>
    </section>
  )
}
