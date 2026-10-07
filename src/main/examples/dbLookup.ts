import Database from 'better-sqlite3'
import { normalizeLocation } from '../location'
import type { WorkMode } from '../sources/types'
import type { ResolvedFields } from './resolve'

export interface DbJobRow {
  id: number
  source: string
  external_id: string
  title: string | null
  company: string | null
  url: string
  description: string | null
  location: string | null
  country: string | null
  city: string | null
  work_mode: string | null
  posted_at: number | null
}

/**
 * Finds jobs by numeric `jobs.id` or by `external_id` in a job-finder SQLite file. Opened READ-ONLY and
 * with fileMustExist, and deliberately NOT through openDb (which may migrate the user's live database).
 */
export function lookupJobsInDb(dbPath: string, idOrExternalId: string): DbJobRow[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const rows: DbJobRow[] = []
    if (/^\d+$/.test(idOrExternalId)) {
      const r = db.prepare('SELECT * FROM jobs WHERE id = ?').get(Number(idOrExternalId)) as DbJobRow | undefined
      if (r) rows.push(r)
    }
    for (const r of db.prepare('SELECT * FROM jobs WHERE external_id = ?').all(idOrExternalId) as DbJobRow[]) {
      if (!rows.some((x) => x.id === r.id)) rows.push(r)
    }
    return rows
  } finally {
    db.close()
  }
}

/** DB row -> fields. `seniority` is never persisted by the app, so it is absent here (report scores may differ slightly). */
export function dbRowToFields(r: DbJobRow): ResolvedFields {
  const loc =
    r.country === null && r.work_mode === null ? normalizeLocation({ location: r.location }) : null
  return {
    id: `${r.source}:${r.external_id}`,
    url: r.url,
    source: r.source,
    externalId: r.external_id,
    title: r.title ?? '',
    company: r.company ?? '',
    location: r.location ?? '',
    country: r.country ?? loc?.country ?? null,
    city: r.city ?? loc?.city ?? null,
    workMode: ((r.work_mode as WorkMode | null) ?? loc?.workMode ?? 'unknown') as WorkMode,
    postedAt: r.posted_at,
    description: r.description ?? '',
    via: 'ats-api'
  }
}
