import { scoreJob } from '../scoring'
import type { ScoredJob } from '../jobs/upsert'
import type { RawJob } from '../sources/types'

/** A valid Israel-located RawJob with neutral defaults; override only what the test cares about. */
export const rawJob = (o: Partial<RawJob> = {}): RawJob => ({
  source: 'greenhouse:x',
  externalId: 'x',
  title: 'Software Engineer',
  company: 'Co',
  url: 'https://example.com',
  description: null,
  location: null,
  country: 'IL',
  city: null,
  workMode: 'unknown',
  postedAt: null,
  ...o
})

/** scoreJob() of a RawJob built from a title (and optional description / extra fields). */
export const scoreTitle = (title: string, description: string | null = null, extra: Partial<RawJob> = {}): number =>
  scoreJob(rawJob({ title, description, ...extra }))

/** A ScoredJob ready for upsertJobs(); defaults to score 50 and no roles. */
export const scoredJob = (o: Partial<ScoredJob> = {}): ScoredJob => ({ ...rawJob(), score: 50, roles: [], ...o })
