import { useEffect } from 'react'
import { useSettingsStore } from '@/stores/settings-store'

type Theme = 'light' | 'dark' | 'system'

/** Resolve a theme setting to a concrete light/dark decision. */
export function isDarkTheme(theme: Theme): boolean {
  if (theme === 'system') {
    return typeof window !== 'undefined' && !!window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  }
  return theme === 'dark'
}

/**
 * Applies the persisted theme to the document and exposes a toggle.
 *
 * Adds/removes the `dark` class on <html>, which drives the dark-mode overrides
 * in index.css. When the setting is 'system', it follows (and live-updates with)
 * the OS preference. The setting itself is persisted by the settings store.
 */
export function useTheme() {
  const theme = useSettingsStore((s) => s.theme)
  const setTheme = useSettingsStore((s) => s.setTheme)

  const dark = isDarkTheme(theme)

  // Reflect the resolved theme onto <html> for the CSS overrides.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  // When following the system, re-apply if the OS preference changes mid-session.
  useEffect(() => {
    if (theme !== 'system' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => document.documentElement.classList.toggle('dark', mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  /** Flip between light and dark (an explicit choice, leaving 'system' behind). */
  const toggle = () => setTheme(dark ? 'light' : 'dark')

  return { theme, isDark: dark, toggle, setTheme }
}
