import { describe, expect, it } from 'vitest'
import type { Trip } from '../lib/database.types'
import {
  changedSettings,
  parseTripSettings,
  toSettingsInput,
  type TripSettingsInput,
} from './tripSettings'

const trip: Trip = {
  id: 't1',
  owner_id: 'u1',
  name: 'Cross-country',
  start_date: '2027-06-01',
  mpg: 25,
  gas_price_per_gallon: null,
  created_at: '2026-11-25T00:00:00Z',
  updated_at: '2026-11-25T00:00:00Z',
}

const valid: TripSettingsInput = {
  name: ' Cross-country ',
  startDate: '2027-06-01',
  mpg: '27.5',
  gasPrice: '3.459',
}

function errorsFor(input: Partial<TripSettingsInput>) {
  const result = parseTripSettings({ ...valid, ...input })
  return result.ok ? {} : result.errors
}

describe('toSettingsInput', () => {
  it('shows a blank gas price and start date when unset', () => {
    expect(toSettingsInput({ ...trip, start_date: null })).toEqual({
      name: 'Cross-country',
      startDate: '',
      mpg: '25',
      gasPrice: '',
    })
  })

  it('round-trips through parseTripSettings', () => {
    const input = toSettingsInput({ ...trip, gas_price_per_gallon: 3.5 })
    expect(parseTripSettings(input)).toEqual({
      ok: true,
      patch: {
        name: 'Cross-country',
        start_date: '2027-06-01',
        mpg: 25,
        gas_price_per_gallon: 3.5,
      },
    })
  })
})

describe('parseTripSettings', () => {
  it('trims the name and parses numbers', () => {
    expect(parseTripSettings(valid)).toEqual({
      ok: true,
      patch: {
        name: 'Cross-country',
        start_date: '2027-06-01',
        mpg: 27.5,
        gas_price_per_gallon: 3.459,
      },
    })
  })

  it('treats blank gas price and start date as null', () => {
    const result = parseTripSettings({ ...valid, gasPrice: ' ', startDate: '' })
    expect(result.ok && result.patch).toMatchObject({
      start_date: null,
      gas_price_per_gallon: null,
    })
  })

  it('requires a name of at most 200 characters', () => {
    expect(errorsFor({ name: '   ' })).toHaveProperty('name')
    expect(errorsFor({ name: 'x'.repeat(201) })).toHaveProperty('name')
    expect(errorsFor({ name: 'x'.repeat(200) })).toEqual({})
    // Counted in code points, like Postgres char_length.
    expect(errorsFor({ name: '🚗'.repeat(200) })).toEqual({})
  })

  it('requires mpg greater than 0', () => {
    for (const mpg of ['', '0', '-5', 'abc', '1e3', '0.04', '10000']) {
      expect(errorsFor({ mpg }), mpg).toHaveProperty('mpg')
    }
    expect(errorsFor({ mpg: '.5' })).toEqual({})
  })

  it('requires gas price greater than 0 or blank', () => {
    for (const gasPrice of ['0', '-1', 'free', '0.0004', '1000']) {
      expect(errorsFor({ gasPrice }), gasPrice).toHaveProperty('gasPrice')
    }
  })

  it('rounds to the column scale', () => {
    const result = parseTripSettings({
      ...valid,
      mpg: '25.06',
      gasPrice: '3.4567',
    })
    expect(result.ok && result.patch).toMatchObject({
      mpg: 25.1,
      gas_price_per_gallon: 3.457,
    })
  })

  it('rejects impossible dates', () => {
    expect(errorsFor({ startDate: '2027-02-30' })).toHaveProperty('startDate')
    expect(errorsFor({ startDate: 'June 1' })).toHaveProperty('startDate')
  })

  it('reports every invalid field at once', () => {
    expect(
      Object.keys(errorsFor({ name: '', mpg: '0', gasPrice: '0' })),
    ).toEqual(['name', 'mpg', 'gasPrice'])
  })
})

describe('changedSettings', () => {
  function patchFrom(input: Partial<TripSettingsInput>) {
    const result = parseTripSettings({ ...toSettingsInput(trip), ...input })
    if (!result.ok) throw new Error('invalid input')
    return result.patch
  }

  it('is empty when nothing changed', () => {
    expect(changedSettings(patchFrom({}), trip)).toEqual({})
  })

  it('keeps only the edited fields', () => {
    // Someone else's mpg change made after the dialog opened isn't sent back.
    expect(changedSettings(patchFrom({ name: 'Road trip' }), trip)).toEqual({
      name: 'Road trip',
    })
  })

  it('includes clearing and setting nullable fields', () => {
    const priced = { ...trip, gas_price_per_gallon: 3.5 }
    expect(
      changedSettings(patchFrom({ startDate: '', gasPrice: '3.5' }), priced),
    ).toEqual({ start_date: null })
    expect(changedSettings(patchFrom({ gasPrice: '3.5' }), trip)).toEqual({
      gas_price_per_gallon: 3.5,
    })
  })
})
