// Scores every variant against labels.csv and tunes the weights.
// Run: node docs/research/ranking-study/evaluate.mjs
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  PROTOTYPE,
  VARIANTS,
  evaluate,
  loadPlaces,
  readCsv,
  writeCsv,
} from './lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const places = loadPlaces(join(here, 'places.csv'))
const labels = new Map(
  readCsv(join(here, 'labels.csv')).map((r) => [r.id, r.label]),
)
const GROUPS = ['campground', 'venue', 'attraction', 'nature', 'historic']

// A variant is better if more "would stop" land in the top 5, then more "maybe".
const key = (r) => r.stop * 1000 + r.maybe

const SPACE = {
  pageviews: [0.5, 0.75, 1, 1.5],
  commons: [0, 0.3, 0.6, 0.9, 1.2, 1.5],
  sitelinks: [0, 0.25, 0.5, 0.75, 1],
  photo: [0, 0.2, 0.5],
  local: [0, 0.25, 0.5, 0.75],
  commonsSearch: [false, true],
  ...Object.fromEntries(
    GROUPS.map((g) => [`bonus.${g}`, [-1, -0.5, 0, 0.25, 0.5, 1]]),
  ),
}
const getP = (w, k) =>
  k.startsWith('bonus.') ? (w.bonus[k.slice(6)] ?? 0) : w[k]
const setP = (w, k, v) =>
  k.startsWith('bonus.')
    ? { ...w, bonus: { ...w.bonus, [k.slice(6)]: v } }
    : { ...w, [k]: v }

/** Coordinate descent from the prototype, scored on `subset` of places. */
function tune(subset) {
  let best = { ...PROTOTYPE, name: 'tuned' }
  let bestKey = key(evaluate(subset, labels, best))
  for (let round = 0, improved = true; improved && round < 10; round++) {
    improved = false
    for (const [k, values] of Object.entries(SPACE))
      for (const v of values) {
        if (v === getP(best, k)) continue
        const cand = setP(best, k, v)
        const ck = key(evaluate(subset, labels, cand))
        if (ck > bestKey) ((best = cand), (bestKey = ck), (improved = true))
      }
  }
  return best
}

const tuned = tune(places)

// Leave one segment out: tune on the others, measure on the held-out segment.
const segments = [...new Set(places.map((p) => p.segment))].sort(
  (a, b) => a - b,
)
let cv = { stop: 0, maybe: 0, unlabelled: 0, slots: 0 }
for (const s of segments) {
  const w = tune(places.filter((p) => p.segment !== s))
  const r = evaluate(
    places.filter((p) => p.segment === s),
    labels,
    w,
  )
  for (const k of Object.keys(cv)) cv[k] += r[k]
}

const describe = (w) =>
  `pv ${w.pageviews} · commons ${w.commons} · sitelinks ${w.sitelinks} · photo ${w.photo} · local ${w.local}` +
  `${w.commonsSearch ? ' · name search' : ''} · bonus ${JSON.stringify(w.bonus)}`

const rows = [...VARIANTS, tuned].map((w) => ({
  variant: w.name,
  ...evaluate(places, labels, w),
  weights: describe(w),
}))
rows.push({
  variant: 'tuned (leave-one-segment-out)',
  ...cv,
  weights: 'tuned per fold',
})
writeCsv(join(here, 'results.csv'), rows, [
  'variant',
  'stop',
  'maybe',
  'unlabelled',
  'slots',
  'weights',
])
console.table(rows)
console.log(JSON.stringify(tuned, null, 2))
