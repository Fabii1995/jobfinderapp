import { useMemo } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import { useJobsQuery, useStatsQuery } from '@renderer/hooks/useJobs'
import { useCompanyCountsQuery } from '@renderer/hooks/useCompanies'
import { useDebouncedValue } from '@renderer/hooks/useDebouncedValue'
import { useUiStore } from '@renderer/store/ui'
import { applyFilters } from '@renderer/lib/filters'
import { sortJobs } from '@renderer/lib/sort'
import { EmptyState } from './EmptyState'
import { JobTable } from './JobTable'
import { SkeletonRows } from './SkeletonRows'

interface Props {
  mode: 'new' | 'visited'
  onRefresh: () => void
  refreshing: boolean
}

export function JobsPanel({ mode, onRefresh, refreshing }: Props): React.JSX.Element {
  const jobsQ = useJobsQuery(mode === 'visited')
  const statsQ = useStatsQuery()
  const filters = useUiStore((s) => s.filters)
  const search = useUiStore((s) => s.search)
  const sort = useUiStore((s) => s.sort)
  const refreshFailure = useUiStore((s) => s.refreshFailure)
  const debouncedSearch = useDebouncedValue(search, 150)

  const all = jobsQ.data
  const stats = statsQ.data
  const countsQ = useCompanyCountsQuery()
  const knownCompanies = useMemo(
    () => (countsQ.data ? Object.keys(countsQ.data) : undefined),
    [countsQ.data]
  )
  const filtered = useMemo(
    () => (all ? sortJobs(applyFilters(all, filters, debouncedSearch, knownCompanies), sort) : []),
    [all, filters, debouncedSearch, knownCompanies, sort]
  )

  const result = (body: React.ReactNode, count?: string): React.JSX.Element => (
    <>
      <p aria-live="polite" className="text-xs text-muted-foreground" data-testid="result-count">
        {count ?? ' '}
      </p>
      {body}
    </>
  )

  if (jobsQ.isError && !all) {
    return result(
      <Alert variant="destructive" data-testid="list-error">
        <AlertTitle>Couldn&apos;t load jobs</AlertTitle>
        <AlertDescription>
          <Button variant="outline" size="sm" onClick={() => void jobsQ.refetch()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (!all) return result(<SkeletonRows />)

  if (all.length === 0) {
    const lastRefresh = stats?.lastRefresh ?? null
    const allFailed = !!lastRefresh && lastRefresh.sources.length > 0 && lastRefresh.sources.every((s) => !s.ok)
    const noRowsAtAll = !!stats && stats.newCount + stats.visitedCount === 0
    if (noRowsAtAll && (refreshFailure || allFailed)) {
      const msg = refreshFailure ?? lastRefresh?.sources.find((s) => !s.ok)?.error
      return result(
        <EmptyState variant="failed" onRefresh={onRefresh} refreshing={refreshing} failureMessage={msg} />
      )
    }
    if (mode === 'visited') return result(<EmptyState variant="visited" />, 'Showing 0 of 0')
    if (noRowsAtAll && !lastRefresh) {
      return result(<EmptyState variant="never" onRefresh={onRefresh} refreshing={refreshing} />)
    }
    if (noRowsAtAll && lastRefresh) {
      return result(
        <EmptyState variant="none" onRefresh={onRefresh} refreshing={refreshing} lastRefresh={lastRefresh} />,
        'Showing 0 of 0'
      )
    }
    return result(<EmptyState variant="caughtUp" onRefresh={onRefresh} refreshing={refreshing} />, 'Showing 0 of 0')
  }

  const count = `Showing ${filtered.length} of ${all.length}`
  if (filtered.length === 0) return result(<EmptyState variant="filtered" />, count)
  return result(<JobTable key={`${mode}:${sort}`} mode={mode} sort={sort} jobs={filtered} />, count)
}
