import { useEffect, useSyncExternalStore } from 'react'
import { applyTheme, useThemeStore, type ResolvedTheme } from '@renderer/store/theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function subscribe(cb: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(DARK_QUERY)
  mql.addEventListener('change', cb)
  return () => mql.removeEventListener('change', cb)
}

function getSystemDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches
}

/**
 * Keeps the `dark` class on <html> in sync with the chosen theme and, in
 * 'system' mode, with the OS setting. Returns the resolved (light|dark) theme.
 */
export function useTheme(): ResolvedTheme {
  const theme = useThemeStore((s) => s.theme)
  const systemDark = useSyncExternalStore(subscribe, getSystemDark, () => false)
  useEffect(() => {
    applyTheme(theme)
  }, [theme, systemDark])
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
}
