// Which OpenStreetMap features are worth suggesting (requirements §9,
// Discovery). Candidates come only from OSM tags: searching Wikidata for
// "things near here" instead pulled in plane crashes, universities, airports
// and congressional districts.
//
// Pure logic, no I/O: the tile fill worker runs it on each Overpass element.

/** OSM tags of one element, e.g. { tourism: 'museum', name: 'Corn Palace' }. */
export type OsmTags = Readonly<Record<string, string | undefined>>

export type PlaceKind = 'attraction' | 'campground'

export interface Candidate {
  kind: PlaceKind
  /** The tag that made it a candidate, e.g. 'tourism=museum' (places.category). */
  category: string
}

/** tourism=* values that make a place an attraction on their own. */
export const TOURISM_ATTRACTIONS: ReadonlySet<string> = new Set([
  'attraction',
  'museum',
  'viewpoint',
  'zoo',
  'theme_park',
  'gallery',
  'aquarium',
])

export const TOURISM_CAMPGROUNDS: ReadonlySet<string> = new Set([
  'camp_site',
  'caravan_site',
])

/** tourism=artwork is a candidate only for these artwork_type values. */
export const ARTWORK_TYPES: ReadonlySet<string> = new Set([
  'statue',
  'sculpture',
])

/** historic=* values that are worth a stop without anything else. */
export const HISTORIC_SITES: ReadonlySet<string> = new Set([
  'monument',
  'castle',
  'fort',
  'ruins',
  'archaeological_site',
  'battlefield',
  'ship',
  'aircraft',
  'locomotive',
  'mine',
  'manor',
])

/**
 * historic=* values that are mostly minor (plaques, ordinary old buildings):
 * candidates only when they have a Wikidata item, or are a statue/sculpture.
 */
export const HISTORIC_NEEDS_WIKIDATA: ReadonlySet<string> = new Set([
  'memorial',
  'building',
  'house',
  'farm',
  'mill',
  'bridge',
])

export const MEMORIAL_STATUES: ReadonlySet<string> = new Set([
  'statue',
  'sculpture',
  'bust',
])

/** Parks and reserves: so many that only those with Wikidata are kept. */
export const PARKS: ReadonlyArray<readonly [string, string]> = [
  ['boundary', 'national_park'],
  ['leisure', 'nature_reserve'],
  ['leisure', 'park'],
  ['boundary', 'protected_area'],
]

export const NATURAL: ReadonlySet<string> = new Set([
  'waterfall',
  'peak',
  'cave_entrance',
])

/**
 * Decides whether an OSM element is a suggestion candidate, and if so what
 * kind and category. Returns null for everything else, including:
 * - unnamed elements (a suggestion needs a name);
 * - roads, historic districts, plain churches and cemeteries, and anything
 *   tagged just historic=yes, unless they are also tourism-tagged.
 */
export function classifyCandidate(tags: OsmTags): Candidate | null {
  if (!tags.name?.trim()) return null

  const tourism = tags.tourism
  if (tourism && TOURISM_CAMPGROUNDS.has(tourism)) {
    return { kind: 'campground', category: `tourism=${tourism}` }
  }
  if (tourism && TOURISM_ATTRACTIONS.has(tourism)) {
    return attraction(`tourism=${tourism}`)
  }
  if (tourism === 'artwork' && ARTWORK_TYPES.has(tags.artwork_type ?? '')) {
    return attraction('tourism=artwork')
  }

  // Not tourism-tagged from here on, so the exclusions apply.
  if (isExcluded(tags)) return null

  const historic = tags.historic
  if (historic && HISTORIC_SITES.has(historic)) {
    return attraction(`historic=${historic}`)
  }
  if (historic === 'memorial' && MEMORIAL_STATUES.has(tags.memorial ?? '')) {
    return attraction('historic=memorial')
  }
  if (historic && HISTORIC_NEEDS_WIKIDATA.has(historic) && hasWikidata(tags)) {
    return attraction(`historic=${historic}`)
  }

  const natural = tags.natural
  if (natural && NATURAL.has(natural)) return attraction(`natural=${natural}`)
  if (tags.waterway === 'waterfall') return attraction('natural=waterfall')

  if (tags.man_made === 'windmill' || historic === 'windmill') {
    return attraction('man_made=windmill')
  }

  if (hasWikidata(tags)) {
    for (const [key, value] of PARKS) {
      if (tags[key] === value) return attraction(`${key}=${value}`)
    }
  }

  return null
}

/** Whether an OSM element is a suggestion candidate (see classifyCandidate). */
export function isCandidate(tags: OsmTags): boolean {
  return classifyCandidate(tags) !== null
}

function attraction(category: string): Candidate {
  return { kind: 'attraction', category }
}

function hasWikidata(tags: OsmTags): boolean {
  return /^Q[0-9]+$/.test(tags.wikidata ?? '')
}

/**
 * Features that are never suggested unless also tourism-tagged: historic=yes
 * is mostly old roads and buildings ("239th Street"), districts are whole
 * neighbourhoods, and churches and cemeteries are everywhere.
 */
function isExcluded(tags: OsmTags): boolean {
  return (
    tags.highway !== undefined ||
    tags.historic === 'yes' ||
    tags.historic === 'district' ||
    tags.amenity === 'place_of_worship' ||
    tags.amenity === 'grave_yard' ||
    tags.landuse === 'cemetery' ||
    tags.building === 'church' ||
    tags.building === 'cathedral' ||
    tags.building === 'chapel'
  )
}
