// The day colours (`--day-color-N` in index.css) as concrete CSS colours, for
// drawing on the map canvas, which can't read CSS variables. Re-read when the
// colour scheme or theme changes, since each theme has light and dark variants.

import { useEffect, useState } from 'react'
import { THEME_CHANGE_EVENT } from '../theme/theme'
import { DAY_COLOR_COUNT } from './mapView'

function readPalette(): string[] {
  const style = getComputedStyle(document.documentElement)
  return Array.from({ length: DAY_COLOR_COUNT }, (_, i) =>
    style.getPropertyValue(`--day-color-${i + 1}`).trim(),
  )
}

export function useDayPalette(): string[] {
  const [palette, setPalette] = useState(readPalette)
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setPalette(readPalette())
    query.addEventListener('change', update)
    window.addEventListener(THEME_CHANGE_EVENT, update)
    return () => {
      query.removeEventListener('change', update)
      window.removeEventListener(THEME_CHANGE_EVENT, update)
    }
  }, [])
  return palette
}
