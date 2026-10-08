# Roadmap

Owned by the Orchestrator agent. Update status here as work lands — this is the living backlog, not a design doc.

## Stack

Standalone Electron desktop dashboard. Stack, layout and commands: see `AGENTS.md`. Hard rules: `RULES.md`.

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

New user requirement (2026-10-07). Status: all items 1-8 DONE (see items). Checkboxes are ticked only for what was verified; see "Phase 7b open / unverified" below.

Decisions (user, 2026-10-07):
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
- [x] (2) (job-search) Backend: schema migration (country/city/work_mode; purges only UNVISITED rows of the removed remote sources, explicitly approved here for that one migration; `visitedAt` untouched; idempotent) and `RawJob` update. Migration test 7b passes.
- [x] (3) (job-search) Backend connectors in `src/main/sources/`: Amazon, Workday (NVIDIA/Intel/Salesforce), Greenhouse, Comeet, Lever, SmartRecruiters, Ashby, SQLink. Editable company list in userData; seed list now 37 (26 original + 11 new: SQLink, Torq, Apiiro, Cymulate, Salt Security, Orca, BigID, Optimove, Innovid, Lemonade, Finout) with an additive seed merge (`seedsApplied`) so existing installs get new seeds without resurrecting removed ones or overwriting edits. SQLink was ON per the user at the time (its terms page could not be located/read: KNOWN RISK); it is now seeded OFF by default because Cloudflare blocks automated requests with 403 (see Phase 7b open, RESOLVED SQLink 403).
- [x] (4) (job-search) Israel-only location filter (remote-only excluded, no bare "IL") and scoring/roles update: senior etc. in title = 0; new grad/Associate count; 1+ years counts; 2+ neutral; no-experience-stated software title ~30-40; 3+ penalty; student/intern capped; Hebrew support incl. apostrophe variants; firmware/embedded keywords.
- [x] (5) (job-search) Removed Arbeitnow, RemoteOK, Himalayas (sources and tests). Docs references cleaned up in the Phase 9a doc pass.
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
- (Resolved in Phase 9a: the stale `companiesIpc.test.ts` comment was cleaned up and `scripts/live-run.ts` / `scripts/probe-companies.ts` were deleted.)
- **RESOLVED (2026-10-07): SQLink 403.** A live refresh in the packaged app returned `sqlink: HTTP 403 Forbidden for https://www.sqlink.com/sitemap/` and kept 14 jobs (not ~21). Diagnosis (main session, one polite request): sqlink.com answers every automated request, including robots.txt, with HTTP 403 and `Cf-Mitigated: challenge` (a Cloudflare browser challenge). The connector correctly stops on 403 and must NOT bypass it (RULES.md). SQLink earlier produced 8 kept jobs and now yields none while blocked. DECISION (user): SQLink is seeded DISABLED by default (`src/main/companies/seeds.ts`, 4th tuple element `false`); the user can re-enable it in the Companies tab. Existing installs keep their current on/off choice (the user's installed copy likely has it enabled and must untick it manually until a rebuilt installer); fresh installs have 36 of 37 seeds enabled. Verified by the main session: `npm run typecheck` clean, `npx vitest run` 25 files / 594 tests passing. The installer has NOT been rebuilt with this default yet.
- Removing a company leaves its jobs in the DB (by design, noted in the UI).
- Phase 8 relevance tuning waits on the user's good-job examples (see Phase 8); the intake tooling is built (see Phase 8).

## Phase 7c — JSearch (OpenWebNinja) aggregator source (opt-in)

Status: BUILT 2026-10-08, not yet run against the real API. User decisions (2026-10-08): (1) build as an opt-in extra; (2) LinkedIn-sourced listings delivered via the JSearch API count as an approved source (RULES.md "Sources and secrets" edited by the orchestrator, user-approved; the app only stores links and never fetches LinkedIn/Indeed/Glassdoor); (3) frequency: manual "Deep refresh" plus automatic roughly weekly (separate daily-check cron `17 10 * * *` calling `maybeRunWeekly`), never on the 3h cron.

- [x] (job-search) Backend `src/main/sources/jsearch/{types,map,service,index}.ts`: inert without `jsearchApiKey` in userData config.json; 4 queries x 1 page; monthly counter in `jsearch-state.json` blocking at 200 (was 150; see Phase 7d Limits); 401/403/429 block until next month; job_id cache; 45-day age filter; junior-signal gate; ATS dedupe on normalized title+company; Israel location filter; upsert via `upsertJobs` (visitedAt never written). `scheduler.ts` got an optional `daily` hook. Key-leak bug in `guarded()` found by test, fixed by job-search. Agent-reported.
- [x] (ui-ux) Spec: `docs/dashboard-spec.md` section 10.
- [x] (frontend) `src/shared/jsearch.ts`, `src/main/jsearchIpc.ts` (in-flight guard, setKey validation), preload `window.api.jsearch`, `src/main/index.ts` wiring, `DeepSearchPanel` in the Companies tab, "via LinkedIn" badge. Agent-reported; Electron never launched, UI not visually checked.
- [x] (test) 4 new test files (`jsearch.test.ts`, `scheduler.test.ts`, `jsearchIpc.test.ts`, `src/renderer/src/lib/jsearch.test.ts`); agent-reported final: typecheck clean, 29 files / 671 tests passing (not re-run by the orchestrator).
- [ ] (user) Supply/set the key via the app's panel; first real run (unverified: `country=il` and `query` param names, response field names, never checked against a real payload).
- Verified by the orchestrator by Grep only: no console/visitedAt/LinkedIn fetch in the jsearch module; writes go through `upsertJobs`. The orchestrator has no shell: typecheck/vitest/build were NOT run by it; all pass results are agent-reported.
- Out-of-lane files touched: none by job-search, frontend or test beyond their lanes (agent-reported). Orchestrator edited RULES.md (user-approved).
- Not verified: Deep refresh in a running app, weekly gate live, installer not rebuilt.

### Phase 7d — SerpApi (Google Jobs) secondary fallback (opt-in)

Status: BUILT 2026-10-08, never run against the live API. User decision (2026-10-08): add SerpApi as a secondary source with the same rules as JSearch; RULES.md exception line extended to name it (user-approved, applied by the orchestrator). The user is on the SerpApi free plan.

- [x] (job-search) Inside `src/main/sources/jsearch/{map,service,types,index}.ts`: config field `serpapiApiKey` (userData config.json only), `selectProvider` (JSearch preferred; SerpApi only when keyed, not blocked, under cap, AND JSearch is keyless, blocked, or used >= `JSEARCH_FALLBACK_THRESHOLD` 130 of 150), own persisted monthly counter in `serpapi-state.json`, `SERPAPI_MONTHLY_CAP = 200`, 4 queries x 1 request, block until next month on 401/403/429 or quota-exhausted JSON errors, job_id cache, 45-day age filter with defensive relative-date parsing, shared location/junior/score/dedupe code, source name `'serpapi'`. `maybeRunWeekly` picks the provider. `scheduler.ts` unchanged. Agent-reported.
- [x] (frontend) IPC `jsearch:setSerpapiKey` / `jsearch:clearSerpapiKey` (`src/shared/ipc.ts`, `src/main/jsearchIpc.ts`, `src/preload/index.ts`), Deep search panel with SerpApi key field, per-provider quota/blocked status, active provider and "via JSearch/SerpApi" on last run, `sourceLabel`/badges ("via Google Jobs"; "via LinkedIn" only for linkedin.com URLs). typecheck and build pass (agent-reported). UI not launched or visually checked. `docs/dashboard-spec.md` section 10 was NOT updated for SerpApi (ui-ux did not review the new panel layout).
- [x] (test) New `serpapi.test.ts`, extended `jsearchIpc.test.ts` and `renderer/lib/jsearch.test.ts`: mocked HTTP, fallback switching, counters, error blocks, inert without key, key never in status/messages/state files/console, visitedAt preserved. Agent-reported: typecheck clean, 30 files / 780 tests passing; not re-run by the orchestrator (no shell). e2e not run.
- [ ] (user) Enter the SerpApi key in the panel; first real run.
- **Limits (user decisions 2026-10-08, supersede earlier figures):** JSearch `SOFT_LIMIT` = 200 (user's plan limit), `JSEARCH_FALLBACK_THRESHOLD` = 170, `SERPAPI_MONTHLY_CAP` = 250 (USER-STATED/confirmed, not independently verified by us). Block-on-quota-error path kept. Earlier 150/130/100/200 values and the "unverified 250" wording were removed from code comments, tests and docs.
- **Counter overspend warning (plain):** about 10 JSearch credits were already used in testing before the app counted anything. The real remaining JSearch quota this month is therefore about 190, but the app's counter starts at 0, so the app may overspend by about 10 requests this month. If JSearch returns 429 the app blocks it until next month and the SerpApi fallback takes over.
- **Live findings (2026-10-08, VERIFIED by the user's live run of the installed build):** endpoint and key work (status Success). Response shape has top-level keys `error`, `search_information`, `search_metadata`, `search_parameters`. With params engine=google_jobs, hl=en, no location/gl, q="junior software developer Israel" and "junior QA engineer Israel": 0 results with `error: "Google hasn't returned any results for this query."` (treated as a normal empty result). The 3rd request hit a network error (probably timeout) and the run stopped, so q4 never ran (3 requests, 0 fetched). An earlier attempt with location=Israel&gl=il&hl=en returned HTTP 400, reason never seen.
- **Fix landed (2026-10-08, agent-reported: job-search in `service.ts`; test agent reported typecheck clean and 33 files / 858 tests passing, new `serpapiLocation.test.ts` with 19 tests; not re-run by the orchestrator; no commit, no installer rebuild; no out-of-lane files touched):** request changed to engine=google_jobs, q without trailing " Israel", location=Israel, hl=en, NO gl; SerpApi HTTP timeout raised to 45 s; one failed query no longer aborts the rest (counted as a request, failures reported); 400 Details names the offending param when SerpApi names it. **`location=Israel` without `gl` is still an UNTESTED GUESS** (hypothesis: google_jobs returns nothing without a valid location); not verified against the live API.
- UNVERIFIED (except the response top-level keys and `error` wording above): all SerpApi request params and response field names (`jobs_results[].title/company_name/location/description/job_id/apply_options[].link/related_links/detected_extensions.posted_at`) and `error` string wording are assumed from docs knowledge, never checked against a live payload.
- **Intended behaviors (decided, keep):** (a) a run by either provider updates the shared `lastRunAt`/`lastRunSummary` in `jsearch-state.json`, so the roughly weekly gate is shared across providers; (b) saving a DIFFERENT key lifts that provider's API-error block (401/403/429/invalid key) but KEEPS its monthly counter, so the cap still applies; (c) each provider dedupes against every row not from its own source (JSearch also dedupes against SerpApi rows). Also documented in `docs/dashboard-spec.md` section 10 (ui-ux).
- Cleanup (job-search, agent-reported, typecheck clean): `MIN_SCORE` moved to the neutral `src/main/ingest/constants.ts` (imported by `refresh.ts`, which re-exports it, and by `jsearch/map.ts`), removing the potential circular import; behavior-preserving. Frontend removed `FREE_PLAN_LIMIT` and the "free plan 200"/"not verified" panel text.
- ui-ux updated `docs/dashboard-spec.md` section 10 (now 10.1-10.10) to the final panel and reviewed it (code reading only, no contrast/axe check, app not launched). Its a11y findings were fixed by frontend (aria-labels start with visible text, focus management, always-mounted live region, SerpApi "Takes over" text only when JSearch is usable, units). Agent-reported; focus behavior untested. No renderer component-test setup exists (vitest env node), so panel behavior has no automated test.
- Final gate after those edits (test agent, agent-reported; not re-run by the orchestrator): `npm run typecheck` 0 errors, `npx vitest run` 30 files / 780 tests passing. Playwright e2e not run. Test counts: 780 both before and after the limit update (a boundary test replaced/merged existing ones). Constants test pins 200/170/250; 169/170 fallback boundary test added.
- Out-of-lane files touched: job-search edited `src/shared/jsearch.ts` (sanctioned for that one file, first task only; in the follow-up it did not edit it). No others reported. Orchestrator edited RULES.md (user-approved) and PLAN.md.
- **First real SerpApi run failed with HTTP 400 (2026-10-08) and fix (agent-reported, not re-run by the orchestrator):** job-search edited `src/main/sources/jsearch/service.ts` only. (1) Non-2xx responses for both providers now surface the provider's `error`/`message` text (key-scrubbed, whitespace-collapsed, 200 chars max) as "Details: ..." in the run message; SerpApi 200-body errors do the same. (2) Root cause is an UNVERIFIED BEST GUESS: `location=Israel` and/or `gl=il` rejected for `google_jobs`. Request is now `engine=google_jobs&q=<query> Israel&hl=en&api_key=...` (no location/gl); queries end in " Israel". (3) A 400 never blocked (only 401/403/429 and quota/bad-key JSON errors block; unchanged). Counter: 4xx other than 429 (incl. 400, 401, 403) is refunded; network error, timeout, 5xx, 429 and 200 stay counted. (4) test agent: new `errorDetail.test.ts` (31 tests), 7 existing tests adjusted (401/403 `used` now 0); typecheck clean, 31 files / 814 tests pass (agent-reported). e2e not run.
- **Second live run: 200 OK but "0 found, 4 requests" (2026-10-08) and fix (agent-reported, not re-run by the orchestrator):** job-search edited `service.ts` and `map.ts` only. (1) Any 200 response (SerpApi and JSearch) parsing to zero rows now appends a diagnostic to the run message: sorted top-level key names (max 15, 40 chars each), `search_metadata.status`, and `error` text (key-scrubbed, 200 chars), grouped by query number; never job content. SerpApi "hasn't returned any results" is reported as a normal empty result, ok stays true, no block. (2) `interpretSerpapiBody` takes the first array among `jobs_results`/`jobs`/`results`; `mapSerpapiRow`/`serpapiJobId` accept field variants (job_title, company, job_location, snippet/job_description/job_highlights, detected_extensions.posted, apply_options/share_link/share_url/link/related_links/apply_link, http(s) only; hash fallback id). (3) `SERPAPI_QUERIES` (one exported constant) now: 'junior software developer Israel', 'junior QA engineer Israel', 'entry level backend developer Israel', 'junior python developer Israel'; still 4 requests, quota logic unchanged. (4) test agent: new `serpapiEmpty.test.ts` (25 tests); typecheck clean, 32 files / 839 tests pass (agent-reported). e2e not run.
- Likely real cause is an empty-result `error` body (queries too narrow) but this is UNVERIFIED. If the next run shows fetched > 0 and kept = 0, the cause is the strict junior-signal gate, MIN_SCORE or the 45-day cut; rows dropped by those are not counted per reason (possible next step). Out-of-lane files touched: none reported. Nothing committed, installer not rebuilt.
- Still unverified: whether the param change fixes the 400, the real SerpApi `error` JSON shape, live run. The next real run's message will show SerpApi's actual error text. Nothing committed, installer not rebuilt. Out-of-lane files touched: none reported.
- Not verified: live run, running-app UI, installer not rebuilt, nothing committed.

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
- [ ] (job-search) Check QA/FDE coverage; if thin, offer Adzuna (user-provided key in the userData config only, never in the repo)

## Phase 9a — Final cleanup pass (code + rules)

Behavior-preserving only. Runs after Phase 8 relevance tuning if that happens (see Notes), and BEFORE Phase 9 so docs are reconciled last. Method: use tooling to find candidates (knip or ts-prune, depcheck, `tsc --noUnusedLocals --noUnusedParameters`, eslint no-unused-vars), then review each candidate by hand. The user reviews the list of deletions before anything non-trivial is removed.

Status: code cleanup APPLIED 2026-10-07. Main-session verification (re-ran): `npm run typecheck` (node+web+e2e) clean; `npx vitest run` 25 files / 592 tests passing; `npm run build` ok. `git diff` vs snapshot commit 3208d9a: 85 files changed (+617/-1942); new untracked: `e2e/table-sorting.{spec.ts,golden.json}`, `src/main/{text.ts,testing/,hardening/http-client.test.ts,ingest/refresh.test.ts,sources/http.test.ts}`, `tsconfig.e2e.json`. Agent-reported only (frontend; NOT re-run by the main session): `npx playwright test` 2/2 pass, `npm run dist` ok, installer 103,141,255 -> 87,023,238 bytes, unpacked smoke test passed (packaged, menu null, sandbox on, 37 seeds, refresh twice with no duplicates, visitedAt preserved across refresh and relaunch).

- [x] (job-search) Dead/redundant code in its lane `src/main/{sources,scoring,roles,location,companies,ingest,scheduler}`. Done: shared `src/main/text.ts` matcher; deleted `secondsToMs`, a re-export, `listCompanies`, `enabledCompanies`; unexported internals. Skipped D7 (reusing the `amazon.ts` country-code check) on purpose, because `isIsraelCountryCode` is broader. Verified via the main-session typecheck/vitest/build above.
- [x] (frontend) Same for `src/main/{index,ipc,companiesIpc,db,jobs}`, `src/preload`, `src/shared`, `src/renderer/src`. Done: removed deps `@radix-ui/react-slot`, `react-tabs`, `@electron-toolkit/preload`, `@types/node-cron`, `drizzle-kit` (+ `drizzle.config.ts`); deleted `separator.tsx`, `useCompanyNames`, `atsOfSource` and unused mac/duplicate icons; removed server-side workMode/company list filters and `JobStats.bySource` (the renderer filters client-side); de-exports; `Ats`/`ROLE_LABELS` dedupe; `useLegacyTable` migrated to `useTable` with a byte-identical sort-behavior golden (`e2e/table-sorting.spec.ts` + golden json, added by frontend; the test agent should review/adopt). Installer trimmed: better-sqlite3 deps/src/build and non-win32-x64 prebuilds excluded, `electronLanguages` en-US, d.ts/md excluded in node_modules. Typecheck/vitest/build verified by the main session; Playwright, dist and installer size agent-reported (see Status). Remaining lint: `react-hooks/refs` error at `JobTable.tsx` ~62 left as a false positive.
- [x] (test) Redundant/duplicate tests, stale comments, orphaned fixtures, e2e/test config. Done: stale comments fixed (incl. the `companiesIpc.test.ts` "BUG ... it.fails" note); ~10 duplicate tests merged with surviving tests named; shared helpers in `src/main/testing` (memDb, tempDirs, makeOldDb, rawJob, scoredJob, electron mock); renderer-filters test moved to `src/renderer/src/lib/filters.test.ts`; `tsconfig.e2e.json` + `typecheck:e2e` added (test agent edited `package.json` outside its lane, UNAPPROVED; see Notes); two loosened scoring rows re-pinned exactly after the main session objected. Verified by the main session (vitest/typecheck).
- [x] (orchestrator) DONE 2026-10-07 (user-approved, applied; docs reflect the post-cleanup state the code agents are producing, not yet re-verified against the final code). Rules and project docs redundancy/contradictions: `RULES.md`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `.claude/agents/*.md`, `.claude/skills/*/SKILL.md`, `docs/dashboard-spec.md` (outdated lines), stale PLAN.md notes. One source of truth per fact; remove duplication and contradictions; KEEP every hard rule (visitedAt invariant, delegation rule, lane rules, Electron-free DB layer, sandbox/contextIsolation, sources/secrets rules)
- [x] (job-search) Dev scripts: deleted `scripts/live-run.ts` and `scripts/probe-companies.ts`; KEPT `scripts/examples-add.ts` and `scripts/examples-report.ts` (back `npm run examples:*`).
- [x] (main session / test) Gate: `npm run typecheck`, `npx vitest run` (592 passing) and `npm run build` re-run and verified by the main session. `npx playwright test` 2/2, `npm run dist` and the unpacked smoke test are agent-reported by frontend, not re-run by the main session.

## Phase 9 — Docs

- [ ] (orchestrator) Final pass: reconcile every PLAN.md checkbox with what actually landed (verified vs agent-reported)
- [ ] (orchestrator) Re-check README, CLAUDE.md, AGENTS.md, RULES.md and the agent files against the final code (the Phase 9a doc pass already rewrote them for the Electron stack)

## Notes

- **Step 0 gate (passed, with one caveat).** All five agents (orchestrator, frontend, ui-ux, test, job-search) spawned and reported their lanes. The orchestrator's nested spawn of `test` launched without error, but its child's reply was not observed (subagent output files were 0 bytes), so nested delegation is launched-but-unverified. `orchestrator.md` was edited to add Write/Edit (scoped to PLAN.md/docs) and to replace the execute-directly fallback with stop-and-report.
- **Delegation rule:** if delegation fails, STOP and tell the user. Do not do the work directly or return a workaround plan.
- No `/design` skill exists; the ui-ux agent specs the design first (Phase 4), then frontend implements.
- Phase 8 is waiting on user-provided examples (job ids / URLs); intake tooling (`examples:add`, `examples:report`) is built and verified (see Phase 8).
- `npm audit` reports vulnerabilities, unaddressed.
- **Lane exception (Phase 3):** job-search made a narrow, user-sanctioned edit to `src/main/index.ts` (refresh wiring + scheduler start/stop), added `errors` to `RefreshResponse` in `src/shared/ipc.ts`, and added optional `seniority?` on `RawJob`.
- **Phase 3 NOT verified (scheduler):** the scheduler tick is untested live.
- **Phase 5 NOT verified:** real browser open (`openExternal` stubbed), physical Ctrl+R, packaged menu removal / `npm run dist`, an actual cron tick, pointer interaction with Radix dropdowns/Select, axe accessibility audit, skeleton loading state, 1600px max-width, screen-reader announcements.
- **Known issues / TODO (Phase 5):**
  1. Scoring false positive visible in UI: "Junior Business Developer" (sales-type role) scores 100 and tops New; the score doesn't use `roles` yet. Fix in Phase 8 with the user's labeled examples (consider requiring a software role tag).
  2. `useLegacyTable` from `@tanstack/react-table/legacy` is deprecated (v9); migrate to `useTable`/`tableFeatures`.
  3. A scheduled run that throws (non-source error) is only console-logged.
  4. `onOpen` depends on the useMutation result so columns rebuild each render (fine at ~70 rows).
  5. The frontend agent once used `taskkill /IM electron.exe` (kills the user's other Electron apps); now a rule in `RULES.md`/`AGENTS.md`.
  7. The agent reported replying to an "are you stuck?" message the main thread never sent; unexplained.
  8. The app's real userData DB now has an empty `meta` table from a dev run.
- **Phase 6 verified (main session):** `npx vitest run` = 11 files, 153 passed, 0 failing. e2e reported passing 1/1 by the agents (test, and frontend with `sandbox: true`); NOT re-run by the main session after the sandbox change.
- **Phase 6 NOT verified / open:** Ctrl+R and real navigation attempts in a packaged app (mocked only); tests encode CURRENT scoring behavior, not tuned (Phase 8); `e2e/` is not typechecked; sources/refresh/scheduler have mocked tests only, no live network tests; no mutation test of the visitedAt invariant. Earlier TODOs still open: `useLegacyTable`, scheduled-run crash surfacing, Junior Business Developer scoring false positive.
- **Phase 7 status:** installer builds and the unpacked packaged app is verified; the installed (NSIS) flow is unverified pending the user. Phase 7b (Israel-only, on-site/hybrid sources, remote boards removed) was inserted before Phase 8.
- **Phase 7 (earlier note):** items left unchecked until verified. The `sandbox: false` review item from Phase 2 is DONE (sandbox is now true).
- **Docs (2026-10-07, user-approved):** RULES.md (lane additions, lane-exception, migration, renderer-hardening, process, doc-edit and verified-vs-claimed rules), AGENTS.md, CLAUDE.md (now a pointer file), README.md, `docs/dashboard-spec.md`, `training-data/README.md`, the scoring SKILL.md trims and all five `.claude/agents/*.md` were rewritten for the Electron stack. Agent-file edits take effect after a Claude Code restart.
- **Approved Israeli boards:** SQLink only (see Phase 7b item 3). Hebrew boards (AllJobs/Drushim/JobMaster) are not built or approved.
- **Phase 9a sequencing:** Phase 7c (Google Jobs source, awaiting user key) and Phase 8 (relevance tuning, awaiting the user's examples) remain OPEN. The intern exclusion is now user-confirmed. If Phase 8 happens, run Phase 9a after it so the cleanup does not churn code that is about to change; Phase 9 (docs) stays last.
- **Git:** the project folder is now a git repository (`git init -b main` run by the main session on 2026-10-07, user-approved). A snapshot commit `3208d9a` exists; the Phase 9a cleanup changes (and the SQLink default-off change) are uncommitted. `.gitignore` gained `test-results/`, `playwright-report/`, `.claude/settings.local.json`. This resolves the earlier docs-analysis note that the docs assume git while the folder was not a repo.
- **Phase 9a out-of-lane files touched (per RULES.md):** test edited `package.json` (typecheck scripts), outside its lane and NOT approved; frontend edited `src/shared/roles.ts` (job-search lane, approved) and several tests (sanctioned); job-search edited `src/main/jobs/upsert.ts` (its own lane).
- **Still open overall:** installed (NSIS) flow only user-confirmed at a high level; uninstall, SmartScreen, code signing, custom icon; installer not yet rebuilt with the SQLink-off default (existing installs must untick SQLink manually until then); Phase 7c (waiting on the user's key); Phase 8 (waiting on the user's example jobs); Phase 9 final reconcile; agent-file edits need a Claude Code restart.
- **Phase 4:** ui-ux assumed score 0-100; job-search's scoring output confirms 0-100.
