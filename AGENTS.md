# Agent guide: Job Finder

Standalone Electron desktop app that surfaces junior/entry-level software jobs in Israel (on-site or hybrid), with New, Visited and Companies tabs.

## Stack

Electron (electron-vite, react-ts) + React + TypeScript + Tailwind v4 + shadcn/ui. TanStack Query/Table for data, Zustand for UI state, better-sqlite3 + Drizzle ORM for the DB (file in Electron `userData`), node-cron scheduler in main, Vitest + Playwright-Electron for tests, electron-builder for the Windows installer.

## Layout

- `src/main/` - Electron main process: DB, IPC handlers, sources, scoring, scheduler.
- `src/main/sources/` - one connector per ATS (Greenhouse, Lever, Comeet, Ashby, SmartRecruiters, Workday, Amazon, SQLink). `sources/jsearch/` is the opt-in "Deep search" service (JSearch, with SerpApi as fallback); its IPC is `src/main/jsearchIpc.ts`, shared types `src/shared/jsearch.ts`.
- `src/main/ingest/` - refresh pipeline; `ingest/constants.ts` holds `MIN_SCORE`.
- `src/main/examples/` - intake/report logic behind `examples:add` and `examples:report`.
- userData (`%APPDATA%\job-finder`): `jobfinder.db`, `companies.json`, and for Deep search `config.json` (optional `jsearchApiKey` / `serpapiApiKey`, never in the repo) plus the quota counters `jsearch-state.json` / `serpapi-state.json`.
- `src/shared/` - types and constants shared by main, preload and renderer (IPC contract, roles).
- `src/preload/` - contextBridge API exposed to the renderer (typed IPC).
- `src/renderer/src/` - React UI. Alias `@renderer/*`. shadcn components in `components/ui/`, Zustand store in `store/`.
- `e2e/` - Playwright-Electron tests.
- `docs/` - `dashboard-spec.md`, the UI spec.
- `training-data/` - user-labeled examples (`examples.json`) and their schema README.
- `scripts/` - only `examples-add.ts` and `examples-report.ts`, thin tsx wrappers behind the `examples:*` commands.

## Commands

- `npm run dev` - launch the app with HMR.
- `npm run typecheck` - tsc for node (main/preload) and web (renderer).
- `npm run build` - typecheck + electron-vite build to `out/`.
- `npm test` - Vitest.
- `npm run test:e2e` - Playwright-Electron (runs `npm run build` first).
- `npm run rebuild` - rebuild better-sqlite3 against Electron (also runs on `npm install` via postinstall). better-sqlite3 ships an N-API prebuilt binary that loads in both plain Node and Electron, so Vitest needs no separate Node build.
- `npm run dist` - Windows installer into `release/`.
- `npm run examples:add -- <url-or-id>... [--label fit|no-fit] [--reason "..."] [--text-file path] [--title ..] [--company ..] [--location ..] [--db <jobs.sqlite>] [--file <examples.json>]` - add entries to `training-data/examples.json`.
- `npm run examples:report` - score every example with the current scoring and report.
- The `examples:*` commands are dev tools: they never fetch LinkedIn/Indeed/Glassdoor (paste text via `--text-file`), and labels/reasons come only from the user.

## Gotchas

- **shadcn `cn`:** `shadcn add` can write `import { cn } from "cn"` (the npm package `cn`, wrong). After any `shadcn add`, run `grep -rn 'from "cn"' src`, fix hits to `@renderer/lib/utils`, and `npm uninstall cn`.
- **Killing Electron:** stop only the Electron process you launched (by PID). Never `taskkill /IM electron.exe`; it kills the user's other Electron apps.

## Rules

Read `RULES.md` (hard constraints, lane boundaries, visitedAt preservation) and `PLAN.md` (roadmap) before changing anything.
