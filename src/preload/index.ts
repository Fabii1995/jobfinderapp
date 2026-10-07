import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type JobFinderApi } from '../shared/ipc'
import { APP_REFRESH_SHORTCUT } from '../shared/shortcuts'

const api: JobFinderApi = {
  list: (req) => ipcRenderer.invoke(IPC.list, req),
  refresh: () => ipcRenderer.invoke(IPC.refresh),
  visit: (id) => ipcRenderer.invoke(IPC.visit, id),
  stats: () => ipcRenderer.invoke(IPC.stats),
  open: (id) => ipcRenderer.invoke(IPC.open, id),
  companyCounts: () => ipcRenderer.invoke(IPC.companyCounts),
  companies: {
    list: () => ipcRenderer.invoke(IPC.companiesList),
    add: (req) => ipcRenderer.invoke(IPC.companiesAdd, req),
    remove: (id) => ipcRenderer.invoke(IPC.companiesRemove, id),
    setEnabled: (id, enabled) => ipcRenderer.invoke(IPC.companiesSetEnabled, id, enabled)
  },
  onChanged: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on(IPC.changed, listener)
    return () => ipcRenderer.removeListener(IPC.changed, listener)
  }
}

// Ctrl+R hook (main intercepts the key; see src/main/shortcuts.ts). Returns an unsubscribe fn.
// TODO(5b): once jobs refresh wiring exists, fold this into JobFinderApi in src/shared/ipc.ts if desired.
const appShortcuts = {
  onRefresh: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on(APP_REFRESH_SHORTCUT, listener)
    return () => ipcRenderer.removeListener(APP_REFRESH_SHORTCUT, listener)
  }
}

// Sandboxed preload: may only require 'electron' (no bundled-external npm packages), so
// @electron-toolkit/preload's electronAPI is deliberately not used (nothing in the renderer reads it).
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('appShortcuts', appShortcuts)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.appShortcuts = appShortcuts
}
