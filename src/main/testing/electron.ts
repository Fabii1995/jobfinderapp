import { vi } from 'vitest'

/** ipcMain.handle registrations captured by electronMock(); clear in beforeEach. */
export const handlers = new Map<string, (...args: unknown[]) => unknown>()
/** shell.openExternal stand-in. */
export const openExternal = vi.fn().mockResolvedValue(undefined)

/**
 * Factory for `vi.mock('electron', ...)`. vi.mock is hoisted above imports, so load this lazily:
 *   vi.mock('electron', async () => (await import('./testing/electron')).electronMock())
 * and import `handlers` / `openExternal` normally (same module instance as the one the factory loads).
 */
export const electronMock = (): {
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => Map<string, (...args: unknown[]) => unknown> }
  shell: { openExternal: (u: string) => Promise<void> }
} => ({
  ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) },
  shell: { openExternal: (u: string) => openExternal(u) as Promise<void> }
})
