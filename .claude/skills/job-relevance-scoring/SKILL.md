---
name: job-relevance-scoring
description: How to decide whether a job posting is a junior/entry-level/no-experience fit for the target roles (QA, Backend Dev, Python Developer, AI Solutions Engineer, Forward Deployed Engineer, and similar software roles) in Israel. Load this before changing src/main/scoring.ts, roles.ts or location.ts.
---

# Job relevance scoring

Human-readable spec for `src/main/scoring.ts` (`scoreJob(raw: RawJob): number`, pure, integer 0-100). Keep the two in sync: if you change one, change the other. Keyword lists and `WEIGHTS` are exported constants; this document describes them, the code is authoritative for exact values.

## Pipeline order (src/main/ingest/refresh.ts)

1. Connector fetch per configured company (see Sources below).
2. **Location hard filter** (`src/main/location.ts`, `isKeepableLocation`): `country === 'IL'` and `workMode !== 'remote'`. Unknown work mode is kept. Not Israel (or country unknown) is dropped.
3. `scoreJob`, then drop `< MIN_SCORE` (30).
4. `classifyRoles`, then upsert.

## Location rules (location.ts)

- Israel is recognised ONLY by a country signal (the word "Israel"/"ישראל" in text, or a structured country exactly `IL`/`ISR`/`Israel`) or an allowlist of Israeli cities (English + Hebrew spellings). A bare `IL` token in free text is never a signal ("Chicago, IL" is Illinois; Amazon's "IL, Tel Aviv" matches through the city/`country_code: ISR`).
- Multi-location postings: kept if ANY listed location is in Israel; the city is the earliest-mentioned Israeli one. Workday multi-location postings ("5 Locations") qualify through the Israel location facet.
- Work mode: a structured workplace type wins (`Hybrid`/`On-site`/`Remote`/`flex`); else an `isRemote` flag; else text hints judged on the Israeli locations only ("Remote - Israel" = remote, "Tel Aviv; Remote (US)" is not); else `unknown`. Comeet `is_remote` is never used on its own (it is true for hybrid postings); `workplace_type` decides.

## Target roles

QA / QA Automation, Backend Developer, Python Developer, AI Solutions Engineer, Forward Deployed Engineer, and adjacent junior software roles (Software Engineer I, Associate Engineer, Graduate Software Engineer, Junior Developer, SDE...).

## Hard rejects (title only, checked first)

- **Senior titles score 0, unconditionally**, before any description/tag signal: senior, sr/sr., staff, principal, lead, manager, director, head of, vp, vice president, chief, architect, expert, engineer III/IV, Hebrew בכיר/בכירה/מנהל/ראש צוות/ארכיטקט. "0-2 years" or "no experience required" in the body, or an `entry-level` tag, never rescues it. Only the TITLE counts: "seniority" or "senior colleagues" in a body is irrelevant (whole-word title match only).
- **Intern / student titles are capped at `INTERN_TITLE_CAP` (20, below MIN_SCORE)** even if a junior/graduate word is present: intern, internship, student, working student, werkstudent, praktikum/praktikant, Hebrew סטודנט/מתמחה/התמחות; also the seniority tags `intern`/`internship` (Amazon `is_intern`, SmartRecruiters `internship`). **Confirmed by the user (2026-10-07):** intern/student roles do NOT count as junior (they are part-time or temporary placements, not the junior full-time roles the user wants). "students welcome" in a body is not penalized; "International"/"internal" do not match.

## How the score is built (additive, then capped/clamped to 0-100)

Role relevance (title):
- `+30` strong role keyword (`STRONG_ROLE_KEYWORDS`: qa, quality assurance, sdet, test automation, automation engineer, backend, python, solutions engineer, forward deployed, ..., Hebrew בודק תוכנה).
- `+20` general software keyword instead (`GENERAL_ROLE_KEYWORDS`: software engineer/developer, developer, SDE, full stack, devops, ml/ai engineer, **firmware, embedded software/developer, device/kernel driver(s), driver engineer/developer** (bare `driver` is NOT a keyword: "Delivery Driver"), Hebrew מפתח/ת, מהנדס/ת תוכנה, תוכניתן, מתכנת, ...). Hebrew gender markers are stripped from titles first (`normalizeTitle`: "בודק/ת תוכנה" -> "בודק תוכנה", "מפתח(ת)"). Title phrases like "business/sales/marketing developer|development" and "penetration tester" are removed first (not software). In hardware/chip titles (`HARDWARE_TITLE_RE`: physical design, ASIC, RTL, VLSI, IC, SoC, silicon, analog, FPGA, DFT, STA, hardware, RF, design automation...) the generic keywords backend/test engineer/automation engineer/tester are ignored ("Physical Design Backend Engineer" is not software backend), and the no-experience baseline below is withheld. The bare word `software` alone ("Software Sales/Support/Licensing") also never earns the baseline.
- `+5` strong keyword only in the description.
- No role keyword in the title: score capped at `NO_ROLE_TITLE_CAP` (25).
- General-role-only title (no strong keyword): score capped at `GENERAL_ROLE_ONLY_CAP` (65), so a junior Java/.NET developer passes MIN_SCORE but never ties with a junior QA/backend/Python title (which can reach 100).

Junior signals (best of title and description, plus a confirmation bonus):
- Title: `+40` for junior, jr, entry level, graduate, new grad, new college graduate, early career, trainee, apprentice, engineer I, level 1, Hebrew ג'וניור/מתחיל/**בוגר/ת/ים/התחלתי/ללא ניסיון** (the Hebrew graduate/beginner words count in the TITLE only; in a body "בוגר/ת תואר" just means "has a degree"). **New grad / graduate-program roles count as junior.** `+20` for "associate" (moderate signal).
- Description (`bodyJuniorStrength`), used even when the title has no junior word; points `+30` strong, `+20` moderate, `+8` weak:
  - strong: "no (prior/relevant) experience", "0 years of experience", "entry level" (not "not entry-level"), fresh/recent graduate, new grad, new college graduate, Hebrew ללא ניסיון / אין צורך בניסיון / לא נדרש ניסיון; a stated range starting at 0 or "up to N" with upper bound <= 2 (`0-2 years`, `0 to 1 years`, `up to 2 years`, Hebrew `0-2 שנות ניסיון`).
  - moderate: range 0-3 / "up to 3"; `1-2 years`; **a stated minimum of 1 (`1+ years`, `1 year of experience`, `at least 1 year`, Hebrew `שנה ניסיון`) when no larger minimum is stated anywhere in the posting**; the word "junior" describing the role ("junior position/role/developer").
  - **`2+ years` (and a bare `2 years of experience`) gives no junior bonus and no baseline, and is penalized `-10` when the title has no junior/associate marker** (see Experience penalties; user decision 2026-10-08).
  - weak: range 0-4/0-5, "up to 4/5"; `1-3 years`; a bare "junior" word.
  - "junior" must refer to the ROLE, not people supervised: it is ignored after mentor/coach/guide/support/manage/lead/train/help/work with... in the same clause, before plural people nouns (junior engineers/developers/colleagues), and in "junior and senior"/"from junior to senior".
- `+10` extra when both the title and a strong/moderate description agree.
- **No-experience baseline (`noExperienceBaseline` = 10, user decision):** a software-role title (strong keyword, or a general keyword other than bare `software`) whose posting states NO experience duration at all gets `max(titlePts, bodyPts, 10)`: not additive, not part of the confirmation bonus. A plain "Software Engineer" with no stated experience therefore scores exactly 30 (= MIN_SCORE); a plain strong title ("Backend Developer") 40; "Junior ..."/"Graduate ..." titles stay well above. Withheld when any duration is stated (parsed by `extractExperience` OR matched by the looser `EXPERIENCE_WORDING_RE`, e.g. "several years of experience"), for hardware titles, for mid/senior tags and `engineer II`. Senior titles are still 0, 3+ years still -25 (2 years: -10, see below), intern/student still capped at 20. Postings with no description at all count as "nothing stated".
- `+35` seniority tag `entry-level` (Workday workerSubType "New College Graduate" via a second Israel+subtype query, SmartRecruiters `entry_level`, Amazon `university_job`). Carried on `RawJob.seniority`, never persisted.

Experience penalties (`extractExperience`; ranges are consumed first so "0-3 years" is not read as "3 years"):
- `-25` when a stated minimum is >= 3 years ("3+ years", "3-5 years", "at least 4 years", "experience of 4 years", "5 years of ... experience" with up to 5 words in between, number words "three years"/"three-plus years", Hebrew "3+ שנות ניסיון", reversed "ניסיון של 3 שנים ומעלה", "שנתיים ניסיון", "שנה ניסיון", "שלוש שנות ניסיון"). "5 years ago" is ignored, and "N years ... user/customer/client/developer/candidate/employee experience" is a product phrase, not a requirement. The description window is the first 12000 characters.
- `-10` (`twoYearsBody`, user decision 2026-10-08) when the highest stated minimum is exactly 2 years ("2+ years", "at least 2 years", "2 years of experience", "2-4 years", Hebrew "שנתיים ניסיון"/"2 שנות ניסיון") AND the title has NO junior/graduate/entry/associate marker (the words that earn the +40/+20 title points; a junior title outweighs a 2-year mention, so it keeps the old behavior). It never stacks with the -25 (a 3+ minimum anywhere wins). Not penalized: `1+ years`, ranges with a lower bound under 2 ("0-2", "1-2", "up to 2"), and "2 years or less/fewer" (a ceiling). "2+ years or equivalent experience" IS penalized (a minimum is still stated). Why -10: a bare strong title (30) or a software title with a weak junior word (28-30) must fall below MIN_SCORE (30) with margin, while the two user-labeled no-fit examples requiring 2+ years drop to 20 and every labeled fit (none states a year minimum) is unaffected.
- `-10` tag `mid-level`; `-15` titles "engineer II"/"developer II"/"mid-level"; `-60` and cap 15 for a source tag senior/manager/director/executive.

Matching is case-insensitive on Unicode letter boundaries (`\p{L}\p{N}`), so Hebrew works and `intern` does not match "internal".

## Role classification (separate from the score)

`classifyRoles(job): Role[]` in `src/main/roles.ts` (import from `roles`; `scoring.ts` does not re-export it; `explainRoles` returns the same decision with evidence). Pure, multi-label, persisted in `jobs.roles`. Does NOT affect `scoreJob`/`MIN_SCORE`. Roles (`src/shared/roles.ts`): qa, backend, python, ai, forward-deployed, frontend, fullstack.

Precision over recall. A role counts when its keywords appear in the TITLE (always wins), or its BODY keywords appear at least `MIN_BODY_MENTIONS` (2) times in the first `BODY_SCAN_CHARS` after discarding non-evidence mentions: enumerated discipline lists, weak-keyword skill enumerations, "React Native", and for `ai` only the narrow `AI_BODY_KEYWORDS`. A title that names a non-frontend role (python/backend/qa/ai/forward-deployed) suppresses a body-only `frontend` tag (a Python backend job that merely repeats React/Angular is not frontend). "Penetration tester" is not QA. Hebrew keywords exist for QA/backend/python.

## Sources and ids

Company career pages via public ATS endpoints and one approved Israeli board (SQLink, seeded OFF by default since sqlink.com serves a Cloudflare challenge, HTTP 403, to automated requests; the connector stops on 403 and never bypasses it; the user can re-enable it in the Companies tab); one connector per company, configured in `<userData>/companies.json` (seeded on first run, never overwritten by upgrades). `jobs.source` = connector id = `<ats>:<identifier>` lowercased (`greenhouse:wizinc`, `lever:cloudinary`, `comeet:c5.00d` (company uid), `smartrecruiters:armis`, `ashby:<name>`, `workday:nvidia` (tenant), `amazon`); `externalId` is the ATS posting id (Workday: `externalPath`). `sqlink` (single instance, no params): see below.

## SQLink connector (`sources/sqlink.ts`, id `sqlink`)

Israeli tech recruiter. robots.txt allows `/` (only `/archive/` disallowed) and publishes `https://www.sqlink.com/sitemap/`; job pages are server-rendered HTML (no JSON endpoint, no JSON-LD). Its terms-of-use (תקנון שימוש) page could not be located, so no prohibition was found. The connector reads the sitemap once, keeps `/career/<cat>/<sub>/<slug>/` URLs modified within 90 days (old pages never disappear, `lastmod` is the only freshness signal), skips categories hardware/אלקטרוניקה/student, pre-filters on the decoded slug with `isHardRejectTitle` + `titleHasSoftwareRole`, fetches at most 150 pages sequentially >= 1 s apart, and throws on any 401/403/429/5xx or Cloudflare/CAPTCHA page (never retried or bypassed). Location: country `IL`, city only when an allowlisted city (Hebrew prefixes like ב/ל/מ accepted) appears in the first 400 chars, work mode `unknown` unless the text says hybrid/fully remote. `postedAt` = sitemap lastmod. Company is "SQLink" (clients are anonymous).
## JSearch connector (`sources/jsearch/`, id `jsearch`)

Opt-in "Deep search" aggregator (key `jsearchApiKey` in userData `config.json`), manual deep refresh or roughly weekly (daily-check cron calling `maybeRunWeekly`; the 3h refresh never calls it). A JSearch run sends 6 queries (junior backend developer, junior QA engineer, junior python developer, graduate software engineer, graduate backend engineer, junior software engineer; 1 page each = 6 requests); a SerpApi run sends 4. Monthly request counter in `jsearch-state.json`, blocked at `SOFT_LIMIT` 200 (the per-query `used >= cap` check truncates a run mid-way, so it never exceeds the cap). SerpApi (Google Jobs, id `serpapi`, key `serpapiApiKey`, counter `serpapi-state.json`, cap `SERPAPI_MONTHLY_CAP` 250) is the fallback: `selectProvider` picks it only when it is usable and JSearch is keyless, blocked or at >= `JSEARCH_FALLBACK_THRESHOLD` 170. Both share `finalizeJob` in `sources/jsearch/map.ts`: same location filter and `scoreJob`/`MIN_SCORE`, plus two extra rules: postings older than 45 days (`job_posted_at_datetime_utc`) are dropped, and a real junior signal is required (junior/entry title keyword, or a strong/moderate junior description), so the bare no-experience baseline (30) does not keep an aggregator job. Titles are whitespace-collapsed; rows duplicating a row from any other source on normalized title+company are skipped; known `job_id`s are not re-scored. Each run summary counts every fetched row exactly once: `fetched = seenSkipped + sum(dropped) + kept`, with `dropped` split into location, old, noJuniorSignal, scoreTooLow, duplicate, invalid (counts only are persisted). `clearSeen()` empties only the `seen` maps so the next run re-scores everything. SerpApi request params and response fields are assumed from docs and unverified against the live API.

## Where the cut-off lives

`MIN_SCORE = 30` in `src/main/ingest/constants.ts` (neutral module; `refresh.ts` re-exports it and `sources/jsearch/map.ts` imports it): one strong target-role title with no penalty, or a general software title plus a junior signal. Titles with no junior marker and a stated 2+ year minimum (-10) and bare general titles with a stated non-junior requirement (20; with no requirement stated they get the baseline and sit at 30), role-less junior postings (<= 25), interns (<= 20) and senior titles (0) fall below.

## Not used for scoring

Company name, salary, location and work mode (those are the ingest filter and UI filters, not relevance signals).

## Training data

`training-data/examples.json` holds the user's labeled examples; schema, commands and fetching rules are in `training-data/README.md`. Treat it as the source of truth for edge cases: adjust keyword lists, `WEIGHTS`, caps and `MIN_SCORE` to match. `scoring.ts` does not read the file and must keep working when it is empty or absent.
