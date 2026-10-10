import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUiStore } from '@renderer/store/ui'
import { providerName } from '@renderer/lib/jsearch'
import type { JSearchClearSeenResult } from '@renderer/lib/types'
import { jobKeys } from './useJobs'

export const deepSearchKeys = { status: ['deepSearch', 'status'] as const }

function message(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export function useDeepSearchStatus() {
  return useQuery({
    queryKey: deepSearchKeys.status,
    queryFn: () => window.api.jsearch.status(),
    staleTime: 30_000,
    refetchOnWindowFocus: true
  })
}

export function useDeepSearchMutations() {
  const qc = useQueryClient()
  const setAnnounce = useUiStore((s) => s.setAnnounce)
  const refreshStatus = (): Promise<void> => qc.invalidateQueries({ queryKey: deepSearchKeys.status })

  return {
    setKey: useMutation({
      mutationFn: (key: string) => window.api.jsearch.setKey(key),
      onSuccess: refreshStatus
    }),
    clearKey: useMutation({
      mutationFn: () => window.api.jsearch.clearKey(),
      onSuccess: refreshStatus
    }),
    setSerpapiKey: useMutation({
      mutationFn: (key: string) => window.api.jsearch.setSerpapiKey(key),
      onSuccess: refreshStatus
    }),
    clearSerpapiKey: useMutation({
      mutationFn: () => window.api.jsearch.clearSerpapiKey(),
      onSuccess: refreshStatus
    }),
    clearSeen: useMutation({
      mutationFn: (): Promise<JSearchClearSeenResult> => window.api.jsearch.clearSeen(),
      onSuccess: (res) => {
        if (res.ok) void refreshStatus()
      }
    }),
    deepRefresh: useMutation({
      mutationFn: () => window.api.jsearch.deepRefresh(),
      onSuccess: async (res) => {
        await Promise.all([refreshStatus(), qc.invalidateQueries({ queryKey: jobKeys.all })])
        if (res.ok) {
          const s = res.summary
          const none = !s || (s.inserted === 0 && s.updated === 0)
          const via = res.provider ? ` via ${providerName(res.provider)}` : ''
          const counts = s ? `${s.inserted} new, ${s.updated} updated (${s.requests} requests used)` : ''
          toast.success(`Deep refresh done${via}`, {
            description: none ? 'No new jobs found' : counts || res.message || undefined
          })
          setAnnounce(`Deep refresh complete${via}: ${none ? 'no new jobs found' : counts}`)
        } else {
          toast.error('Deep refresh failed', { description: res.message })
          setAnnounce(`Deep refresh failed: ${res.message}`)
        }
      },
      onError: (err) => {
        const m = message(err)
        toast.error('Deep refresh failed', { description: m })
        setAnnounce(`Deep refresh failed: ${m}`)
      }
    })
  }
}
