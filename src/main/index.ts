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
  // Create the browser window.
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

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(rendererIndex)
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.jobfinder.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
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
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
