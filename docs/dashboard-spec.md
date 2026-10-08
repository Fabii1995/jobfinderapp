# Job Finder - Dashboard Design Spec (Phase 4)

Owner: ui-ux. Implementer: frontend. Renderer code lives in `src/renderer/src/` (alias `@renderer/*`). Stack: Electron + React + Tailwind v4 + shadcn/ui (style `new-york`, base `neutral`, lucide icons) + TanStack Query/Table + Zustand. This is a desktop app: no routes, no scroll-the-page layout, no hover-only affordances.

Facts this spec is built on (see `src/shared/ipc.ts` and `src/main/db/schema.ts` for the exact types): a `Job` has `id, source, externalId, title?, company?, url, description?, location?, postedAt?, score?, roles, workMode?, firstSeenAt, visitedAt?` (timestamps are epoch ms; most listing fields are nullable). `jobs:list` returns New ordered by score desc then postedAt desc, Visited ordered by visitedAt desc. `jobs:stats` returns `{newCount, visitedCount, lastRefreshAt, lastRefresh}`; `jobs:companyCounts` returns job counts per company name. `jobs:refresh` returns `{inserted, updated, errors, sources}`. Scores are integers 0-100 (higher = better fit). Jobs are Israel-only, on-site or hybrid. A job's `source` is a company connector id (e.g. `greenhouse:acme`); the UI shows the company name.

---

## 1. Purpose and users

One person scanning quickly for junior / entry-level / no-experience software roles (QA, Backend, Python, AI Solutions, Forward Deployed...). Core loop: open app, glance at what is new, skim ranked rows, click one to read it in the browser, it drops into Visited, repeat. Success = under 5 seconds from launch to "I know whether there is anything worth opening".

- Window: default 1280x800, **min 900x600** (set `minWidth: 900, minHeight: 600` in the BrowserWindow in `src/main/index.ts` - frontend/main), resizable, maximizable.
- Themes: light and dark through the existing CSS variables in `assets/main.css` (`:root` and `.dark`). Never hardcode hex/oklch in components except the new tier tokens (3.5). The theme follows the OS by default (`prefers-color-scheme`), and a manual toggle in the header (`ThemeToggle`, `useTheme`, `store/theme.ts`) overrides it. The `dark` class on `<html>` carries the theme.
- Density: compact-comfortable. Body text `text-sm` (14px), meta `text-xs` (12px). Base font: system UI stack (Tailwind default `font-sans`).

## 2. Layout (app shell)

The shell is `h-screen flex flex-col overflow-hidden`. Only the job list region scrolls. Content width: `mx-auto w-full max-w-[1600px] px-6` (px-4 below 1100px).

```
+----------------------------------------------------------------+
| Header (h-14, border-b)                                        |
|  Job Finder              Last refreshed 12 min ago  [Refresh]  |
+----------------------------------------------------------------+
| [error/partial Alert, only when relevant]                      |
| Stats row (4 cards)                                            |
| Tabs: [New 24] [Visited 7]                                     |
| Filter bar: [search....] [Company v] [Work mode v] [Roles v] [Score v] x |
| "Showing 12 of 24"                                             |
| +------------------------------------------------------------+ |
| | sticky table header                                        | |
| | rows ... (this region scrolls: flex-1 min-h-0 overflow-y)  | |
| +------------------------------------------------------------+ |
+----------------------------------------------------------------+
```

### 2.1 Header
- `<header class="h-14 border-b bg-background">`; app title `<h1 class="text-base font-semibold">Job Finder</h1>` at left.
- Right side: `LastRefreshLabel` (`text-xs text-muted-foreground`, relative time via `Intl.RelativeTimeFormat`, re-rendered every 30 s, absolute time in a Tooltip; "Never refreshed" if null) then the Refresh button.
- **Refresh button** (shadcn `Button`, `size="sm"`, lucide `RefreshCw`):
  - idle: `variant="default"`, label "Refresh", icon static.
  - loading: `disabled`, `aria-busy="true"`, label "Refreshing...", icon `animate-spin motion-reduce:animate-none`. Also shows a 2px indeterminate bar under the header (`data-testid="refresh-progress"`, `h-0.5 bg-primary animate-pulse`, no layout shift: reserve the 2px always).
  - error (last refresh rejected or every source failed): `variant="outline"` with `border-destructive text-destructive`, icon `AlertCircle`, label "Retry refresh". Returns to idle on the next attempt.
  - Tooltip (add `tooltip`) shows shortcut "Ctrl+R".
- Single-flight: the button is disabled while `isPending`; main must also dedupe concurrent refreshes (scheduler + button) - see section 8.

### 2.2 Stats row
`<section aria-label="Summary" class="grid grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.6fr)] gap-3">`. Each is a shadcn `Card` with `py-3 gap-1 px-4` (override the default card padding); label `text-xs text-muted-foreground`, value `text-2xl font-semibold tabular-nums leading-none`.
1. **New** - `newCount`. Clicking switches to the New tab (card is a `button` wrapper, `focus-visible` ring).
2. **Visited** - `visitedCount`. Same, switches to Visited.
3. **Last refresh** - relative time as value (`text-lg`), under it `text-xs` "12 new, 3 updated" from `lastRefresh`.
4. **By company** - `jobs:companyCounts` rendered as wrapping chips (`Badge variant="outline"`, `name count`, e.g. "Acme 31"), top 8 by count desc plus a "+N more" note. Chips are toggle buttons that set the company filter (`aria-pressed`); a company selected in the filter bar stays visible. Caption "all jobs, new + visited" because the counts cover every row. A company whose last refresh failed shows a small `AlertTriangle` icon and a tooltip with the error.
- Stats data comes from `jobs:stats` and `jobs:companyCounts`. Skeleton (loading): same cards with `Skeleton h-7 w-12` values.
- Short windows (`@media (max-height: 700px)`): hide the card labels' caption lines and use `py-2`, value `text-xl`, so the list keeps at least ~300px at 600px window height.

### 2.3 Tabs
shadcn `Tabs` controlled by Zustand `activeTab` (`value={activeTab} onValueChange={setActiveTab}`), `TabsList` + three `TabsTrigger`s labelled "New", "Visited" and "Companies", each with a count `Badge variant="secondary"` (`tabular-nums`) from stats (Companies: configured company count). The Companies tab (`CompaniesPanel`) hides the stats row and filter bar; it has a paste-a-careers-URL form (URL + optional name), a list with an enable/disable toggle and a confirm-to-remove action per company, a per-company last-refresh failure summary, and an empty state. Removing a company keeps its already-stored jobs. Radix provides `role=tablist/tab` and `aria-selected`; do NOT add `aria-current` on top. Both tabs render the same `<JobList mode={tab}>`; only data and the visited-column differ (3.3). Shortcuts: Ctrl+1 New, Ctrl+2 Visited.

### 2.4 Filter bar
`<div role="search" class="flex flex-wrap items-center gap-2">`. Filters apply **client-side** to the already-fetched tab list (the dataset is hundreds of rows, not thousands) and apply identically to both tabs.
- **Search**: shadcn `Input` with leading `Search` icon, `w-72`, placeholder "Search title, company, location...", `aria-label="Search jobs"`, 150ms debounce, case-insensitive substring across title, company, location, description. Esc clears when focused. `/` focuses it (when no input is focused).
- **Company**: single-select `Select` ("All companies" + one item per company with its count, from `jobs:companyCounts`). A persisted company that no longer exists is ignored.
- **Work mode**: `Select`: All work modes, On-site, Hybrid, Unknown (remote-only jobs are never ingested). Jobs with no work mode count as Unknown.
- **Roles**: `DropdownMenu` + `DropdownMenuCheckboxItem`, trigger `variant="outline" size="sm"` "Roles" + count Badge when any selected. Options: QA / Test, Backend, Python, AI / ML, Forward Deployed, Frontend, Full-stack, matched against each job's `roles` tags. Selected roles combine with OR. Empty = all roles.
- **Min score**: shadcn `Select` with presets: Any, 30+, 50+, 70+ (the tier boundaries). `aria-label="Minimum score"`.
- **Clear filters**: `Button variant="ghost" size="sm"` with `X` icon, rendered only when something is active. Does not clear the Tab.
- Result line under the bar: `<p aria-live="polite" class="text-xs text-muted-foreground">Showing 12 of 24</p>`.

## 3. Job list

### 3.1 Table
TanStack Table (`useReactTable` with `getCoreRowModel`, `getSortedRowModel`, `getFilteredRowModel`) rendered with the existing shadcn `Table` primitives. Real `<table>/<thead>/<tbody>/<th scope="col">/<td>` - not divs. No pagination or virtualization in v1 (fine to a few thousand rows; revisit if over ~2000). Header is sticky: `sticky top-0 z-10 bg-background` on `<thead>`; scroll container is `flex-1 min-h-0 overflow-y-auto rounded-lg border`.

Columns (id: content, size, sortable):
| id | Content | Width | Sortable | Notes |
|---|---|---|---|---|
| `score` | Score badge | `w-20` | yes | numeric, null sorts as 0 |
| `job` | Title (button), company, meta line, excerpt | flex (`min-w-0`) | yes (by title, locale compare) | the shared card cell |
| `workMode` | On-site / Hybrid / Unknown, `text-xs` | `w-28` | yes | hidden < 1100px, folded into meta line |
| `location` | text `text-xs`, `truncate` | `w-40` | yes | hidden < 1100px, folded into meta line |
| `postedAt` | relative "3d ago", `title` = absolute date | `w-24` | yes | null shows "-" and sorts last |
| `visitedAt` | check icon + "2d ago" | `w-28` | yes | **Visited tab only** (`columnVisibility`) |

Sort behavior: header cell is a `button` (`aria-sort="ascending|descending|none"` on the `th`), lucide `ArrowUp/ArrowDown/ChevronsUpDown` icon, click cycles desc -> asc -> default. Sorting is client-side, held in local table state (not persisted), reset when the tab changes. Null values always sort last regardless of direction.
- **Default sort New:** score desc, then postedAt desc (matches `listJobs`; do not re-sort away from server order unless the user picks a column).
- **Default sort Visited:** visitedAt desc.

### 3.2 Shared row design (both tabs identical)
Row min-height 72px (`min-h-[72px]`), cell padding `px-3 py-2.5`, `align-top`, bottom border only (`border-b`), hover `hover:bg-muted/50`, row focus-within `bg-muted/50`. The `job` cell contains, stacked:
1. **Title** - the interactive element: `<button type="button" class="group inline-flex max-w-full items-center gap-1 text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">` with `<span class="truncate">title</span>` + `ExternalLink` icon (`size-3.5 text-muted-foreground shrink-0`) + `<span class="sr-only">(opens in your browser)</span>`. Fallback text "Untitled role".
2. **Meta line** `text-xs text-muted-foreground`: `company` (font-medium, `text-foreground/80`; fallback "Unknown company") then, separated by a middle dot (U+00B7), location and work mode when those columns are hidden.
3. **Excerpt** `text-xs text-muted-foreground` - rules in 3.6.
Clicking anywhere on the row behaves the same as the title button (row `onClick` calls the same handler; ignore clicks that originate on the button to avoid double-fire). The row has NO `tabIndex` - the title button is the single tab stop per row.

### 3.3 Click behavior and moving to Visited
- Click / Enter / Space on a row -> `useOpenJob().mutate(job)` -> renderer calls `window.api.open(job.id)` (IPC `jobs:open`, section 8). Main: loads the row by id, validates `url` parses as `http:` or `https:` only, calls `shell.openExternal(url)`, then calls `markVisited(db, id)` and returns the updated `Job`. The renderer never passes a URL, only the id. If the protocol is invalid or openExternal throws, nothing is marked visited and the renderer shows `toast.error("Couldn't open that link")`.
- Never render the URL as `<a href>` (Electron would navigate the app window). Main must also set `webContents.setWindowOpenHandler(() => ({ action: 'deny' }))` and block `will-navigate` (frontend/main).
- Optimistic update: on mutate, remove the row from the New list cache (`setQueryData`), increment/decrement stats; roll back on error; `onSettled` invalidate (see 7.2). Keyboard focus moves to the next row's title button (or the previous if last, or the search input if the list becomes empty).
- Feedback: `toast("Moved to Visited", { description: title })` (sonner, 3s) and a visually hidden live region announcement. No undo in v1 (RULES: `visitedAt` is write-once via `markVisited`; there is no unvisit path - do not add one without a rules change).
- In the **Visited** tab, clicking re-opens the URL; `markVisited` is idempotent so `visitedAt` does not change and the list order does not jump.

### 3.4 Visited rows appearance
Identical layout, density and score badge. Differences only: the extra `visitedAt` column (check icon `Check` + relative time, `text-muted-foreground`), and the title uses `font-medium` unchanged. Do NOT dim the whole row (muted-on-muted fails contrast). In the New tab the title is `text-foreground`; in Visited it is also `text-foreground` - the tab itself carries the meaning.

### 3.5 Score badge tiers
Component `ScoreBadge` (shadcn `Badge`, `tabular-nums`, min width `min-w-10`, shows the rounded integer; null shows "-" with `variant="outline"`). Constants in `lib/score.ts`:
```ts
export const SCORE_MAX = 100
export const TIERS = { strong: 70, possible: 40 } as const  // >=70 strong, 40-69 possible, <40 weak
```
| Tier | Range | Label (sr-only + tooltip) | Light mode | Dark mode |
|---|---|---|---|---|
| strong | >= 70 | "Strong match" | bg `--score-strong-bg`, fg `--score-strong-fg` | same vars, dark values |
| possible | 40-69 | "Possible match" | `--score-possible-*` | |
| weak | < 40 | "Weak match" | `--score-weak-*` (neutral, = `secondary`/`muted-foreground`) | |

Add to `main.css` (`:root` / `.dark`) and expose in `@theme inline` as `--color-score-strong-bg` etc. so classes are `bg-score-strong-bg text-score-strong-fg`:
```
:root  { --score-strong-bg: oklch(0.93 0.07 155); --score-strong-fg: oklch(0.35 0.09 155);
         --score-possible-bg: oklch(0.95 0.08 85); --score-possible-fg: oklch(0.40 0.09 70);
         --score-weak-bg: var(--secondary);        --score-weak-fg: var(--muted-foreground); }
.dark  { --score-strong-bg: oklch(0.32 0.07 155);  --score-strong-fg: oklch(0.90 0.10 155);
         --score-possible-bg: oklch(0.34 0.07 80); --score-possible-fg: oklch(0.92 0.09 85);
         --score-weak-bg: var(--secondary);        --score-weak-fg: var(--muted-foreground); }
```
These values are targets: frontend must verify each fg/bg pair is >= 4.5:1 (e.g. in devtools) and adjust lightness, not hue. Color is never the only signal: the number is visible and the tier word is in `aria-label="Score 82 of 100, strong match"` and the tooltip.

### 3.6 Description excerpt rules
- `description` may be HTML (RawJob says "plain text or sanitized HTML"). Util `toExcerpt(html)` in `lib/text.ts`: parse with `DOMParser`, take `textContent`, collapse whitespace, trim. **Never** use `dangerouslySetInnerHTML` anywhere.
- Display with `line-clamp-2` at >= 1100px width, `line-clamp-1` below. Hard-cap the string at 280 chars before rendering (cheap, avoids huge DOM). Null/empty description: render nothing (row stays >= 72px via min-height; no placeholder text).
- Excerpt is computed once per row via `useMemo`/column accessor, not on every render.

## 4. States

| State | Trigger | UI |
|---|---|---|
| **Initial loading** | list/stats query `isPending` | Stats: 4 skeleton cards. List: 8 `SkeletonRow`s (same 72px height and column widths; `Skeleton h-4 w-3/5` title, `h-3 w-2/5` meta, `h-3 w-4/5` excerpt, `h-6 w-10 rounded-full` score), container `aria-busy="true"`, `data-testid="skeleton-row"`. |
| **Mid-refresh** | refresh mutation pending | Keep current rows and stats on screen (do NOT swap to skeletons). Refresh button loading state + header progress bar. `placeholderData: keepPreviousData` on list queries. After success the rows re-sort in place; no flashing. |
| **Empty - never refreshed** | stats: `newCount===0 && visitedCount===0` and no last refresh | Centered in the list region: `Inbox` icon (`size-10 text-muted-foreground`), `h2` "No jobs yet", text "Run your first refresh to pull junior and entry-level roles in Israel from your companies' career pages.", primary `Button` "Refresh now" (same handler). Hide filter bar and stats values show 0. `data-testid="empty-never"`. |
| **Empty - New caught up** | New tab, `newCount===0`, `visitedCount>0` | `CheckCircle2` icon, "You're all caught up", "New roles appear after the next refresh (automatic every 3 hours).", secondary button "Refresh now". `empty-caught-up`. |
| **Empty - no filter match** | rows exist, filtered result is 0 | `SearchX` icon, "No jobs match your filters", list of active filters as removable chips, button "Clear filters". `empty-filtered`. |
| **Empty - zero visited** | Visited tab, `visitedCount===0` | `MousePointerClick` icon, "Nothing visited yet", "Open a job from the New tab and it will be saved here.", button "Go to New". `empty-visited`. |
| **Partial source failure** | refresh finished with >= 1 but not all sources failed | shadcn `Alert` (add `alert`) above stats, `variant="default"` with `AlertTriangle` (amber tier colors): title "Some sources failed", body "Acme: request timed out. Results from other sources were saved." one line per failed source, dismiss `X` button. Cleared on next fully/partly successful refresh. Plus a warning toast instead of the success toast. `data-testid="error-banner"`. |
| **Total failure** | refresh rejects or all sources failed | `Alert variant="destructive"` "Refresh failed", reason, `Retry` button. If rows exist: add "Showing results from {relative time}". If no rows at all: the `never refreshed` empty state is replaced by the same message (icon `CloudOff`). Refresh button goes to its error state. |
| **List query error** | `jobs:list` / `jobs:stats` reject | Inline destructive `Alert` in the list region with "Couldn't load jobs" + Retry (`refetch`). |
| **Refresh success** | mutation resolves, no errors | `toast.success("Refreshed", { description: "12 new, 3 updated" })`; if both 0: "Already up to date". |

## 5. Accessibility

- **Landmarks:** `<header>`, `<main>` (stats + tabs + list), `role="search"` on the filter bar, stats `<section aria-label="Summary">`. Exactly one `h1`; empty states use `h2`.
- **Tab order:** Refresh button -> stats card buttons -> tabs (Radix: arrow keys move between triggers, Tab leaves the tablist) -> search -> Company -> Work mode -> Roles -> Min score -> Clear -> table sort headers -> one title button per row. Visual order equals DOM order.
- **Rows:** Enter/Space on the title button activates (native `button`). ArrowDown/ArrowUp on a title button moves focus to the next/previous row's title button; Home/End jump to first/last. Do not hijack arrows inside inputs/menus.
- **Shortcuts** (global `keydown` in `useShortcuts`, ignored when typing in an input except Esc): `Ctrl+R` refresh (`preventDefault`; production build should remove the default Electron menu with `Menu.setApplicationMenu(null)` so it does not reload the page - in dev Ctrl+R reloads, acceptable), `Ctrl+1` / `Ctrl+2` tabs, `/` focus search. Show them in tooltips.
- **Focus ring:** every interactive element uses `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background`. Do not rely on shadcn's default `ring-[3px] ring-ring/50` alone (see contrast).
- **Live regions:** one app-level `<div role="status" aria-live="polite" class="sr-only">` fed by a store/ref: "Refreshing jobs...", "Refresh complete: 12 new, 3 updated", "Refresh failed: ...", "Moved {title} to Visited". Sonner toasts are also `role=status`, but keep the sr-only region as the source of truth (toasts can vanish). Error banner uses `role="alert"` (shadcn `Alert` default).
- **Tabs:** Radix sets `aria-selected` and roving tabindex; `TabsContent` gets `aria-label`. Counts are inside the trigger text so the accessible name is "New 24".
- **Table semantics:** `<th scope="col">`, sorted column has `aria-sort`, `<caption class="sr-only">New jobs, sorted by score</caption>` (update with tab/sort). Skeleton table has `aria-busy` and no row semantics for assistive tech (`aria-hidden` on skeleton rows).
- **Motion:** every `animate-*` also gets `motion-reduce:animate-none`.
- **Contrast notes against existing tokens (compute and confirm in devtools):**
  - `--muted-foreground` oklch(0.556) on `--background` white is ~4.7:1: passes AA for `text-xs` but with no margin. Do NOT use `text-muted-foreground/70` or opacity variants for text, and do not put muted text on `bg-muted`/`bg-muted/50` rows in light mode without checking (~4.3:1, borderline). If it fails, lower light `--muted-foreground` to oklch(0.5 0 0).
  - `--ring` light oklch(0.708) on white is ~2.6:1, below the 3:1 non-text minimum for focus indicators; shadcn defaults additionally use `/50` alpha. **Change `--ring` to oklch(0.55 0 0) (light) and oklch(0.7 0 0) (dark)** in `main.css` (lines 25 and 46) and use full-opacity rings as above.
  - `--border` dark `oklch(1 0 0 / 10%)` and `--input` dark `/ 15%` are below 3:1 against `--background`/`--card`; fine for decorative dividers, but the Input/Select/filter trigger borders must be visible: use `border-input` plus `dark:border-white/30` on those controls (or raise dark `--input` to `oklch(1 0 0 / 30%)`).
  - `--destructive` oklch(0.577 0.245 27) as text on white is ~4.6:1 (ok); in dark mode oklch(0.704...) on 0.145 is ~7:1 (ok). Destructive Badge uses white on `bg-destructive` - ok in light, uses `/60` in dark - verify.
  - Tier colors: verify per 3.5.

## 6. Responsive behavior (window width)

| Width | Layout |
|---|---|
| **900px** (min) | Padding `px-4`. Stats grid keeps 4 columns but values `text-xl`; company chips wrap to 2 lines max. Filter bar wraps to 2 rows (search full-width row, dropdowns second row). Table shows only `score`, `job`, `postedAt` (+`visitedAt` on Visited, replacing posted... both fit at `w-24`/`w-28`); work mode and location fold into the meta line; excerpt 1 line. Header: "Last refreshed" text hidden below 1000px, shown only inside the Refresh tooltip and the stats card. |
| **~1280px** | Default design. All columns visible, excerpt 2 lines, filter bar on one row, stats 4 columns. |
| **Maximized (1600px+)** | Content capped at `max-w-[1600px]` and centered; extra width goes to the `job` column (flex). Do not scale font sizes. Row height unchanged. |
| **Short heights (<= 700px)** | Stats cards go compact (2.2). Only the list region scrolls; header, stats, tabs, filters stay fixed. Never allow body scroll (`overflow-hidden` on root). |

Implement column hiding with TanStack `columnVisibility` driven by a `useWindowWidth()` hook (breakpoints: `<1100` compact, `>=1100` full), not CSS `hidden`, so hidden cells are not in the accessibility tree.

## 7. Components and code structure

### 7.1 shadcn components
Existing (keep): `button`, `card`, `tabs`, `badge`, `skeleton`, `table`.
Add (exact `npx shadcn@latest add ...` names): `input`, `select`, `dropdown-menu`, `sonner`, `tooltip`, `alert`. Also add dependency `lucide-react` if missing. Mount `<Toaster richColors closeButton />` once in `App.tsx`, wrap the app in `<TooltipProvider>`. Do not add `dialog`, `sheet`, `slider`, `checkbox` in v1.

### 7.2 File breakdown (`src/renderer/src/`)
```
App.tsx                      providers (QueryClientProvider, TooltipProvider), <AppShell/>, <Toaster/>
main.tsx
components/
  layout/AppShell.tsx        h-screen flex column, a11y live region
  layout/Header.tsx          title, LastRefreshLabel, RefreshButton
  layout/RefreshButton.tsx
  stats/StatsRow.tsx         (stat cards + company chips)
  filters/FilterBar.tsx      MultiSelectMenu.tsx (roles)
  companies/CompaniesPanel.tsx
  ThemeToggle.tsx
  jobs/JobTabs.tsx           tabs + counts
  jobs/JobList.tsx           table container, state switch (loading/empty/error/rows)
  jobs/columns.tsx           TanStack ColumnDef[] (single definition, both tabs)
  jobs/JobCell.tsx           title button + meta + excerpt (the shared card)
  jobs/ScoreBadge.tsx
  jobs/SkeletonRows.tsx
  jobs/EmptyState.tsx        variants: never | caughtUp | filtered | visited
  feedback/ErrorBanner.tsx   partial + total failure Alerts
  ui/                        shadcn (generated)
hooks/
  useJobs.ts                 useJobsQuery(visited), useStatsQuery()
  useRefreshJobs.ts          useOpenJob.ts
  (filters are applied by the pure `applyFilters` in lib/filters.ts)
  useCompanies.ts  useAppEvents.ts  useWindowWidth.ts  useTheme.ts  useNow.ts (30s tick)
lib/
  utils.ts (cn)  score.ts  text.ts (toExcerpt)  time.ts (relative/absolute)  filters.ts  types.ts
store/ui.ts                  existing, extended below
```

### 7.3 TanStack Query hooks and invalidation
Keys: `['jobs','list',{visited:false}]`, `['jobs','list',{visited:true}]`, `['jobs','stats']`.
- `useJobsQuery(visited)`: `queryFn: () => window.api.list({visited})`, `placeholderData: keepPreviousData`, `staleTime: 30_000`, `refetchOnWindowFocus: true`.
- `useStatsQuery()`: same options. Scheduler-driven refreshes show up through the `jobs:changed` push (section 8), which invalidates `['jobs']`.
- `useRefreshJobs()`: mutation -> `window.api.refresh()`. `onSuccess`: `invalidateQueries({queryKey:['jobs']})` (all three), set `lastRefreshErrors` (from response), toast. `onError`: error banner + button error state. Never optimistic.
- `useOpenJob()`: mutation -> `window.api.open(id)`. `onMutate`: cancel `['jobs']`, snapshot, remove from New list cache, adjust stats counts. `onError`: restore snapshot + error toast. `onSettled`: invalidate `['jobs','list']` (both) and `['jobs','stats']`.
- `jobs:visit` stays in the API but the renderer uses `jobs:open`; `visit` is only for a possible future "mark as visited without opening".

### 7.4 Zustand store (`store/ui.ts`)
```ts
interface UiState {
  activeTab: 'new' | 'visited'           // not persisted (always opens on New)
  search: string                          // not persisted
  filters: { company: string | null; workMode: 'all' | 'onsite' | 'hybrid' | 'unknown'; roles: Role[]; minScore: 0 | 30 | 50 | 70 }  // PERSISTED
  refreshErrors: { source: string; message: string }[]   // not persisted
  bannerDismissed: boolean                // not persisted
  announce: string                        // not persisted, feeds the sr-only live region
  setActiveTab / setSearch / setCompany / setWorkMode / toggleRole / setMinScore / clearFilters / dismissBanner / setAnnounce
}
```
`activeTab` also includes `'companies'`.
Persist with `zustand/middleware` `persist`, name `'jobfinder-ui-v1'`, `partialize: s => ({ filters: s.filters })`, localStorage (Electron renderer). A persisted company that no longer exists is ignored at filter time, not an error. `clearFilters` also clears `search`.

## 8. IPC contract (implemented)

The data and IPC gaps this spec originally listed are implemented; the contract is `src/shared/ipc.ts`. Behavior the UI relies on: `jobs:open` takes a job id only and opens only http/https URLs, then marks the job visited (rejects without visiting otherwise); `jobs:refresh` returns per-source outcomes and a single-flight wrapper dedupes cron and button refreshes; the last refresh summary is persisted and returned in `jobs:stats` (`lastRefresh`, with `lastRefreshAt` the true refresh time); jobs carry `roles` tags and `workMode`; `jobs:changed` is pushed to the renderer after every refresh (including cron). Posted age is derived in the renderer from `postedAt` (null shows "-"). Sources strip HTML from descriptions and the renderer still strips tags defensively (3.6).

## 9. Acceptance checklist (for Playwright-Electron)

Use a seeded temp DB (mix of companies, scores 10/45/85, null title/postedAt/score rows, one HTML description, 2 visited rows) and a stub refresh. Required `data-testid`s: `refresh-button`, `refresh-progress`, `last-refresh`, `stat-new`, `stat-visited`, `stat-company-<name>`, `tab-new`, `tab-visited`, `search-input`, `filter-company`, `filter-work-mode`, `filter-roles`, `filter-min-score`, `clear-filters`, `result-count`, `job-row`, `job-open-<id>`, `score-badge`, `skeleton-row`, `error-banner`, `empty-never|empty-caught-up|empty-filtered|empty-visited`.

Layout and tabs
- [ ] Window opens with min size 900x600 and cannot be resized smaller.
- [ ] Header shows "Job Finder", last-refresh label ("Never refreshed" on empty DB) and Refresh button.
- [ ] Stats show New, Visited, per-company chips and last refresh, values match the seeded DB (`stat-new` equals the number of `job-row`s on New with no filters).
- [ ] New tab is active on launch; `tab-new` has `aria-selected="true"`, `tab-visited` false; Ctrl+2 switches and flips the attributes.
- [ ] Both tabs render rows with the same column set except the extra visited column on Visited.
Rows and sorting
- [ ] New default order is score desc then posted desc; Visited default is visitedAt desc.
- [ ] Clicking the Score header sorts asc, again desc, again returns to default; `th` has matching `aria-sort`.
- [ ] Null score/title/postedAt rows render "-", "Untitled role" and sort last without errors.
- [ ] Score badge tier: 85 strong, 45 possible, 10 weak (check `aria-label`), >= 4.5:1 contrast (axe) in light and dark.
- [ ] Excerpt is plain text (no `<` tags in text content), clamped to 2 lines at 1280px and 1 line at 900px, and a `<script>` in a seeded description does not execute.
Open / visit
- [ ] Clicking a row calls `jobs:open` (stub `shell.openExternal`), the row leaves New, appears first in Visited, counts update (New -1, Visited +1), toast "Moved to Visited" shows.
- [ ] A seeded job with a `javascript:` or `file:` url is not opened and not marked visited; error toast shown.
- [ ] Enter and Space on a focused title button open the job; focus lands on the next row.
- [ ] Relaunch against the same DB: visited rows still in Visited; after a stub refresh that re-upserts them they remain Visited (invariant from RULES.md).
- [ ] Clicking a Visited row does not change its `visitedAt` or its position.
Filters
- [ ] Search narrows rows live (debounced) and updates `result-count`; Esc clears.
- [ ] Company, work mode, role multi-select and min score 70+ combine with AND; filters apply to both tabs; Clear filters restores all.
- [ ] Filters (not search, not active tab) persist across relaunch.
States
- [ ] Empty DB: `empty-never` with a working "Refresh now" button; filter bar hidden.
- [ ] Zero visited: `empty-visited` with "Go to New". All visited: `empty-caught-up`. Impossible search: `empty-filtered` with Clear filters.
- [ ] Initial load shows 8 `skeleton-row`s (delay IPC to assert), then rows.
- [ ] During a delayed refresh: button disabled, `aria-busy="true"`, label "Refreshing...", `refresh-progress` visible, existing rows remain, no skeleton rows.
- [ ] Successful refresh shows toast with inserted/updated counts and updates stats; 0/0 shows "Already up to date".
- [ ] Refresh with one failed source: `error-banner` names that source, other results saved, dismissible. All sources failed or IPC rejects: destructive alert, button shows "Retry refresh", rows from before are still shown.
Accessibility
- [ ] Tab order matches 5 (header -> stats -> tabs -> filters -> sort headers -> rows); every focused element shows a visible focus ring (screenshot diff, ring contrast >= 3:1).
- [ ] ArrowDown/Up move focus between row title buttons; `/` focuses search; Ctrl+R triggers refresh (production build menu removed).
- [ ] `role="status"` live region text updates on refresh start, finish and visit.
- [ ] Table uses `table/thead/th[scope=col]/tbody/tr/td`; axe-core reports 0 serious/critical violations in light and dark, at 900x600, 1280x800 and maximized.
- [ ] Responsive: at 900 wide Work mode and Location columns are absent and no horizontal scroll; at 1280 all columns present; maximized content stays <= 1600px wide and centered; at 900x600 the list region scrolls and the page body does not.
- [ ] `prefers-color-scheme: dark` flips `html.dark`; `prefers-reduced-motion` stops spinner animation.

---

## 10. Deep search (JSearch + SerpApi backup), opt-in settings

Owner: ui-ux. Implementer: frontend (implemented: `components/companies/DeepSearchPanel.tsx`, `hooks/useDeepSearch.ts`, `lib/jsearch.ts`). Approved by RULES.md "Sources and secrets" (JSearch exception). Deep search is an optional extra: off until the user enters a key, never on the 3h refresh, ~weekly automatic run plus manual "Deep refresh". Two providers: **JSearch (OpenWebNinja)** is preferred; **SerpApi (Google Jobs)** is an optional backup. Reuse existing primitives only (bordered section, `Input`, `Button`, `Alert`, `Badge`, `Skeleton`, sonner); no `dialog`, `progress` or `collapsible` (the progress bars are styled `div`s, 10.4).

### 10.1 Placement and header
A panel at the top of the Companies tab, directly above `AddCompanyBox` in `CompaniesPanel` (no dialog: excluded in 7.1, hides state, header is crowded at 900px). `<section aria-labelledby="deep-search-title" aria-busy data-testid="deepsearch" class="flex flex-col gap-3 rounded-lg border p-3">`, `h3 text-sm font-semibold` **"Deep search"**, right-aligned status `Badge variant="outline"`. Badge states (text is the state, never color alone):

| Badge | When |
|---|---|
| Off | neither provider has a key |
| On: JSearch | a key exists and `activeProvider === 'jsearch'` |
| On: SerpApi | a key exists and `activeProvider === 'serpapi'` |
| On | a key exists but `activeProvider === 'none'` and nothing is blocked (monthly limits reached) |
| Paused (`AlertTriangle`) | `activeProvider === 'none'` and either provider is blocked |

While one provider is paused but the other serves, the badge shows the serving one and the paused provider's alert (10.4) shows in its section. Below the title row: the explainer (10.3), then the controls: JSearch section, SerpApi section, run row, last-run line. The panel scrolls with the tab content (one scroller on the `CompaniesPanel` wrapper).

### 10.2 Data and actions
`JSearchStatus` (`src/shared/jsearch.ts`, never contains keys): flat fields are JSearch's own `{configured, used, softLimit, month 'YYYY-MM' UTC, blocked, blockedReason, blockedUntil ISO, lastRunAt ISO, lastRunSummary {fetched, kept, inserted, updated, skippedDuplicates, requests, provider?}}` plus `serpapi {configured, used, cap, blocked, blockedReason, blockedUntil}`, `fallbackThreshold`, `activeProvider 'jsearch'|'serpapi'|'none'`. **All limits come from status; the UI hard-codes none.** Current values: JSearch app limit (`softLimit`) 200 (the user's plan), fallback threshold 170, SerpApi `cap` 250 (user-confirmed). Actions: `setKey/clearKey`, `setSerpapiKey/clearSerpapiKey` (return `{ok:true}|{ok:false,error}`; max length 256), `deepRefresh() -> {ok, message, summary?, provider?}`. Query key `['deepSearch','status']`; every mutation invalidates it, and a deep refresh also invalidates jobs. The UI never receives a key.

### 10.3 Explainer and fallback behavior
Explainer (`text-xs text-muted-foreground`, always visible, it is the consent text): "Optional. Adds extra junior roles found through the JSearch (OpenWebNinja) service using your own free API key. Many results are LinkedIn links: the app only saves the link and opens it in your browser (LinkedIn may ask you to sign in). It never loads or reads LinkedIn itself. Runs about weekly and when you press Deep refresh, not on the 3-hour refresh. Your keys are stored only on this computer." The SerpApi section has its own note: "SerpApi (Google Jobs) is an optional backup with its own free key. The app uses it only when JSearch is near its monthly limit, paused, or has no key. It also saves links only."

Provider selection (main decides, UI only displays `activeProvider`): JSearch is preferred. SerpApi is used only when it is usable (key, not paused, under its cap) AND JSearch is keyless, paused (401/403/429), or has >= 170 requests used (or is at its limit). Exactly one provider per run. **Shared run state:** last run and the 7-day automatic gate are shared; a run by either provider updates "Last run" and restarts the 7-day gate. Saving a DIFFERENT key for a provider lifts that provider's block but keeps its monthly counter, so the cap still applies after a key swap.

### 10.4 Provider sections
Two `<section aria-labelledby>` blocks with `h4 text-xs font-semibold`: **"JSearch (OpenWebNinja)"** and **"SerpApi (Google Jobs), backup"** (the latter followed by its note). Each contains, in order:
- **Key controls.** No key: text "No key" then `<form noValidate>` with visible `<label>` "{JSearch|SerpApi} API key" wrapping `Input type=password autoComplete=off spellCheck=false autoCapitalize=off maxLength=256 h-8` (no Show toggle), Save button "Save key" ("Saving..." pending; disabled when trimmed empty/pending), and an always-rendered `<p role="alert">` below (`aria-describedby` target) for `{ok:false}` errors (`aria-invalid`, typed value kept). On success the input state is cleared immediately and a `role="status"` notice "Key saved." shows; the key is never echoed, logged or toasted. Key set: `Check` + "Key set", `Replace key` (`outline`, `default` when that provider is blocked so it is the visible next step) and `Remove key` (`ghost`). Replace swaps in the same form with autofocus plus Cancel; Esc cancels (only in Replace mode). Remove is an inline confirm: "Saved jobs stay." + destructive `Remove` + `Cancel`; then notice "Key removed. {name} is off."
- **Alerts (only when configured).** Paused: `Alert` (`AlertTriangle`) title "{name} is paused", description = reason, then "It turns back on {date}." (`blockedUntil` formatted `dateStyle:'medium'`, absolute time in `title`) or "It will retry on the next scheduled run." when null/past; `data-testid="deepsearch[-serpapi]-blocked"`. Limit: title "{name}: monthly limit reached", description "Available again on {reset date}." (`...-limit`). Paused takes precedence over limit.
- **Quota (only when configured).** "**{used} / {limit} this month** Resets on {date}." (reset date = first of next UTC month, UTC date). JSearch limit = `softLimit`, SerpApi limit = `serpapi.cap`; the SerpApi line adds "Takes over when JSearch reaches {fallbackThreshold}." Bar: `role="progressbar"` `aria-label` **"JSearch monthly requests"** / **"SerpApi monthly searches"**, `aria-valuemin 0`, `aria-valuemax {limit}`, `aria-valuenow min(used,limit)`, `aria-valuetext "{used} of {limit} requests used this month"`, `h-1.5 rounded-full bg-secondary`; fill `bg-primary` < 80%, `bg-score-possible-fg` 80-99%, `bg-destructive` >= 100% (clamped; text keeps the real number); `transition-[width] motion-reduce:transition-none`. testids `deepsearch-quota`, `deepsearch-serpapi-quota`.

### 10.5 Deep refresh and hint
Run row: `Button size="sm"` `data-testid="deepsearch-run"` "Deep refresh" (`Radar`), always rendered (also with no key), disabled when `activeProvider === 'none'` or running; `aria-describedby="deepsearch-run-hint"`; running: `aria-busy`, "Deep refreshing...", `Loader2` `animate-spin motion-reduce:animate-none`. Next to it a `role="status"` hint (always visible text, not tooltip):
- running: "Searching, this can take a minute."
- JSearch active: "Next run uses JSearch."
- SerpApi active: "Next run uses SerpApi (Google Jobs) because {JSearch has no key | JSearch is paused | JSearch reached its monthly limit | JSearch is near its monthly limit (N of 170 used)}."
- none, no keys: "Add a key to use Deep refresh."
- none, any provider paused: "Paused, see above."
- none otherwise: "No search available: monthly limits reached. Available again {reset date}."
A failed run shows an inline `role="alert"` line with the message (cleared on the next run).

### 10.6 Last run and toasts
`<p data-testid="deepsearch-last-run" class="text-xs text-muted-foreground">`: "Last run {relative, absolute in title} via {JSearch|SerpApi}: {fetched} found, {kept} kept, {inserted} new, {updated} updated, {skippedDuplicates} already known, {requests} requests." (" via ..." omitted for old summaries without `provider`, falling back to the provider of this session's run). No run: "Not run yet." Always followed by "Also runs about once a week automatically. It does not run on the 3-hour refresh." Counts wrap at 900px, never truncate.
Toasts (sonner) and the sr-only live region (`setAnnounce`): success `toast.success("Deep refresh done via {provider}", {description: "{inserted} new, {updated} updated ({requests} requests used)"})`, or description "No new jobs found" when 0 new and 0 updated; failure `toast.error("Deep refresh failed", {description: message})`; live region "Deep refresh complete via {provider}: ..." / "Deep refresh failed: ...". Keys are never in a toast.

### 10.7 Deep-search jobs in the lists
Same row design and density in New and Visited (3.2), no extra columns. In the `JobCell` meta line, after the company, a `Badge variant="outline" px-1.5 py-0 text-[11px] font-normal` `data-testid="via-badge"`:
- **"via LinkedIn"** only when the job URL host is linkedin.com (any provider);
- else **"via Google Jobs"** for SerpApi rows;
- else **"via JSearch"** for JSearch rows.
`title` is "Found through {provider}." (+ " Opens a LinkedIn page in your browser; you may need to sign in." for LinkedIn). The title button's sr-only text is "(opens LinkedIn in your browser, sign-in may be required)" for LinkedIn rows, "(opens in your browser)" otherwise. The sign-in caveat is not tooltip-only: it is in the explainer and (first LinkedIn open per session) the "Moved to Visited" toast description. These rows have no connector, so no per-company failure icon.


### 10.8 States summary
| State | UI |
|---|---|
| Status loading | Title + badge skeleton (`Skeleton h-5 w-12`), explainer visible, one `Skeleton h-8 w-full` in place of controls, `aria-busy="true"` on the section |
| No keys | Badge "Off"; both sections show "No key" + form; no quota/alerts; Deep refresh disabled, hint "Add a key to use Deep refresh." |
| JSearch key only, never run | "On: JSearch", quota 0 / 200, hint "Next run uses JSearch.", "Not run yet." |
| SerpApi key only | "On: SerpApi", hint "Next run uses SerpApi (Google Jobs) because JSearch has no key." |
| JSearch >= 170 and SerpApi usable | "On: SerpApi", hint "...because JSearch is near its monthly limit (N of 170 used)." |
| One provider paused, other usable | Paused alert in that section; badge shows the serving provider |
| Both paused, or one paused and the other at limit | Badge "Paused", run disabled, hint "Paused, see above." |
| Both at limit | Badge "On", limit alerts, run disabled, hint "No search available: monthly limits reached. Available again {date}." |
| Running | Button `aria-busy`, spinner, hint "Searching, this can take a minute."; status refetched on finish |
| Status query error | Destructive `Alert` "Couldn't load Deep search status" + Retry (`refetch`); controls hidden |
| Action error | `role="alert"` line + toast; controls remain |

### 10.9 Accessibility, keyboard, theme, narrow widths
- Landmark: `<section aria-labelledby>` per panel and per provider; `h3` then `h4`. Tab order: JSearch key input -> Save (or Replace/Remove) -> SerpApi key controls -> Deep refresh -> remaining Companies content. Control names must be unique across the two sections (the provider name is in the accessible name) and must contain their visible text (WCAG 2.5.3). Visual order equals DOM order. Enter in the key input submits the form. Every button uses the shared focus ring (section 5). The key input needs a visible `<label>` (not placeholder-only); all status/notice texts use `role="status"` (ok) or `role="alert"` (error) with stable container IDs referenced by `aria-describedby`, same as `add-company-notice`.
- The password field must keep the dark border fix from section 5 (`border-input dark:border-white/30`). All colors via tokens; amber for warnings uses existing `score-possible-*` tokens; quota fill colors verified >= 3:1 against `bg-secondary` in both themes (non-text contrast), text >= 4.5:1.
- Narrow (900px min): panel is full width, rows use `flex-wrap` so Save/Deep refresh drop below the input; input `min-w-[16rem] flex-1`; quota bar full width; the Alert text wraps. At <= 700px height the explainer stays visible (it is the consent text), the panel is not collapsed; the Companies wrapper scrolls.
- Reduced motion: spinner and bar transitions gated with `motion-reduce:`.
- Focus management: after Save (replace mode) or Cancel focus returns to `Replace {name} key`; after the first save (no key -> key) focus goes to `Replace {name} key`; after Remove focus goes to that provider's key input; opening the remove confirm moves focus to its `Remove` button.
- `data-testid`s (JSearch uses `deepsearch-*`, SerpApi `deepsearch-serpapi-*`): `deepsearch`, `*-key-input`, `*-key-save`, `*-key-state`, `*-key-replace`, `*-key-remove`, `*-key-remove-confirm`, `*-quota`, `*-blocked`, `*-limit`, plus `deepsearch-run`, `deepsearch-last-run`, `via-badge`.

### 10.10 Acceptance additions
- [ ] No keys: badge "Off", both sections "No key" with `type=password` inputs, Deep refresh disabled with "Add a key to use Deep refresh."; saving a key shows "Key set" and the input value/DOM never contains the key afterwards (assert `input.value===''` and no text node with the key).
- [ ] Remove key needs a confirm ("Saved jobs stay."); after it, "No key", quota hidden, saved jobs still listed.
- [ ] Quota text reads "{used} / 200 this month" (JSearch) and "{used} / 250 this month" (SerpApi), taken from status; progressbars labelled "JSearch monthly requests" / "SerpApi monthly searches" have `aria-valuenow`/`aria-valuetext`.
- [ ] Provider choice: JSearch only -> "Next run uses JSearch."; JSearch used 170 with SerpApi key -> "On: SerpApi" and the "because" hint; both limits reached -> "No search available..." and run disabled.
- [ ] Deep refresh: button `aria-busy` and disabled while running, spinner stops under reduced motion, toast "Deep refresh done via {provider}" with counts; `ok:false` shows toast and `role="alert"`; last-run line reads "via {provider}" and a SerpApi run restarts the shared 7-day gate.
- [ ] Paused: Alert "{name} is paused" with reason and re-enable date; limit: "{name}: monthly limit reached". Saving a different key lifts the pause but the counter stays.
- [ ] A seeded deep-search job with a linkedin.com URL shows "via LinkedIn" in both New and Visited, same row height as other rows; a non-LinkedIn SerpApi row shows "via Google Jobs"; the open goes through `jobs:open` only (no `<a href>`).
- [ ] axe 0 serious/critical on the Companies tab in light and dark at 900x600 and 1280x800 for every state in 10.8.
