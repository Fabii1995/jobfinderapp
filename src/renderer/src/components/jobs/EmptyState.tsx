import { CheckCircle2, CloudOff, Inbox, MousePointerClick, SearchX, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { ROLE_LABELS } from '@renderer/lib/types'
import { WORK_MODE_LABEL } from '@renderer/lib/filters'
import type { LastRefresh } from '@renderer/lib/types'
import { useUiStore } from '@renderer/store/ui'

type Variant = 'never' | 'none' | 'caughtUp' | 'filtered' | 'visited' | 'failed'

interface Props {
  variant: Variant
  onRefresh?: () => void
  refreshing?: boolean
  failureMessage?: string
  lastRefresh?: LastRefresh | null
}

function Shell({
  testId,
  icon,
  title,
  children
}: {
  testId: string
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      data-testid={testId}
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-lg border px-6 py-10 text-center"
    >
      <div className="text-muted-foreground" aria-hidden="true">
        {icon}
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </div>
  )
}

export function EmptyState({ variant, onRefresh, refreshing, failureMessage, lastRefresh }: Props): React.JSX.Element {
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const filters = useUiStore((s) => s.filters)
  const search = useUiStore((s) => s.search)
  const setCompany = useUiStore((s) => s.setCompany)
  const setWorkMode = useUiStore((s) => s.setWorkMode)
  const toggleRole = useUiStore((s) => s.toggleRole)
  const setMinScore = useUiStore((s) => s.setMinScore)
  const setSearch = useUiStore((s) => s.setSearch)
  const clearFilters = useUiStore((s) => s.clearFilters)

  const refreshBtn = (label: string, variantName: 'default' | 'secondary'): React.JSX.Element => (
    <Button variant={variantName} onClick={onRefresh} disabled={refreshing}>
      {label}
    </Button>
  )

  switch (variant) {
    case 'never':
      return (
        <Shell testId="empty-never" icon={<Inbox className="size-10" />} title="No jobs yet">
          <p className="max-w-md text-sm text-muted-foreground">
            Run your first refresh to look for junior and entry-level software roles in Israel (on-site
            or hybrid) on your companies&apos; career pages.
          </p>
          {refreshBtn(refreshing ? 'Refreshing...' : 'Refresh now', 'default')}
        </Shell>
      )
    case 'none': {
      const ok = (lastRefresh?.sources ?? []).filter((x) => x.ok)
      const fetched = ok.reduce((n, x) => n + (x.count ?? 0), 0)
      const inIsrael = ok.reduce((n, x) => n + (x.israel ?? 0), 0)
      return (
        <Shell
          testId="empty-none"
          icon={<SearchX className="size-10" />}
          title="No junior jobs in Israel found yet"
        >
          <p className="max-w-lg text-sm text-muted-foreground">
            The filter is strict on purpose: only jobs located in Israel and on-site or hybrid (remote
            is excluded) whose title or description looks junior or entry-level are kept. Senior roles,
            interns and students are dropped.
          </p>
          {lastRefresh && (
            <p className="max-w-lg text-sm text-muted-foreground" data-testid="empty-none-summary">
              Last refresh checked {ok.length} {ok.length === 1 ? 'company' : 'companies'}: {fetched} jobs
              fetched, {inIsrael} in Israel, 0 matched.
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {refreshBtn(refreshing ? 'Refreshing...' : 'Refresh now', 'default')}
            <Button variant="secondary" onClick={() => setActiveTab('companies')}>
              Manage companies
            </Button>
          </div>
        </Shell>
      )
    }
    case 'failed':
      return (
        <Shell testId="empty-failed" icon={<CloudOff className="size-10" />} title="Refresh failed">
          <p className="max-w-md text-sm text-muted-foreground">
            {failureMessage ?? 'No company could be reached.'} No jobs are saved yet.
          </p>
          {refreshBtn(refreshing ? 'Refreshing...' : 'Retry refresh', 'default')}
        </Shell>
      )
    case 'caughtUp':
      return (
        <Shell testId="empty-caught-up" icon={<CheckCircle2 className="size-10" />} title="You're all caught up">
          <p className="max-w-md text-sm text-muted-foreground">
            New roles appear after the next refresh (automatic every 3 hours).
          </p>
          {refreshBtn(refreshing ? 'Refreshing...' : 'Refresh now', 'secondary')}
        </Shell>
      )
    case 'visited':
      return (
        <Shell testId="empty-visited" icon={<MousePointerClick className="size-10" />} title="Nothing visited yet">
          <p className="max-w-md text-sm text-muted-foreground">
            Open a job from the New tab and it will be saved here.
          </p>
          <Button variant="secondary" onClick={() => setActiveTab('new')}>
            Go to New
          </Button>
        </Shell>
      )
    case 'filtered': {
      const chips: { key: string; label: string; remove: () => void }[] = [
        ...(filters.company
          ? [{ key: 'company', label: filters.company, remove: () => setCompany(null) }]
          : []),
        ...(filters.workMode !== 'all'
          ? [{ key: 'mode', label: WORK_MODE_LABEL[filters.workMode], remove: () => setWorkMode('all') }]
          : []),
        ...filters.roles.map((r) => ({ key: `r-${r}`, label: ROLE_LABELS[r], remove: () => toggleRole(r) })),
        ...(filters.minScore > 0
          ? [{ key: 'score', label: `Score ${filters.minScore}+`, remove: () => setMinScore(0) }]
          : []),
        ...(search.trim()
          ? [{ key: 'q', label: `"${search.trim()}"`, remove: () => setSearch('') }]
          : [])
      ]
      return (
        <Shell testId="empty-filtered" icon={<SearchX className="size-10" />} title="No jobs match your filters">
          <div className="flex flex-wrap justify-center gap-2">
            {chips.map((c) => (
              <Badge key={c.key} variant="secondary" className="gap-1 pr-1">
                {c.label}
                <button
                  type="button"
                  onClick={c.remove}
                  aria-label={`Remove filter ${c.label}`}
                  className="rounded-full p-0.5 hover:bg-background/60"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            ))}
          </div>
          <Button variant="secondary" onClick={clearFilters}>
            Clear filters
          </Button>
        </Shell>
      )
    }
  }
}
