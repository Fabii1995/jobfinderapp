import { ipcMain } from 'electron'
import type { Db } from './db'
import { detectAtsFromUrl, resolveComeetParams } from './companies/detect'
import {
  addCompany,
  loadCompanies,
  removeCompany,
  setCompanyEnabled
} from './companies/store'
import type { CompanyEntry } from './companies/types'
import { makeCompanyEntry } from './companies/validate'
import { getCompanyCounts } from './jobs/queries'
import { fetchCompany } from './sources'
import {
  IPC,
  MAX_COMPANY_NAME_LENGTH,
  MAX_URL_LENGTH,
  type AddCompanyResponse,
  type CompaniesListResponse,
  type CompanyMutationResponse
} from '../shared/ipc'

export interface CompaniesIpcDeps {
  db: Db
  /** Directory holding companies.json (Electron userData). Only touched inside handlers (lazy). */
  dir: string
  /** Reachability probe run before a new company is saved; throws when the board can't be read. */
  probe?: (entry: CompanyEntry) => Promise<unknown>
  /** Comeet page resolver (injectable for tests). */
  resolveComeet?: typeof resolveComeetParams
}

const MAX_ID_LENGTH = 200

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** "wizinc" -> "Wizinc", "acme-labs" -> "Acme Labs". */
export function prettifyIdentifier(raw: string): string {
  return raw
    .replace(/[-_.]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, MAX_COMPANY_NAME_LENGTH)
}

function defaultName(ats: string, params: Record<string, string>, pageUrl?: string): string {
  const key = { greenhouse: 'token', lever: 'slug', ashby: 'name', smartrecruiters: 'id', workday: 'tenant' }[
    ats as 'greenhouse'
  ]
  if (key && params[key]) return prettifyIdentifier(params[key])
  if (ats === 'comeet' && pageUrl) {
    try {
      const segs = new URL(pageUrl).pathname.split('/').filter(Boolean)
      if (segs[0] === 'jobs' && segs[1]) return prettifyIdentifier(decodeURIComponent(segs[1]))
    } catch {
      /* fall through */
    }
  }
  return 'New company'
}

export const UNSUPPORTED_MESSAGE =
  'This page is not a supported careers board. Supported: Greenhouse, Lever, Ashby, SmartRecruiters, Workday and Comeet (comeet.com/jobs/<company>/<id>) links. Custom careers sites cannot be read.'

export async function addCompanyFromUrl(
  deps: CompaniesIpcDeps,
  req: unknown
): Promise<AddCompanyResponse> {
  const o = req && typeof req === 'object' ? (req as Record<string, unknown>) : null
  const url = o?.url
  if (typeof url !== 'string' || !url.trim()) return fail('Paste a careers page URL.')
  if (url.length > MAX_URL_LENGTH) return fail(`That URL is too long (max ${MAX_URL_LENGTH} characters).`)
  let customName: string | undefined
  if (o?.name !== undefined && o.name !== null) {
    if (typeof o.name !== 'string') return fail('Company name must be text.')
    customName = o.name.trim() || undefined
    if (customName && customName.length > MAX_COMPANY_NAME_LENGTH) {
      return fail(`Company name is too long (max ${MAX_COMPANY_NAME_LENGTH} characters).`)
    }
  }

  const detected = detectAtsFromUrl(url)
  if (!detected) return fail(UNSUPPORTED_MESSAGE)

  let params: Record<string, string> = detected.params
  if (detected.needsFetch) {
    try {
      params = await (deps.resolveComeet ?? resolveComeetParams)(detected.pageUrl ?? url)
    } catch (e) {
      return fail(`Could not read the Comeet configuration from that page: ${errMsg(e)}`)
    }
  }

  let entry: CompanyEntry
  try {
    entry = makeCompanyEntry({
      name: customName ?? defaultName(detected.ats, params, detected.pageUrl),
      ats: detected.ats,
      params
    })
  } catch (e) {
    return fail(errMsg(e))
  }

  const loaded = loadCompanies(deps.dir)
  if (loaded.error) return fail(loaded.error)
  const dup = loaded.companies.find((c) => c.id === entry.id)
  if (dup) return fail(`Already in your list as "${dup.name}" (${dup.ats}).`)

  try {
    await (deps.probe ?? ((e: CompanyEntry) => fetchCompany(e)))(entry)
  } catch (e) {
    return fail(`Could not reach that ${entry.ats} board: ${errMsg(e)}`)
  }

  try {
    return { ok: true, company: addCompany(deps.dir, entry) }
  } catch (e) {
    return fail(errMsg(e))
  }
}

const validId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH

export function registerCompaniesIpc(deps: CompaniesIpcDeps): void {
  const { db, dir } = deps
  ipcMain.handle(IPC.companyCounts, () => getCompanyCounts(db))
  ipcMain.handle(IPC.companiesList, (): CompaniesListResponse => {
    const { companies, error } = loadCompanies(dir)
    return error ? { companies, error } : { companies }
  })
  ipcMain.handle(IPC.companiesAdd, (_e, req: unknown) => addCompanyFromUrl(deps, req))
  ipcMain.handle(IPC.companiesRemove, (_e, id: unknown): CompanyMutationResponse => {
    if (!validId(id)) return fail('Invalid company id.')
    try {
      return removeCompany(dir, id) ? { ok: true } : fail('Company not found.')
    } catch (e) {
      return fail(errMsg(e))
    }
  })
  ipcMain.handle(IPC.companiesSetEnabled, (_e, id: unknown, enabled: unknown): CompanyMutationResponse => {
    if (!validId(id)) return fail('Invalid company id.')
    if (typeof enabled !== 'boolean') return fail('Invalid enabled flag.')
    try {
      return setCompanyEnabled(dir, id, enabled) ? { ok: true } : fail('Company not found.')
    } catch (e) {
      return fail(errMsg(e))
    }
  })
}
