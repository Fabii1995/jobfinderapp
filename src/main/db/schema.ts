import { sqliteTable, integer, real, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { Role } from '../../shared/roles'

export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    title: text('title'),
    company: text('company'),
    url: text('url').notNull(),
    description: text('description'),
    location: text('location'),
    /** ISO-2 country ('IL'); null on rows stored before the Israel rework. Additive nullable column. */
    country: text('country'),
    city: text('city'),
    /** 'onsite' | 'hybrid' | 'remote' | 'unknown'; null on pre-rework rows. */
    workMode: text('work_mode'),
    postedAt: integer('posted_at'),
    score: real('score').default(0),
    /** Derived at ingestion by classifyRoles (title + description). JSON array of role slugs. */
    roles: text('roles', { mode: 'json' }).$type<Role[]>().notNull().default([]),
    firstSeenAt: integer('first_seen_at').notNull(),
    visitedAt: integer('visited_at')
  },
  (t) => [uniqueIndex('jobs_source_external_id_uq').on(t.source, t.externalId)]
)

export type Job = typeof jobs.$inferSelect

/** Small key/value store (e.g. the last refresh summary). Created idempotently in db/index.ts. */
export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})
