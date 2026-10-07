import { and, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { jobs, meta, type Job } from '../db/schema'
import type { JobStats, LastRefresh } from '../../shared/ipc'

interface ListJobsOptions {
  visited: boolean
}

export function listJobs(db: Db, opts: ListJobsOptions): Job[] {
  const q = db
    .select()
    .from(jobs)
    .where(opts.visited ? isNotNull(jobs.visitedAt) : isNull(jobs.visitedAt))
  return opts.visited
    ? q.orderBy(desc(jobs.visitedAt)).all()
    : q.orderBy(desc(jobs.score), sql`${jobs.postedAt} DESC NULLS LAST`).all()
}

/** Job counts per company display name (all rows; null company grouped as ''). For the company filter UI. */
export function getCompanyCounts(db: Db): Record<string, number> {
  const rows = db
    .select({ company: jobs.company, n: count() })
    .from(jobs)
    .groupBy(jobs.company)
    .all()
  const out: Record<string, number> = {}
  for (const r of rows) out[r.company ?? ''] = r.n
  return out
}

/**
 * The ONLY writer of visitedAt. Idempotent: only sets it while currently NULL.
 * Returns the row, or null if no such id.
 */
export function markVisited(db: Db, id: number): Job | null {
  db.update(jobs)
    .set({ visitedAt: Date.now() })
    .where(and(eq(jobs.id, id), isNull(jobs.visitedAt)))
    .run()
  return db.select().from(jobs).where(eq(jobs.id, id)).get() ?? null
}

export function getJobById(db: Db, id: number): Job | null {
  return db.select().from(jobs).where(eq(jobs.id, id)).get() ?? null
}

const LAST_REFRESH_KEY = 'lastRefresh'

/** Persists the last refresh summary (meta table; never touches `jobs`). */
export function saveLastRefresh(db: Db, summary: LastRefresh): void {
  const value = JSON.stringify(summary)
  db.insert(meta)
    .values({ key: LAST_REFRESH_KEY, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } })
    .run()
}

export function getLastRefresh(db: Db): LastRefresh | null {
  const row = db.select().from(meta).where(eq(meta.key, LAST_REFRESH_KEY)).get()
  if (!row) return null
  try {
    const v = JSON.parse(row.value) as Partial<LastRefresh>
    if (typeof v?.at !== 'number' || !Array.isArray(v.sources)) return null
    return {
      at: v.at,
      inserted: Number(v.inserted ?? 0),
      updated: Number(v.updated ?? 0),
      sources: v.sources
    }
  } catch {
    return null
  }
}

export function getStats(db: Db): JobStats {
  const totals = db
    .select({
      newCount: sql<number>`coalesce(sum(case when ${jobs.visitedAt} is null then 1 else 0 end), 0)`,
      visitedCount: sql<number>`coalesce(sum(case when ${jobs.visitedAt} is not null then 1 else 0 end), 0)`
    })
    .from(jobs)
    .get()
  const lastRefresh = getLastRefresh(db)
  return {
    newCount: Number(totals?.newCount ?? 0),
    visitedCount: Number(totals?.visitedCount ?? 0),
    lastRefreshAt: lastRefresh?.at ?? null,
    lastRefresh
  }
}
