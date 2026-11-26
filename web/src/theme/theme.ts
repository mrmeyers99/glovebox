// App-wide colour themes and light/dark mode. Both are per-device preferences
// kept in localStorage and applied to <html>: `data-theme` picks a theme's
// tokens in index.css, and `data-scheme` forces light or dark (absent: follow
// the system).

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

export const SCHEMES = [
  { id: 'auto', name: 'Auto' },
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
] as const

export type SchemeId = (typeof SCHEMES)[number]['id']

export const DEFAULT_SCHEME: SchemeId = 'auto'

export const SCHEME_STORAGE_KEY = 'glovebox.scheme'

/** Fired on window after the theme or scheme changes, so canvas code can re-read colours. */
export const THEME_CHANGE_EVENT = 'glovebox:themechange'

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value)
}

export function isSchemeId(value: unknown): value is SchemeId {
  return SCHEMES.some((scheme) => scheme.id === value)
}

function load<T>(key: string, valid: (v: unknown) => v is T, fallback: T): T {
  try {
    const saved = localStorage.getItem(key)
    return valid(saved) ? saved : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode or storage blocked: the choice still applies until reload.
  }
}

function announce() {
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
}

/** The saved theme, or the default if none is saved or storage is unavailable. */
export function loadTheme(): ThemeId {
  return load(THEME_STORAGE_KEY, isThemeId, DEFAULT_THEME)
}

/** The saved light/dark choice, or auto. */
export function loadScheme(): SchemeId {
  return load(SCHEME_STORAGE_KEY, isSchemeId, DEFAULT_SCHEME)
}

/** Show `theme` on the page. */
export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme
  announce()
}

/** Show `theme` and remember it on this device. */
export function setTheme(theme: ThemeId) {
  applyTheme(theme)
  save(THEME_STORAGE_KEY, theme)
}

/** Force light or dark, or follow the system for auto. */
export function applyScheme(scheme: SchemeId) {
  if (scheme === 'auto') delete document.documentElement.dataset.scheme
  else document.documentElement.dataset.scheme = scheme
  announce()
}

/** Apply `scheme` and remember it on this device. */
export function setScheme(scheme: SchemeId) {
  applyScheme(scheme)
  save(SCHEME_STORAGE_KEY, scheme)
}
