import { assertAlmostEquals, assertEquals } from '@std/assert'
import {
  AMENITY_BONUS,
  CATEGORY_BONUS,
  campgroundScore,
  scorePlace,
} from './score.ts'

Deno.test('scorePlace follows the prototype formula', () => {
  const score = scorePlace(
    { pageviewsMonth: 999, commonsFiles: 99, sitelinks: 9, hasPhoto: true },
    'tourism=museum',
  )
  // 3 + 0.6·2 + 0.5·1 + 0.3 + 0.2
  assertAlmostEquals(score, 5.2)
})

Deno.test('unknown signals count as zero', () => {
  assertEquals(
    scorePlace({}, 'tourism=viewpoint'),
    CATEGORY_BONUS['tourism=viewpoint'],
  )
  assertEquals(
    scorePlace(
      { pageviewsMonth: null, commonsFiles: -3, sitelinks: Number.NaN },
      'not a category',
    ),
    0,
  )
  assertEquals(scorePlace({ hasPhoto: false }, 'not a category'), 0)
})

Deno.test('a well-known place outranks an obscure one', () => {
  // Corn Palace vs a minor viewpoint.
  const cornPalace = scorePlace(
    { pageviewsMonth: 9000, commonsFiles: 250, sitelinks: 20, hasPhoto: true },
    'tourism=attraction',
  )
  const viewpoint = scorePlace({ commonsFiles: 2 }, 'tourism=viewpoint')
  assertEquals(cornPalace > viewpoint, true)
})

Deno.test('every category bonus is a small non-negative number', () => {
  for (const bonus of Object.values(CATEGORY_BONUS)) {
    assertEquals(bonus >= 0 && bonus <= 1, true)
  }
})

Deno.test('a campground inherits its park score plus an amenity bonus', () => {
  assertAlmostEquals(campgroundScore(0, 2.5, 1), 2.5 + AMENITY_BONUS)
  assertAlmostEquals(campgroundScore(0.1, 2, 0.5), 2.1 + AMENITY_BONUS / 2)
  // No park (or one not scored yet): its own score and the bonus only.
  assertAlmostEquals(campgroundScore(0, null, 0), 0)
  assertAlmostEquals(campgroundScore(0, undefined, 1), AMENITY_BONUS)
  assertAlmostEquals(campgroundScore(0, Number.NaN, 0), 0)
  // Completeness is clamped to 0..1.
  assertAlmostEquals(campgroundScore(0, 1, 3), 1 + AMENITY_BONUS)
  assertAlmostEquals(campgroundScore(0, 1, -1), 1)
})
