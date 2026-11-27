import { assertEquals, assertThrows } from '@std/assert'
import { HttpError } from '../_shared/http.ts'
import { isTileKey, MAX_TILES, parseSuggestionsRequest } from './request.ts'

Deno.test('isTileKey accepts keys as place_tile_key() writes them', () => {
  for (const key of ['42.5_-96.5', '0.0_0.0', '-90.0_-180.0', '89.5_179.5']) {
    assertEquals(isTileKey(key), true, key)
  }
})

Deno.test('isTileKey rejects anything else', () => {
  for (const key of [
    42.5,
    null,
    '42.7_-96.5', // off the grid
    '42.5,-96.5',
    '-0.0_0.0', // place_tile_key() never writes -0
    '05.0_0.0',
    '90.0_0.0', // beyond the pole
    '0.0_180.0', // wraps to -180
    '0.0_-180.5',
    ' 42.5_-96.5',
  ]) {
    assertEquals(isTileKey(key), false, String(key))
  }
})

Deno.test('parses tiles and kind, dropping duplicate tiles', () => {
  assertEquals(
    parseSuggestionsRequest({
      tiles: ['42.5_-96.5', '43.0_-96.5', '42.5_-96.5'],
      kind: 'campground',
    }),
    { tiles: ['42.5_-96.5', '43.0_-96.5'], kind: 'campground' },
  )
  assertEquals(parseSuggestionsRequest({ tiles: [], kind: 'attraction' }), {
    tiles: [],
    kind: 'attraction',
  })
})

Deno.test('rejects invalid requests with 400', () => {
  const tooMany = Array.from(
    { length: MAX_TILES + 1 },
    (_, i) =>
      `${(i % 100).toFixed(1)}_${(Math.floor(i / 100) - 90).toFixed(1)}`,
  )
  const cases: [unknown, string][] = [
    [null, 'Body must be an object'],
    [[], 'Body must be an object'],
    ['tiles', 'Body must be an object'],
    [{ tiles: ['42.5_-96.5'] }, 'kind must be one of: attraction, campground'],
    [{ tiles: ['42.5_-96.5'], kind: 'hotel' }, 'kind must be one of'],
    [{ kind: 'attraction' }, 'tiles must be an array'],
    [{ tiles: '42.5_-96.5', kind: 'attraction' }, 'tiles must be an array'],
    [{ tiles: tooMany, kind: 'attraction' }, `At most ${MAX_TILES} tiles`],
    [{ tiles: ['42.5_-96.5', 7], kind: 'attraction' }, 'Not a tile key: 7'],
    [
      { tiles: ['42.7_-96.5'], kind: 'attraction' },
      'Not a tile key: "42.7_-96.5"',
    ],
  ]
  for (const [body, message] of cases) {
    const error = assertThrows(
      () => parseSuggestionsRequest(body),
      HttpError,
      message,
    )
    assertEquals(error.status, 400)
  }
})
