# Job Finder

Personal job-finder app for junior/entry-level/no-experience software roles (QA, Backend Dev, Python Developer, AI Solutions Engineer, Forward Deployed Engineer, etc.), with a Visited tab that durably tracks which jobs you've opened.

## Run it

```bash
npm install
npx prisma migrate dev   # first time only, creates prisma/dev.db
npm run dev              # http://localhost:3000
```

The app fetches jobs from three free, keyless sources (Arbeitnow, RemoteOK, Himalayas) via the "Refresh Jobs" button, and automatically every 3 hours while the dev/prod server is running (see `src/instrumentation.ts` / `src/lib/scheduler.ts`).

## Project structure & agentic workflow

See `CLAUDE.md` for the full map, `RULES.md` for hard constraints, and `PLAN.md` for the roadmap. This repo uses dedicated Claude Code agents (`.claude/agents/`) for orchestration, frontend, UI/UX, testing, and job-source maintenance.

## Optional: connect the Himalayas MCP server

Not required to run the app (it calls Himalayas's plain REST API at runtime), but useful for interactively exploring job data in a Claude Code session:

```bash
claude mcp add himalayas -s project -- npx -y mcp-remote https://mcp.himalayas.app/mcp
```

Free, no API key.

## Tests

```bash
npx vitest run
npx playwright test
```
