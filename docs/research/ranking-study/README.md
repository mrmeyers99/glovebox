# Ranking study (#59)

Tunes the attraction score weights for #57 against a human-labelled route:
Mitchell, SD → Waterloo, IA.

## Steps

1. `node docs/research/ranking-study/fetch.mjs` rebuilds `places.csv` from OpenStreetMap
   (Overpass), Wikidata, English Wikipedia pageviews and Wikimedia Commons. It needs network
   access to `overpass-api.de`, `www.wikidata.org`, `wikimedia.org` and `commons.wikimedia.org`.
2. `node docs/research/ranking-study/sample.mjs` picks the places to label and writes
   `places.json`: every segment's prototype top 10, every variant's top 5, then a seeded random
   fill to 110.
3. Publish `label.html` with `places.json` beside it as an artifact with the `db` capability.
   Each answer is saved to the `labels` collection as `{label: 'stop' | 'maybe' | 'no'}`, keyed by
   place id. Export them to `labels.csv` (`id,label`).
4. `node docs/research/ranking-study/evaluate.mjs` scores every variant, tunes the weights by
   coordinate descent from the prototype, checks the tuned weights with leave-one-segment-out,
   and writes `results.csv`.

## Files

- `lib.mjs`: route, corridor geometry, candidate filter, scoring, the measure, CSV helpers.
- `places.csv`: every candidate with its signals. `segment` is one of 8 equal stretches of route.
- `labels.csv`: the owner's answers.
- `results.csv`: "would stop" places in each segment's top 5, per variant (8 segments × 5 = 40
  slots).

## Measure

For each variant, rank the places within each segment and count how many of the top 5 the owner
marked "would stop" (ties broken by "maybe"). A place nobody labelled counts as a miss and is
reported in the `unlabelled` column.

"More local" blends the place's percentile on the whole route with its percentile among places
within 25 km along the route, so a modest stop on an empty stretch can outrank a busy city's
fifth-best museum in the same segment.
