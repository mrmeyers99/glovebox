import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Stop } from '../lib/database.types'

// Code-split: the map library is only downloaded on the trip page.
const TripMap = lazy(() => import('./TripMap'))

export function MapPanel({ stops }: { stops: readonly Stop[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const hasSize = useHasSize(ref)

  return (
    <div ref={ref} className="map-panel">
      {/* At phone width the panel is hidden until the Map tab is picked.
          Wait until it has a size so the initial fit uses real dimensions. */}
      {hasSize && (
        <Suspense fallback={<p className="map-loading">Loading map…</p>}>
          <TripMap stops={stops} />
        </Suspense>
      )}
    </div>
  )
}

/** Becomes true (and stays true) once the element has a non-zero size. */
function useHasSize(ref: RefObject<HTMLElement | null>) {
  const [hasSize, setHasSize] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || hasSize) return
    const check = () => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) setHasSize(true)
    }
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, hasSize])
  return hasSize
}
