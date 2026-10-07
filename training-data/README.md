# Training data

`examples.json` is a JSON array of labeled example jobs used to tune `src/main/scoring.ts` and `.claude/skills/job-relevance-scoring/SKILL.md` (few-shot reference, not ML training). The app works with the file empty (`[]`) or absent; `scoring.ts` never reads it.

`label` and `reason` are the USER's judgment. Tools never infer them: `examples:add` takes the label from `--label` (default `fit`, since the user supplies good jobs) and the reason only from `--reason`. Re-adding an existing job keeps its stored label/reason unless you pass the flags again.

## Entry schema

```json
{
  "id": "greenhouse:acme:123",
  "url": "https://boards.greenhouse.io/acme/jobs/123",
  "label": "fit",
  "reason": "optional, the user's own words",
  "source": "greenhouse:acme",
  "externalId": "123",
  "title": "Junior QA Engineer",
  "company": "Acme",
  "location": "Tel Aviv, Israel",
  "country": "IL",
  "city": "Tel Aviv",
  "workMode": "hybrid",
  "seniority": ["entry-level"],
  "postedAt": 1767225600000,
  "description": "stripped plain text",
  "experienceText": "sentences about experience (dev aid)",
  "fetchedAt": "2026-10-07T00:00:00.000Z",
  "via": "ats-api"
}
```

Required: `id, url, label ('fit'|'no-fit'), title, company, location, description, fetchedAt, via ('ats-api'|'jsonld'|'manual')`. Optional: `reason, source, externalId, country, city, workMode, seniority, postedAt, experienceText, needsText`. The optional structured fields let `examples:report` reproduce what ingestion would score and filter. `id` is `<source>:<externalId>` (same as the app's `jobs.source` + `external_id`) for ATS jobs, else `manual:<hash of the canonical URL>`. A `manual` entry with `needsText: true` is a stub that still needs the user's pasted job text (empty title/description allowed only for `manual`).

## Commands

`npm run examples:add` and `npm run examples:report` (flags: see `AGENTS.md`). `examples:report` scores every example with the current scoring (score, kept/rejected, rejection reasons, roles, experience wording) and lists mismatches first.

Sources: supported ATS job URLs use that ATS's public single-posting endpoint; other pages only when robots.txt allows and they carry JSON-LD `JobPosting`. LinkedIn, Indeed, Glassdoor and similar sites are NEVER fetched (RULES.md): a stub is written and the user pastes the job text (`--text-file`). Never put API keys in this file.
