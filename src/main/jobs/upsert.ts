import { and, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { jobs } from '../db/schema'
import type { Role } from '../../shared/roles'
import type { RawJob } from '../sources/types'

/**
 * The ONLY columns the refresh path may overwrite on an existing row.
 * See RULES.md, "Visited state must survive refresh": visitedAt and firstSeenAt
 * must never appear here. The conflict `set` is built exclusively from this list.
 */
export const UPDATABLE_LISTING_FIELDS = [
  'title',
  'company',
  'url',
  'description',
  'location',
  'country',
  'city',
  'workMode',
  'postedAt',
  'score',
  'roles'
] as const

type UpdatableField = (typeof UPDATABLE_LISTING_FIELDS)[number]
export type ScoredJob = RawJob & { score: number; roles: Role[] }

function buildUpdateSet(row: ScoredJob): Pick<ScoredJob, UpdatableField> {
  const set: Record<string, unknown> = {}
  for (const f of UPDATABLE_LISTING_FIELDS) set[f] = row[f]
  return set as Pick<ScoredJob, UpdatableField>
}

/**
 * Builds the insert ... on conflict (source, external_id) do update statement.
 * Insert side leaves visitedAt unset (NULL) and stamps firstSeenAt = now.
 * Exported so tests can inspect the generated SQL via `.toSQL()`.
 */
export function buildUpsertStatement(db: Db, row: ScoredJob, now: number) {
  return db
    .insert(jobs)
    .values({
      source: row.source,
      externalId: row.externalId,
      title: row.title,
      company: row.company,
      url: row.url,
      description: row.description,
      location: row.location,
      country: row.country,
      city: row.city,
      workMode: row.workMode,
      postedAt: row.postedAt,
      score: row.score,
      roles: row.roles,
      firstSeenAt: now
    })
    .onConflictDoUpdate({
      target: [jobs.source, jobs.externalId],
      set: buildUpdateSet(row)
    })
}

/**
 * Upserts a batch in one transaction. inserted/updated are counted by checking
 * row existence (inside the same transaction) immediately before each upsert, so
 * a duplicate (source, externalId) within the batch counts as one insert then
 * one update.
 */
export function upsertJobs(db: Db, rows: ScoredJob[]): { inserted: number; updated: number } {
  const now = Date.now()
  return db.transaction((tx) => {
    let inserted = 0
    let updated = 0
    for (const row of rows) {
      const existing = tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.source, row.source), eq(jobs.externalId, row.externalId)))
        .get()
      buildUpsertStatement(tx as unknown as Db, row, now).run()
      if (existing) updated++
      else inserted++
    }
    return { inserted, updated }
  })
}
