import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { safeStorage } from './theme'
import { DEFAULT_FILTERS, sanitizeFilters, type Filters, type WorkModeFilter } from '@renderer/lib/filters'
import type { Role } from '@renderer/lib/types'
import type { MinScore } from '@renderer/lib/score'

export type ActiveTab = 'new' | 'visited' | 'companies'

interface UiState {
  activeTab: ActiveTab // not persisted (always opens on New)
  search: string // not persisted
  filters: Filters // PERSISTED
  /** Message when the refresh call itself rejected (IPC/DB error). Not persisted. */
  refreshFailure: string | null
  /** `lastRefresh.at` whose partial-failure banner was dismissed (a newer run re-shows it). */
  dismissedBannerAt: number | null
  /** Text for the sr-only aria-live region. */
  announce: string
  setActiveTab: (tab: ActiveTab) => void
  setSearch: (s: string) => void
  setCompany: (company: string | null) => void
  setWorkMode: (mode: WorkModeFilter) => void
  toggleRole: (role: Role) => void
  setMinScore: (n: MinScore) => void
  clearFilters: () => void
  setRefreshFailure: (m: string | null) => void
  dismissBanner: (at: number) => void
  setAnnounce: (s: string) => void
}

const toggle = <T,>(list: T[], v: T): T[] =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v]

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      activeTab: 'new',
      search: '',
      filters: DEFAULT_FILTERS,
      refreshFailure: null,
      dismissedBannerAt: null,
      announce: '',
      setActiveTab: (activeTab) => set({ activeTab }),
      setSearch: (search) => set({ search }),
      setCompany: (company) => set((s) => ({ filters: { ...s.filters, company } })),
      setWorkMode: (workMode) => set((s) => ({ filters: { ...s.filters, workMode } })),
      toggleRole: (role) =>
        set((s) => ({ filters: { ...s.filters, roles: toggle(s.filters.roles, role) } })),
      setMinScore: (minScore) => set((s) => ({ filters: { ...s.filters, minScore } })),
      clearFilters: () => set({ filters: DEFAULT_FILTERS, search: '' }),
      setRefreshFailure: (refreshFailure) => set({ refreshFailure }),
      dismissBanner: (dismissedBannerAt) => set({ dismissedBannerAt }),
      setAnnounce: (announce) => set({ announce })
    }),
    {
      name: 'jobfinder-ui-v1',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ filters: s.filters }),
      merge: (persisted, current) => ({
        ...current,
        filters: sanitizeFilters((persisted as { filters?: unknown } | undefined)?.filters)
      })
    }
  )
)
