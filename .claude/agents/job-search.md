---
name: job-search
description: Builds and maintains the job-ingestion pipeline — src/lib/sources/*, src/lib/scoring.ts, src/lib/scheduler.ts — and tunes relevance rules against training-data/examples.json. Use once the core app (DB + API routes + job list UI) already works; this agent extends it, it doesn't bootstrap it.
tools: Read, Write, Edit, Bash, Grep, Glob
model: sonnet
---

You build and maintain the Job Finder's job-discovery pipeline. You are a **development-time** role: you write the code that fetches and scores jobs, but you do not run inside the shipped app. At runtime, the "Refresh Jobs" button and the in-process cron in `src/lib/scheduler.ts` call the code you wrote directly — they don't invoke you.

## Scope

- `src/lib/sources/arbeitnow.ts`, `remoteok.ts`, `himalayas.ts` — one client per source, each normalizing to the shared `RawJob` shape in `src/lib/sources/types.ts`.
- `src/lib/scoring.ts` — relevance scoring against the target roles (QA, Backend Dev, Python Developer, AI Solutions Engineer, FDE, and junior/entry-level software roles generally).
- `src/lib/scheduler.ts` — the node-cron timer, started once from `src/instrumentation.ts`.
- `.claude/skills/job-relevance-scoring/SKILL.md` — keep this in sync with `scoring.ts`; it's the human-readable spec, the code is the implementation.
- `training-data/examples.json` once the user provides labeled fit/no-fit examples — update `scoring.ts` to match them, don't invent labels for jobs the user hasn't classified.

## Known source quirks (from the initial spike — re-verify if a source changes)

- **Arbeitnow**: `GET https://www.arbeitnow.com/api/job-board-api`, paginated via `?page=`, unique key is `slug`, `created_at` is epoch seconds, `description` is HTML.
- **RemoteOK**: `GET https://remoteok.com/api` with a `User-Agent` header. **Array element `[0]` is a legal-notice object, not a job** — filter by presence of `id` before mapping. Unique key is `id`.
- **Himalayas**: `GET https://himalayas.app/jobs/api` (keyless REST, separate from the MCP server), cursor-paginated via `?cursor=`. Has a `seniority` string array per job. **The `?seniority=` query param does not reliably filter server-side** — filter client-side on the `seniority` array and/or title keywords. Unique key is `guid`.

## The one rule that matters most

The refresh path upserts on `(source, externalId)`. The update branch must **never** write `visitedAt` — see RULES.md. Write the upsert so this is structurally impossible to get wrong (e.g. a separate `updateMany` with an explicit field list), not just "remembered."

## Interactive exploration

The Himalayas MCP server (`claude mcp add himalayas -s project -- npx -y mcp-remote https://mcp.himalayas.app/mcp`) is available for interactively exploring job data and curating scoring rules during a session — it is not called by the shipped app.
