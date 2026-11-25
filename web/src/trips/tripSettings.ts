// Trip settings form: string inputs in, a validated `trips` update out.
// The rules mirror the database checks so mistakes are caught before saving.

import type { Trip } from '../lib/database.types'

export type TripSettingsInput = {
  name: string
  startDate: string
  mpg: string
  gasPrice: string
}

export type TripSettingsPatch = Pick<
  Trip,
  'name' | 'start_date' | 'mpg' | 'gas_price_per_gallon'
>

export type TripSettingsErrors = Partial<
  Record<keyof TripSettingsInput, string>
>

export type TripSettingsResult =
  | { ok: true; patch: TripSettingsPatch }
  | { ok: false; errors: TripSettingsErrors }

// trips.name: char_length between 1 and 200 (counts code points).
const MAX_NAME_LENGTH = 200
// trips.mpg: numeric(5, 1); trips.gas_price_per_gallon: numeric(6, 3).
const MAX_MPG = 9999.9
const MAX_GAS_PRICE = 999.999

export function toSettingsInput(trip: Trip): TripSettingsInput {
  return {
    name: trip.name,
    startDate: trip.start_date ?? '',
    mpg: String(trip.mpg),
    gasPrice:
      trip.gas_price_per_gallon === null
        ? ''
        : String(trip.gas_price_per_gallon),
  }
}

/** Rounds like Postgres does when storing into numeric(p, scale). */
function roundTo(value: number, scale: number) {
  const factor = 10 ** scale
  return Math.round(value * factor) / factor
}

/** Parses a positive number that is still positive after rounding to `scale`. */
function parsePositive(text: string, scale: number, max: number) {
  const trimmed = text.trim()
  if (!/^\d*\.?\d+$|^\d+\.$/.test(trimmed)) return null
  const value = roundTo(Number(trimmed), scale)
  return value > 0 && value <= max ? value : null
}

export function parseTripSettings(
  input: TripSettingsInput,
): TripSettingsResult {
  const errors: TripSettingsErrors = {}

  const name = input.name.trim()
  if (name === '') errors.name = 'Enter a name.'
  else if ([...name].length > MAX_NAME_LENGTH)
    errors.name = `Keep the name to ${MAX_NAME_LENGTH} characters.`

  const startDate = input.startDate.trim()
  if (startDate !== '' && !isValidDate(startDate))
    errors.startDate = 'Enter a valid date.'

  const mpg = parsePositive(input.mpg, 1, MAX_MPG)
  if (mpg === null) errors.mpg = 'Enter an mpg greater than 0.'

  let gasPrice: number | null = null
  if (input.gasPrice.trim() !== '') {
    gasPrice = parsePositive(input.gasPrice, 3, MAX_GAS_PRICE)
    if (gasPrice === null)
      errors.gasPrice = 'Enter a price greater than 0, or leave it blank.'
  }

  if (Object.keys(errors).length > 0 || mpg === null) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    patch: {
      name,
      start_date: startDate === '' ? null : startDate,
      mpg,
      gas_price_per_gallon: gasPrice,
    },
  }
}

/** True for a real calendar date in YYYY-MM-DD form. */
function isValidDate(text: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text)
}
