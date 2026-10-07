# Agent guide: Job Finder

Standalone Electron desktop app that surfaces junior/entry-level software jobs, with New and Visited tabs.

## Stack

Electron (electron-vite, react-ts) + React + TypeScript + Tailwind v4 + shadcn/ui. TanStack Query/Table for data, Zustand for UI state, better-sqlite3 + Drizzle ORM for the DB (file in Electron `userData`), node-cron scheduler in main, Vitest for tests, electron-builder for the Windows installer.

## Layout

- `src/main/` - Electron main process: DB, IPC handlers, sources, scoring, scheduler.
- `src/main/examples/` - intake/report logic behind `examples:add` and `examples:report`.
- `scripts/` - thin tsx wrappers (`examples-add.ts`, `examples-report.ts`) plus other dev-only scripts.
- `src/preload/` - contextBridge API exposed to the renderer (typed IPC).
- `src/renderer/src/` - React UI. Alias `@renderer/*`. shadcn components in `components/ui/`, Zustand store in `store/`.

## Commands

- `npm run dev` - launch the app with HMR.
- `npm run typecheck` - tsc for node (main/preload) and web (renderer).
- `npm run build` - typecheck + electron-vite build to `out/`.
- `npm test` - Vitest.
- `npm run rebuild` - rebuild better-sqlite3 against Electron (also runs on `npm install` via postinstall). Vitest runs under plain Node, and better-sqlite3's prebuilt N-API binary loads in both Node and Electron, so no separate Node build is needed.
- `npm run dist` - Windows installer into `release/`.
- `npm run examples:add -- <url-or-id>... [--label fit|no-fit] [--reason "..."] [--text-file path] [--title ..] [--company ..] [--location ..] [--db <jobs.sqlite>] [--file <examples.json>]` - add entries to `training-data/examples.json`.
- `npm run examples:report` - score every example with the current scoring and report.
- The `examples:*` commands are dev tools: they never fetch LinkedIn/Indeed/Glassdoor (paste text via `--text-file`), and labels/reasons come only from the user.

## Rules

Read `RULES.md` (hard constraints, lane boundaries, visitedAt preservation) and `PLAN.md` (roadmap) before changing anything. Note: parts of `CLAUDE.md`/`README.md` still describe the old Next.js/Prisma stack and are stale.
