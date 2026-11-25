import { describe, expect, it } from 'vitest'
import { decodePolyline } from './polyline'

describe('decodePolyline', () => {
  it("decodes Google's reference example", () => {
    // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ])
  })

  it('decodes an empty string to no points', () => {
    expect(decodePolyline('')).toEqual([])
  })

  it('round-trips points encoded like the route function does', () => {
    const points: [number, number][] = [
      [38.5733, -109.5498],
      [-89.99999, 179.99999],
      [89.99999, -179.99999],
      [0, 0],
      [0.00001, -0.00001],
    ]
    expect(decodePolyline(encodePolyline(points))).toEqual(points)
  })

  it('rejects truncated input', () => {
    // The reference example with its last character cut off.
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq')).toBeNull()
    // A latitude with no longitude.
    expect(decodePolyline('_p~iF')).toBeNull()
  })

  it('rejects characters outside the format', () => {
    expect(decodePolyline('_p~iF ps|U')).toBeNull()
  })

  it('supports other precisions', () => {
    expect(decodePolyline('_izlhA~rlgdF', 6)).toEqual([[38.5, -120.2]])
  })
})

/** Reference encoder: the same algorithm as the route Edge Function's. */
function encodePolyline(points: [number, number][]): string {
  let out = ''
  let prevLat = 0
  let prevLng = 0
  const encode = (delta: number) => {
    let value = delta < 0 ? ~(delta << 1) : delta << 1
    while (value >= 0x20) {
      out += String.fromCharCode((0x20 | (value & 0x1f)) + 63)
      value >>= 5
    }
    out += String.fromCharCode(value + 63)
  }
  for (const [lat, lng] of points) {
    const iLat = Math.round(lat * 1e5)
    const iLng = Math.round(lng * 1e5)
    encode(iLat - prevLat)
    encode(iLng - prevLng)
    prevLat = iLat
    prevLng = iLng
  }
  return out
}
