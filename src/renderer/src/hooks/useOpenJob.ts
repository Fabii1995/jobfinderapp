import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUiStore } from '@renderer/store/ui'
import { isLinkedInJob } from '@renderer/lib/jsearch'
import type { Job } from '@renderer/lib/types'
import { jobKeys } from './useJobs'

/**
 * Opens the job in the system browser via `jobs:open` (main validates the URL, opens it,
 * then marks it visited). Not optimistic: the row moves only after main confirms.
 */
export function useOpenJob() {
  const qc = useQueryClient()
  const setAnnounce = useUiStore((s) => s.setAnnounce)
  const setLinkedinHintShown = useUiStore((s) => s.setLinkedinHintShown)

  return useMutation({
    mutationFn: async (job: Job) => {
      const res = await window.api.open(job.id)
      if (!res) throw new Error('Job no longer exists')
      return res
    },
    onSuccess: async (_res, job) => {
      if (job.visitedAt == null) {
        const hint = isLinkedInJob(job) && !useUiStore.getState().linkedinHintShown
        if (hint) setLinkedinHintShown()
        toast('Moved to Visited', {
          description: `${job.title ?? 'Untitled role'}${hint ? '. LinkedIn may ask you to sign in.' : ''}`,
          duration: hint ? 5000 : 3000
        })
        setAnnounce(`Moved ${job.title ?? 'job'} to Visited`)
      }
      await qc.invalidateQueries({ queryKey: jobKeys.all })
    },
    onError: () => {
      toast.error("Couldn't open that link")
      setAnnounce("Couldn't open that link")
    }
  })
}
