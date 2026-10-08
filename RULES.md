# Rules

Hard constraints for anyone (human or agent) working on this repo. AGENTS.md explains how things work; this file says what must never break.

## Agent lanes

- **Orchestrator** delegates and sequences work, and is the only one who updates `PLAN.md` status. It does not write feature code, tests or config.
- **Frontend** owns the UI in `src/renderer/src/**` (pages, components, Zustand store), the typed IPC surface (`src/shared/**` except `roles.ts`, `src/preload/**`, `src/main/ipc.ts`, `src/main/companiesIpc.ts`), the main-process window/IPC wiring (`src/main/index.ts`, `src/main/shortcuts.ts`, `src/main/jobs/{open,refreshService}.ts`), the DB layer (`src/main/db/**`, `src/main/jobs/queries.ts`), `electron-builder.yml`, and `package.json` dependencies (flag dependency changes to the other agents). It does not touch sources, scoring, roles, location, the scheduler, or ingestion logic.
- **UI/UX** owns visual design, layout, accessibility, empty/loading states: specs and reviews (e.g. `docs/dashboard-spec.md`); Frontend implements. UI/UX may make purely cosmetic class/spacing edits in renderer files (no logic, no props, no data flow).
- **Test** owns `*.test.ts`, `e2e/`, the Vitest/Playwright configs, and test helpers in `src/main/testing/`. It writes and runs tests and reports failures; it does not implement features or edit product code.
- **Job Search** owns `src/main/sources/**`, `src/main/scoring.ts`, `src/main/roles.ts` and `src/shared/roles.ts`, `src/main/location.ts`, `src/main/text.ts` (shared text helper), `src/main/companies/**`, `src/main/examples/**`, `scripts/examples-*.ts`, `src/main/scheduler.ts`, `src/main/ingest/**`, and `src/main/jobs/upsert.ts` (Job Search's file even though it lives in the Electron-free DB layer). It consumes `training-data/examples.json`. It is a development-time role and does not run inside the shipped app; the "Refresh" button and the node-cron scheduler are the runtime code it built.
- **Lane exceptions:** an agent may edit outside its lane only for files the user named for that task. The Orchestrator lists those files in the delegation and records in PLAN.md Notes which out-of-lane files were actually touched. Anything touched beyond the named set is reported to the user, not silently accepted. A sanction does not carry over to the next task.
- Lane rules are enforced by review, not by tool permissions.
- **Delegation rule:** if a subagent can't be spawned, stop and report exactly what failed. Do not do the work directly and do not return a workaround plan; the user decides what happens next.
- **Doc edits:** `RULES.md`, `AGENTS.md` and `.claude/agents/*.md` change only with explicit user approval, applied by the Orchestrator.
- **Process rules:** agents kill only their own Electron process (never by image name). Agents do not install the app, create accounts, or obtain API keys; they ask the user. After any `shadcn add`, run the `cn` check in AGENTS.md Gotchas.
- **Verified vs claimed:** record work as done only when it was verified. Mark results an agent reported but nobody re-ran as agent-reported. Approved Israeli job boards are recorded in PLAN.md.

## Visited state must survive refresh

The ingestion/refresh path upserts `Job` rows on `(source, externalId)`. The **update branch must only write listing fields** (title, company, url, description, location, postedAt, score, and the other listing columns) and must **never write `visitedAt`** (or `firstSeenAt`) on an existing row. `visitedAt` is only ever set by `markVisited` (reached via `jobs:visit` and `jobs:open`), and it is write-once: a repeated `markVisited` keeps the original `visitedAt`. Breaking this silently un-visits jobs and they reappear in the New tab; it is the single most important invariant in the app. There is a unit test for it (`upsert preserves visitedAt`); don't remove or weaken it.

Any schema migration must be idempotent, must never drop VISITED jobs, and must never touch `visitedAt` or `firstSeenAt`. Deleting unvisited rows is allowed only when it is explicit in PLAN.md and approved by the user.

## Architecture constraints

- The DB layer (`src/main/db/**`, `src/main/jobs/**`) must stay Electron-free and injectable (e.g. `openDb(path)`), so it can be tested under plain Node/Vitest.
- `sandbox: true` and `contextIsolation` must stay on for the BrowserWindow. Don't weaken either (or expose Node/Electron APIs to the renderer beyond the typed preload API) without user approval.
- Renderer hardening: no `dangerouslySetInnerHTML` on job text; `stripHtml` on all untrusted text. `jobs:open` takes a job id only, opens only `http:`/`https:` URLs, and marks visited only on success. Window navigation and `window.open` are denied except the app's own `index.html`.

## Sources and secrets

- The app targets jobs located in Israel, on-site or hybrid. Remote-only jobs are excluded.
- Sources are company career pages via ATS public endpoints (e.g. Comeet, Greenhouse, Lever, Ashby, Workday, SmartRecruiters) and any approved Israeli job boards.
- Sources must not require paid keys.
- Exception (user-approved 2026-10-08): the JSearch (OpenWebNinja) aggregator API, and SerpApi (Google Jobs engine) as its secondary fallback used only when JSearch is near its monthly limit or blocked, are approved, opt-in sources. Each is off unless the user supplies a free-tier key, and their results may link to LinkedIn pages. The app only stores those links and opens them in the user's browser; it must NEVER fetch or scrape LinkedIn, Indeed or Glassdoor itself.
- Any API key a user supplies goes in the userData config only: never committed, never in the repo (including `training-data/examples.json`), and never logged.
- Scraping that violates a site's terms of service or evades anti-bot measures is not allowed. No LinkedIn, Indeed, or Glassdoor scraping.

## Training data

`training-data/examples.json` is user-provided and may be edited by the Job Search agent to add derived notes, but the `label`/`reason` fields reflect the user's judgment: don't invent labels for jobs the user hasn't actually classified. Default keyword heuristics in `scoring.ts` must keep working even when this file is empty or absent.
