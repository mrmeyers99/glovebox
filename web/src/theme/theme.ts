// App-wide colour themes. The chosen theme is a per-device preference kept
// in localStorage and applied as `data-theme` on <html>; index.css holds each
// theme's tokens (light and dark). Light/dark still follows the system.

export const THEMES = [
  { id: 'classic', name: 'Classic' },
  { id: 'atlas', name: 'Road atlas' },
  { id: 'sign', name: 'Highway sign' },
  { id: 'park', name: 'Park poster' },
  { id: 'motel', name: 'Motel postcard' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

export const DEFAULT_THEME: ThemeId = 'classic'

export const THEME_STORAGE_KEY = 'glovebox.theme'

/** Fired on window after the theme changes, so canvas code can re-read colours. */
export const THEME_CHANGE_EVENT = 'glovebox:themechange'

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value)
}

/** The saved theme, or the default if none is saved or storage is unavailable. */
export function loadTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeId(saved) ? saved : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

/** Show `theme` on the page. */
export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
}

/** Show `theme` and remember it on this device. */
export function setTheme(theme: ThemeId) {
  applyTheme(theme)
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Private mode or storage blocked: the theme still applies until reload.
  }
}
