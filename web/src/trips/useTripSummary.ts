// The trip's legs and totals, with driving routes fetched as needed. Shared
// by the day list (totals) and the map (route lines), so routes are fetched
// once for both.

import { useMemo } from 'react'
import type { Day, Stop, Trip } from '../lib/database.types'
import { effectiveGasPrice } from '../lib/gasPrice'
import { summarizeTrip, type TripSummary } from '../lib/tripMath'
import { toDayInput, toStopInput } from '../lib/tripRows'
import { useNationalAverage } from './useNationalAverage'
import { useRoutes } from './useRoutes'

export function useTripSummary(
  trip: Trip | null,
  days: readonly Day[],
  stops: readonly Stop[],
): { summary: TripSummary; gasPriceKnown: boolean } {
  // The trip's own price, else the national average (null until it loads).
  const nationalAverage = useNationalAverage()
  const gasPrice = effectiveGasPrice(
    trip?.gas_price_per_gallon ?? null,
    nationalAverage,
  )
  const mpg = Number(trip?.mpg ?? 0)

  const dayInputs = useMemo(() => days.map(toDayInput), [days])
  const stopInputs = useMemo(() => stops.map(toStopInput), [stops])
  // The legs the trip needs, before any routes are known.
  const neededLegs = useMemo(
    () =>
      summarizeTrip(dayInputs, stopInputs, {
        mpg,
        gasPricePerGallon: gasPrice ?? 0,
        route: () => undefined,
      }).legs,
    [dayInputs, stopInputs, mpg, gasPrice],
  )
  const route = useRoutes(neededLegs)
  const summary = useMemo(
    () =>
      summarizeTrip(dayInputs, stopInputs, {
        mpg,
        gasPricePerGallon: gasPrice ?? 0,
        route,
      }),
    [dayInputs, stopInputs, mpg, gasPrice, route],
  )
  return { summary, gasPriceKnown: gasPrice !== null }
}
