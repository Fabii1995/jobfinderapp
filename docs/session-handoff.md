# Job Finder: session handoff (written 2026-10-08)

Paste this into a new Claude Code session to continue. Read RULES.md, AGENTS.md and PLAN.md first; they are the source of truth. This file is a snapshot, not a rule file.

## What the app is
Standalone Electron desktop app (Windows) that lists junior / new-grad software jobs located in **Israel** (on-site or hybrid, never remote-only). Tabs: New, Visited, Companies. Stack: Electron + electron-vite, React, TypeScript, Tailwind v4, shadcn/ui, TanStack Query/Table, Zustand, better-sqlite3 + Drizzle, node-cron (3 h), Vitest, Playwright-Electron, electron-builder (NSIS). Working root: `C:\JobFinderApp`. Data: `%APPDATA%\job-finder` (`jobfinder.db`, `companies.json`, `config.json`).

## State right now
- Git: `3208d9a` (initial snapshot) and `8492938` (Phase 9a cleanup, SQLink off by default, docs/rules). Working tree was clean before this file was added. Commit only when the user asks.
- Verified by the main session on 2026-10-08: `npm run typecheck` clean; `npx vitest run` 25 files / 594 tests passing.
- Agent-reported (not re-run by main): `npm run build`, `npx playwright test` (2 pass), `npm run dist`.
- Installer: `release\job-finder-1.0.0-setup.exe`, 87,023,385 bytes, unsigned, default icon. The user installed an earlier build and said "it works" (high level only). The user's installed copy still has the old defaults (SQLink enabled): untick it in the Companies tab, or reinstall.
- Live refresh in the packaged app (unpacked, throwaway data dir): about 13 jobs kept from about 1,900 fetched, no duplicates on re-refresh, `visitedAt` preserved across refresh and relaunch.

## Phases (see PLAN.md for the checkboxes)
Done: 0 to 7b, 9a (cleanup). Waiting on the user: **Phase 8** (relevance tuning: user will send good jobs as URLs, ids with the db path, or pasted text). **Phase 7c** (optional JSearch source): free-tier test DONE, connector NOT built, three decisions pending (below). **Phase 9**: final doc reconcile (re-check docs/dashboard-spec.md against final code), last.

## Sources
37 seeded companies, 36 enabled: Greenhouse (24), Workday (NVIDIA, Intel, Salesforce), Comeet (Pentera, Silverfort), Lever (Cloudinary, WalkMe), SmartRecruiters (Armis, ServiceNow), Ashby (Lemonade, Finout), Amazon Israel. **SQLink is seeded OFF**: sqlink.com answers every automated request (even robots.txt) with a Cloudflare challenge (403, `Cf-Mitigated: challenge`); the connector stops on 403 and must never circumvent it. HireMeTech not built (robots disallow /api/, data only via /api). LinkedIn/Indeed/Glassdoor: never scraped (RULES.md). Removed: Arbeitnow, RemoteOK, Himalayas. Users add companies by pasting a careers URL (Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Comeet); custom career sites (Wix, Monday.com, Check Point...) are unreachable.

## Scoring rules (user decisions; code authoritative: src/main/scoring.ts, SKILL.md)
Senior/Sr/staff/principal/lead/manager/director/architect (and Hebrew בכיר...) in the TITLE = score 0, immediate reject. New grad / graduate program counts as junior; student and intern roles do NOT (confirmed). "Associate" is a moderate signal. "1+ years" counts; "2+ years" is neutral; "3+" is penalized. A software-titled role with no experience stated gets a baseline (about 30 to 40). Hebrew titles and phrases supported. MIN_SCORE 30. Known soft spots: NVIDIA "Firmware SerDes Verification Engineer" (40), Amazon "Chip Validation Software Engineer" (40).

## Phase 7c: JSearch (OpenWebNinja) test results
- Key: in `%APPDATA%\job-finder\config.json` as `jsearchApiKey` (provisional format, nothing reads it yet). Never print it, log it, or put it in the repo. It also appeared in an earlier chat message: rotate if a transcript is shared.
- Quota: free plan is **200 requests/month, hard limit**. The test used 10, so **at most 190 remain**; no header or usage endpoint reports the true remainder (only the provider dashboard does).
- API: `GET https://api.openwebninja.com/jsearch/search-v2`, header `x-api-key`; `num_pages` costs one credit per page (always use 1); pagination via `cursor`; no `page` param. `job_requirements` filter had NO effect; `date_posted=month` leaked old postings (filter on `job_posted_at_datetime_utc` ourselves).
- Results: 100 rows, 79 unique, 23 kept, all 23 NEW vs our ATS jobs (0 overlap). About half real junior roles (e.g. Junior Backend Engineer at Fullpath 80, ERGO 70, inmanage 70; Junior Software Engineer at Bellboy Robotics and Infinity Labs 65); about 10 are baseline-30 noise on bare titles.
- Every result's publisher is LinkedIn, `job_apply_is_direct` false for all: links open LinkedIn pages (may need login). We would only store links and open them in the user's browser, never fetch LinkedIn.
- No structured seniority or work-arrangement fields; score from title/description only.
- Terms (public Terms of Use, 2026-09-14): use and storage of API data in your own product is allowed, no attribution; no reselling as a data product; no scraping their site. Publisher terms (LinkedIn) not read.
- Proposed design (not built): off by default, only active when a key is set; persisted monthly counter that blocks at about 150; 3 to 4 queries per run, 1 page each, results cached by `job_id`; run as manual "deep refresh" or about weekly (3 queries every 2 days is about 45 to 50 per month); on 401/403/429 disable until next month and show a message; require a junior signal so a bare score-30 does not keep a JSearch job; dedupe against ATS rows on normalized title + company; normalize multi-line titles.
- Scratch outputs (temporary job dir, may be gone): `C:\Users\Fabi\.claude\jobs\f0da06e8\tmp\jsearch\`.

## Decisions waiting on the user
1. Build the JSearch connector (opt-in extra)? Recommended yes.
2. Do LinkedIn-sourced listings via the API count as an "approved" source? (RULES.md currently says ATS endpoints and approved Israeli boards; needs a rule/PLAN.md note if yes.)
3. Frequency: manual deep refresh plus weekly, or manual only?
Also: the user's good-job examples (Phase 8), whether to rebuild the installer after any new code, and whether to commit.

## How we work (user preferences)
- All work goes through the project subagents: `orchestrator` (only editor of PLAN.md and user-approved docs), `frontend`, `ui-ux`, `test`, `job-search`; lanes in RULES.md. If a subagent cannot be spawned: STOP and tell the user (no workaround). **Restart Claude Code first** so the rewritten `.claude/agents/*.md` load.
- Wait for ALL running agents before acting on results. Re-verify agent claims yourself (typecheck, `npx vitest run`, build); keep "verified by main session" and "agent-reported" apart in PLAN.md. Be honest about what was not verified.
- No weakening of tests or rules; the `visitedAt` invariant (upsert never writes it; only `markVisited`, write-once) is the most important rule.
- Do not let agents install the app, create accounts, or get API keys; an agent attempt to install and touch `%APPDATA%\job-finder` was blocked by the auto-mode classifier. Kill only your own Electron process (never by image name). Do not touch `%APPDATA%\job-finder` without the user's say-so.
- Commit only when asked; never commit secrets (`.env` is git-ignored; the key is NOT in the repo).
- After any `shadcn add`: `grep -rn 'from "cn"' src` and `npm uninstall cn`.

## Commands
`npm run dev`, `npm run typecheck`, `npm test`, `npm run test:e2e` (builds first), `npm run build`, `npm run dist` (installer into `release/`), `npm run examples:add -- <url> --label fit` and `npm run examples:report` (Phase 8 intake; never fetches LinkedIn/Indeed/Glassdoor, user pastes text via `--text-file`).

## Known open items
Installed (NSIS) flow only confirmed by the user at a high level; uninstall, SmartScreen, code signing and a custom icon unverified; 3 h scheduled refresh and Ctrl+R not verified end to end; one unexplained extra visited row in a smoke run (code review says only a UI click can cause it; did not reproduce); `JobTable.tsx:~62` lint error is a React-compiler false positive; no tests for scheduler/shortcuts/refreshService; connector fixtures never checked against real captured payloads.
