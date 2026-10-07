import type { JobFinderApi } from '../shared/ipc'

declare global {
  interface Window {
    api: JobFinderApi
    appShortcuts: { onRefresh: (cb: () => void) => () => void }
  }
}
