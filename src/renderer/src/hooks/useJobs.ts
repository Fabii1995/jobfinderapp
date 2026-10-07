import { keepPreviousData, useQuery } from '@tanstack/react-query'

export const jobKeys = {
  all: ['jobs'] as const,
  list: (visited: boolean) => ['jobs', 'list', { visited }] as const,
  stats: ['jobs', 'stats'] as const
}

export function useJobsQuery(visited: boolean) {
  return useQuery({
    queryKey: jobKeys.list(visited),
    queryFn: () => window.api.list({ visited }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchOnWindowFocus: true
  })
}

export function useStatsQuery() {
  return useQuery({
    queryKey: jobKeys.stats,
    queryFn: () => window.api.stats(),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchOnWindowFocus: true
  })
}
