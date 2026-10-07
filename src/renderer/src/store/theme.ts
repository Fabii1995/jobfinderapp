import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark' || v === 'system'

// localStorage can throw (disabled/quota); never let that break the app.
export const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value)
    } catch {
      /* ignore */
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name)
    } catch {
      /* ignore */
    }
  }
}

// Storage key/shape is mirrored in public/theme-init.js (pre-paint script).
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme: isTheme(theme) ? theme : 'system' })
    }),
    {
      name: 'jobfinder-theme-v1',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ theme: s.theme }),
      merge: (persisted, current) => {
        const t = (persisted as Partial<ThemeState> | undefined)?.theme
        return { ...current, theme: isTheme(t) ? t : 'system' }
      }
    }
  )
)

const DARK_QUERY = '(prefers-color-scheme: dark)'

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return theme
}

export function applyTheme(theme: Theme): void {
  const resolved = resolveTheme(theme)
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
}
