// The day colours (`--day-color-N` in index.css) as concrete CSS colours, for
// drawing on the map canvas, which can't read CSS variables. Re-read when the
// colour scheme changes, since the palette has light and dark variants.

import { useEffect, useState } from 'react'
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
    return () => query.removeEventListener('change', update)
  }, [])
  return palette
}
