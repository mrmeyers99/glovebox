// Add-stop form: string inputs and a picked place in, a validated `stops`
// insert out. The rules mirror the database checks so mistakes are caught
// before saving. Also where a new stop goes in its day, and which point to
// bias place search toward.

import type { CostCategory, Day, Stop } from '../lib/database.types'
import type { LatLng, Place } from '../lib/geocode'
import { positionBetween } from '../lib/positions'
import { comparePositions, orderTrip } from '../lib/tripMath'
import { toDayInput, toStopInput } from '../lib/tripRows'

export type StopFormInput = {
  name: string
  notes: string
  costAmount: string
  costCategory: CostCategory | ''
  arrivalTime: string
  stay: string
}

export const emptyStopForm: StopFormInput = {
  name: '',
  notes: '',
  costAmount: '',
  costCategory: '',
  arrivalTime: '',
  stay: '',
}

export type StopFields = Pick<
  Stop,
  | 'name'
  | 'address'
  | 'lat'
  | 'lng'
  | 'notes'
  | 'cost_amount'
  | 'cost_category'
  | 'arrival_time'
  | 'stay_minutes'
>

export type StopFormErrors = Partial<
  Record<keyof StopFormInput | 'place', string>
>

export type StopFormResult =
  { ok: true; fields: StopFields } | { ok: false; errors: StopFormErrors }

export const COST_CATEGORIES: { value: CostCategory; label: string }[] = [
  { value: 'lodging', label: 'Lodging' },
  { value: 'food', label: 'Food' },
  { value: 'activity', label: 'Activity' },
  { value: 'other', label: 'Other' },
]

// stops.name: char_length between 1 and 200 (counts code points).
export const MAX_NAME_LENGTH = 200
// stops.cost_amount: numeric(10, 2), >= 0.
const MAX_COST = 99_999_999.99
// stops.stay_minutes: integer, >= 0.
const MAX_STAY_MINUTES = 2_147_483_647
// Matches the geocode function's limit.
const MAX_QUERY_LENGTH = 200
// Shorter queries match too much to be useful.
const MIN_QUERY_LENGTH = 2

/**
 * A cost in dollars, e.g. `120`, `$1,250.50`, rounded to cents like
 * numeric(10, 2). Null if it isn't a number of 0 or more within range.
 */
export function parseCost(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, '').replace(/,/g, '')
  if (!/^(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null
  const value = Math.round(Number(cleaned) * 100) / 100
  return value <= MAX_COST ? value : null
}

/**
 * A stay duration in minutes. Accepts plain minutes (`90`), `H:MM` (`1:30`),
 * or hours and/or minutes (`2h`, `45m`, `1h 30m`, `1.5h`). Null if invalid.
 */
export function parseStay(text: string): number | null {
  const s = text.trim().toLowerCase()
  let minutes: number | null = null

  let match: RegExpMatchArray | null
  if ((match = s.match(/^(\d+)$/))) {
    minutes = Number(match[1])
  } else if ((match = s.match(/^(\d+):([0-5]\d)$/))) {
    minutes = Number(match[1]) * 60 + Number(match[2])
  } else if (
    (match = s.match(
      /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/,
    )) &&
    (match[1] !== undefined || match[2] !== undefined)
  ) {
    minutes = Math.round(Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0))
  }

  return minutes !== null && minutes <= MAX_STAY_MINUTES ? minutes : null
}

/** A Postgres `time` from an `<input type="time">` (HH:MM or HH:MM:SS). */
function isValidTime(text: string) {
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(text)
}

export function parseStopForm(
  input: StopFormInput,
  place: Place | null,
): StopFormResult {
  const errors: StopFormErrors = {}

  if (!place) errors.place = 'Search for a place and pick one from the list.'

  const name = input.name.trim()
  if (name === '') errors.name = 'Enter a name.'
  else if ([...name].length > MAX_NAME_LENGTH)
    errors.name = `Keep the name to ${MAX_NAME_LENGTH} characters.`

  let costAmount: number | null = null
  if (input.costAmount.trim() !== '') {
    costAmount = parseCost(input.costAmount)
    if (costAmount === null)
      errors.costAmount = 'Enter an amount of $0 or more, or leave it blank.'
  }

  const arrivalTime = input.arrivalTime.trim()
  if (arrivalTime !== '' && !isValidTime(arrivalTime))
    errors.arrivalTime = 'Enter a time like 2:30 PM, or leave it blank.'

  let stay: number | null = null
  if (input.stay.trim() !== '') {
    stay = parseStay(input.stay)
    if (stay === null)
      errors.stay =
        'Enter a duration like 45m, 2h or 1h 30m, or leave it blank.'
  }

  if (Object.keys(errors).length > 0 || !place) return { ok: false, errors }

  const notes = input.notes.trim()
  return {
    ok: true,
    fields: {
      name,
      address: place.address.trim() === '' ? null : place.address,
      lat: place.lat,
      lng: place.lng,
      notes: notes === '' ? null : notes,
      cost_amount: costAmount,
      // A category without an amount means nothing; don't store it.
      cost_category:
        costAmount === null || input.costCategory === ''
          ? null
          : input.costCategory,
      arrival_time: arrivalTime === '' ? null : arrivalTime,
      stay_minutes: stay,
    },
  }
}

/**
 * The name to show after picking `place`: the place's name, unless the user
 * has typed their own name (one that isn't blank or the last pick's name).
 */
export function nameAfterPick(
  currentName: string,
  previous: Pick<Place, 'name'> | null,
  place: Place,
): string {
  const current = currentName.trim()
  if (current === '' || current === previous?.name) return place.name
  return currentName
}

/** The text to send to place search, or null if it's too short to search. */
export function placeQuery(text: string): string | null {
  const q = text.trim().slice(0, MAX_QUERY_LENGTH).trim()
  return [...q].length >= MIN_QUERY_LENGTH ? q : null
}

/**
 * A position key for a new waypoint at the end of a day whose stops are
 * `dayStops`, but before the trip's end stop if it's on that day.
 */
export function newStopPosition(
  dayStops: Pick<Stop, 'kind' | 'position'>[],
): string {
  let last: string | null = null
  let end: string | null = null
  for (const stop of dayStops) {
    if (stop.kind === 'end') end = stop.position
    else if (last === null || comparePositions(stop.position, last) > 0)
      last = stop.position
  }
  // The end stop is always listed last whatever its key, so if keys are
  // somehow out of order, sorting after the other stops is enough.
  if (end !== null && (last === null || comparePositions(last, end) < 0)) {
    return positionBetween(last, end)
  }
  return positionBetween(last, null)
}

/**
 * Where to bias place search for a stop added to `dayId`: the active stop the
 * new one would follow (the last one before it on that day or an earlier
 * day), else any active stop on the trip.
 */
export function searchFocus(
  days: Day[],
  stops: Stop[],
  dayId: string,
): LatLng | undefined {
  const ordered = orderTrip(days.map(toDayInput), stops.map(toStopInput))
  const index = ordered.findIndex((d) => d.day.id === dayId)
  const toPoint = (s: { lat: number; lng: number }) => ({
    lat: s.lat,
    lng: s.lng,
  })

  for (let i = index; i >= 0; i--) {
    const candidates = ordered[i].stops.filter(
      (s) => !s.skipped && (i !== index || s.kind !== 'end'),
    )
    const last = candidates.at(-1)
    if (last) return toPoint(last)
  }
  for (const { stops: dayStops } of ordered) {
    const active = dayStops.find((s) => !s.skipped)
    if (active) return toPoint(active)
  }
  return undefined
}
