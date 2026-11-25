import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'
import { comparePositions } from './tripMath'

/**
 * Fractional-indexing keys for `position` columns (days, stops). Keys sort
 * byte-wise (`comparePositions`, Postgres `COLLATE "C"`), so an item can be
 * inserted or moved between two others without renumbering the rest.
 */

function checkOrder(before: string | null, after: string | null): void {
  if (
    before !== null &&
    after !== null &&
    comparePositions(before, after) >= 0
  ) {
    throw new Error(`Position ${before} must sort before ${after}`)
  }
}

/** A key strictly between `before` and `after`; `null` means open-ended. */
export function positionBetween(
  before: string | null,
  after: string | null,
): string {
  checkOrder(before, after)
  return generateKeyBetween(before, after)
}

/** `n` ascending keys strictly between `before` and `after`. */
export function positionsBetween(
  before: string | null,
  after: string | null,
  n: number,
): string[] {
  checkOrder(before, after)
  return generateNKeysBetween(before, after, n)
}

function extreme(existing: string[], sign: 1 | -1): string | null {
  let result: string | null = null
  for (const key of existing) {
    if (result === null || sign * comparePositions(key, result) > 0)
      result = key
  }
  return result
}

/** A key after every key in `existing` (which need not be sorted). */
export function positionAtEnd(existing: string[]): string {
  return positionBetween(extreme(existing, 1), null)
}

/** A key before every key in `existing` (which need not be sorted). */
export function positionAtStart(existing: string[]): string {
  return positionBetween(null, extreme(existing, -1))
}
