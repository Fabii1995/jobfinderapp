import { useSyncExternalStore } from 'react'

function subscribe(cb: () => void): () => void {
  window.addEventListener('resize', cb)
  return () => window.removeEventListener('resize', cb)
}

const COMPACT_BREAKPOINT = 1100

function useWindowWidth(): number {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth,
    () => 1280
  )
}

export function useIsCompact(): boolean {
  return useWindowWidth() < COMPACT_BREAKPOINT
}
