import type { BrowserWindow } from 'electron'
import { APP_REFRESH_SHORTCUT } from '../shared/shortcuts'

/**
 * Intercepts Ctrl+R (Cmd+R on macOS) before the page sees it, so it never
 * reloads the renderer (dev or prod), and tells the renderer to refresh jobs.
 * The renderer subscribes via `window.appShortcuts.onRefresh` (see preload).
 */
export function registerRefreshShortcut(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return
    const mod = input.control || input.meta
    if (mod && !input.shift && !input.alt && input.key.toLowerCase() === 'r') {
      event.preventDefault()
      if (!win.isDestroyed()) win.webContents.send(APP_REFRESH_SHORTCUT)
    }
  })
}
