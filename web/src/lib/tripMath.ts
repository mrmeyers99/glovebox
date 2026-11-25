// Trip calculations: ordering, legs, and per-day / per-trip totals.
// Pure functions, so they can be unit-tested and reused (e.g. in a mobile app).

import type { CostCategory, StopKind } from './database.types'

export const METERS_PER_MILE = 1609.344

export type DayInput = { id: string; position: string }

export type StopInput = {
  id: string
  dayId: string
  position: string
  kind: StopKind
  skipped: boolean
  lat: number
  lng: number
  costAmount: number | null
  costCategory: CostCategory | null
}

export type RouteInfo = {
  distanceM: number
  durationS: number
  /** Encoded polyline (precision 5) of the driving line, when known. */
  geometry?: string
}

/**
 * Looks up a route between two stops: undefined if it hasn't been fetched
 * yet, null if routing found no route for it.
 */
export type RouteLookup = (
  from: StopInput,
  to: StopInput,
) => RouteInfo | null | undefined

/** ok: route known; pending: not fetched yet; failed: no route found. */
export type LegStatus = 'ok' | 'pending' | 'failed'

export type Leg = {
  from: StopInput
  to: StopInput
  /** The day this leg counts toward: the day of the stop it arrives at. */
  dayId: string
  route: RouteInfo | undefined
  status: LegStatus
  miles: number
  gasCost: number
}

export type Totals = {
  drivingMiles: number
  drivingSeconds: number
  gasCost: number
  costsByCategory: Record<CostCategory, number>
  /** Sum of stop costs (all categories). */
  stopCosts: number
  /** Gas + stop costs. */
  totalCost: number
  /** Legs whose route hasn't been fetched yet (totals are incomplete). */
  pendingLegs: number
  /** Legs with no route; left out of the driving totals. */
  failedLegs: number
}

export type DaySummary = Totals & {
  dayId: string
  /** 1-based day number. */
  dayNumber: number
  stops: StopInput[]
  legs: Leg[]
}

export type TripSummary = {
  days: DaySummary[]
  legs: Leg[]
  totals: Totals
}

/** Byte-wise comparison, matching Postgres COLLATE "C" for position keys. */
export function comparePositions(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function emptyTotals(): Totals {
  return {
    drivingMiles: 0,
    drivingSeconds: 0,
    gasCost: 0,
    costsByCategory: { lodging: 0, food: 0, activity: 0, other: 0 },
    stopCosts: 0,
    totalCost: 0,
    pendingLegs: 0,
    failedLegs: 0,
  }
}

function addLeg(totals: Totals, leg: Leg) {
  if (leg.status === 'pending') totals.pendingLegs += 1
  if (leg.status === 'failed') totals.failedLegs += 1
  if (!leg.route) return
  totals.drivingMiles += leg.miles
  totals.drivingSeconds += leg.route.durationS
  totals.gasCost += leg.gasCost
  totals.totalCost += leg.gasCost
}

function addStopCost(totals: Totals, stop: StopInput) {
  if (stop.skipped || !stop.costAmount) return
  const category = stop.costCategory ?? 'other'
  totals.costsByCategory[category] += stop.costAmount
  totals.stopCosts += stop.costAmount
  totals.totalCost += stop.costAmount
}

function addTotals(into: Totals, from: Totals) {
  into.drivingMiles += from.drivingMiles
  into.drivingSeconds += from.drivingSeconds
  into.gasCost += from.gasCost
  into.stopCosts += from.stopCosts
  into.totalCost += from.totalCost
  into.pendingLegs += from.pendingLegs
  into.failedLegs += from.failedLegs
  for (const key of Object.keys(into.costsByCategory) as CostCategory[]) {
    into.costsByCategory[key] += from.costsByCategory[key]
  }
}

/** Gas cost for a distance, given average mpg and price per gallon. */
export function gasCost(miles: number, mpg: number, pricePerGallon: number) {
  if (mpg <= 0) return 0
  return (miles / mpg) * pricePerGallon
}

/**
 * Days in order, each with its stops in order. Stops on unknown days are
 * dropped (they'd only exist briefly during a sync).
 */
export function orderTrip(days: DayInput[], stops: StopInput[]) {
  const ordered = [...days].sort((a, b) =>
    comparePositions(a.position, b.position),
  )
  const byDay = new Map<string, StopInput[]>(ordered.map((d) => [d.id, []]))
  for (const stop of stops) byDay.get(stop.dayId)?.push(stop)
  return ordered.map((day) => ({
    day,
    stops: byDay.get(day.id)!.sort((a, b) => {
      // Start always first, end always last, regardless of position keys.
      const rank = (s: StopInput) =>
        s.kind === 'start' ? 0 : s.kind === 'end' ? 2 : 1
      return rank(a) - rank(b) || comparePositions(a.position, b.position)
    }),
  }))
}

/**
 * Summarize a trip: legs between consecutive non-skipped stops across all
 * days, attributed to the day of the arrival stop, plus stop costs per day.
 */
export function summarizeTrip(
  days: DayInput[],
  stops: StopInput[],
  options: { mpg: number; gasPricePerGallon: number; route: RouteLookup },
): TripSummary {
  const ordered = orderTrip(days, stops)

  const daySummaries: DaySummary[] = ordered.map(({ day, stops }, i) => ({
    ...emptyTotals(),
    dayId: day.id,
    dayNumber: i + 1,
    stops,
    legs: [],
  }))
  const dayIndex = new Map(daySummaries.map((d, i) => [d.dayId, i]))

  const legs: Leg[] = []
  let previous: StopInput | undefined
  for (const { stops: dayStops } of ordered) {
    for (const stop of dayStops) {
      const summary = daySummaries[dayIndex.get(stop.dayId)!]
      addStopCost(summary, stop)
      if (stop.skipped) continue
      if (previous) {
        const found = options.route(previous, stop)
        const route = found ?? undefined
        const miles = route ? route.distanceM / METERS_PER_MILE : 0
        const leg: Leg = {
          from: previous,
          to: stop,
          dayId: stop.dayId,
          route,
          status: route ? 'ok' : found === null ? 'failed' : 'pending',
          miles,
          gasCost: gasCost(miles, options.mpg, options.gasPricePerGallon),
        }
        legs.push(leg)
        summary.legs.push(leg)
        addLeg(summary, leg)
      }
      previous = stop
    }
  }

  const totals = emptyTotals()
  for (const day of daySummaries) addTotals(totals, day)

  return { days: daySummaries, legs, totals }
}

/** Date for a day, from the trip start date (YYYY-MM-DD) and 1-based number. */
export function dayDate(startDate: string | null, dayNumber: number) {
  if (!startDate) return null
  const date = new Date(`${startDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + dayNumber - 1)
  return date.toISOString().slice(0, 10)
}

/** Round to 5 decimals, matching how route_cache keys coordinates. */
export function roundCoord(value: number) {
  return Math.round(value * 1e5) / 1e5
}
