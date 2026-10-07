import { pathToFileURL } from 'url'
import { beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Drives the real src/main/index.ts with electron mocked, captures the BrowserWindow
 * constructor options and the webContents handlers, and asserts the hardening behaviour.
 * No source edit needed: the app.whenReady().then(...) callback is invoked by hand.
 */
const h = vi.hoisted(() => ({
  ready: [] as Array<() => void>,
  opts: null as null | { webPreferences: Record<string, unknown> },
  openHandler: null as null | ((d: { url: string }) => { action: string }),
  navHandler: null as null | ((e: { preventDefault: () => void }, url: string) => void),
  loaded: [] as string[],
  env: { dev: false }
}))

vi.mock('electron', () => {
  class BrowserWindow {
    static getAllWindows = (): unknown[] => []
    webContents = {
      setWindowOpenHandler: (fn: never) => (h.openHandler = fn),
      on: (ev: string, fn: never) => {
        if (ev === 'will-navigate') h.navHandler = fn
      },
      send: (): void => {}
    }
    constructor(o: never) {
      h.opts = o
    }
    on(): void {
      /* not needed */
    }
    show(): void {
      /* not needed */
    }
    isDestroyed = (): boolean => false
    loadURL(u: string): void {
      h.loaded.push(u)
    }
    loadFile(f: string): void {
      h.loaded.push(f)
    }
  }
  return {
    app: {
      whenReady: () => ({ then: (fn: () => void) => h.ready.push(fn) }),
      on: (): void => {},
      quit: (): void => {},
      getPath: (): string => ':memory:',
      isPackaged: false
    },
    BrowserWindow,
    Menu: { setApplicationMenu: (): void => {} },
    ipcMain: { handle: (): void => {} },
    shell: { openExternal: async (): Promise<void> => {} }
  }
})
vi.mock('@electron-toolkit/utils', () => ({
  electronApp: { setAppUserModelId: (): void => {} },
  optimizer: { watchWindowShortcuts: (): void => {} },
  get is() {
    return h.env
  }
}))
vi.mock('../../../resources/icon.png?asset', () => ({ default: 'icon.png' }))
vi.mock('../db', () => ({ openDb: () => ({ db: {}, close: (): void => {} }) }))
vi.mock('../scheduler', () => ({ startScheduler: () => (): void => {} }))
vi.mock('../shortcuts', () => ({ registerRefreshShortcut: (): void => {} }))
vi.mock('../ingest/refresh', () => ({ refreshJobs: async (): Promise<void> => {} }))

async function boot(devUrl?: string): Promise<void> {
  vi.resetModules()
  h.ready.length = 0
  h.opts = h.openHandler = h.navHandler = null
  h.loaded.length = 0
  h.env.dev = !!devUrl
  const env = process.env as Record<string, string | undefined>
  if (devUrl) env['ELECTRON_RENDERER_URL'] = devUrl
  else delete env['ELECTRON_RENDERER_URL']
  await import('../index')
  h.ready.forEach((f) => f())
}

const nav = (url: string): boolean => {
  const prevented = vi.fn()
  h.navHandler!({ preventDefault: prevented }, url)
  return prevented.mock.calls.length === 0 // true = allowed
}

describe('BrowserWindow webPreferences', () => {
  beforeAll(() => boot())
  it('contextIsolation on, nodeIntegration off', () => {
    expect(h.opts!.webPreferences.contextIsolation).toBe(true)
    expect(h.opts!.webPreferences.nodeIntegration).toBe(false)
  })
  it('does not enable webSecurity/remote-ish escape hatches', () => {
    const wp = h.opts!.webPreferences
    expect(wp.webSecurity).not.toBe(false)
    expect(wp.allowRunningInsecureContent).not.toBe(true)
    expect(wp.nodeIntegrationInWorker).not.toBe(true)
    expect(wp.nodeIntegrationInSubFrames).not.toBe(true)
  })
  // A sandboxed preload using only contextBridge/ipcRenderer is the hardened default.
  it('sandbox is enabled', () => {
    expect(h.opts!.webPreferences.sandbox).toBe(true)
  })
})

describe('setWindowOpenHandler', () => {
  beforeAll(() => boot())
  it('denies every window.open / target=_blank request', () => {
    for (const url of ['https://evil.test', 'javascript:alert(1)', 'file:///c:/x', 'about:blank', '']) {
      expect(h.openHandler!({ url })).toEqual({ action: 'deny' })
    }
  })
})

describe('will-navigate (packaged / file origin)', () => {
  beforeAll(() => boot())
  it('allows only the exact loaded index.html (hash/query ok)', () => {
    const url = pathToFileURL(h.loaded[0]).href
    expect(nav(url)).toBe(true)
    expect(nav(url + '#/visited')).toBe(true)
    expect(nav(url.replace('index.html', 'index.html.evil.html'))).toBe(false)
    expect(nav(url.replace('renderer', 'renderer2'))).toBe(false)
    expect(nav('file://evil-host/share/index.html')).toBe(false)
  })
  it('blocks http(s), javascript:, data:, garbage', () => {
    for (const u of ['https://evil.test', 'http://localhost:5173', 'javascript:alert(1)', 'data:text/html,<script>1</script>', 'not a url', '', 'blob:https://x/1']) {
      expect(nav(u), u).toBe(false)
    }
  })
  // Regression: packaged mode must not accept arbitrary file: URLs, only the app's own index.html.
  it('blocks file: URLs outside the app renderer directory', () => {
    expect(nav('file:///C:/Users/victim/Downloads/evil.html')).toBe(false)
  })
  it('loads the built file, not a URL', () => {
    expect(h.loaded).toHaveLength(1)
    expect(h.loaded[0]).toMatch(/renderer[\\/]index\.html$/)
  })
})

describe('will-navigate (dev server origin)', () => {
  beforeAll(() => boot('http://localhost:5173/'))
  it('allows only the dev origin', () => {
    expect(nav('http://localhost:5173/#/x')).toBe(true)
    expect(nav('http://localhost:5173/other')).toBe(true)
  })
  it('blocks other ports, hosts, schemes, and file:', () => {
    for (const u of ['http://localhost:5174/', 'http://localhost.evil.test:5173/', 'https://localhost:5173/', 'http://127.0.0.1:5173/', 'file:///c:/x', 'http://localhost:5173@evil.test/']) {
      expect(nav(u), u).toBe(false)
    }
  })
})
