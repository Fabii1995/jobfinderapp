import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { Badge } from '@renderer/components/ui/badge'
import { ErrorBanner } from '@renderer/components/feedback/ErrorBanner'
import { CompaniesPanel } from '@renderer/components/companies/CompaniesPanel'
import { useCompaniesQuery } from '@renderer/hooks/useCompanies'
import { FilterBar } from '@renderer/components/filters/FilterBar'
import { JobsPanel } from '@renderer/components/jobs/JobsPanel'
import { StatsRow } from '@renderer/components/stats/StatsRow'
import { useAppEvents } from '@renderer/hooks/useAppEvents'
import { useStatsQuery } from '@renderer/hooks/useJobs'
import { useRefreshJobs } from '@renderer/hooks/useRefreshJobs'
import { useUiStore, type ActiveTab } from '@renderer/store/ui'
import { Header } from './Header'

export function AppShell(): React.JSX.Element {
  const { data: stats } = useStatsQuery()
  const activeTab = useUiStore((s) => s.activeTab)
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const announce = useUiStore((s) => s.announce)
  const refreshFailure = useUiStore((s) => s.refreshFailure)
  const { data: companiesData } = useCompaniesQuery()
  const refresh = useRefreshJobs()

  const doRefresh = (): void => {
    if (!refresh.isPending) refresh.mutate()
  }
  useAppEvents(doRefresh)

  const last = stats?.lastRefresh
  const allFailed = !!last && last.sources.length > 0 && last.sources.every((s) => !s.ok)
  const refreshError = refreshFailure != null || allFailed
  const hasAnyJobs = !stats || stats.newCount + stats.visitedCount > 0

  const tab = (value: ActiveTab, label: string, n: number | undefined): React.JSX.Element => (
    <TabsTrigger
      value={value}
      data-testid={`tab-${value}`}
      aria-current={activeTab === value ? 'true' : undefined}
      className="px-3"
    >
      {label}
      {n != null && (
        <Badge variant="secondary" className="tabular-nums">
          {n}
        </Badge>
      )}
    </TabsTrigger>
  )

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      <Header refreshing={refresh.isPending} refreshError={refreshError} onRefresh={doRefresh} />
      <div role="status" aria-live="polite" className="sr-only" data-testid="live-region">
        {announce}
      </div>
      <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 min-[1100px]:px-6">
        <ErrorBanner onRetry={doRefresh} retrying={refresh.isPending} />
        {activeTab !== 'companies' && <StatsRow />}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as ActiveTab)}
          className="min-h-0 flex-1 gap-3"
        >
          <TabsList>
            {tab('new', 'New', stats?.newCount)}
            {tab('visited', 'Visited', stats?.visitedCount)}
            {tab('companies', 'Companies', companiesData?.companies.length)}
          </TabsList>
          {hasAnyJobs && activeTab !== 'companies' && <FilterBar />}
          {(['new', 'visited'] as const).map((m) => (
            <TabsContent
              key={m}
              value={m}
              aria-label={m === 'new' ? 'New jobs' : 'Visited jobs'}
              className="flex min-h-[220px] flex-1 flex-col gap-2"
            >
              <JobsPanel mode={m} onRefresh={doRefresh} refreshing={refresh.isPending} />
            </TabsContent>
          ))}
          <TabsContent
            value="companies"
            aria-label="Companies"
            className="flex min-h-[220px] flex-1 flex-col gap-2"
          >
            <CompaniesPanel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
