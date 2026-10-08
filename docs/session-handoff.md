# Job Finder: session handoff (updated 2026-10-08, after commit ad89561)

Snapshot, not a rule file. Read RULES.md, AGENTS.md and PLAN.md first; they are the source of truth. No keys or secrets belong in this file.

## What the app is
Standalone Electron desktop app (Windows) listing junior / new-grad software jobs located in Israel (on-site or hybrid, never remote-only). Tabs: New, Visited, Companies. Stack, layout, commands and userData files: AGENTS.md.

## State right now
- Git: last commit `ad89561` (Phase 8: 2-year-minimum penalty, 11 labeled examples). Only remote: `origin` https://github.com/Fabii1995/jobfinderapp (private). The Phase 9 docs edits are uncommitted. Commit only when the user asks.
- Verified by the main session on 2026-10-08 after `ad89561`: `npm run typecheck` clean; `npx vitest run` 33 files / 873 tests; `npm run build` ok; `npm run examples:report` 11 examples (6 fit, 5 no-fit), 0 mismatches.
- Installer rebuilt: `release\job-finder-1.0.0-setup.exe`, 87,034,696 bytes, unsigned, default icon. The user installed an EARLIER build from this session and ran Deep search (below). Existing installs keep SQLink enabled (seeded off only for fresh installs): untick it in the Companies tab.
- Not re-run since: Playwright e2e, the packaged smoke test.

## Deep search (opt-in, Phase 7c/7d)
- JSearch (OpenWebNinja) primary, SerpApi (Google Jobs) fallback. Keys live only in userData `config.json` (`jsearchApiKey`, `serpapiApiKey`), entered in the Companies tab panel. Counters in `jsearch-state.json` / `serpapi-state.json`. User-stated plan limits: JSearch 200/month, SerpApi 250/month; the app blocks at those caps. Roughly weekly automatic run via a daily check, plus a manual "Deep refresh"; never on the 3 h cron.
- Live results: JSearch ran for real and produced 3 new jobs. SerpApi with `location=Israel` (no `gl`) returned no results and no message: effectively UNPROVEN. It stays as a fallback; the user stopped spending SerpApi quota. The app's SerpApi counter showed 19/250 at one point. JSearch spent about 10 credits in testing before the counter existed, so the app may overspend slightly this month.
- Listings from these APIs may link to LinkedIn; the app only stores and opens links, never fetches LinkedIn/Indeed/Glassdoor (RULES.md).

## Sources
37 seeded companies (36 enabled on fresh installs). SQLink is seeded off: sqlink.com answers automated requests with a Cloudflare 403 challenge and the connector must never circumvent it. Removed: Arbeitnow, RemoteOK, Himalayas. HireMeTech and Hebrew boards not built. Users add companies by pasting a careers URL (Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Comeet); custom career sites are unreachable.

## Scoring
Authoritative: `src/main/scoring.ts` and `.claude/skills/job-relevance-scoring/SKILL.md`. User decisions: senior-type words in the title are an immediate reject; new grad counts, student/intern do not; a stated minimum of 2 years is penalized (-10, Phase 8), 3+ more heavily; MIN_SCORE 30 (`src/main/ingest/constants.ts`). Labeled examples: `training-data/examples.json` (user labels only).

## Open / unverified
- Installed app: uninstall, SmartScreen, code signing, custom icon, the 3 h scheduled tick, Ctrl+R.
- SerpApi live yield (above).
- `examples:add` on a single Comeet posting fails with "no Comeet configuration (comeetvar)"; an Indeed example was added without a title.
- Connector fixtures never validated against real captured payloads; no renderer component tests; `JobTable.tsx` ~62 lint error is a React-compiler false positive.
- Further Phase 8 tuning waits on more user examples; QA/FDE coverage check still open.

## How we work (user preferences)
- All work goes through the project subagents (`orchestrator` is the only editor of PLAN.md and user-approved docs; `frontend`, `ui-ux`, `test`, `job-search`; lanes in RULES.md). If a subagent cannot be spawned: STOP and tell the user. Restart Claude Code so edited `.claude/agents/*.md` load.
- Keep "verified by main session" and "agent-reported" apart. Never weaken tests or rules; the `visitedAt` invariant is the most important one.
- Agents do not install the app, create accounts or get API keys. Kill only your own Electron process by PID. Do not touch `%APPDATA%\job-finder` without the user's say-so.
- Commit only when asked; never commit secrets.
