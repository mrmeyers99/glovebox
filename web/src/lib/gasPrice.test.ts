import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('./supabase', () => ({ supabase: { functions: { invoke } } }))

const {
  effectiveGasPrice,
  formatNationalAverage,
  loadNationalAverage,
  parseNationalAverage,
  resetNationalAverageForTests,
} = await import('./gasPrice')

const response = {
  region: 'US',
  price_per_gallon: 3.061,
  as_of: '2026-11-23',
  fetched_at: '2026-11-25T12:00:00.000Z',
  stale: false,
}
const average = { pricePerGallon: 3.061, asOf: '2026-11-23' }

beforeEach(() => {
  invoke.mockReset()
  resetNationalAverageForTests()
})

describe('parseNationalAverage', () => {
  it('reads the price and week', () => {
    expect(parseNationalAverage(response)).toEqual(average)
  })

  it('rejects anything else', () => {
    for (const bad of [
      null,
      'x',
      {},
      { ...response, price_per_gallon: '3.06' },
      { ...response, price_per_gallon: 0 },
      { ...response, as_of: 'last week' },
    ]) {
      expect(parseNationalAverage(bad)).toBeNull()
    }
  })
})

describe('loadNationalAverage', () => {
  it('calls the function once per session', async () => {
    invoke.mockResolvedValue({ data: response, error: null })
    expect(await loadNationalAverage()).toEqual(average)
    expect(await loadNationalAverage()).toEqual(average)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('gas-price', { method: 'GET' })
  })

  it('tries again after a failure', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error('down') })
    await expect(loadNationalAverage()).rejects.toThrow('down')
    invoke.mockResolvedValueOnce({ data: { error: 'x' }, error: null })
    await expect(loadNationalAverage()).rejects.toThrow()
    invoke.mockResolvedValueOnce({ data: response, error: null })
    expect(await loadNationalAverage()).toEqual(average)
    expect(invoke).toHaveBeenCalledTimes(3)
  })
})

describe('formatNationalAverage', () => {
  it('shows dollars and cents and the week', () => {
    expect(formatNationalAverage(average)).toBe(
      'National average: $3.06 (as of Nov 23, 2026)',
    )
  })
})

describe('effectiveGasPrice', () => {
  it("uses the trip's own price when set", () => {
    expect(effectiveGasPrice(3.5, average)).toBe(3.5)
    expect(effectiveGasPrice(3.5, null)).toBe(3.5)
  })

  it('falls back to the national average', () => {
    expect(effectiveGasPrice(null, average)).toBe(3.061)
  })

  it('is unknown without either', () => {
    expect(effectiveGasPrice(null, null)).toBeNull()
  })
})
