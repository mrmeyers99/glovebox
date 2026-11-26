import { useState } from 'react'
import { loadTheme, setTheme, THEMES, isThemeId, type ThemeId } from './theme'

export function ThemePicker() {
  const [theme, setThemeState] = useState<ThemeId>(loadTheme)

  return (
    <label className="theme-picker">
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
  )
}
