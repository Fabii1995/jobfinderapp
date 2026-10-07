import { ipcMain, shell } from 'electron'
import type { Db } from './db'
import { getStats, listJobs, markVisited } from './jobs/queries'
import { openJob } from './jobs/open'
import { IPC, MAX_COMPANY_NAME_LENGTH, WORK_MODES, type ListJobsRequest, type RefreshResponse } from '../shared/ipc'

export interface JobsIpcDeps {
  db: Db
  refresh: () => Promise<RefreshResponse>
}

export function registerJobsIpc({ db, refresh }: JobsIpcDeps): void {
  ipcMain.handle(IPC.list, (_e, req: ListJobsRequest) => {
    // Optional filters: invalid values are ignored (never thrown), `visited` coercion unchanged.
    const workMode =
      typeof req?.workMode === 'string' && (WORK_MODES as readonly string[]).includes(req.workMode)
        ? req.workMode
        : undefined
    const company =
      typeof req?.company === 'string' && req.company.length > 0 && req.company.length <= MAX_COMPANY_NAME_LENGTH
        ? req.company
        : undefined
    return listJobs(db, { visited: !!req?.visited, workMode, company })
  })
  ipcMain.handle(IPC.visit, (_e, id: number) => {
    if (!Number.isInteger(id)) throw new Error('jobs:visit requires an integer id')
    return markVisited(db, id)
  })
  ipcMain.handle(IPC.open, (_e, id: unknown) => openJob(db, id, (url) => shell.openExternal(url)))
  ipcMain.handle(IPC.stats, () => getStats(db))
  ipcMain.handle(IPC.refresh, () => refresh())
}
