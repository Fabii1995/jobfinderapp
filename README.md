# Job Finder

Personal Electron desktop app that surfaces junior/entry-level/no-experience software roles in Israel (on-site or hybrid; QA, Backend, Python, AI Solutions, Forward Deployed, etc.), with a Visited tab that durably tracks which jobs you've opened.

## Run it

```bash
npm install
npm run dev     # launches the Electron app with HMR
```

Jobs come from company career pages via public ATS endpoints (Greenhouse, Lever, Comeet, Ashby, SmartRecruiters, Workday, Amazon) plus SQLink (seeded off by default, blocked by Cloudflare). No API keys are needed for these. An optional "Deep search" (JSearch, with SerpApi as fallback) is off until you enter a free-tier key in the Companies tab. Click Refresh, or wait for the automatic refresh every 3 hours while the app is running. Manage the company list in the Companies tab (paste a careers-page URL to add one).

Windows installer: `npm run dist` writes it to `release/`.

## Project docs

See `AGENTS.md` for stack, layout and commands, `RULES.md` for hard constraints, and `PLAN.md` for the roadmap. This repo uses dedicated Claude Code agents (`.claude/agents/`) for orchestration, frontend, UI/UX, testing, and job-source maintenance.

## Tests

```bash
npm test          # Vitest
npm run test:e2e  # Playwright-Electron (builds first)
```
