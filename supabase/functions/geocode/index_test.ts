import { assert, assertEquals, assertThrows } from '@std/assert'
import { HttpError } from '../_shared/http.ts'
import { invokeRequest, userToken } from '../_shared/test_env.ts'
import { createHandler } from './index.ts'
import { orsUrl, parseGeocodeRequest, toPlaces } from './ors.ts'

Deno.env.set('ORS_API_KEY', 'ors-test-key')

const arches = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-109.5925, 38.7331] },
  properties: {
    name: 'Arches National Park',
    label: 'Arches National Park, Grand County, UT, USA',
  },
}
const mainSt = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-109.5498, 38.5733] },
  properties: {
    name: '123 Main St',
    label: '123 Main St, Moab, UT, USA',
  },
}

interface Call {
  url: URL
  init?: RequestInit
}

/** A fake fetch that records calls and answers with `response`. */
function fakeFetch(response: () => Response) {
  const calls: Call[] = []
  const fetchFn = ((input: URL, init?: RequestInit) => {
    calls.push({ url: new URL(input), init })
    return Promise.resolve(response())
  }) as typeof fetch
  return { calls, fetchFn }
}

function featureCollection(...features: unknown[]): Response {
  return Response.json({ type: 'FeatureCollection', features })
}

async function call(body: unknown, response: () => Response) {
  const { calls, fetchFn } = fakeFetch(response)
  const token = await userToken(crypto.randomUUID())
  const res = await createHandler(fetchFn)(
    invokeRequest(token, 'POST', body, 'geocode'),
  )
  return { res, calls }
}

Deno.test('search returns places and biases to the US', async () => {
  const { res, calls } = await call(
    { q: ' Arches ', focus: { lat: 38.5, lng: -109.5 } },
    () => featureCollection(arches, mainSt),
  )
  assertEquals(res.status, 200)
  assertEquals(await res.json(), {
    results: [
      {
        name: 'Arches National Park',
        address: 'Grand County, UT, USA',
        lat: 38.7331,
        lng: -109.5925,
      },
      {
        name: '123 Main St',
        address: 'Moab, UT, USA',
        lat: 38.5733,
        lng: -109.5498,
      },
    ],
  })
  assertEquals(calls.length, 1)
  const { url, init } = calls[0]
  assertEquals(url.pathname, '/geocode/search')
  assertEquals(url.searchParams.get('text'), 'Arches')
  assertEquals(url.searchParams.get('size'), '8')
  assertEquals(url.searchParams.get('boundary.country'), 'US')
  assertEquals(url.searchParams.get('focus.point.lat'), '38.5')
  assertEquals(url.searchParams.get('focus.point.lon'), '-109.5')
  assertEquals(new Headers(init?.headers).get('authorization'), 'ors-test-key')
  assert(!url.toString().includes('ors-test-key'))
})

Deno.test('reverse returns one place', async () => {
  const { res, calls } = await call(
    { reverse: { lat: 38.57, lng: -109.55 } },
    () => featureCollection(mainSt, arches),
  )
  assertEquals(res.status, 200)
  const { results } = await res.json()
  assertEquals(results.length, 1)
  assertEquals(results[0].name, '123 Main St')
  const { url } = calls[0]
  assertEquals(url.pathname, '/geocode/reverse')
  assertEquals(url.searchParams.get('point.lat'), '38.57')
  assertEquals(url.searchParams.get('point.lon'), '-109.55')
  assertEquals(url.searchParams.get('boundary.country'), 'US')
})

Deno.test('returns 401 when signed out, without calling ORS', async () => {
  const { calls, fetchFn } = fakeFetch(() => featureCollection())
  const res = await createHandler(fetchFn)(
    invokeRequest(undefined, 'POST', { q: 'Moab' }, 'geocode'),
  )
  assertEquals(res.status, 401)
  await res.body?.cancel()
  assertEquals(calls.length, 0)
})

Deno.test('returns 400 for invalid input, without calling ORS', async () => {
  for (const body of [
    {},
    { q: '   ' },
    { q: 'x'.repeat(201) },
    { q: 42 },
    { q: 'Moab', focus: { lat: 91, lng: 0 } },
    { reverse: { lat: 0, lng: 181 } },
    { reverse: { lat: '1', lng: 2 } },
    { q: 'Moab', reverse: { lat: 1, lng: 2 } },
    ['Moab'],
  ]) {
    const { res, calls } = await call(body, () => featureCollection())
    assertEquals(res.status, 400, JSON.stringify(body))
    assert(typeof (await res.json()).error === 'string')
    assertEquals(calls.length, 0)
  }
})

Deno.test('returns 429 when ORS rate-limits', async () => {
  const { res } = await call(
    { q: 'Moab' },
    () => new Response('{"error":"Rate limit exceeded"}', { status: 429 }),
  )
  assertEquals(res.status, 429)
  const { error } = await res.json()
  assert(error.includes('rate limit'))
})

Deno.test(
  'returns 502 without leaking ORS details when ORS fails',
  async () => {
    const { res } = await call(
      { q: 'Moab' },
      () =>
        new Response('{"error":"Access to this API has been disallowed"}', {
          status: 403,
        }),
    )
    assertEquals(res.status, 502)
    assertEquals(await res.json(), { error: 'Place search failed' })
  },
)

Deno.test('returns 502 when ORS is unreachable', async () => {
  const token = await userToken(crypto.randomUUID())
  const failing = (() =>
    Promise.reject(new TypeError('network'))) as typeof fetch
  const res = await createHandler(failing)(
    invokeRequest(token, 'POST', { q: 'Moab' }, 'geocode'),
  )
  assertEquals(res.status, 502)
  await res.body?.cancel()
})

Deno.test('returns 503 when the ORS key is not set', async () => {
  Deno.env.delete('ORS_API_KEY')
  try {
    const { res, calls } = await call({ q: 'Moab' }, () => featureCollection())
    assertEquals(res.status, 503)
    await res.body?.cancel()
    assertEquals(calls.length, 0)
  } finally {
    Deno.env.set('ORS_API_KEY', 'ors-test-key')
  }
})

Deno.test(
  'parseGeocodeRequest allows a 200-character query and null focus',
  () => {
    assertEquals(parseGeocodeRequest({ q: 'x'.repeat(200), focus: null }), {
      kind: 'search',
      q: 'x'.repeat(200),
    })
    assertThrows(() => parseGeocodeRequest(null), HttpError)
  },
)

Deno.test('orsUrl leaves focus out when not given', () => {
  const url = orsUrl({ kind: 'search', q: 'Moab' })
  assertEquals(url.searchParams.has('focus.point.lat'), false)
})

Deno.test(
  'toPlaces skips malformed features and falls back to the label',
  () => {
    assertEquals(
      toPlaces({
        features: [
          { geometry: { coordinates: [1] }, properties: { name: 'x' } },
          { geometry: { coordinates: [-111, 40] }, properties: {} },
          {
            geometry: { coordinates: [-111, 40] },
            properties: { label: 'Utah, USA' },
          },
        ],
      }),
      [{ name: 'Utah, USA', address: 'Utah, USA', lat: 40, lng: -111 }],
    )
    assertThrows(() => toPlaces({}))
  },
)
