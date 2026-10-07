import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUiStore } from '@renderer/store/ui'
import { jobKeys } from './useJobs'

function message(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  // Electron prefixes "Error invoking remote method 'x': Error: ..."
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** User-initiated refresh (button / Ctrl+R). Scheduled runs arrive via `jobs:changed`. */
export function useRefreshJobs() {
  const qc = useQueryClient()
  const setAnnounce = useUiStore((s) => s.setAnnounce)
  const setRefreshFailure = useUiStore((s) => s.setRefreshFailure)

  return useMutation({
    mutationFn: () => window.api.refresh(),
    onMutate: () => {
      setRefreshFailure(null)
      setAnnounce('Refreshing jobs...')
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: jobKeys.all })
      const failed = res.sources.filter((s) => !s.ok)
      const configError = res.errors?.['companies.json']
      if (configError) toast.error('Company list problem', { description: configError })
      const summary = `${res.inserted} new, ${res.updated} updated`
      if (failed.length && failed.length === res.sources.length) {
        setAnnounce('Refresh failed: no company could be reached')
        toast.error('Refresh failed', { description: 'No company could be reached.' })
      } else if (failed.length) {
        const n = `${failed.length} ${failed.length === 1 ? 'company' : 'companies'} failed`
        setAnnounce(`Refresh finished, ${n}: ${summary}`)
        toast.warning('Refreshed with errors', { description: `${summary}. ${n}.` })
      } else {
        setAnnounce(`Refresh complete: ${summary}`)
        toast.success('Refreshed', {
          description: res.inserted === 0 && res.updated === 0 ? 'Already up to date' : summary
        })
      }
    },
    onError: (err) => {
      const m = message(err)
      setRefreshFailure(m)
      setAnnounce(`Refresh failed: ${m}`)
      toast.error('Refresh failed', { description: m })
    }
  })
}
