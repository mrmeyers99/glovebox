import { describe, expect, it } from 'vitest'
import { CONTINENTAL_US_BOUNDS, initialBounds } from './mapView'

const stop = (lat: number, lng: number, skipped = false) => ({
  lat,
  lng,
  skipped,
})

describe('initialBounds', () => {
  it('shows the continental US when there are no stops', () => {
    expect(initialBounds([])).toEqual(CONTINENTAL_US_BOUNDS)
  })

  it('shows the continental US when every stop is skipped', () => {
    expect(initialBounds([stop(40, -100, true)])).toEqual(CONTINENTAL_US_BOUNDS)
  })

  it('contains all active stops', () => {
    expect(
      initialBounds([
        stop(37.77, -122.42),
        stop(36.17, -115.14),
        stop(39.74, -104.99),
      ]),
    ).toEqual([
      [-122.42, 36.17],
      [-104.99, 39.74],
    ])
  })

  it('leaves out skipped stops', () => {
    expect(
      initialBounds([stop(37.77, -122.42), stop(25.76, -80.19, true)]),
    ).toEqual([
      [-122.42, 37.77],
      [-122.42, 37.77],
    ])
  })

  it('ignores stops without finite coordinates', () => {
    expect(initialBounds([stop(Number.NaN, 0), stop(10, 20)])).toEqual([
      [20, 10],
      [20, 10],
    ])
  })
})
