import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import {
  COMMONS_BATCH,
  fetchCategoryFiles,
  fetchImageInfo,
  MAX_CREDIT_LENGTH,
  pagesByRequestedTitle,
  plainText,
} from './commons.ts'
import { fakeWikimedia, testClient } from './testdata/fake_wikimedia.ts'

Deno.test(
  'fetchCategoryFiles counts files, 0 for a missing category',
  async () => {
    const { requests, fetchFn } = fakeWikimedia()
    const counts = await fetchCategoryFiles(
      ['Corn_Palace', 'Mitchell water tower', 'Corn_Palace'],
      testClient(fetchFn),
    )
    assertEquals(
      counts,
      new Map([
        ['Corn_Palace', 120],
        ['Mitchell water tower', 0],
      ]),
    )
    assertEquals(requests.length, 1)
    const params = new URL(requests[0].url).searchParams
    assertEquals(
      params.get('titles'),
      'Category:Corn_Palace|Category:Mitchell water tower',
    )
    assertEquals(params.get('formatversion'), '2')
  },
)

Deno.test(
  'fetchCategoryFiles asks COMMONS_BATCH titles per request',
  async () => {
    const { requests, fetchFn } = fakeWikimedia()
    const names = Array.from(
      { length: COMMONS_BATCH * 2 + 1 },
      (_, i) => `C${i}`,
    )
    const counts = await fetchCategoryFiles(names, testClient(fetchFn))
    assertEquals(requests.length, 3)
    assertEquals(
      new URL(requests[2].url).searchParams.get('titles'),
      `Category:C${COMMONS_BATCH * 2}`,
    )
    assertEquals(counts.get('C0'), 0)
    assertEquals((await fetchCategoryFiles([], testClient(fetchFn))).size, 0)
    assertEquals(requests.length, 3)
  },
)

Deno.test(
  'fetchImageInfo reads the credit and licence, skips missing files',
  async () => {
    const { requests, fetchFn } = fakeWikimedia()
    const info = await fetchImageInfo(
      ['Corn Palace 2017.jpg', 'Gone.jpg'],
      testClient(fetchFn),
    )
    assertEquals(
      info,
      new Map([
        [
          'Corn Palace 2017.jpg',
          {
            file: 'Corn Palace 2017.jpg',
            credit: 'Jane Doe & friends',
            license: 'CC BY-SA 4.0',
          },
        ],
      ]),
    )
    const params = new URL(requests[0].url).searchParams
    assertEquals(params.get('prop'), 'imageinfo')
    assertEquals(params.get('iiextmetadatafilter'), 'Artist|LicenseShortName')
  },
)

Deno.test(
  'fetchImageInfo keeps Commons’ spelling of a normalized title',
  async () => {
    const { fetchFn } = fakeWikimedia({
      imageinfo: () =>
        Response.json({
          query: {
            normalized: [
              { from: 'File:corn_palace.jpg', to: 'File:Corn palace.jpg' },
            ],
            pages: [
              {
                title: 'File:Corn palace.jpg',
                imageinfo: [{ extmetadata: {} }],
              },
              { title: 'File:Broken.jpg', imageinfo: [] },
              {
                title: 'File:Gone.jpg',
                missing: true,
                imageinfo: [{ extmetadata: {} }],
              },
            ],
          },
        }),
    })
    const info = await fetchImageInfo(
      ['corn_palace.jpg', 'Broken.jpg', 'Gone.jpg'],
      testClient(fetchFn),
    )
    assertEquals(
      info,
      new Map([
        [
          'corn_palace.jpg',
          { file: 'Corn palace.jpg', credit: null, license: null },
        ],
      ]),
    )
  },
)

Deno.test('a Commons answer without pages is an error', async () => {
  assertThrows(
    () => pagesByRequestedTitle({ error: { code: 'ratelimited' } }),
    Error,
    'no pages',
  )
  const { fetchFn } = fakeWikimedia({
    categoryinfo: () => Response.json({ batchcomplete: true }),
  })
  await assertRejects(
    () => fetchCategoryFiles(['A'], testClient(fetchFn)),
    Error,
    'no pages',
  )
})

Deno.test('plainText strips tags, hidden text and entities', () => {
  assertEquals(
    plainText(
      '<span lang="en">Anonymous</span><span style="display:none">Unknown author</span>',
    ),
    'Anonymous',
  )
  assertEquals(
    plainText('<b>A</b>\n&lt;B&gt; &quot;C&quot; &#39;D&#x27; &nbsp;E&eacute;'),
    'A <B> "C" \'D\' E&eacute;',
  )
  assertEquals(plainText('  <br/> '), null)
  assertEquals(plainText(42), null)
  assertEquals(plainText(undefined), null)
  const long = plainText('x'.repeat(500))!
  assertEquals(long.length, MAX_CREDIT_LENGTH)
  assertEquals(long.endsWith('…'), true)
})
