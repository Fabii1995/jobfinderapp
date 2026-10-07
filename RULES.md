# Rules

Hard constraints for anyone (human or agent) working on this repo. AGENTS.md explains how things work; this file says what must never break.

## Agent lanes

- **Orchestrator** delegates and sequences work, and is the only one who updates `PLAN.md` status. It does not write feature code.
- **Frontend** owns the UI in `src/renderer/src/**` (pages, components, Zustand store), the typed IPC surface (`src/shared/ipc.ts`, `src/preload/**`, `src/main/ipc.ts`), and the main-process window/IPC wiring (`src/main/index.ts`, the DB layer in `src/main/db/**` and `src/main/jobs/queries.ts`). It does not touch `src/main/sources/*`, scoring, roles, the scheduler, or ingestion logic.
- **UI/UX** owns visual design, layout, accessibility, empty/loading states — specs and reviews (e.g. `docs/dashboard-spec.md`), Frontend implements.
- **Test** writes and runs tests and test tooling only (Vitest in `src/main/**/*.test.ts`, Playwright-Electron in `e2e/`, and their configs) and reports failures. It does not implement features.
- **Job Search** owns `src/main/sources/*`, `src/main/scoring.ts`, `src/main/roles.ts` (and `src/shared/roles.ts`), `src/main/scheduler.ts`, `src/main/ingest/*`, and the upsert in `src/main/jobs/upsert.ts`, and consumes `training-data/examples.json`. It is a development-time role — it does not run inside the shipped app. The app's own "Refresh Jobs" button and the in-process cron scheduler (node-cron in the main process) are the runtime code it built; the agent itself is not invoked at runtime.
- **Lane exceptions** (an agent editing outside its lane above) are narrow and need explicit user sanction per task. A sanction for one task does not carry over to the next.
- **Delegation rule:** if a subagent can't be spawned, stop and report exactly what failed. Do not do the work directly and do not return a workaround plan — the user decides what happens next.

## Visited state must survive refresh

The ingestion/refresh path upserts `Job` rows on `(source, externalId)`. The **update branch must only write listing fields** (title, company, url, description, location, postedAt, score) and must **never write `visitedAt`** (or `firstSeenAt`) on an existing row. `visitedAt` is only ever set by `markVisited` (the visit IPC path, `jobs:visit`), and it is write-once. Breaking this silently un-visits jobs and they reappear in the New tab — this is the single most important invariant in the app. There's a unit test for it (`upsert preserves visitedAt`); don't remove or weaken it.

Any schema migration must be idempotent, must never drop jobs, and must never touch `visitedAt`.

## Architecture constraints

- The DB layer (`src/main/db/**`, `src/main/jobs/**`) must stay Electron-free and injectable (e.g. `openDb(path)`), so it can be tested under plain Node/Vitest.
- `sandbox: true` and `contextIsolation` must stay on for the BrowserWindow. Don't weaken either (or expose Node/Electron APIs to the renderer beyond the typed preload API) without user approval.

## Sources and secrets

- The app targets jobs located in Israel, on-site or hybrid. Remote-only jobs are excluded.
- Sources are company career pages via ATS public endpoints (e.g. Comeet, Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday) and any approved Israeli job boards.
- Sources must not require paid keys.
- Any API key a user supplies goes in the userData config only — never committed, never in the repo (including `training-data/examples.json`), and never logged.
- Scraping that violates a site's terms of service or evades anti-bot measures is not allowed. No LinkedIn, Indeed, or Glassdoor scraping.

## Training data

`training-data/examples.json` is user-provided and may be edited by the Job Search agent to add derived notes, but the `label`/`reason` fields reflect the user's judgment — don't invent labels for jobs the user hasn't actually classified. Default keyword heuristics in `scoring.ts` must keep working even when this file is empty or absent.
