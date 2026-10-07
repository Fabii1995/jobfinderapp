import { useMemo } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { namesFromOutcomes } from '@renderer/lib/sources'
import { jobKeys, useStatsQuery } from './useJobs'

// Under the ['jobs', ...] prefix so every existing `invalidateQueries(jobKeys.all)` covers them.
export const companyKeys = {
  list: ['jobs', 'companies'] as const,
  counts: ['jobs', 'companyCounts'] as const
}

export function useCompaniesQuery() {
  return useQuery({
    queryKey: companyKeys.list,
    queryFn: () => window.api.companies.list(),
    placeholderData: keepPreviousData,
    staleTime: 30_000
  })
}

export function useCompanyCountsQuery() {
  return useQuery({
    queryKey: companyKeys.counts,
    queryFn: () => window.api.companyCounts(),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchOnWindowFocus: true
  })
}

/** id -> display name, from the configured companies, then the last refresh outcomes. */
export function useCompanyNames(): Record<string, string> {
  const { data: list } = useCompaniesQuery()
  const { data: stats } = useStatsQuery()
  return useMemo(() => {
    const names = namesFromOutcomes(stats?.lastRefresh?.sources)
    for (const c of list?.companies ?? []) names[c.id] = c.name
    return names
  }, [list, stats])
}

export function useCompanyMutations() {
  const qc = useQueryClient()
  const done = (): Promise<void> => qc.invalidateQueries({ queryKey: jobKeys.all })
  return {
    add: useMutation({
      mutationFn: (req: { url: string; name?: string }) => window.api.companies.add(req),
      onSuccess: done
    }),
    remove: useMutation({
      mutationFn: (id: string) => window.api.companies.remove(id),
      onSuccess: done
    }),
    setEnabled: useMutation({
      mutationFn: (v: { id: string; enabled: boolean }) =>
        window.api.companies.setEnabled(v.id, v.enabled),
      onSuccess: done
    })
  }
}
