import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUiStore } from '@renderer/store/ui'
import { jobKeys } from './useJobs'

export const SEARCH_INPUT_ID = 'job-search-input'

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

/**
 * Wires main -> renderer pushes (`jobs:changed`, Ctrl+R) and in-page shortcuts
 * (Ctrl+1 / Ctrl+2 tabs, `/` focuses search).
 */
export function useAppEvents(refresh: () => void): void {
  const qc = useQueryClient()
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  })

  useEffect(() => {
    const offChanged = window.api.onChanged(() => {
      useUiStore.getState().setRefreshFailure(null)
      void qc.invalidateQueries({ queryKey: jobKeys.all })
    })
    const offRefresh = window.appShortcuts.onRefresh(() => refreshRef.current())
    return () => {
      offChanged()
      offRefresh()
    }
  }, [qc])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === '1') {
        e.preventDefault()
        setActiveTab('new')
      } else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key === '2') {
        e.preventDefault()
        setActiveTab('visited')
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
        const input = document.getElementById(SEARCH_INPUT_ID)
        if (input) {
          e.preventDefault()
          input.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setActiveTab])
}
