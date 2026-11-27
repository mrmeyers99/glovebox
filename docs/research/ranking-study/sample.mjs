// Picks the places to label: every segment's prototype top 10, every variant's
// top 5 (so each variant's measure is fully labelled), then a seeded random
// fill across segments up to TARGET. Writes places.json for label.html.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  PROTOTYPE,
  VARIANTS,
  loadPlaces,
  rng,
  segmentName,
  topPerSegment,
} from './lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const TARGET = 110
const places = loadPlaces(join(here, 'places.csv'))

const chosen = new Map()
const add = (id, why) => {
  if (!chosen.has(id)) chosen.set(id, new Set())
  chosen.get(id).add(why)
}
for (const ids of topPerSegment(places, PROTOTYPE, 10).values())
  ids.forEach((id) => add(id, 'prototype top 10'))
for (const v of VARIANTS)
  for (const ids of topPerSegment(places, v, 5).values())
    ids.forEach((id) => add(id, `${v.name} top 5`))

const rand = rng(59)
const rest = places.filter((p) => !chosen.has(p.id))
while (chosen.size < TARGET && rest.length) {
  const [p] = rest.splice(Math.floor(rand() * rest.length), 1)
  add(p.id, 'random')
}

const set = places
  .filter((p) => chosen.has(p.id))
  .map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    segment: p.segment,
    stretch: segmentName(p.segment),
    lat: Number(p.lat),
    lon: Number(p.lon),
    enwiki: p.enwiki,
    wikidata: p.wikidata,
    website: p.website,
    reasons: [...chosen.get(p.id)],
  }))
writeFileSync(join(here, 'places.json'), JSON.stringify(set, null, 2) + '\n')
console.error(`${set.length} places to label`)
