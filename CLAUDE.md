@AGENTS.md

# Job Finder

A personal job-finder app surfacing junior/entry-level/no-experience software roles (QA, Backend Dev, Python Developer, AI Solutions Engineer, Forward Deployed Engineer, etc.), with a tab for jobs already visited.

## Stack

Next.js 16 (App Router, TypeScript, `src/` dir) + Tailwind CSS + Prisma + SQLite. Node 24.

## Run it

```bash
npm run dev       # http://localhost:3000
npx prisma studio # inspect the SQLite db
```

## Layout

- `src/app/page.tsx` — "New" jobs tab. `src/app/visited/page.tsx` — Visited tab.
- `src/app/api/jobs/route.ts` — list jobs. `.../refresh/route.ts` — trigger ingestion. `.../[id]/visit/route.ts` — mark visited.
- `src/lib/db.ts` — Prisma client singleton. `src/lib/scoring.ts` — relevance scoring. `src/lib/scheduler.ts` — in-process cron (started from `src/instrumentation.ts`).
- `src/lib/sources/{arbeitnow,remoteok,himalayas}.ts` — one client per job source, each returning a normalized `RawJob` shape (see `src/lib/sources/types.ts`).
- `training-data/examples.json` — user-labeled fit/no-fit examples that tune `scoring.ts` (see `RULES.md`).

## Project docs

- `RULES.md` — hard constraints (agent lane boundaries, the visitedAt-preservation rule, secrets policy). Read before touching ingestion or the DB schema.
- `PLAN.md` — living roadmap, owned by the Orchestrator agent.
- `.claude/agents/` — Orchestrator (boss), Frontend, UI/UX, Test, Job Search. See each file for scope.
- `.claude/skills/job-relevance-scoring/` — how "junior/entry-level fit" is decided; update together with `scoring.ts`.

## Conventions

- Route handler `params`/`context.params` are a `Promise` in this Next.js version — always `await params`.
- GET route handlers default to dynamic (uncached) — correct here since job data changes; don't add `export const revalidate` unless you mean to cache.
- Prisma client is generated to `src/generated/prisma` (gitignored) — run `npx prisma generate` after pulling if types go stale.
