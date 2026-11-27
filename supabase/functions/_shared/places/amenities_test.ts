import { assertEquals } from '@std/assert'
import {
  amenityCompleteness,
  type CampgroundAmenities,
  parseAmenities,
  yesNo,
} from './amenities.ts'

const camp = (tags: Record<string, string>) =>
  parseAmenities('tourism=camp_site', tags)

const NOTHING: CampgroundAmenities = {
  tents: null,
  rvs: null,
  hookups: null,
  drinking_water: null,
  dump_station: null,
  showers: null,
  toilets: null,
  fee: null,
  fee_amount: null,
  reservation: null,
  capacity: null,
  website: null,
  phone: null,
  operator: null,
  ownership: null,
}

Deno.test('a campground without amenity tags knows nothing', () => {
  assertEquals(camp({ tourism: 'camp_site', name: 'X' }), NOTHING)
  assertEquals(amenityCompleteness(NOTHING), 0)
})

Deno.test('yesNo reads the common variants', () => {
  for (const yes of ['yes', 'YES', ' hot', 'cold', 'flush', 'customers']) {
    assertEquals(yesNo(yes), true, yes)
  }
  for (const no of ['no', 'No', 'none', 'false', '0']) {
    assertEquals(yesNo(no), false, no)
  }
  for (const unknown of [undefined, '', ' ', 'unknown', '?']) {
    assertEquals(yesNo(unknown), null, String(unknown))
  }
})

Deno.test('parses a well-tagged campground', () => {
  assertEquals(
    camp({
      tents: 'yes',
      caravans: 'yes',
      power_supply: 'yes',
      drinking_water: 'yes',
      sanitary_dump_station: 'customers',
      shower: 'hot',
      toilets: 'flush',
      fee: 'no',
      reservation: 'Required',
      capacity: '62',
      website: 'https://gfp.sd.gov/parks/detail/palisades-state-park/',
      phone: '+1 605-594-3824',
      operator: 'South Dakota Game, Fish and Parks',
    }),
    {
      tents: true,
      rvs: true,
      hookups: true,
      drinking_water: true,
      dump_station: true,
      showers: true,
      toilets: true,
      fee: false,
      fee_amount: null,
      reservation: 'required',
      capacity: 62,
      website: 'https://gfp.sd.gov/parks/detail/palisades-state-park/',
      phone: '+1 605-594-3824',
      operator: 'South Dakota Game, Fish and Parks',
      ownership: 'public',
    },
  )
})

Deno.test('RVs: caravans, then motorhome, then a caravan_site', () => {
  assertEquals(camp({ caravans: 'no', motorhome: 'yes' }).rvs, false)
  assertEquals(camp({ motorhome: 'yes' }).rvs, true)
  assertEquals(camp({}).rvs, null)
  assertEquals(parseAmenities('tourism=caravan_site', {}).rvs, true)
  assertEquals(
    parseAmenities('tourism=caravan_site', { caravans: 'no' }).rvs,
    false,
  )
})

Deno.test('tents and hookups', () => {
  assertEquals(camp({ tents: 'yes' }).tents, true)
  assertEquals(camp({ tents: 'no' }).tents, false)
  assertEquals(camp({ power_supply: 'no' }).hookups, false)
  assertEquals(camp({ power_supply: 'some' }).hookups, true)
})

Deno.test('water: drinking_water, or else water_point', () => {
  assertEquals(camp({ water_point: 'yes' }).drinking_water, true)
  assertEquals(
    camp({ drinking_water: 'no', water_point: 'yes' }).drinking_water,
    false,
  )
})

Deno.test('fee: yes or no, an amount in the fee tag, or a charge', () => {
  assertEquals(camp({ fee: 'yes' }), { ...NOTHING, fee: true })
  assertEquals(camp({ fee: 'no', charge: '$5' }), { ...NOTHING, fee: false })
  assertEquals(camp({ fee: '$25' }), {
    ...NOTHING,
    fee: true,
    fee_amount: '$25',
  })
  assertEquals(camp({ fee: 'yes', charge: '20 USD/night' }), {
    ...NOTHING,
    fee: true,
    fee_amount: '20 USD/night',
  })
  assertEquals(camp({ charge: '15 USD' }), {
    ...NOTHING,
    fee: true,
    fee_amount: '15 USD',
  })
})

Deno.test('capacity: a whole number, or the sum of capacity:*', () => {
  assertEquals(camp({ capacity: '40' }).capacity, 40)
  assertEquals(camp({ capacity: 'lots' }).capacity, null)
  assertEquals(camp({ capacity: '0' }).capacity, null)
  assertEquals(camp({ capacity: '2.5' }).capacity, null)
  assertEquals(
    camp({ 'capacity:tents': '10', 'capacity:caravans': '25', other: '3' })
      .capacity,
    35,
  )
  assertEquals(camp({ 'capacity:tents': 'x' }).capacity, null)
})

Deno.test('contact: http(s) website and phone, from any of their tags', () => {
  assertEquals(
    camp({ 'contact:website': 'http://a.example' }).website,
    'http://a.example',
  )
  assertEquals(
    camp({ url: 'https://b.example/camp' }).website,
    'https://b.example/camp',
  )
  assertEquals(
    camp({ website: 'javascript:alert(1)', url: 'https://c.example' }).website,
    'https://c.example',
  )
  assertEquals(camp({ website: 'www.example.com' }).website, null)
  assertEquals(camp({ 'contact:phone': '555-0100' }).phone, '555-0100')
  assertEquals(
    camp({ phone: ' ', 'contact:phone': '555-0101' }).phone,
    '555-0101',
  )
})

Deno.test('ownership: from operator:type, or else the operator name', () => {
  const owner = (tags: Record<string, string>) => camp(tags).ownership
  assertEquals(owner({ 'operator:type': 'government' }), 'public')
  assertEquals(owner({ 'operator:type': 'Public' }), 'public')
  assertEquals(owner({ 'operator:type': 'private' }), 'private')
  assertEquals(owner({ 'operator:type': 'community' }), 'private')
  assertEquals(
    owner({ 'operator:type': 'private', operator: 'Lincoln County' }),
    'private',
  )
  assertEquals(owner({ operator: 'USDA Forest Service' }), 'public')
  assertEquals(
    owner({ operator: 'Iowa Department of Natural Resources' }),
    'public',
  )
  assertEquals(owner({ operator: 'Minnehaha County' }), 'public')
  assertEquals(owner({ operator: 'City of Mitchell' }), 'public')
  assertEquals(owner({ operator: 'US Army Corps of Engineers' }), 'public')
  assertEquals(
    owner({ operator: 'Black Hawk County Conservation Board' }),
    'public',
  )
  assertEquals(owner({ operator: 'Kampgrounds of America' }), 'private')
  assertEquals(owner({ operator: 'Sioux Falls KOA' }), 'private')
  assertEquals(owner({ operator: 'Lake Park Campground LLC' }), 'private')
  assertEquals(owner({ operator: 'Bob and Sue' }), null)
  assertEquals(owner({ 'operator:type': 'other', operator: 'Bob' }), null)
})

Deno.test('completeness counts the fields people choose by', () => {
  const some = camp({ tents: 'yes', shower: 'no', fee: 'yes', operator: 'X' })
  // tents, showers and fee are 3 of 11; the operator isn't counted.
  assertEquals(amenityCompleteness(some), 3 / 11)
  const all = camp({
    tents: 'yes',
    caravans: 'yes',
    power_supply: 'yes',
    drinking_water: 'yes',
    sanitary_dump_station: 'yes',
    shower: 'yes',
    toilets: 'yes',
    fee: 'yes',
    reservation: 'no',
    capacity: '10',
    website: 'https://example.com',
  })
  assertEquals(amenityCompleteness(all), 1)
})
