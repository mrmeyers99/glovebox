import { assertEquals } from '@std/assert'
import { localPercentile, tileKey, tileNeighbourhood } from './percentile.ts'

Deno.test('tileKey matches public.place_tile_key()', () => {
  assertEquals(tileKey(42.7, -96.2), '42.5_-96.5')
  assertEquals(tileKey(42.2, -97.0), '42.0_-97.0')
  assertEquals(tileKey(42.5, -96.5), '42.5_-96.5')
  assertEquals(tileKey(-0.2, 0), '-0.5_0.0')
  assertEquals(tileKey(-0, -0.0001), '0.0_-0.5')
  assertEquals(tileKey(0.49, 0.5), '0.0_0.5')
})

Deno.test('tileNeighbourhood is the tile and its eight neighbours', () => {
  assertEquals(tileNeighbourhood('42.5_-96.5').sort(), [
    '42.0_-96.0',
    '42.0_-96.5',
    '42.0_-97.0',
    '42.5_-96.0',
    '42.5_-96.5',
    '42.5_-97.0',
    '43.0_-96.0',
    '43.0_-96.5',
    '43.0_-97.0',
  ])
})

Deno.test(
  'tileNeighbourhood wraps the antimeridian and stops at the poles',
  () => {
    const east = tileNeighbourhood('10.0_179.5')
    assertEquals(east.includes('10.0_-180.0'), true)
    const west = tileNeighbourhood('10.0_-180.0')
    assertEquals(west.includes('10.0_179.5'), true)
    const north = tileNeighbourhood('89.5_0.0')
    assertEquals(north.length, 6)
    assertEquals(
      north.some((k) => k.startsWith('90')),
      false,
    )
    assertEquals(tileNeighbourhood('-90.0_0.0').length, 6)
  },
)

interface P {
  tile: string
  score: number | null
}
const score = (p: P) => p.score
const tile = (p: P) => p.tile

Deno.test('percentile within a group, from 0 to 1', () => {
  const places: P[] = [
    { tile: 'a', score: 1 },
    { tile: 'a', score: 3 },
    { tile: 'a', score: 2 },
    { tile: 'b', score: 100 },
  ]
  assertEquals(localPercentile(places, tile, { score }), [0, 1, 0.5, 1])
})

Deno.test('a quirky stop on an empty stretch is the best around here', () => {
  // Porter Sculpture Park: low nationally, alone in its area.
  const places: P[] = [
    { tile: 'empty', score: 0.4 },
    { tile: 'city', score: 3 },
    { tile: 'city', score: 5 },
  ]
  assertEquals(localPercentile(places, tile, { score })[0], 1)
})

Deno.test('ties share their middle rank; unscored places are left out', () => {
  const places: P[] = [
    { tile: 'a', score: 1 },
    { tile: 'a', score: 2 },
    { tile: 'a', score: 2 },
    { tile: 'a', score: 3 },
    { tile: 'a', score: null },
  ]
  assertEquals(localPercentile(places, tile, { score }), [0, 0.5, 0.5, 1, null])
})

Deno.test('neighbouring groups are compared together', () => {
  const places: P[] = [
    { tile: '42.5_-96.5', score: 1 },
    { tile: '43.0_-96.5', score: 2 }, // north neighbour
    { tile: '45.0_-96.5', score: 3 }, // far away
  ]
  assertEquals(
    localPercentile(places, tile, { score, neighbours: tileNeighbourhood }),
    [0, 1, 1],
  )
})

Deno.test('empty input', () => {
  assertEquals(localPercentile([] as P[], tile, { score }), [])
})
