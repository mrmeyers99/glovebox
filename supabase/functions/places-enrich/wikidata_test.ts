import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import {
  buildSparql,
  fetchWikidata,
  parseSparql,
  WIKIDATA_BATCH,
} from './wikidata.ts'
import { fakeWikimedia, testClient } from './testdata/fake_wikimedia.ts'
import sparql from './testdata/sparql.json' with { type: 'json' }

Deno.test('buildSparql asks for each item’s signals', () => {
  const query = buildSparql(['Q1', 'Q1135328'])
  assertStringIncludes(query, 'VALUES ?item { wd:Q1 wd:Q1135328 }')
  assertStringIncludes(query, 'wikibase:sitelinks ?sitelinks')
  assertStringIncludes(query, 'wdt:P18 ?image')
  assertStringIncludes(query, 'wdt:P373 ?commonsCategory')
  assertStringIncludes(query, 'schema:isPartOf <https://en.wikipedia.org/>')
})

Deno.test('buildSparql rejects anything but a QID', () => {
  assertThrows(() => buildSparql(['Q1', 'Q2 } DELETE {']), Error, 'Bad QID')
})

Deno.test('parseSparql reads sitelinks, image, category and article', () => {
  const items = parseSparql(sparql)
  assertEquals(items.get('Q1135328'), {
    sitelinks: 14,
    image: 'Corn Palace 2017.jpg', // the first of its two images
    commonsCategory: 'Corn Palace',
    enwikiTitle: 'Corn_Palace',
  })
  assertEquals(items.get('Q5432100'), {
    sitelinks: 2,
    image: null,
    commonsCategory: null,
    enwikiTitle: 'Prehistoric_Indian_Village/Mitchell',
  })
  assertEquals(items.get('Q7000001')?.sitelinks, 0)
  // An item Wikidata doesn't know has no data.
  assertEquals(items.has('Q999999999'), false)
  assertEquals(items.size, 3)
})

Deno.test('parseSparql fills gaps from later rows and skips odd values', () => {
  const uri = (value: string) => ({ type: 'uri', value })
  const items = parseSparql({
    results: {
      bindings: [
        {
          item: uri('http://www.wikidata.org/entity/Q1'),
          sitelinks: { type: 'literal', value: 'x' },
        },
        {
          item: uri('http://www.wikidata.org/entity/Q1'),
          image: uri(
            'http://commons.wikimedia.org/wiki/Special:FilePath/A.jpg',
          ),
          commonsCategory: { type: 'literal', value: ' A ' },
          article: uri('https://en.wikipedia.org/wiki/A'),
        },
        {
          item: uri('http://www.wikidata.org/entity/Q2'),
          image: uri(
            'http://commons.wikimedia.org/wiki/Special:FilePath/%E0%A4%A',
          ),
        },
        {
          item: uri('https://example.org/Q3'),
          sitelinks: { type: 'literal', value: '5' },
        },
        {},
      ],
    },
  })
  assertEquals(items.get('Q1'), {
    sitelinks: 0,
    image: 'A.jpg',
    commonsCategory: 'A',
    enwikiTitle: 'A',
  })
  assertEquals(items.has('Q2'), false) // badly encoded file name, nothing else
  assertEquals(items.size, 1)
})

Deno.test('parseSparql rejects an answer without results', () => {
  assertThrows(() => parseSparql({ error: 'timeout' }), Error, 'no results')
  assertThrows(() => parseSparql(null), Error, 'no results')
})

Deno.test(
  'fetchWikidata queries in batches of WIKIDATA_BATCH, each QID once',
  async () => {
    const { requests, fetchFn } = fakeWikimedia()
    const qids = Array.from(
      { length: WIKIDATA_BATCH + 1 },
      (_, i) => `Q${i + 1}`,
    )
    const items = await fetchWikidata([...qids, 'Q1'], testClient(fetchFn))
    assertEquals(requests.length, 2)
    const queries = await Promise.all(
      requests.map(async (r) =>
        new URLSearchParams(await r.text()).get('query')!,
      ),
    )
    assertEquals(queries[0].match(/wd:Q/g)?.length, WIKIDATA_BATCH)
    assertStringIncludes(
      queries[1],
      `VALUES ?item { wd:Q${WIKIDATA_BATCH + 1} }`,
    )
    assertEquals(
      requests[0].headers.get('accept'),
      'application/sparql-results+json',
    )
    assertEquals(items.get('Q1135328')?.sitelinks, 14)
  },
)

Deno.test(
  'fetchWikidata sends nothing for no QIDs, and passes errors on',
  async () => {
    const { requests, fetchFn } = fakeWikimedia({
      sparql: () => new Response('', { status: 500 }),
    })
    assertEquals((await fetchWikidata([], testClient(fetchFn))).size, 0)
    assertEquals(requests.length, 0)
    await assertRejects(
      () => fetchWikidata(['Q1'], testClient(fetchFn)),
      Error,
      'HTTP 500',
    )
  },
)
