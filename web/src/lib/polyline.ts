// Google encoded polyline decoding (precision 5), the format the `route`
// Edge Function returns leg geometry in.

/**
 * Decodes an encoded polyline to [lat, lng] points. Returns null if the
 * string is malformed (truncated, or a character outside the format).
 */
export function decodePolyline(
  encoded: string,
  precision = 5,
): [number, number][] | null {
  const factor = 10 ** precision
  const points: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0
  const next = (): number | null => {
    let result = 0
    let shift = 0
    let byte: number
    do {
      if (index >= encoded.length) return null
      byte = encoded.charCodeAt(index++) - 63
      if (byte < 0 || byte > 0x3f) return null
      // Multiply rather than shift: deltas can exceed 32-bit shifts' range.
      result += (byte & 0x1f) * 2 ** shift
      shift += 5
    } while (byte >= 0x20)
    return result % 2 === 1 ? -(result + 1) / 2 : result / 2
  }
  while (index < encoded.length) {
    const dLat = next()
    const dLng = next()
    if (dLat === null || dLng === null) return null
    lat += dLat
    lng += dLng
    points.push([lat / factor, lng / factor])
  }
  return points
}
