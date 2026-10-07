import type { CompanyEntry } from '../companies/types'
import { fetchAmazon } from './amazon'
import { fetchAshby } from './ashby'
import { fetchComeet } from './comeet'
import { fetchGreenhouse } from './greenhouse'
import { defaultHttp } from './http'
import { fetchLever } from './lever'
import { fetchSmartRecruiters } from './smartrecruiters'
import { fetchSqlink } from './sqlink'
import type { ConnectorFn, Http, RawJob } from './types'
import { fetchWorkday } from './workday'

export const CONNECTORS: Record<CompanyEntry['ats'], ConnectorFn> = {
  greenhouse: fetchGreenhouse,
  comeet: fetchComeet,
  lever: fetchLever,
  smartrecruiters: fetchSmartRecruiters,
  ashby: fetchAshby,
  workday: fetchWorkday,
  amazon: fetchAmazon,
  sqlink: fetchSqlink
}

/** Fetches one configured company. Throws on failure (the caller isolates per company). */
export function fetchCompany(entry: CompanyEntry, http: Http = defaultHttp, delayMs = 250): Promise<RawJob[]> {
  return CONNECTORS[entry.ats](entry.params, { id: entry.id, name: entry.name, http, delayMs })
}
