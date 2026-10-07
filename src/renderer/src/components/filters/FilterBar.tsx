import { Search, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { useCompanyCountsQuery } from '@renderer/hooks/useCompanies'
import { SEARCH_INPUT_ID } from '@renderer/hooks/useAppEvents'
import { useUiStore } from '@renderer/store/ui'
import { activeFilterCount, WORK_MODE_OPTIONS, type WorkModeFilter } from '@renderer/lib/filters'
import { MIN_SCORE_OPTIONS, type MinScore } from '@renderer/lib/score'
import { ROLES, type Role } from '@renderer/lib/types'
import { MultiSelectMenu } from './MultiSelectMenu'

const ALL_COMPANIES = '__all__'

export function FilterBar(): React.JSX.Element {
  const { data: counts } = useCompanyCountsQuery()
  const filters = useUiStore((s) => s.filters)
  const search = useUiStore((s) => s.search)
  const setSearch = useUiStore((s) => s.setSearch)
  const setCompany = useUiStore((s) => s.setCompany)
  const setWorkMode = useUiStore((s) => s.setWorkMode)
  const toggleRole = useUiStore((s) => s.toggleRole)
  const setMinScore = useUiStore((s) => s.setMinScore)
  const clearFilters = useUiStore((s) => s.clearFilters)

  const companyOptions = Object.entries(counts ?? {})
    .filter(([name]) => name !== '')
    .sort((a, b) => a[0].localeCompare(b[0]))
  // A persisted company that no longer exists is ignored (matches applyFilters).
  const selectedCompany =
    filters.company && (!counts || filters.company in counts) ? filters.company : null
  const roleOptions = ROLES.map((r) => ({ value: r.slug, label: r.label }))
  const active = activeFilterCount(filters, search) > 0

  return (
    <div role="search" className="flex flex-wrap items-center gap-2">
      <div className="relative w-full min-[1100px]:w-72">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={SEARCH_INPUT_ID}
          data-testid="search-input"
          type="search"
          aria-label="Search jobs"
          placeholder="Search title, company, location..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && search) {
              e.preventDefault()
              setSearch('')
            }
          }}
          className="h-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
        />
      </div>
      <Select
        value={selectedCompany ?? ALL_COMPANIES}
        onValueChange={(v) => setCompany(v === ALL_COMPANIES ? null : v)}
      >
        <SelectTrigger
          size="sm"
          aria-label="Company"
          data-testid="filter-company"
          className="max-w-[14rem] min-w-0"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-w-[22rem]">
          <SelectItem value={ALL_COMPANIES}>All companies</SelectItem>
          {companyOptions.map(([name, n]) => (
            <SelectItem key={name} value={name}>
              {name} ({n})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filters.workMode} onValueChange={(v) => setWorkMode(v as WorkModeFilter)}>
        <SelectTrigger size="sm" aria-label="Work mode" data-testid="filter-work-mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WORK_MODE_OPTIONS.map((w) => (
            <SelectItem key={w.value} value={w.value}>
              {w.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <MultiSelectMenu
        label="Roles"
        testId="filter-roles"
        options={roleOptions}
        selected={filters.roles}
        onToggle={(v) => toggleRole(v as Role)}
      />
      <Select value={String(filters.minScore)} onValueChange={(v) => setMinScore(Number(v) as MinScore)}>
        <SelectTrigger size="sm" aria-label="Minimum score" data-testid="filter-min-score">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MIN_SCORE_OPTIONS.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n === 0 ? 'Any score' : `Score ${n}+`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {active && (
        <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="clear-filters">
          <X aria-hidden="true" /> Clear filters
        </Button>
      )}
    </div>
  )
}
