import { app, BrowserWindow, Menu } from 'electron'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { openDb } from './db'
import { registerJobsIpc } from './ipc'
import { registerCompaniesIpc } from './companiesIpc'
import { setCompaniesConfigDir } from './companies/store'
import { refreshJobs } from './ingest/refresh'
import { createRefreshService } from './jobs/refreshService'
import { IPC } from '../shared/ipc'
import { startScheduler } from './scheduler'
import { registerRefreshShortcut } from './shortcuts'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  registerRefreshShortcut(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // The renderer never navigates or opens windows; external links go through `jobs:open`
  // (http/https only, then markVisited), never through here.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const appOrigin =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? new URL(process.env['ELECTRON_RENDERER_URL']).origin
      : null
  // Packaged: only the exact renderer index.html (hash/query allowed) may be navigated to.
  const rendererIndex = resolve(join(__dirname, '../renderer/index.html'))
  const norm = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let allowed = false
    try {
      const u = new URL(url)
      allowed = appOrigin
        ? u.origin === appOrigin
        : u.protocol === 'file:' &&
          (u.host === '' || u.host === 'localhost') &&
          norm(resolve(fileURLToPath(u))) === norm(rendererIndex)
    } catch {
      /* unparseable -> block */
    }
    if (!allowed) event.preventDefault()
  })

  // Dev: load the Vite dev server URL; packaged: the built index.html.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(rendererIndex)
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.jobfinder.app')

  // F12 toggles DevTools in dev; Ctrl+R is ignored in production (electron-toolkit optimizer).
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Company list (companies.json) lives in userData; set before any refresh/scheduler tick.
  // Only the directory is recorded here; the file is read/seeded lazily on first use.
  const userData = app.getPath('userData')
  setCompaniesConfigDir(userData)

  const dbPath = join(userData, 'jobfinder.db')
  const { db, close } = openDb(dbPath)
  console.log('[db] opened', dbPath)
  app.on('will-quit', close)
  // Single refresh entry point shared by the IPC handler and the scheduler.
  const refresh = createRefreshService({
    db,
    run: refreshJobs,
    notify: () => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send(IPC.changed)
      }
    }
  })
  registerJobsIpc({ db, refresh })
  registerCompaniesIpc({ db, dir: userData })
  const stopScheduler = startScheduler(refresh)
  app.on('will-quit', stopScheduler)

  // Packaged builds have no default menu (File/Edit/View/...), which also removes
  // the menu accelerators (reload, devtools). Dev keeps it for convenience.
  if (app.isPackaged) Menu.setApplicationMenu(null)

  createWindow()

  app.on('activate', function () {
    // macOS: re-create a window when the dock icon is clicked with none open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS (stays active until Cmd + Q).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
