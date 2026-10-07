@AGENTS.md

# Job Finder

Standalone Electron desktop app (not a web app) that surfaces junior/entry-level software jobs in Israel (QA, Backend, Python, AI Solutions, Forward Deployed, etc.), with a Visited tab.

- `AGENTS.md` - stack, layout, commands, gotchas.
- `RULES.md` - hard constraints (agent lanes, visitedAt preservation, sources/secrets). Read before touching ingestion or the DB schema.
- `PLAN.md` - living roadmap, owned by the Orchestrator agent.
- `.claude/agents/` - Orchestrator (boss), Frontend, UI/UX, Test, Job Search. Edits to these files take effect after a Claude Code restart.
- `.claude/skills/job-relevance-scoring/` - how "junior/entry-level fit" is decided; update together with `src/main/scoring.ts`.
