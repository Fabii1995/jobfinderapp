# Job Finder - Dashboard Design Spec (Phase 4)

Owner: ui-ux. Implementer: frontend. Renderer code lives in `src/renderer/src/` (alias `@renderer/*`). Stack: Electron + React + Tailwind v4 + shadcn/ui (style `new-york`, base `neutral`, lucide icons) + TanStack Query/Table + Zustand. This is a desktop app: no routes, no scroll-the-page layout, no hover-only affordances.

Facts this spec is built on (verified in repo): `Job` = `{id, source, externalId, title?, company?, url, description?, location?, postedAt?, score?, firstSeenAt, visitedAt?}` (timestamps are epoch ms; title/company/description/location/postedAt/score are all nullable). `jobs:list` returns New ordered by score desc then postedAt desc, Visited ordered by visitedAt desc. `jobs:stats` returns `{newCount, visitedCount, bySource, lastRefreshAt}`. `jobs:refresh` returns `{inserted, updated}`. Sources: `arbeitnow | remoteok | himalayas`.

**Score range assumption:** `src/main/scoring.ts` did not exist when this was written. Assumed score is a number in **0-100** (higher = better fit). If job-search chooses another scale, only the constants in `lib/score.ts` (section 3.5) change. Job-search: please confirm the range.

---

## 1. Purpose and users

One person scanning quickly for junior / entry-level / no-experience software roles (QA, Backend, Python, AI Solutions, Forward Deployed...). Core loop: open app, glance at what is new, skim ranked rows, click one to read it in the browser, it drops into Visited, repeat. Success = under 5 seconds from launch to "I know whether there is anything worth opening".

- Window: default 1280x800, **min 900x600** (set `minWidth: 900, minHeight: 600` in the BrowserWindow in `src/main/index.ts` - frontend/main), resizable, maximizable.
- Themes: light and dark through the existing CSS variables in `assets/main.css` (`:root` and `.dark`). Never hardcode hex/oklch in components except the new tier tokens (3.5). Follow the OS: a `useSystemTheme` hook toggles the `dark` class on `<html>` from `matchMedia('(prefers-color-scheme: dark)')` and listens for changes. No manual toggle in v1.
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
| Filter bar: [search........] [Sources v] [Roles v] [Score v] x |
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
3. **Last refresh** - relative time as value (`text-lg`), under it `text-xs` "12 new, 3 updated" from the last refresh summary (needs data gap D1; until then show only the time).
4. **By source** - `bySource` rendered as wrapping chips (`Badge variant="outline"`, `name count`, e.g. "remoteok 31"). Chips are toggle buttons that set the source filter (`aria-pressed`). Caption "All jobs (new + visited)" because `bySource` counts every row. Sort chips by count desc. A source with a failed last refresh shows a small `AlertTriangle` icon and tooltip with the error (needs D1).
- Stats data comes from `jobs:stats` only. Skeleton (loading): same cards with `Skeleton h-7 w-12` values.
- Short windows (`@media (max-height: 700px)`): hide the card labels' caption lines and use `py-2`, value `text-xl`, so the list keeps at least ~300px at 600px window height.

### 2.3 Tabs
shadcn `Tabs` controlled by Zustand `activeTab` (`value={activeTab} onValueChange={setActiveTab}`), `TabsList` + two `TabsTrigger`s labelled "New" and "Visited", each with a count `Badge variant="secondary"` (`tabular-nums`) from stats. Radix provides `role=tablist/tab` and `aria-selected`; do NOT add `aria-current` on top. Both tabs render the same `<JobList mode={tab}>`; only data and the visited-column differ (3.3). Shortcuts: Ctrl+1 New, Ctrl+2 Visited.

### 2.4 Filter bar
`<div role="search" class="flex flex-wrap items-center gap-2">`. Filters apply **client-side** to the already-fetched tab list (the dataset is hundreds of rows, not thousands) and apply identically to both tabs.
- **Search**: shadcn `Input` with leading `Search` icon, `w-72`, placeholder "Search title, company, location...", `aria-label="Search jobs"`, 150ms debounce, case-insensitive substring across title, company, location, description. Esc clears when focused. `/` focuses it (when no input is focused).
- **Sources**: `DropdownMenu` + `DropdownMenuCheckboxItem` per source (options = keys of `stats.bySource`). Trigger button `variant="outline" size="sm"` text "Sources" + count Badge when any selected. Empty selection = all sources.
- **Roles**: same pattern. Options: QA / Test, Backend, Python, AI / ML, Forward Deployed, Frontend, Full-stack. v1 fallback matches title keywords client-side from a constant `ROLE_PRESETS` (`lib/roles.ts`); see D2 for the proper field. Empty = all roles.
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
| `source` | text `text-xs`, capitalized | `w-28` | yes | hidden < 1100px, folded into meta line |
| `location` | text `text-xs`, `truncate` | `w-40` | yes | hidden < 1100px, folded into meta line |
| `postedAt` | relative "3d ago", `title` = absolute date | `w-24` | yes | null shows "-" and sorts last |
| `visitedAt` | check icon + "2d ago" | `w-28` | yes | **Visited tab only** (`columnVisibility`) |

Sort behavior: header cell is a `button` (`aria-sort="ascending|descending|none"` on the `th`), lucide `ArrowUp/ArrowDown/ChevronsUpDown` icon, click cycles desc -> asc -> default. Sorting is client-side, held in local table state (not persisted), reset when the tab changes. Null values always sort last regardless of direction.
- **Default sort New:** score desc, then postedAt desc (matches `listJobs`; do not re-sort away from server order unless the user picks a column).
- **Default sort Visited:** visitedAt desc.

### 3.2 Shared row design (both tabs identical)
Row min-height 72px (`min-h-[72px]`), cell padding `px-3 py-2.5`, `align-top`, bottom border only (`border-b`), hover `hover:bg-muted/50`, row focus-within `bg-muted/50`. The `job` cell contains, stacked:
1. **Title** - the interactive element: `<button type="button" class="group inline-flex max-w-full items-center gap-1 text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">` with `<span class="truncate">title</span>` + `ExternalLink` icon (`size-3.5 text-muted-foreground shrink-0`) + `<span class="sr-only">(opens in your browser)</span>`. Fallback text "Untitled role".
2. **Meta line** `text-xs text-muted-foreground`: `company` (font-medium, `text-foreground/80`; fallback "Unknown company") then, separated by a middle dot (U+00B7), location and source when those columns are hidden.
3. **Excerpt** `text-xs text-muted-foreground` - rules in 3.6.
Clicking anywhere on the row behaves the same as the title button (row `onClick` calls the same handler; ignore clicks that originate on the button to avoid double-fire). The row has NO `tabIndex` - the title button is the single tab stop per row.

### 3.3 Click behavior and moving to Visited
- Click / Enter / Space on a row -> `useOpenJob().mutate(job)` -> renderer calls `window.api.open(job.id)` (**NEW IPC `jobs:open`**, section 8). Main: loads the row by id, validates `url` parses as `http:` or `https:` only, calls `shell.openExternal(url)`, then calls `markVisited(db, id)` and returns the updated `Job`. The renderer never passes a URL, only the id. If the protocol is invalid or openExternal throws, nothing is marked visited and the renderer shows `toast.error("Couldn't open that link")`.
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
| **Empty - never refreshed** | stats: `newCount===0 && visitedCount===0` and no last refresh | Centered in the list region: `Inbox` icon (`size-10 text-muted-foreground`), `h2` "No jobs yet", text "Run your first refresh to pull junior and entry-level roles from Arbeitnow, RemoteOK and Himalayas.", primary `Button` "Refresh now" (same handler). Hide filter bar and stats values show 0. `data-testid="empty-never"`. |
| **Empty - New caught up** | New tab, `newCount===0`, `visitedCount>0` | `CheckCircle2` icon, "You're all caught up", "New roles appear after the next refresh (automatic every 3 hours).", secondary button "Refresh now". `empty-caught-up`. |
| **Empty - no filter match** | rows exist, filtered result is 0 | `SearchX` icon, "No jobs match your filters", list of active filters as removable chips, button "Clear filters". `empty-filtered`. |
| **Empty - zero visited** | Visited tab, `visitedCount===0` | `MousePointerClick` icon, "Nothing visited yet", "Open a job from the New tab and it will be saved here.", button "Go to New". `empty-visited`. |
| **Partial source failure** | refresh finished with >= 1 but not all sources failed | shadcn `Alert` (add `alert`) above stats, `variant="default"` with `AlertTriangle` (amber tier colors): title "Some sources failed", body "RemoteOK: request timed out. Results from other sources were saved." one line per failed source, dismiss `X` button. Cleared on next fully/partly successful refresh. Plus a warning toast instead of the success toast. `data-testid="error-banner"`. |
| **Total failure** | refresh rejects or all sources failed | `Alert variant="destructive"` "Refresh failed", reason, `Retry` button. If rows exist: add "Showing results from {relative time}". If no rows at all: the `never refreshed` empty state is replaced by the same message (icon `CloudOff`). Refresh button goes to its error state. |
| **List query error** | `jobs:list` / `jobs:stats` reject | Inline destructive `Alert` in the list region with "Couldn't load jobs" + Retry (`refetch`). |
| **Refresh success** | mutation resolves, no errors | `toast.success("Refreshed", { description: "12 new, 3 updated" })`; if both 0: "Already up to date". |

## 5. Accessibility

- **Landmarks:** `<header>`, `<main>` (stats + tabs + list), `role="search"` on the filter bar, stats `<section aria-label="Summary">`. Exactly one `h1`; empty states use `h2`.
- **Tab order:** Refresh button -> stats card buttons -> tabs (Radix: arrow keys move between triggers, Tab leaves the tablist) -> search -> Sources -> Roles -> Min score -> Clear -> table sort headers -> one title button per row. Visual order equals DOM order.
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
- **Existing bug to fix before building on it (all 6 ui files):** `import { cn } from "cn"` at `components/ui/button.tsx:3`, `skeleton.tsx:1`, `card.tsx:2`, `badge.tsx:3`, `tabs.tsx:3`, `table.tsx:4`. `cn` is the npm package of the shadcn CLI (it is in package.json), not the class-merge helper; it should be `import { cn } from "@renderer/lib/utils"` (the alias in `components.json`). Also remove the stray `cn` dependency from `package.json` if nothing else uses it. Frontend owns the fix.

## 6. Responsive behavior (window width)

| Width | Layout |
|---|---|
| **900px** (min) | Padding `px-4`. Stats grid keeps 4 columns but values `text-xl`; source chips wrap to 2 lines max (`+N` overflow chip beyond 4 sources). Filter bar wraps to 2 rows (search full-width row, dropdowns second row). Table shows only `score`, `job`, `postedAt` (+`visitedAt` on Visited, replacing posted... both fit at `w-24`/`w-28`); source and location fold into the meta line; excerpt 1 line. Header: "Last refreshed" text hidden below 1000px, shown only inside the Refresh tooltip and the stats card. |
| **~1280px** | Default design. All columns visible, excerpt 2 lines, filter bar on one row, stats 4 columns. |
| **Maximized (1600px+)** | Content capped at `max-w-[1600px]` and centered; extra width goes to the `job` column (flex). Do not scale font sizes. Row height unchanged. |
| **Short heights (<= 700px)** | Stats cards go compact (2.2). Only the list region scrolls; header, stats, tabs, filters stay fixed. Never allow body scroll (`overflow-hidden` on root). |

Implement column hiding with TanStack `columnVisibility` driven by a `useWindowWidth()` hook (breakpoints: `<1100` compact, `>=1100` full), not CSS `hidden`, so hidden cells are not in the accessibility tree.

## 7. Components and code structure

### 7.1 shadcn components
Existing (keep): `button`, `card`, `tabs`, `badge`, `skeleton`, `table`.
Add (exact `npx shadcn@latest add ...` names): `input`, `select`, `dropdown-menu`, `sonner`, `tooltip`, `separator`, `alert`. Also add dependency `lucide-react` if missing. Mount `<Toaster richColors closeButton />` once in `App.tsx`, wrap the app in `<TooltipProvider>`. Do not add `dialog`, `sheet`, `slider`, `checkbox` in v1.

### 7.2 File breakdown (`src/renderer/src/`)
```
App.tsx                      providers (QueryClientProvider, TooltipProvider), <AppShell/>, <Toaster/>
main.tsx
components/
  layout/AppShell.tsx        h-screen flex column, a11y live region
  layout/Header.tsx          title, LastRefreshLabel, RefreshButton
  layout/RefreshButton.tsx
  stats/StatsRow.tsx         StatCard.tsx  SourceChips.tsx
  filters/FilterBar.tsx      MultiSelectMenu.tsx (shared by sources + roles)
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
  useFilteredJobs.ts         applies store filters to a Job[] (pure fn in lib/filters.ts)
  useShortcuts.ts  useWindowWidth.ts  useSystemTheme.ts  useNow.ts (30s tick)
lib/
  utils.ts (cn)  score.ts  roles.ts  text.ts (toExcerpt)  time.ts (relative/absolute)  filters.ts  api.ts (typed window.api wrapper)
store/ui.ts                  existing, extended below
```

### 7.3 TanStack Query hooks and invalidation
Keys: `['jobs','list',{visited:false}]`, `['jobs','list',{visited:true}]`, `['jobs','stats']`.
- `useJobsQuery(visited)`: `queryFn: () => window.api.list({visited})`, `placeholderData: keepPreviousData`, `staleTime: 30_000`, `refetchOnWindowFocus: true`.
- `useStatsQuery()`: same options; also `refetchInterval: 60_000` so scheduler-driven refreshes show up (unless main pushes `jobs:changed`, see 8).
- `useRefreshJobs()`: mutation -> `window.api.refresh()`. `onSuccess`: `invalidateQueries({queryKey:['jobs']})` (all three), set `lastRefreshErrors` (from response), toast. `onError`: error banner + button error state. Never optimistic.
- `useOpenJob()`: mutation -> `window.api.open(id)`. `onMutate`: cancel `['jobs']`, snapshot, remove from New list cache, adjust stats counts. `onError`: restore snapshot + error toast. `onSettled`: invalidate `['jobs','list']` (both) and `['jobs','stats']`.
- `jobs:visit` stays in the API but the renderer uses `jobs:open`; `visit` is only for a possible future "mark as visited without opening".

### 7.4 Zustand store (`store/ui.ts`)
```ts
interface UiState {
  activeTab: 'new' | 'visited'           // not persisted (always opens on New)
  search: string                          // not persisted
  filters: { sources: string[]; roles: string[]; minScore: 0 | 30 | 50 | 70 }  // PERSISTED
  refreshErrors: { source: string; message: string }[]   // not persisted
  bannerDismissed: boolean                // not persisted
  announce: string                        // not persisted, feeds the sr-only live region
  setActiveTab / setSearch / setFilters / toggleSource / toggleRole / setMinScore / clearFilters / dismissBanner / setAnnounce
}
```
Persist with `zustand/middleware` `persist`, name `'jobfinder-ui-v1'`, `partialize: s => ({ filters: s.filters })`, localStorage (Electron renderer). Stale persisted sources (a source no longer in `bySource`) are ignored at filter time, not errors. `clearFilters` also clears `search`.

## 8. Data and IPC gaps (do not fake in the UI)

| # | Need | Why | Owner |
|---|---|---|---|
| **N1 (REQUIRED, new IPC)** `jobs:open` | `open(id: number): Promise<Job \| null>`; add `IPC.open='jobs:open'` and `JobFinderApi.open` in `src/shared/ipc.ts`, handler in `src/main/ipc.ts`, preload exposure. Main loads URL by id, allows only `http:`/`https:`, `shell.openExternal`, then `markVisited`; rejects (no visit) otherwise. | Click-to-open + move to Visited atomically, without the renderer handling URLs | frontend (main + preload + shared) |
| **D1** Refresh result with per-source outcome | Extend `RefreshResponse` to `{inserted, updated, sources: {source: string; ok: boolean; count?: number; error?: string}[]}`. Also persist the last refresh summary (time, inserted, updated, per-source errors) in a one-row `meta`/`refresh_log` table and return it in `JobStats` as `lastRefresh: {at:number; inserted:number; updated:number; sources:[...]} \| null`, so scheduled (cron) refreshes surface errors too, not only button presses. | Partial-failure banner, source warning icons, "12 new, 3 updated" | job-search (refresh orchestrator output); frontend (type, table, stats query) |
| **D1b** True `lastRefreshAt` | `JobStats.lastRefreshAt` is currently `max(firstSeenAt)` (`queries.ts:40`) = the last time a NEW job was inserted, not the last refresh (a refresh with zero new rows would still read "3 days ago"). Replace with the `meta` timestamp from D1. | Honest "last refreshed" label | frontend (queries.ts/DB) fed by job-search refresh |
| **D2** Role tag | A `roles: string[]` (or single `role`) per job derived by scoring/ingestion from title keywords (qa, backend, python, ai, forward-deployed...). Needs a schema column (frontend owns schema) populated by job-search; expose in `Job`. Until then the Roles filter does client-side title matching (`lib/roles.ts`) which may disagree with scoring. | Reliable role filter | job-search (values/keywords) + frontend (column) |
| **D3** Score contract | Confirm range 0-100 and that `score` is always set (schema default 0; type allows null). Export `SCORE_MAX` or document the range in `src/main/scoring.ts`. | Tier thresholds | job-search |
| **D4** `jobs:changed` push event (recommended) | `webContents.send('jobs:changed')` after any refresh (incl. cron); preload `onChanged(cb)` returning an unsubscribe; renderer invalidates `['jobs']`. Replaces the 60s polling. | Scheduler refreshes appear live | frontend (main/preload); job-search emits |
| **D5** Single-flight refresh | Main refresh function must dedupe concurrent calls (cron + button) and return the in-flight promise. | No double ingestion / no duplicated errors | job-search / frontend (wiring in `ipc.ts`) |
| **D6** Days since posted | Derived in renderer from existing `postedAt` (no new field). Null `postedAt` shows "-". | Posted column | frontend (no gap) |
| **D7** HTML description | Prefer sources to store plain text; renderer strips tags defensively regardless (3.6). | Excerpt quality | job-search (optional) |

## 9. Acceptance checklist (for Playwright-Electron)

Use a seeded temp DB (mix of sources, scores 10/45/85, null title/postedAt/score rows, one HTML description, 2 visited rows) and a stub refresh. Required `data-testid`s: `refresh-button`, `refresh-progress`, `last-refresh`, `stat-new`, `stat-visited`, `stat-source-<name>`, `tab-new`, `tab-visited`, `search-input`, `filter-sources`, `filter-roles`, `filter-min-score`, `clear-filters`, `result-count`, `job-row`, `job-open-<id>`, `score-badge`, `skeleton-row`, `error-banner`, `empty-never|empty-caught-up|empty-filtered|empty-visited`.

Layout and tabs
- [ ] Window opens with min size 900x600 and cannot be resized smaller.
- [ ] Header shows "Job Finder", last-refresh label ("Never refreshed" on empty DB) and Refresh button.
- [ ] Stats show New, Visited, per-source chips and last refresh, values match the seeded DB (`stat-new` equals the number of `job-row`s on New with no filters).
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
- [ ] Source multi-select, role multi-select and min score 70+ combine with AND; filters apply to both tabs; Clear filters restores all.
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
- [ ] Responsive: at 900 wide Source and Location columns are absent and no horizontal scroll; at 1280 all columns present; maximized content stays <= 1600px wide and centered; at 900x600 the list region scrolls and the page body does not.
- [ ] `prefers-color-scheme: dark` flips `html.dark`; `prefers-reduced-motion` stops spinner animation.
