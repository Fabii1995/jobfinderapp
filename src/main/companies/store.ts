import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { LEGACY_SEED_IDS, seedCompanies } from './seeds'
import type { CompanyEntry } from './types'
import { makeCompanyEntry, parseCompanyEntry } from './validate'

/**
 * Electron-free companies config store: `<dir>/companies.json` (dir = Electron userData, passed in).
 *  - Seeded with the seed list when the file does not exist. The file records `seedsApplied` (seed ids
 *    already offered to this install). On load, seeds not in `seedsApplied` are ADDED (with the seed's own enabled flag; SQLink is disabled) and recorded;
 *    seeds the user removed stay removed, and existing entries are never modified. Files without
 *    `seedsApplied` (older installs) get LEGACY_SEED_IDS. The extra field is ignored by older readers.
 *  - Writes are tmp-file + rename.
 *  - A corrupt/unreadable file is never overwritten: loadCompanies returns the in-memory seeds plus an
 *    `error` string, and mutating calls refuse (throw) until the user fixes or deletes the file.
 */

export const COMPANIES_FILE = 'companies.json'

let configuredDir: string | null = null
/** Main process calls this once with userData; refreshJobs then reads the user's company list from it. */
export function setCompaniesConfigDir(dir: string | null): void {
  configuredDir = dir
}
export function getCompaniesConfigDir(): string | null {
  return configuredDir
}
const FILE_VERSION = 1

export interface LoadedCompanies {
  companies: CompanyEntry[]
  /** Set when the file exists but could not be read/parsed; `companies` is then the seed list. */
  error?: string
  /** Seed ids already offered to this install (absent on error). */
  seedsApplied?: string[]
  /** True when this call created the file from the seeds. */
  seeded?: boolean
}

function filePath(dir: string): string {
  return join(dir, COMPANIES_FILE)
}

function writeAtomic(dir: string, companies: CompanyEntry[], seedsApplied: string[]): void {
  mkdirSync(dir, { recursive: true })
  const file = filePath(dir)
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ version: FILE_VERSION, companies, seedsApplied }, null, 2), 'utf8')
  renameSync(tmp, file)
}

export function loadCompanies(dir: string): LoadedCompanies {
  const file = filePath(dir)
  if (!existsSync(file)) {
    const companies = seedCompanies()
    try {
      writeAtomic(dir, companies, companies.map((c) => c.id))
      return { companies, seeded: true }
    } catch (e) {
      return { companies, error: `could not write ${COMPANIES_FILE}: ${(e as Error).message}` }
    }
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed as { companies?: unknown } | null)?.companies
    if (!Array.isArray(list)) throw new Error('expected {"companies": [...]}')
    const seen = new Set<string>()
    const companies: CompanyEntry[] = []
    for (const raw of list) {
      const e = parseCompanyEntry(raw) // invalid entries are skipped, never fatal
      if (e && !seen.has(e.id)) {
        seen.add(e.id)
        companies.push(e)
      }
    }
    const rawApplied = Array.isArray(parsed)
      ? undefined
      : (parsed as { seedsApplied?: unknown } | null)?.seedsApplied
    const hadApplied = Array.isArray(rawApplied)
    const applied = new Set<string>(
      hadApplied ? (rawApplied as unknown[]).filter((x): x is string => typeof x === 'string') : LEGACY_SEED_IDS
    )
    let added = false
    for (const seed of seedCompanies()) {
      if (applied.has(seed.id)) continue // already offered: keep whatever the user did with it
      applied.add(seed.id)
      added = true
      if (!seen.has(seed.id)) {
        seen.add(seed.id)
        companies.push(seed)
      }
    }
    if (added || !hadApplied) {
      try {
        writeAtomic(dir, companies, [...applied])
      } catch {
        // non-fatal: the merge is retried on the next load
      }
    }
    return { companies, seedsApplied: [...applied] }
  } catch (e) {
    return { companies: seedCompanies(), error: `${COMPANIES_FILE} is unreadable: ${(e as Error).message}` }
  }
}

function loadForWrite(dir: string): { list: CompanyEntry[]; applied: string[] } {
  const { companies, error, seedsApplied } = loadCompanies(dir)
  if (error) throw new Error(error)
  return { list: companies, applied: seedsApplied ?? companies.map((c) => c.id) }
}

/** Adds a validated company; throws on invalid input or a duplicate id. Returns the stored entry. */
export function addCompany(
  dir: string,
  input: { name: string; ats: string; params: Record<string, unknown>; enabled?: boolean }
): CompanyEntry {
  const entry = makeCompanyEntry(input)
  const { list, applied } = loadForWrite(dir)
  if (list.some((c) => c.id === entry.id)) throw new Error(`company already configured (${entry.id})`)
  writeAtomic(dir, [...list, entry], applied)
  return entry
}

/** Removes by id. Returns whether something was removed. */
export function removeCompany(dir: string, id: string): boolean {
  const { list, applied } = loadForWrite(dir)
  const next = list.filter((c) => c.id !== id)
  if (next.length === list.length) return false
  writeAtomic(dir, next, applied)
  return true
}

/** Enables/disables by id. Returns the updated entry or null if unknown. */
export function setCompanyEnabled(dir: string, id: string, enabled: boolean): CompanyEntry | null {
  const { list, applied } = loadForWrite(dir)
  const target = list.find((c) => c.id === id)
  if (!target) return null
  const updated = { ...target, enabled: !!enabled }
  writeAtomic(dir, list.map((c) => (c.id === id ? updated : c)), applied)
  return updated
}
