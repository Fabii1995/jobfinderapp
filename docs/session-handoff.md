# Job Finder: session handoff (updated 2026-10-25, after commit e55f4a8; the docs commit follows)

Snapshot, not a rule file. Read RULES.md, AGENTS.md and PLAN.md first; they are the source of truth. No keys or secrets belong in this file.

## What the app is
Standalone Electron desktop app (Windows) listing junior / new-grad software jobs located in Israel (on-site or hybrid, never remote-only). Tabs: New, Visited, Companies. Stack, layout, commands and userData files: AGENTS.md.

## State right now
- Git: HEAD `e55f4a8` (Sort by: Recently added / Oldest added). Commits since `ad89561`: a6ce41a (Phase 9 docs), 5429da8 (PLAN e2e record), b2abe8d, d009bb1, c921074, e7953a8, 6a94ff0 (Deep search), fb67a92, d6e24e7 (company seeds), fbea7e6, e55f4a8 (Sort by). Only remote: `origin` https://github.com/Fabii1995/jobfinderapp (private). The docs edits for this snapshot are committed separately. Commit only when the user asks.
- Verified by the main session at e55f4a8: `npm run typecheck` 0 errors; `npx vitest run` 41 files / 1077 tests; e2e 3/3 (sort-by, table-sorting golden, visited-persistence).
- Installer: `release\job-finder-1.0.0-setup.exe`, 87,040,152 bytes (10/18 4:52 PM), unsigned, default icon. The user installed an EARLIER build and ran Deep search; this build was not re-installed. Existing installs keep SQLink enabled (seeded off only for fresh installs): untick it in the Companies tab.
- README screenshots (`docs/screenshots`) are being added separately; not part of this snapshot.

## Deep search (opt-in, Phase 7c/7d)
- JSearch (OpenWebNinja) primary, SerpApi (Google Jobs) fallback. Keys live only in userData `config.json` (`jsearchApiKey`, `serpapiApiKey`), entered in the Companies tab panel. Counters in `jsearch-state.json` / `serpapi-state.json`. User-stated plan limits: JSearch 200/month, SerpApi 250/month; the app blocks at those caps. Roughly weekly automatic run via a daily check, plus a manual "Deep refresh"; never on the 3 h cron.
- JSearch runs 6 queries (junior backend developer, junior QA engineer, junior python developer, graduate software engineer, graduate backend engineer, junior software engineer in Israel) and a page 2 for the last one only: up to 7 requests per run. The page-2 cursor field names are ASSUMED and UNVERIFIED live; if no cursor comes back, page 2 is skipped with a note.
- "Last run" shows per-reason drop counts; "Clear seen jobs" resets the seen lists; an in-memory "Recently dropped" list (max 100, not persisted) shows what was dropped and why. These were agent-reported builds with unit tests; the panel UI was not visually checked by the main session.
- Live results: JSearch ran for real and produced 3 new jobs (user-reported, earlier build). SerpApi never returned jobs live: UNPROVEN, stays a fallback. JSearch spent about 10 credits in testing before the counter existed, so the app may overspend slightly in that month.
- Listings from these APIs may link to LinkedIn; the app only stores and opens links, never fetches LinkedIn/Indeed/Glassdoor (RULES.md).

## Sources
54 seeded companies (53 enabled on fresh installs); new seeds merge into existing installs on startup. SQLink is seeded off: sqlink.com answers automated requests with a Cloudflare 403 challenge and the connector must never circumvent it. Removed: Arbeitnow, RemoteOK, Himalayas. HireMeTech and Hebrew boards not built. Users add companies by pasting a careers URL (Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Comeet); custom career sites are unreachable.

Company discovery (PDL probe, throwaway code outside the repo; the PDL file/rows are not in the repo and we did not read the PDL usage policy): the People Data Labs free Company dataset (5.8 GB CSV, 37M rows, 71,159 Israeli companies) was probed against Greenhouse/Ashby/SmartRecruiters/Lever. Probe 1 (4,055 Israeli tech companies, 11+ employees) found 40 boards with Israel jobs; probe 2 (8,529 global tech companies, 1,001+ employees, no Lever) found 27 matches, 20 new; no blocks/429/403. A dry run through the app's real connectors and scoring over 52 boards gave 5 boards / 6 passing jobs. Seeded: WeDev, TenenGroup, then 15 Israeli companies (Moon Active, Loora, Connecteam, Mixtiles, MyHeritage, Incrmntal, Stigg, QuantHealth, Beamup, accessiBe, Sweet Security, Kueez, Rapydo, Play-perfect, Oktopost). Open: a GitLab "Remote, Israel" listing passed the location filter (possible remote-only gap, unchecked); six boards had Israel jobs but none kept by `isKeepableLocation` (tlvtech, wmg, firstpointmobileguard, dueto, grafanalabs, snowflake), not investigated.

## Sort by
FilterBar select: Best match, Recently visited (Visited tab), Recently added (`firstSeenAt` desc), Oldest added, Newest posted, Oldest posted. Client-side (`lib/sort.ts`), session-only, not persisted. E2E: `e2e/sort-by.spec.ts`.

## Scoring
Authoritative: `src/main/scoring.ts` and `.claude/skills/job-relevance-scoring/SKILL.md`. User decisions: senior-type words in the title are an immediate reject; new grad counts, student/intern do not; a stated minimum of 2 years is penalized (-10, Phase 8), 3+ more heavily; MIN_SCORE 30 (`src/main/ingest/constants.ts`). Labeled examples: `training-data/examples.json` (user labels only; 12 as of d009bb1).

## Open / unverified
- Installed app: uninstall, SmartScreen, code signing, custom icon, the 3 h scheduled tick.
- SerpApi live yield; JSearch page-2 cursor names.
- `examples:add` on a single Comeet posting fails with "no Comeet configuration (comeetvar)"; an Indeed example was added without a title.
- Electron 39.8.10 `npm audit` advisories; upgrade to 44 is breaking, not done.
- Accessibility polish (not critical). Hebrew boards and HireMeTech not built.
- Cosmetic: the dropped-list text cut at 160 chars may end in a trailing space.
- Workday NVIDIA/Intel sometimes fail on a maintenance page (an outage, not a bug). Lever pace.
- Company discovery open questions (GitLab remote listing, six boards without a kept location) above.
- Connector fixtures never validated against real captured payloads; no renderer component tests; `JobTable.tsx` ~62 lint error is a React-compiler false positive.
- Further Phase 8 tuning waits on more user examples; QA/FDE coverage check still open.

## How we work (user preferences)
- All work goes through the project subagents (`orchestrator` is the only editor of PLAN.md and user-approved docs; `frontend`, `ui-ux`, `test`, `job-search`; lanes in RULES.md). If a subagent cannot be spawned: STOP and tell the user. Restart Claude Code so edited `.claude/agents/*.md` load.
- Keep "verified by main session" and "agent-reported" apart. Never weaken tests or rules; the `visitedAt` invariant is the most important one.
- Agents do not install the app, create accounts or get API keys. Kill only your own Electron process by PID. Do not touch `%APPDATA%\job-finder` without the user's say-so.
- Commit only when asked; never commit secrets.
