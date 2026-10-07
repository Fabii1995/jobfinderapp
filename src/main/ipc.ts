import { ipcMain, shell } from 'electron'
import type { Db } from './db'
import { getStats, listJobs, markVisited } from './jobs/queries'
import { openJob } from './jobs/open'
import { IPC, type ListJobsRequest, type RefreshResponse } from '../shared/ipc'

interface JobsIpcDeps {
  db: Db
  refresh: () => Promise<RefreshResponse>
}

export function registerJobsIpc({ db, refresh }: JobsIpcDeps): void {
  ipcMain.handle(IPC.list, (_e, req: ListJobsRequest) => {
    return listJobs(db, { visited: !!req?.visited })
  })
  ipcMain.handle(IPC.visit, (_e, id: number) => {
    if (!Number.isInteger(id)) throw new Error('jobs:visit requires an integer id')
    return markVisited(db, id)
  })
  ipcMain.handle(IPC.open, (_e, id: unknown) => openJob(db, id, (url) => shell.openExternal(url)))
  ipcMain.handle(IPC.stats, () => getStats(db))
  ipcMain.handle(IPC.refresh, () => refresh())
}
