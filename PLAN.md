# Roadmap

Owned by the Orchestrator agent. Update status here as work lands — this is the living backlog, not a design doc.

## Stack

Standalone Electron desktop dashboard (replaces the old Next.js/Prisma stack).

- Shell: Electron, scaffolded with electron-vite (react-ts template)
- UI: Vite + React + TypeScript + Tailwind, shadcn/ui components
- Server state: TanStack Query (wraps IPC calls); tables: TanStack Table
- UI state: Zustand (tab, filters, search; filters persisted)
- Main/UI bridge: typed IPC via contextBridge preload (`jobs:list`, `jobs:refresh`, `jobs:visit`)
- DB: better-sqlite3 + Drizzle ORM (electron-rebuild for the native module), file in Electron `userData`
- Scheduler: node-cron in the main process (3h)
- Tests: Vitest (unit) + Playwright-Electron (e2e)
- Packaging: electron-builder (Windows installer)

## Phase 0 — Reset docs

- [x] (orchestrator) Step 0 subagent gate passed and recorded (see Notes)
- [x] (orchestrator) Rewrite PLAN.md from scratch for the Electron plan

## Phase 1 — Foundation

- [x] (frontend) Scaffold electron-vite react-ts, Tailwind, shadcn/ui init
- [x] (frontend) Add TanStack Query/Table, Zustand
- [x] (frontend) Add Drizzle + better-sqlite3, electron-rebuild and electron-builder config
- [x] (frontend) Create `AGENTS.md` and `.gitignore`

## Phase 2 — Data + IPC

- [x] (frontend) `jobs` table with unique `(source, externalId)` and nullable `visitedAt` — `src/main/db/schema.ts`; injectable `openDb(path)` in `src/main/db/index.ts`. Verified: typecheck passes; better-sqlite3 loads inside Electron and opens the DB in userData (frontend's `npm run dev` run).
- [x] (frontend) IPC handlers and preload (list, visit, stats; refresh is wired to an INJECTED placeholder that rejects "not implemented") — `src/main/ipc.ts`, `src/shared/ipc.ts`, `src/preload`. (refresh handler still a placeholder until Phase 3). Verified: typecheck/build pass; grep confirmed `markVisited` in `src/main/jobs/queries.ts` is the only writer of `visitedAt`. NOT verified: IPC never exercised end to end (nothing in the renderer calls `window.api` yet).
- [x] (job-search) Upsert with an explicit-field update so `visitedAt` is structurally unwritable — `src/main/jobs/upsert.ts` (`UPDATABLE_LISTING_FIELDS` const list drives the ON CONFLICT set; confirmed by reading the file that `visitedAt`/`firstSeenAt` are never in it; job-search inspected the generated SQL via `.toSQL()` and confirmed `visited_at`/`first_seen_at` are absent from DO UPDATE SET). (written, NOT yet tested against a real DB — Phase 6 invariant test required). Also created `src/main/sources/types.ts` (`RawJob`).

## Phase 3 — Ingestion (`src/main/`)

- [x] (job-search) `sources/arbeitnow.ts`, `sources/remoteok.ts`, `sources/himalayas.ts` in `src/main/sources/` (plus `http.ts`) returning `RawJob`
- [x] (job-search) `scoring.ts` default heuristics, score 0-100, `MIN_SCORE=30` in `ingest/refresh.ts`, `NO_ROLE_TITLE_CAP=25`; also updated `.claude/skills/job-relevance-scoring/SKILL.md`
- [x] (job-search) `scheduler.ts` (node-cron, `0 */3 * * *`)
- [x] (job-search) Honor source quirks (see Notes)

### Phase 3b — Role tagging

- [x] (job-search) Role tagging: `src/shared/roles.ts`, `src/main/roles.ts` (`classifyRoles` / `explainRoles`: title match, or >=2 non-list body mentions; head rule dropped; `ai` uses a narrower body keyword list). `roles` JSON column + idempotent ALTER TABLE migration (never drops jobs). Verified in real Electron against a scratch DB with visited rows. After tightening, kept jobs tagged `ai` fell 40% -> 19%. Remaining borderline false positives: aspirational "front-end work over time" / React requirements tag `frontend`. "React Native" deliberately maps to no role. No labeled ground truth; tune in Phase 8.

## Phase 4 — Design spec

- [x] (ui-ux) Spec dashboard layout: stats row (new / visited / per source / last refresh), filterable job list by role/source/score, New + Visited views sharing one card, refresh status, empty/loading states, accessibility, window resizing
- [x] (ui-ux) Write the spec to `docs/dashboard-spec.md` (9 sections)

## Phase 5 — Dashboard UI

- [x] (frontend) Implement the spec in `src/renderer/` (see 5a/5b below for what was verified vs not)

### Phase 5 prerequisites / new work from the spec

- [x] (frontend) 5a done: `cn` imports fixed (shadcn CLI regresses this on every `add`; after any `shadcn add` run `grep -rn 'from "cn"' src` and `npm uninstall cn`), contrast tokens (`--ring`, dark `--input`/`--border`), shadcn components added (input, select, dropdown-menu, sonner, tooltip, separator, alert), theme (OS + manual toggle), BrowserWindow minWidth/minHeight, Menu removed when packaged, Ctrl+R hook.
- [x] (frontend) 5b done: `jobs:open` IPC (http/https only, opens then marks visited), per-source outcomes, `meta` table + persisted lastRefresh, single refresh wrapper shared by IPC + scheduler, `jobs:changed` push, full dashboard UI per `docs/dashboard-spec.md`, real roles filter.
  - Verified by main thread: typecheck passes with no errors; grep confirms `markVisited` in `src/main/jobs/queries.ts` is still the only `visitedAt` writer; screenshots viewed show the dashboard rendering in light and dark (stats cards, New/Visited tabs, filters, score badges, role tags, refresh toast, visited row).
  - Frontend-agent-reported (live Electron harness, scratch DB): refresh inserted 70, then updated 72 / inserted 0; `visited_at` identical before/after the second refresh; `javascript:` / `file:` / garbage URLs rejected without marking visited; script/onerror in descriptions not executed; Ctrl+R synthetic event triggers refresh.
  - **Scope sign-off:** frontend exceeded the three granted lane exceptions (also edited `queries.ts`, `ipc.ts`, `index.ts`, `preload/index.ts`, `tsconfig.web.json`, `main.css`, and created `src/main/jobs/open.ts` + `refreshService.ts`). Main thread read key files and saw no problems; accepted by the main thread, flagged for the user.

## Phase 6 — Tests

- [x] (test) PREREQUISITE: make better-sqlite3 usable under Vitest. NOT NEEDED as planned: better-sqlite3 13.0.3 ships N-API prebuilds that load under both plain Node and Electron, so no separate Node-ABI copy was built.
- [x] (test) Vitest: scoring
- [x] (test) Vitest: upsert preserves `visitedAt` (real DB + generated SQL)
- [x] (test) Playwright-Electron: visit a job, relaunch against the same DB file, still Visited (`e2e/visited-persistence.spec.ts`, `npm run test:e2e`)

### Phase 6b — Hardening

- [x] (test) Vitest suite in `src/main/**/*.test.ts` and `src/main/hardening/*.test.ts`. Covered: visitedAt preserved on refresh, `markVisited` write-once, scoring, roles, queries/stats, roles migration, open-URL checks, hostile DB content, `stripHtml` on untrusted text, mocked-HTTP sources, refresh isolation and in-flight guard, IPC malformed args, window hardening (mocked electron).
- [x] Weaknesses found and FIXED: `stripHtml` quadratic regex; out-of-range numeric entity crash (now U+FFFD); entity-encoded tags surviving; `sandbox` now true (preload no longer exposes `window.electron`); packaged `will-navigate` now only allows the exact renderer `index.html`.
- [x] (job-search) Fix slow `<script>/<style>` regex (was `src/main/sources/http.ts:34`, slow on 100k+ unclosed `<script` openers). DONE, verified by the main session: `http.ts` now has a linear scanner `removeScriptStyleBlocks` (`src/main/sources/http.ts:90`, used by `stripHtml` at ~line 116); `src/main/hardening/untrusted-text.test.ts:95` tests 200k unclosed `<script` / `<style` openers run fast and leave no script text. Full suite 24 files / 601 tests passed. Behavior change: an unclosed `<script`/`<style` now drops everything to end of input.

## Phase 7 — Package

- [x] (frontend) Build the installer with electron-builder. `npm run dist` builds `release\job-finder-1.0.0-setup.exe` (~98.4 MB, NSIS, per-user, no admin, install dir changeable, unsigned, default electron-vite icon). Verified by agents; main session saw the files exist. `electron-builder.yml` whitelists files (`out/**`, `package.json`; no tests/e2e/docs), better-sqlite3 unpacked from asar, renderer libs moved to devDependencies (asar node_modules = drizzle-orm + better-sqlite3 only), `setAppUserModelId` now `com.jobfinder.app`, sandbox true.
- [x] (test) Smoke-test the UNPACKED packaged app (`release\win-unpacked\job-finder.exe`, isolated `--user-data-dir`, Playwright `executablePath`): starts, DB created, packaged=true, menu null, sandbox/contextIsolation on, `window.api` present, dashboard renders. Live refresh x4: 69 inserted, then 1/0/0 new, updated 65-66, rows 69->70, zero duplicate (source, external_id), zero cross-source dupes, 1 same-source same-title/company pair with different ids (himalayas "Associate Developer" at RUX, unchecked). `visitedAt` preserved exactly across refresh and relaunch.
- [x] (user) Smoke-test the INSTALLED app: the USER personally installed the rebuilt NSIS installer on their machine and reported "installed it, it works" (their words). USER-CONFIRMED AT A HIGH LEVEL ONLY: no per-step details were given, so specific sub-steps (shortcuts, default userData path, Ctrl+R, uninstall) are NOT claimed as checked. (Earlier agent attempt to install was blocked by the auto-mode safety check; the user did it themselves.)
- [ ] NOT verified in the packaged/installed app (stays open): uninstall, SmartScreen behavior, code signing (unsigned), custom icon (default electron-vite icon), 3h scheduled tick, UI Refresh button details (agent runs drove `window.api` only; user gave only "it works"), failure paths live.

## Phase 7b — Israel-focused sources

New user requirement (this session). Status: all items 1-8 DONE (see items). Checkboxes are ticked only for what was verified; see "Phase 7b open / unverified" below.

Decisions (user, this session):
- New-grad / graduate-program roles COUNT as junior.
- Student and intern roles do NOT count as junior. CONFIRMED by the user (2026-10-07); no longer an assumption.
- "Associate" titles are a moderate junior signal.
- Junior may also be inferred from the description ("no experience required", "0-N years", etc.). Bounds on the upper years figure: <=2 strong signal, 3 moderate, 4-5 weak, "3+ years" is a penalty.
- A title containing "senior" (or "sr", or Hebrew "בכיר") is an IMMEDIATE reject regardless of description.
- Includes a "paste careers URL" helper, backed by an editable company list stored in userData.

Requirements:
- Jobs MUST be located in Israel and on-site or hybrid. Remote-only does NOT count; Israel-based-but-fully-remote is excluded. This is a hard location filter.
- REMOVE the remote boards entirely (Arbeitnow, RemoteOK, Himalayas): source files, their tests, and docs references.
- No fixed target company list. job-search proposes a seed list; the user can add companies.
- Sources: company career pages via ATS public JSON endpoints (Comeet, Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday for NVIDIA), and possibly Israeli boards (AllJobs, Drushim, JobMaster) if permitted.
- NOT used: LinkedIn/Indeed/Glassdoor (no public API; scraping breaks ToS and gets blocked). A third-party LinkedIn MCP drives a logged-in LinkedIn session (account/ToS risk), and Claude/MCP is not present in the packaged standalone app, so it is not an option for runtime ingestion.

Items:
- [x] (1) (job-search) Feasibility research with live counts per ATS/board. Outcome: HireMeTech NOT built (robots.txt Disallow /api/, job data only reachable via /api, client-rendered, terms unreadable). Workable not implemented. Hebrew boards (AllJobs/Drushim/JobMaster) not built.
- [x] (2) (job-search) Backend: schema migration (country/city/work_mode; purges only UNVISITED rows of the removed remote sources; `visitedAt` untouched; idempotent) and `RawJob` update. Migration test 7b passes.
- [x] (3) (job-search) Backend connectors in `src/main/sources/`: Amazon, Workday (NVIDIA/Intel/Salesforce), Greenhouse, Comeet, Lever, SmartRecruiters, Ashby, SQLink. Editable company list in userData; seed list now 37 (26 original + 11 new: SQLink, Torq, Apiiro, Cymulate, Salt Security, Orca, BigID, Optimove, Innovid, Lemonade, Finout) with an additive seed merge (`seedsApplied`) so existing installs get new seeds without resurrecting removed ones or overwriting edits. SQLink is ON per the user; robots allow it but its terms page could not be located/read: KNOWN RISK, one-click disable in the Companies tab.
- [x] (4) (job-search) Israel-only location filter (remote-only excluded, no bare "IL") and scoring/roles update: senior etc. in title = 0; new grad/Associate count; 1+ years counts; 2+ neutral; no-experience-stated software title ~30-40; 3+ penalty; student/intern capped; Hebrew support incl. apostrophe variants; firmware/embedded keywords.
- [x] (5) (job-search) Removed Arbeitnow, RemoteOK, Himalayas (sources and tests). Docs references: see Notes (Phase 9 still owns CLAUDE.md/README.md).
- [x] (6) (frontend) IPC for new data; work-mode and company filters; Companies tab with paste-URL add + enable/remove; per-company failure summary; empty state. Verified in the built app by frontend (live add of Stripe; bad URLs rejected).
- [x] (7) (test) New tests: companiesIpc, ipc filters, queries filters, migration 7b, renderer filters, scoring table (~95 cases), connectors with mocked HTTP. 3 bugs found and FIXED (malformed percent-escape URLs threw; Hebrew geresh/curly-apostrophe junior; NULL work_mode vs 'unknown' filter). Main session ran `npx vitest run`: 23 files, 571 passed + 4 expected-fail (before the last fix); after it job-search reported 575 passing, 0 failing, no `it.fails` left; typecheck clean.
- [x] (8) (frontend/test) Rebuild installer and re-verify. DONE. Frontend rebuilt `release\job-finder-1.0.0-setup.exe` (103,141,255 bytes, ~98.4 MiB, unsigned). Asar contents verified (no tests/e2e/scripts; better-sqlite3 unpacked). Unpacked packaged app verified with isolated userData: packaged, menu null, sandbox on, 37 seeds, legacy-upgrade merge, live refresh x2 (21 kept, 0 duplicates, visitedAt preserved across refresh and relaunch). The user separately installed the NSIS installer and reported it works (high level only, see Phase 7).

Live run (scratch DB, job-search): ~21 kept of ~1,500 fetched: SQLink 8, Amazon 8, NVIDIA 2, Cato 1, Melio 1, Armis 1. Top: NVIDIA Software QA Engineer 75, SQLink Junior DevOps 65, Amazon 2026 Graduate SDE x2 60. Junior supply is thin: most seed companies list only senior or 4+ year roles. Possible false positives to watch: NVIDIA Firmware SerDes Verification Engineer (40), Amazon Chip Validation Software Engineer (40), SQLink Embedded Hard Real-Time (30).

Phase 7b open / unverified:
- Installer rebuild + re-verify (item 8) is done; installed-app test is user-confirmed at a high level only (see Phase 7). Still unverified: uninstall, SmartScreen, code signing, custom icon, 3h scheduled tick, UI Refresh button details.
- One unexplained extra visited row during the agent run (id 19 'QA Digital...', visited ~45s after the scripted visit). Code review: only `jobs:visit` and `jobs:open` (a renderer row click) can mark visited; refresh never does. Most likely a stray click on the visible test window. Unexplained but low risk.
- A real Refresh via the UI across all companies has not been run; Comeet add not verified live.
- Workable not implemented; HireMeTech not built (reasons in item 1); Hebrew boards not built.
- Connector fixtures follow connector docs and were never validated against real captured payloads; no concurrent-refresh test.
- Stale comment in `companiesIpc.test.ts` ("BUG ... it.fails", title suffix) needs cleanup.
- Dev-only scripts `scripts/live-run.ts` and `scripts/probe-companies.ts` exist (user may delete).
- Removing a company leaves its jobs in the DB (by design, noted in the UI).
- Phase 8 relevance tuning waits on the user's good-job examples (see Phase 8); the intake tooling is built (see Phase 8).

## Phase 7c — Google Jobs aggregator source (optional)

Status: APPROVED by the user (2026-10-07), WAITING ON THE USER to supply their own free SerpApi or JSearch key (agents cannot sign up for accounts). Nothing is started or built. The app must work fully without it. Phase 7b is done, so the only gate is the key.

- [ ] (user) Supply a free API key (SerpApi Google Jobs or JSearch/OpenWebNinja). Agents cannot sign up for accounts.
- [ ] (job-search) Evaluate free-tier limits on REAL Israel junior searches first (needs the user's key), before building anything
- [ ] (job-search) If worthwhile: optional connector; key stored ONLY in the userData config, never committed or logged; connector is inert when no key is set
- [ ] (job-search) Limit to a few Israel-specific queries, run on manual refresh or at most daily; keep/cache results to stay within quota
- [ ] (orchestrator/user) Decide per the real results whether to ship

Rejected options (assessments from general knowledge, NOT tested):
- Apify LinkedIn/Indeed/Glassdoor scrapers: scraping, banned by RULES.md.
- Google Cloud Talent Solution: employer-side job indexing/search API, not a job search source for us.
- Techmap: unknown pricing and Israel coverage, unverified.

## Phase 8 — Relevance tuning (waiting on the user's examples)

- Status: the user WILL provide good-job examples as job ids and page URLs (possibly from LinkedIn etc.). Phase 8 is no longer an open-ended wait; it is blocked only on receiving them.
- Intake tooling is BUILT and verified by the main session: 24 test files / 601 tests pass, typecheck clean. `npm run examples:add -- <url-or-id>... [--label fit|no-fit] [--reason "..."] [--text-file path] [--title ..] [--company ..] [--location ..] [--db <jobs.sqlite>] [--file <examples.json>]` resolves a job id or URL into an entry in `training-data/examples.json`; `npm run examples:report` scores each example with the CURRENT scoring and reports the results. Code in `src/main/examples/` with thin tsx wrappers `scripts/examples-add.ts` and `scripts/examples-report.ts`; `tsx` added as a devDependency. `training-data/examples.json` is `[]`; `training-data/README.md` documents the schema.
  - `examples:add` resolves ATS pages and JSON-LD job pages via PUBLIC endpoints only.
  - Live-verified: single-posting Greenhouse, Lever, Amazon resolve; a LinkedIn URL produced a stub with no request. Unit-test-only (never run live): Ashby, SmartRecruiters single posting, Workday, Comeet, SQLink.
  - It NEVER fetches LinkedIn, Indeed, Glassdoor, ZipRecruiter or Monster. For those, the user pastes the job text via `--text-file`.
  - Labels and reasons come ONLY from the user; agents must not invent or infer them.
  - The report's rejection reasons are best-effort; scores are exact. Jobs loaded via `--db` lack seniority.
- Tuning of `scoring.ts` follows once the examples arrive.
- Sequencing: relevance tuning should run AFTER the Phase 7b sources exist, so it tunes against the real Israel job pool.
- Live observations from the packaged-app run (inputs): 4 of the top-10 score-100 jobs have empty role tags (Java/.NET junior roles), so a 100 score does not imply a target role; a Python backend job was spuriously tagged frontend; one truncated title; 21 rows scored 20-39 were not inspected; ~93% of ~950 fetched jobs were filtered out.
- [x] (job-search) Build the intake tools `examples:add` and `examples:report` (see above) — built; main session verified 24 files / 601 tests pass, typecheck clean; live vs unit-test-only coverage listed above
- [ ] User provides good-job examples (job ids / page URLs; pasted text for blocked sites, with their own labels and reasons) — WAITING on the user
- [ ] (job-search) Update `scoring.ts` and the `job-relevance-scoring` skill to match the examples
- [ ] (job-search) Check QA/FDE coverage; if thin, offer Adzuna (key in `.env.local`/userData config, user-provided)

## Phase 9a — Final cleanup pass (code + rules)

Behavior-preserving only. Runs after Phase 8 relevance tuning if that happens (see Notes), and BEFORE Phase 9 so docs are reconciled last. Method: use tooling to find candidates (knip or ts-prune, depcheck, `tsc --noUnusedLocals --noUnusedParameters`, eslint no-unused-vars), then review each candidate by hand. The user reviews the list of deletions before anything non-trivial is removed.

- [ ] (job-search) Dead/redundant code in its lane `src/main/{sources,scoring,roles,location,companies,ingest,scheduler}`: unused exports, functions, constants, imports, duplicate helpers (e.g. overlapping normalization/regex/decode helpers across `http.ts`, `scoring.ts`, `location.ts`, connectors), leftover remote-source remnants, unused params/types
- [ ] (frontend) Same for `src/main/{index,ipc,companiesIpc,db,jobs}`, `src/preload`, `src/shared`, `src/renderer/src`: unused shadcn components/files/hooks/lib exports/types, duplicated logic, deprecated `useLegacyTable` migration, any leftover `cn` dependency or `from "cn"` imports, unused deps in package.json/devDependencies (e.g. `@electron-toolkit/preload`), unused assets, stale comments
- [ ] (test) Redundant/duplicate tests, stale comments (e.g. the stale "BUG ... it.fails" note in `companiesIpc.test.ts`), orphaned fixtures, unused e2e/test config; tests must still prove every invariant
- [ ] (orchestrator) Rules and project docs redundancy/contradictions: `RULES.md`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `.claude/agents/*.md`, `.claude/skills/*/SKILL.md`, `docs/dashboard-spec.md` (outdated lines), stale PLAN.md notes. One source of truth per fact; remove duplication and contradictions; KEEP every hard rule (visitedAt invariant, delegation rule, lane rules, Electron-free DB layer, sandbox/contextIsolation, sources/secrets rules)
- [ ] (job-search) Dev scripts: decide keep or delete `scripts/live-run.ts` and `scripts/probe-companies.ts` (user decides; default delete unless documented in AGENTS.md as dev tools). Decision must also consider `scripts/examples-add.ts` and `scripts/examples-report.ts`: default KEEP, documented in AGENTS.md as dev tools (they back `npm run examples:*`, thin wrappers over `src/main/examples/`).
- [ ] (test) Gate, all must pass after the cleanup: `npm run typecheck`, `npx vitest run` (all green, visitedAt tests intact), `npm run build`, `npx playwright test`, and a final `npm run dist` smoke test of the unpacked app. No behavior changes, no weakening of tests or rules.

## Phase 9 — Docs

- [ ] (orchestrator) Final pass: reconcile every PLAN.md checkbox with what actually landed
- [ ] (orchestrator) Update README and CLAUDE.md (stack, layout, conventions; drop Next.js `await params`/Prisma notes)
- [ ] (orchestrator) Update RULES.md lane paths and agent files to `src/main`, `src/renderer`, `src/preload`

## Notes

- **Step 0 gate (passed, with one caveat).** All five agents (orchestrator, frontend, ui-ux, test, job-search) spawned and reported their lanes. The orchestrator's nested spawn of `test` launched without error, but its child's reply was not observed (subagent output files were 0 bytes), so nested delegation is launched-but-unverified. `orchestrator.md` was edited to add Write/Edit (scoped to PLAN.md/docs) and to replace the execute-directly fallback with stop-and-report.
- **Delegation rule:** if delegation fails, STOP and tell the user. Do not do the work directly or return a workaround plan.
- No `/design` skill exists; the ui-ux agent specs the design first (Phase 4), then frontend implements.
- Phase 8 is waiting on user-provided examples (job ids / URLs); intake tooling (`examples:add`, `examples:report`) is built and verified (see Phase 8).
- Himalayas's `?seniority=` query param does not reliably filter server-side — filtering happens client-side on the `seniority` array field plus title keywords. Don't re-add server-side trust in that param without re-verifying.
- RemoteOK's `/api` response has a legal-notice object as the first array element — always filter by presence of `id` before mapping.
- **Phase 1 verified:** files exist (AGENTS.md, .gitignore, shadcn button/card/tabs/badge/skeleton/table, Zustand store `src/renderer/src/store/ui.ts`, `electron-builder.yml`), deps installed (TanStack Query/Table, Zustand, Drizzle, better-sqlite3, node-cron, Tailwind v4), `npm run typecheck` passes. Frontend also reported `npm run build`, `npm run rebuild` (better-sqlite3 vs Electron) passed, and `npm run dev` started with no errors.
- **Phase 1 NOT verified:** the Electron window was never seen rendering; `npm run dist` / ASAR unpack of better-sqlite3 untested (revisit in Phase 7); better-sqlite3 not yet loaded inside Electron (no DB code until Phase 2).
- **Phase 6 constraint:** better-sqlite3 is built for Electron's ABI but Vitest runs under plain Node, so tests touching the native module need an injectable DB layer or a Node-ABI build. Design the Phase 2 DB layer so the upsert is testable.
- `src/main/index.ts` and `src/preload` are still stock electron-vite demo code (incl. a `ping` IPC) until Phase 2.
- **Phase 2 UNTESTED:** the real behavior of `visitedAt` surviving a refresh, the transaction, inserted/updated counts, `listJobs` ordering (NULLS LAST) and the `getStats` SQL are all untested, because better-sqlite3 is built for Electron's ABI and Vitest runs under plain Node. Phase 6 must solve this (Node-ABI build or an alternative) before the invariant test can run. Also note: the upsert uses a `tx as unknown as Db` cast, and `sandbox: false` is still set in the BrowserWindow from the stock template (review in Phase 7).
- `npm audit` reports vulnerabilities, unaddressed.
- README.md and CLAUDE.md are still stale until Phase 9.
- **Phase 3 verified (main thread):** typecheck passes; grep confirms no `visitedAt` write outside `queries.ts` `markVisited` / the safe upsert; `src/main/index.ts` is wired to `refreshJobs` + `startScheduler`. job-search fetched all three sources LIVE with no failures (Arbeitnow 731, RemoteOK 99, Himalayas 113 jobs); 72 of 943 kept at `MIN_SCORE` 30 (~8%).
- **Live-API findings:** Arbeitnow ~300/page, capped at 3 pages. RemoteOK `[0]` legal notice confirmed; descriptions have mojibake cleaned by `stripHtml`; terms ask for a link-back. Himalayas uses cursor pagination (`?cursor=`), limit capped at 20, `?seniority=` confirmed ignored server-side, plus a `/jobs/api/search?q=` endpoint; the client does 5 feed pages + 8 targeted searches, deduping by guid.
- **Scoring caveat:** unlabeled generic "Backend Engineer"/"QA Engineer" score exactly 30 (pass at threshold) and some German Werkstudent IT roles score 60. Tighten in Phase 8 once the user labels examples.
- **Lane exception:** job-search made a narrow, user-sanctioned edit to `src/main/index.ts` (refresh wiring + scheduler start/stop), added `errors` to `RefreshResponse` in `src/shared/ipc.ts`, and added optional `seniority?` on `RawJob`.
- **Phase 3 NOT verified:** `refreshJobs` never run against a DB or inside Electron; scheduler tick untested; no renderer reads `errors`; a request failing mid-pagination is swallowed (partial results kept).
- **Phase 5 NOT verified:** real browser open (`openExternal` stubbed), physical Ctrl+R, packaged menu removal / `npm run dist`, an actual cron tick, pointer interaction with Radix dropdowns/Select, axe accessibility audit, skeleton loading state, 1600px max-width, screen-reader announcements.
- **Known issues / TODO (Phase 5):**
  1. Scoring false positive visible in UI: "Junior Business Developer" (sales-type role) scores 100 and tops New; the score doesn't use `roles` yet. Fix in Phase 8 with the user's labeled examples (consider requiring a software role tag).
  2. `useLegacyTable` from `@tanstack/react-table/legacy` is deprecated (v9); migrate to `useTable`/`tableFeatures`.
  3. A scheduled run that throws (non-source error) is only console-logged.
  4. `onOpen` depends on the useMutation result so columns rebuild each render (fine at ~70 rows).
  5. The frontend agent used `taskkill /IM electron.exe`, which kills any other Electron apps the user has open. Future agents must kill only their own process.
  6. `docs/dashboard-spec.md` still says "no manual toggle" (outdated: the toggle exists).
  7. The agent reported replying to an "are you stuck?" message the main thread never sent; unexplained.
  8. The app's real userData DB now has an empty `meta` table from a dev run.
- **Phase 6 verified (main session):** `npx vitest run` = 11 files, 153 passed, 0 failing. e2e reported passing 1/1 by the agents (test, and frontend with `sandbox: true`); NOT re-run by the main session after the sandbox change.
- **Phase 6 NOT verified / open:** Ctrl+R and real navigation attempts in a packaged app (mocked only); tests encode CURRENT scoring behavior, not tuned (Phase 8); `e2e/` is not typechecked; sources/refresh/scheduler have mocked tests only, no live network tests; no mutation test of the visitedAt invariant. Earlier TODOs still open: `useLegacyTable`, scheduled-run crash surfacing, Junior Business Developer scoring false positive.
- **Phase 7 status:** installer builds and the unpacked packaged app is verified; the installed (NSIS) flow is unverified pending the user. Phase 7b (Israel-only, on-site/hybrid sources, remote boards removed) is inserted before Phase 8. Several Notes below describe the remote boards and will be stale after 7b item 5.
- **Phase 7 (earlier note):** items left unchecked until verified. The `sandbox: false` review item from Phase 2 is DONE (sandbox is now true).
- **RULES.md updated this session** (paths, Israel-only sources, architecture constraints). CLAUDE.md, README.md and the agent files remain STALE (old Next.js/Prisma paths and remote-board references); Phase 9 owns them.
- **Phase 9a sequencing:** Phase 7c (Google Jobs source, awaiting user key) and Phase 8 (relevance tuning, awaiting the user's examples) remain OPEN. The intern exclusion is now user-confirmed. If Phase 8 happens, run Phase 9a after it so the cleanup does not churn code that is about to change; Phase 9 (docs) stays last.
- **Git:** the project folder is now a git repository (`git init -b main` run by the main session on 2026-10-07, user-approved). NO commit has been made yet. `.gitignore` gained `test-results/`, `playwright-report/`, `.claude/settings.local.json`. This resolves the earlier docs-analysis note that the docs assume git while the folder was not a repo.
- **Phase 4:** ui-ux assumed score 0-100; job-search's scoring output confirms 0-100. Open design questions were put to the user; answers will be recorded here once given.
