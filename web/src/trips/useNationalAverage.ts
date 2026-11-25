import { useEffect, useState } from 'react'
import { loadNationalAverage, type NationalAverage } from '../lib/gasPrice'

/**
 * The U.S. national average gas price, or null while loading or if it's
 * unavailable. Loaded once per session; every component shares the result.
 */
export function useNationalAverage(): NationalAverage | null {
  const [average, setAverage] = useState<NationalAverage | null>(null)
  useEffect(() => {
    let active = true
    loadNationalAverage().then(
      (value) => {
        if (active) setAverage(value)
      },
      (error: unknown) => {
        console.error('Could not load the national average gas price', error)
      },
    )
    return () => {
      active = false
    }
  }, [])
  return average
}
