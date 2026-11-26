import { useState } from 'react'
import {
  isSchemeId,
  isThemeId,
  loadScheme,
  loadTheme,
  SCHEMES,
  setScheme,
  setTheme,
  THEMES,
  type SchemeId,
  type ThemeId,
} from './theme'

/** Theme and light/dark choices, remembered on this device. */
export function ThemePicker() {
  const [theme, setThemeState] = useState<ThemeId>(loadTheme)
  const [scheme, setSchemeState] = useState<SchemeId>(loadScheme)

  return (
    <div className="theme-picker">
      <label>
        Theme
        <select
          value={theme}
          onChange={(e) => {
            const next = e.target.value
            if (!isThemeId(next)) return
            setTheme(next)
            setThemeState(next)
          }}
        >
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Mode
        <select
          value={scheme}
          onChange={(e) => {
            const next = e.target.value
            if (!isSchemeId(next)) return
            setScheme(next)
            setSchemeState(next)
          }}
        >
          {SCHEMES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
