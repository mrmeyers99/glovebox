// Rebuilds places.csv for the Mitchell, SD → Waterloo, IA corridor.
// Needs network access to overpass-api.de, www.wikidata.org, wikimedia.org,
// commons.wikimedia.org. Run: node docs/research/ranking-study/fetch.mjs
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  CORRIDOR_METERS,
  ROUTE,
  candidateCategory,
  categoryGroup,
  locate,
  segmentOf,
  writeCsv,
} from './lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const UA = 'glovebox-ranking-study/0.1 (https://github.com/mrmeyers99/glovebox)'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function get(url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': UA, ...init.headers },
    })
    if (res.ok) return res.json()
    if (res.status === 404) return null
    if (attempt >= 4 || ![429, 500, 502, 503, 504].includes(res.status))
      throw new Error(`${res.status} ${url}`)
    await sleep(2000 * 2 ** attempt)
  }
}

const chunks = (xs, n) =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) =>
    xs.slice(i * n, i * n + n),
  )

// 1. Candidates from OSM. One query per route leg, clipped to the leg's
// bounding box: a single query over the whole route times out. A leg that
// still times out on every server is split in half and retried.
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]
const filters = [
  'tourism',
  'historic',
  'leisure~"^(park|nature_reserve)$"',
  'boundary~"^(protected_area|national_park)$"',
  'waterway=waterfall',
  'natural~"^(waterfall|peak|cave_entrance)$"',
  'man_made=windmill',
]
async function overpass(query) {
  let last
  for (const server of OVERPASS) {
    try {
      const data = await get(server, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
      })
      // Overpass reports a timeout as HTTP 200 with a remark and no elements.
      if (data?.remark) throw new Error(`${server}: ${data.remark}`)
      return data
    } catch (err) {
      last = err
      console.error(`  ${err.message}`)
    }
  }
  throw last
}

const legQuery = (a, b) => {
  const pad = CORRIDOR_METERS / 111000
  const padLon = pad / Math.cos((a[0] * Math.PI) / 180)
  const bbox = [
    Math.min(a[0], b[0]) - pad,
    Math.min(a[1], b[1]) - padLon,
    Math.max(a[0], b[0]) + pad,
    Math.max(a[1], b[1]) + padLon,
  ]
    .map((x) => x.toFixed(4))
    .join(',')
  const around = `(around:${CORRIDOR_METERS},${a[0]},${a[1]},${b[0]},${b[1]})`
  return `[out:json][timeout:300][bbox:${bbox}];(${filters.map((f) => `nwr[${f}]${around};`).join('')});out center tags;`
}

async function leg(a, b, depth = 0) {
  try {
    return (await overpass(legQuery(a, b))).elements
  } catch (err) {
    if (depth >= 2) throw err
    const mid = [
      (a[0] + b[0]) / 2,
      (a[1] + b[1]) / 2,
      `${a[2]}–${b[2]} midpoint`,
    ]
    console.error(`  splitting ${a[2]} → ${b[2]} in half`)
    return [
      ...(await leg(a, mid, depth + 1)),
      ...(await leg(mid, b, depth + 1)),
    ]
  }
}

const elements = new Map()
for (let i = 1; i < ROUTE.length; i++) {
  const [a, b] = [ROUTE[i - 1], ROUTE[i]]
  console.error(`Overpass leg ${i}/${ROUTE.length - 1} (${a[2]} → ${b[2]})…`)
  for (const el of await leg(a, b)) elements.set(`${el.type}${el.id}`, el)
  await sleep(1000)
}
const osm = { elements: [...elements.values()] }
if (!osm.elements.length) throw new Error('Overpass returned no candidates')

let places = []
for (const el of osm.elements) {
  const t = el.tags ?? {}
  if (!t.name) continue
  const category = candidateCategory(t)
  if (!category) continue
  const lat = el.lat ?? el.center?.lat
  const lon = el.lon ?? el.center?.lon
  const { along, off } = locate(lat, lon)
  if (off > CORRIDOR_METERS) continue
  places.push({
    id: `${el.type[0]}${el.id}`,
    name: t.name,
    category,
    group: categoryGroup(category),
    lat: lat.toFixed(5),
    lon: lon.toFixed(5),
    along_m: Math.round(along),
    off_route_m: Math.round(off),
    segment: segmentOf(along),
    wikidata: /^Q\d+$/.test(t.wikidata ?? '') ? t.wikidata : '',
    enwiki: t.wikipedia?.startsWith('en:') ? t.wikipedia.slice(3) : '',
    osm_image: t.image || t.wikimedia_commons ? 'true' : 'false',
    website: t.website ?? '',
  })
}

// Merge exact duplicates (same QID, or same name within 2 km) keeping the first.
const seen = []
places = places.filter((p) => {
  const dup = seen.find(
    (q) =>
      (p.wikidata && p.wikidata === q.wikidata) ||
      (p.name.toLowerCase() === q.name.toLowerCase() &&
        Math.abs(p.along_m - q.along_m) < 2000),
  )
  if (dup) return false
  seen.push(p)
  return true
})
console.error(`${places.length} candidates`)

// 2. Wikidata: sitelinks, enwiki title, image, Commons category.
const byQid = new Map(
  places.filter((p) => p.wikidata).map((p) => [p.wikidata, p]),
)
for (const ids of chunks([...byQid.keys()], 50)) {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks|claims&ids=${ids.join('|')}`
  const data = await get(url)
  for (const [qid, e] of Object.entries(data.entities ?? {})) {
    const p = byQid.get(qid)
    if (!p || e.missing !== undefined) continue
    const links = Object.keys(e.sitelinks ?? {}).filter(
      (k) => k.endsWith('wiki') && k !== 'commonswiki',
    )
    p.sitelinks = links.length
    p.enwiki ||= e.sitelinks?.enwiki?.title ?? ''
    p.wd_image = e.claims?.P18 ? 'true' : 'false'
    p.commons_category = e.claims?.P373?.[0]?.mainsnak?.datavalue?.value ?? ''
    if (
      !p.commons_category &&
      e.sitelinks?.commonswiki?.title?.startsWith('Category:')
    )
      p.commons_category = e.sitelinks.commonswiki.title.slice(9)
  }
  await sleep(200)
}

// 3. English Wikipedia pageviews: average per month over the last 12 full months.
const now = new Date()
const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
const start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), 1))
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '') + '00'
for (const p of places.filter((p) => p.enwiki)) {
  const title = encodeURIComponent(p.enwiki.replace(/ /g, '_'))
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user/${title}/monthly/${ymd(start)}/${ymd(end)}`
  const data = await get(url)
  const items = data?.items ?? []
  p.pageviews_month = items.length
    ? Math.round(items.reduce((s, i) => s + i.views, 0) / 12)
    : 0
  await sleep(50)
}

// 4. Commons: files in the place's category, and a name search for places without one.
const byCat = new Map(
  places
    .filter((p) => p.commons_category)
    .map((p) => [`Category:${p.commons_category}`, p]),
)
for (const titles of chunks([...byCat.keys()], 50)) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=categoryinfo&titles=${encodeURIComponent(titles.join('|'))}`
  const data = await get(url)
  const norm = new Map(
    (data.query?.normalized ?? []).map((n) => [n.to, n.from]),
  )
  for (const page of data.query?.pages ?? []) {
    const p = byCat.get(norm.get(page.title) ?? page.title)
    if (p) p.commons_files = page.categoryinfo?.files ?? 0
  }
  await sleep(200)
}
for (const p of places.filter((p) => !p.commons_category)) {
  const q = `"${p.name}"`
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srnamespace=6&srlimit=1&srinfo=totalhits&srsearch=${encodeURIComponent(q)}`
  const data = await get(url)
  p.commons_search_hits = data.query?.searchinfo?.totalhits ?? 0
  await sleep(100)
}

for (const p of places) {
  p.sitelinks ??= 0
  p.pageviews_month ??= 0
  p.commons_files ??= 0
  p.commons_search_hits ??= ''
  p.has_photo =
    p.wd_image === 'true' || p.osm_image === 'true' ? 'true' : 'false'
}
places.sort((a, b) => a.along_m - b.along_m)

const columns = [
  'id',
  'name',
  'category',
  'group',
  'segment',
  'along_m',
  'off_route_m',
  'lat',
  'lon',
  'wikidata',
  'enwiki',
  'sitelinks',
  'pageviews_month',
  'commons_category',
  'commons_files',
  'commons_search_hits',
  'has_photo',
  'website',
]
writeCsv(join(here, 'places.csv'), places, columns)
console.error(`wrote places.csv (${places.length} places)`)
