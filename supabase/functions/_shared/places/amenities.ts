// What a campground offers, normalised from its OpenStreetMap tags
// (requirements §9). People pick campgrounds by location and amenities, not
// fame, so the tile fill worker stores this object in places.tags.amenities
// and the app filters on it (tent/RV, hookups, showers).
//
// Pure logic, no I/O.
import type { OsmTags } from './candidates.ts'

/** null always means "not known": the tag isn't set, or can't be read. */
export interface CampgroundAmenities {
  tents: boolean | null
  /** Caravans or motorhomes allowed. */
  rvs: boolean | null
  /** Electric hookups (power_supply). */
  hookups: boolean | null
  drinking_water: boolean | null
  /** An RV sanitary dump station. */
  dump_station: boolean | null
  showers: boolean | null
  toilets: boolean | null
  fee: boolean | null
  /** The price when OSM gives one, as written, e.g. '$25' or '20 USD/night'. */
  fee_amount: string | null
  /** OSM reservation=*: 'required', 'recommended', 'yes', 'no'... */
  reservation: string | null
  /** Number of pitches. */
  capacity: number | null
  website: string | null
  phone: string | null
  operator: string | null
  /** Run by a government body (public) or a business or club (private). */
  ownership: 'public' | 'private' | null
}

/** Values of yes/no-style tags that mean no; any other value means yes. */
const NO = new Set(['no', 'none', 'false', '0'])
/** Values that say nothing either way. */
const UNKNOWN = new Set(['unknown', 'fixme', '?'])

/**
 * An OSM yes/no-style tag: null if unset or unknown; false for no; true for
 * anything else, since the other values describe a kind of yes
 * (shower=hot, toilets=flush, sanitary_dump_station=customers,
 * drinking_water=seasonal, power_supply=some).
 */
export function yesNo(value: string | undefined): boolean | null {
  const v = value?.trim().toLowerCase()
  if (!v || UNKNOWN.has(v)) return null
  return !NO.has(v)
}

/** operator:type values, by who runs the campground. */
const PUBLIC_OPERATOR_TYPES = new Set([
  'public',
  'government',
  'governmental',
  'federal',
  'state',
  'regional',
  'county',
  'municipal',
  'municipality',
  'council',
  'national',
])
const PRIVATE_OPERATOR_TYPES = new Set([
  'private',
  'commercial',
  'business',
  'community',
  'cooperative',
  'religious',
  'ngo',
  'charitable',
  'club',
])

/**
 * Operator names that are a government body: "Iowa Department of Natural
 * Resources", "USDA Forest Service", "Minnehaha County", "City of Mitchell",
 * "US Army Corps of Engineers", "South Dakota Game, Fish and Parks".
 */
const PUBLIC_OPERATOR =
  /\b(state|national|federal|county|city|town|township|village|municipal|government|department|dept|forest service|usda|usfs|bureau of land management|blm|corps of engineers|usace|nps|park service|fish and wildlife|game,? fish|dnr|natural resources|conservation (board|commission|district)|parks (and|&) rec(reation)?|park district|recreation district)\b/i
/** Operator names that are a business: "Kampgrounds of America", "… LLC". */
const PRIVATE_OPERATOR =
  /\b(koa|kampgrounds of america|thousand trails|jellystone|sun rv|encore|llc|inc|ltd|corp)\b/i

function ownership(tags: OsmTags): 'public' | 'private' | null {
  const type = tags['operator:type']?.trim().toLowerCase()
  if (type && PUBLIC_OPERATOR_TYPES.has(type)) return 'public'
  if (type && PRIVATE_OPERATOR_TYPES.has(type)) return 'private'
  const operator = tags.operator ?? ''
  if (PRIVATE_OPERATOR.test(operator)) return 'private'
  if (PUBLIC_OPERATOR.test(operator)) return 'public'
  return null
}

const text = (value: string | undefined) => value?.trim() || null

/** A URL the app can link to (http or https only). */
function webUrl(...values: (string | undefined)[]): string | null {
  for (const value of values) {
    const url = value?.trim()
    if (url && /^https?:\/\/\S+$/i.test(url)) return url
  }
  return null
}

/** fee=yes/no, or fee=<amount> (a price written in the fee tag itself). */
function fee(tags: OsmTags): { fee: boolean | null; amount: string | null } {
  const value = text(tags.fee)
  const charge = text(tags.charge)
  if (value && /\d/.test(value)) return { fee: true, amount: value }
  const paid = yesNo(value ?? undefined)
  if (paid === false) return { fee: false, amount: null }
  return { fee: paid ?? (charge ? true : null), amount: charge }
}

/** Pitches: capacity, or else the sum of capacity:tents / caravans / … */
function capacity(tags: OsmTags): number | null {
  const count = (value: string | undefined) => {
    const n = Number(value?.trim())
    return Number.isInteger(n) && n > 0 ? n : null
  }
  const total = count(tags.capacity)
  if (total) return total
  const parts = Object.entries(tags)
    .filter(([key]) =>
      /^capacity:(tents|caravans|motorhomes|pitches)$/.test(key),
    )
    .map(([, value]) => count(value) ?? 0)
  const sum = parts.reduce((a, b) => a + b, 0)
  return sum > 0 ? sum : null
}

/**
 * The amenities of a campground from its OSM tags. `category` is the place's
 * category: a caravan_site takes RVs even when it doesn't say so.
 */
export function parseAmenities(
  category: string,
  tags: OsmTags,
): CampgroundAmenities {
  const { fee: paid, amount } = fee(tags)
  return {
    tents: yesNo(tags.tents),
    rvs:
      yesNo(tags.caravans) ??
      yesNo(tags.motorhome) ??
      (category === 'tourism=caravan_site' ? true : null),
    hookups: yesNo(tags.power_supply),
    drinking_water: yesNo(tags.drinking_water) ?? yesNo(tags.water_point),
    dump_station: yesNo(tags.sanitary_dump_station),
    showers: yesNo(tags.shower),
    toilets: yesNo(tags.toilets),
    fee: paid,
    fee_amount: amount,
    reservation: text(tags.reservation)?.toLowerCase() ?? null,
    capacity: capacity(tags),
    website: webUrl(tags.website, tags['contact:website'], tags.url),
    phone: text(tags.phone) ?? text(tags['contact:phone']),
    operator: text(tags.operator),
    ownership: ownership(tags),
  }
}

/** The fields counted by amenityCompleteness(): what people choose by. */
export const COMPLETENESS_FIELDS = [
  'tents',
  'rvs',
  'hookups',
  'drinking_water',
  'dump_station',
  'showers',
  'toilets',
  'fee',
  'reservation',
  'capacity',
  'website',
] as const satisfies readonly (keyof CampgroundAmenities)[]

/** The share of COMPLETENESS_FIELDS that are known, from 0 to 1. */
export function amenityCompleteness(amenities: CampgroundAmenities): number {
  const known = COMPLETENESS_FIELDS.filter((f) => amenities[f] !== null)
  return known.length / COMPLETENESS_FIELDS.length
}
