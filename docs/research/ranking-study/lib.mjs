// Shared helpers for the ranking study (#59). Plain Node, no dependencies.
import { readFileSync, writeFileSync } from 'node:fs'

// Mitchell, SD → Waterloo, IA along I-90, US-18 and US-218. Approximate: the
// study needs the right towns in the corridor, not turn-by-turn accuracy.
export const ROUTE = [
  [43.7094, -98.0298, 'Mitchell'],
  [43.6886, -97.4462, 'Montrose'], // Porter Sculpture Park
  [43.5446, -96.7311, 'Sioux Falls'],
  [43.6211, -96.2004, 'Brandon'],
  [43.6197, -95.5958, 'Worthington'],
  [43.4214, -95.1022, 'Okoboji'],
  [43.1144, -94.6831, 'Emmetsburg'],
  [43.0733, -94.233, 'Algona'],
  [43.138, -93.38, 'Clear Lake'],
  [43.1536, -93.201, 'Mason City'],
  [43.0664, -92.6724, 'Charles City'],
  [42.7258, -92.4746, 'Waverly'],
  [42.4928, -92.3426, 'Waterloo'],
]

export const CORRIDOR_METERS = 12000
export const SEGMENT_COUNT = 8

// ---- geometry ---------------------------------------------------------------

const R = 6371000
const rad = (d) => (d * Math.PI) / 180

function toXY([lat, lon], lat0) {
  return [R * rad(lon) * Math.cos(rad(lat0)), R * rad(lat)]
}

const LAT0 = ROUTE.reduce((s, p) => s + p[0], 0) / ROUTE.length
const ROUTE_XY = ROUTE.map((p) => toXY(p, LAT0))
const CUM = [0]
for (let i = 1; i < ROUTE_XY.length; i++) {
  const [x0, y0] = ROUTE_XY[i - 1]
  const [x1, y1] = ROUTE_XY[i]
  CUM.push(CUM[i - 1] + Math.hypot(x1 - x0, y1 - y0))
}
export const ROUTE_LENGTH = CUM[CUM.length - 1]

/** Distance along the route (m) and off the route (m) of a point. */
export function locate(lat, lon) {
  const [px, py] = toXY([lat, lon], LAT0)
  let best = { along: 0, off: Infinity }
  for (let i = 1; i < ROUTE_XY.length; i++) {
    const [x0, y0] = ROUTE_XY[i - 1]
    const [x1, y1] = ROUTE_XY[i]
    const dx = x1 - x0
    const dy = y1 - y0
    const len2 = dx * dx + dy * dy
    const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2))
    const off = Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
    if (off < best.off) best = { along: CUM[i - 1] + t * Math.sqrt(len2), off }
  }
  return best
}

/** "Sioux Falls to Worthington": the nearest route towns at a segment's ends. */
export function segmentName(segment) {
  const town = (along) => {
    let best = 0
    CUM.forEach((d, i) => {
      if (Math.abs(d - along) < Math.abs(CUM[best] - along)) best = i
    })
    return ROUTE[best][2]
  }
  const a = town((segment / SEGMENT_COUNT) * ROUTE_LENGTH)
  const b = town(((segment + 1) / SEGMENT_COUNT) * ROUTE_LENGTH)
  return a === b ? `Around ${a}` : `${a} to ${b}`
}

export function segmentOf(along) {
  return Math.min(
    SEGMENT_COUNT - 1,
    Math.floor((along / ROUTE_LENGTH) * SEGMENT_COUNT),
  )
}

// ---- candidate filter (mirrors the allow-list planned for #57) ---------------

const TOURISM = new Set([
  'attraction',
  'museum',
  'viewpoint',
  'zoo',
  'theme_park',
  'gallery',
  'aquarium',
  'camp_site',
  'caravan_site',
])
const HISTORIC_DROP = new Set([
  'yes',
  'district',
  'boundary_stone',
  'milestone',
  'grave',
])

/** The category that makes a place a candidate, or null. */
export function candidateCategory(t) {
  if (t.highway && t.historic === 'yes') return null
  if (TOURISM.has(t.tourism)) return `tourism=${t.tourism}`
  if (
    t.tourism === 'artwork' &&
    ['statue', 'sculpture'].includes(t.artwork_type)
  )
    return 'tourism=artwork'
  if (
    t.amenity === 'place_of_worship' ||
    t.landuse === 'cemetery' ||
    t.amenity === 'grave_yard'
  )
    return null
  if (t.historic === 'memorial' && t.memorial === 'statue')
    return 'historic=memorial'
  if (
    t.historic &&
    !HISTORIC_DROP.has(t.historic) &&
    (t.wikidata || t.historic !== 'memorial')
  )
    return `historic=${t.historic}`
  if (t.wikidata && (t.leisure === 'park' || t.leisure === 'nature_reserve'))
    return `leisure=${t.leisure}`
  if (
    t.wikidata &&
    (t.boundary === 'protected_area' || t.boundary === 'national_park')
  )
    return `boundary=${t.boundary}`
  if (t.waterway === 'waterfall' || t.natural === 'waterfall')
    return 'natural=waterfall'
  if (t.natural === 'peak' && t.name) return 'natural=peak'
  if (t.natural === 'cave_entrance') return 'natural=cave_entrance'
  if (t.man_made === 'windmill') return 'man_made=windmill'
  return null
}

/** Coarse groups used for category bonuses. */
export function categoryGroup(category) {
  if (/camp_site|caravan_site/.test(category)) return 'campground'
  if (/museum|gallery|aquarium|zoo|theme_park/.test(category)) return 'venue'
  if (/attraction|artwork|memorial|windmill/.test(category)) return 'attraction'
  if (/leisure|boundary|waterfall|peak|cave|viewpoint/.test(category))
    return 'nature'
  if (/historic/.test(category)) return 'historic'
  return 'other'
}

// ---- scoring ----------------------------------------------------------------

const log = (x) => Math.log10(1 + (Number(x) || 0))

export const PROTOTYPE = {
  name: 'prototype',
  pageviews: 1,
  commons: 0.6,
  sitelinks: 0.5,
  photo: 0.2,
  bonus: {},
  local: 0,
  commonsSearch: false,
}

export function baseScore(p, w) {
  const commons =
    w.commonsSearch && !p.commons_category
      ? p.commons_search_hits
      : p.commons_files
  return (
    w.pageviews * log(p.pageviews_month) +
    w.commons * log(commons) +
    w.sitelinks * log(p.sitelinks) +
    (w.bonus[p.group] ?? 0) +
    (p.has_photo === 'true' || p.has_photo === true ? w.photo : 0)
  )
}

function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return values.map((v) => {
    let lo = 0
    while (lo < sorted.length && sorted[lo] < v) lo++
    return sorted.length > 1 ? lo / (sorted.length - 1) : 1
  })
}

export const LOCAL_WINDOW_METERS = 25000

/**
 * Final score: a blend of the place's percentile on the whole route and its
 * percentile among places within LOCAL_WINDOW_METERS along the route.
 */
export function scoreAll(places, w) {
  const base = places.map((p) => baseScore(p, w))
  if (!w.local) return base
  const global = percentiles(base)
  return places.map((p, i) => {
    const near = []
    places.forEach((q, j) => {
      if (Math.abs(q.along_m - p.along_m) <= LOCAL_WINDOW_METERS)
        near.push(base[j])
    })
    const local = percentiles([...near, base[i]]).at(-1)
    return (1 - w.local) * global[i] + w.local * local
  })
}

/** Ids of each segment's top `n` places under a variant. */
export function topPerSegment(places, w, n) {
  const scores = scoreAll(places, w)
  const bySeg = new Map()
  places.forEach((p, i) => {
    const list = bySeg.get(p.segment) ?? []
    list.push({ id: p.id, s: scores[i] })
    bySeg.set(p.segment, list)
  })
  const out = new Map()
  for (const [seg, list] of bySeg) {
    list.sort((a, b) => b.s - a.s || (a.id < b.id ? -1 : 1))
    out.set(
      seg,
      list.slice(0, n).map((x) => x.id),
    )
  }
  return out
}

/** The study's measure: "would stop" places landing in each segment's top 5. */
export function evaluate(places, labels, w, n = 5) {
  const top = topPerSegment(places, w, n)
  let stop = 0
  let maybe = 0
  let unlabelled = 0
  for (const ids of top.values())
    for (const id of ids) {
      const l = labels.get(id)
      if (l === 'stop') stop++
      else if (l === 'maybe') maybe++
      else if (!l) unlabelled++
    }
  return {
    stop,
    maybe,
    unlabelled,
    slots: [...top.values()].reduce((s, l) => s + l.length, 0),
  }
}

// ---- CSV --------------------------------------------------------------------

export function readCsv(path) {
  const text = readFileSync(path, 'utf8').trim()
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') ((cell += '"'), i++)
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') (row.push(cell), (cell = ''))
    else if (c === '\n')
      (row.push(cell), rows.push(row), (row = []), (cell = ''))
    else if (c !== '\r') cell += c
  }
  row.push(cell)
  rows.push(row)
  const [head, ...body] = rows
  return body.map((r) =>
    Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])),
  )
}

export function writeCsv(path, rows, columns = Object.keys(rows[0] ?? {})) {
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  writeFileSync(
    path,
    [
      columns.join(','),
      ...rows.map((r) => columns.map((c) => esc(r[c])).join(',')),
    ].join('\n') + '\n',
  )
}

export function loadPlaces(path) {
  return readCsv(path).map((p) => ({
    ...p,
    segment: Number(p.segment),
    along_m: Number(p.along_m),
  }))
}

// ---- variants compared in the write-up ----------------------------------------

const only = (name, key) => ({
  ...PROTOTYPE,
  name,
  pageviews: 0,
  commons: 0,
  sitelinks: 0,
  photo: 0,
  [key]: 1,
})

export const VARIANTS = [
  only('pageviews only', 'pageviews'),
  only('commons only', 'commons'),
  only('sitelinks only', 'sitelinks'),
  PROTOTYPE,
  { ...PROTOTYPE, name: 'more commons', commons: 1.2 },
  { ...PROTOTYPE, name: 'more local', local: 0.5 },
  { ...PROTOTYPE, name: 'commons name search', commonsSearch: true },
]

/** Seeded PRNG so the labelling sample is reproducible. */
export function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
