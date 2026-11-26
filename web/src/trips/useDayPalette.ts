// The day colours (`--day-color-N` in index.css) as concrete CSS colours, for
// drawing on the map canvas, which can't read CSS variables. The tokens are
// light-dark() pairs, so each is resolved through a probe element's computed
// colour. Re-read when the system scheme, theme or chosen mode changes.

import { useEffect, useState } from 'react'
import { THEME_CHANGE_EVENT } from '../theme/theme'
import { DAY_COLOR_COUNT } from './mapView'

function readPalette(): string[] {
  const probe = document.createElement('span')
  probe.hidden = true
  document.documentElement.append(probe)
  const colors = Array.from({ length: DAY_COLOR_COUNT }, (_, i) => {
    probe.style.color = `var(--day-color-${i + 1})`
    return getComputedStyle(probe).color
  })
  probe.remove()
  return colors
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
