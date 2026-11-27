import { assertEquals, assertThrows } from '@std/assert'
import {
  FIRST_RETRY_MS,
  inTile,
  MAX_RETRY_MS,
  retryDelayMs,
  tileBounds,
} from './tiles.ts'

Deno.test('tileBounds reads the south-west corner from the key', () => {
  assertEquals(tileBounds('43.5_-98.5'), {
    south: 43.5,
    west: -98.5,
    north: 44,
    east: -98,
  })
  assertEquals(tileBounds('-0.5_0.0'), {
    south: -0.5,
    west: 0,
    north: 0,
    east: 0.5,
  })
  assertThrows(() => tileBounds('43.7_-98.5'), Error, 'Bad tile key')
  assertThrows(() => tileBounds('x'), Error, 'Bad tile key')
})

Deno.test(
  'inTile puts points on a grid line in the tile to the north / east',
  () => {
    const bounds = tileBounds('43.5_-98.5')
    assertEquals(inTile(bounds, 43.7, -98.2), true)
    assertEquals(inTile(bounds, 43.5, -98.5), true)
    assertEquals(inTile(bounds, 44, -98.2), false)
    assertEquals(inTile(bounds, 43.7, -98), false)
    assertEquals(inTile(bounds, 43.49, -98.2), false)
    assertEquals(inTile(bounds, 43.7, -98.51), false)
  },
)

Deno.test('retryDelayMs backs off 4× per failure, capped at a week', () => {
  const minutes = (n: number) => retryDelayMs(n) / 60_000
  assertEquals([1, 2, 3, 4].map(minutes), [15, 60, 240, 960])
  assertEquals(retryDelayMs(0), FIRST_RETRY_MS)
  assertEquals(retryDelayMs(6), MAX_RETRY_MS)
  assertEquals(retryDelayMs(50), MAX_RETRY_MS)
})
