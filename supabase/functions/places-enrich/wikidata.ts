// Ranking signals from Wikidata, through the SPARQL endpoint (the action API
// rate-limited a cloud IP outright in prototyping): sitelinks, image (P18),
// Commons category (P373) and English Wikipedia article, for many items per
// query.
import type { WikimediaClient } from './wikimedia.ts'

export const SPARQL_URL = 'https://query.wikidata.org/sparql'
/** Items per query. */
export const WIKIDATA_BATCH = 150

export interface WikidataItem {
  /** Wikipedia (and sister project) sitelinks. */
  sitelinks: number
  /** Commons file name of the P18 image, e.g. 'Corn Palace.jpg'. */
  image: string | null
  /** P373, without the 'Category:' prefix. */
  commonsCategory: string | null
  /** English Wikipedia article title, with underscores, e.g. 'Corn_Palace'. */
  enwikiTitle: string | null
}

export function buildSparql(qids: readonly string[]): string {
  for (const qid of qids) {
    if (!/^Q[0-9]+$/.test(qid)) throw new Error(`Bad QID: ${qid}`)
  }
  return [
    'SELECT ?item ?sitelinks ?image ?commonsCategory ?article WHERE {',
    `  VALUES ?item { ${qids.map((q) => `wd:${q}`).join(' ')} }`,
    '  OPTIONAL { ?item wikibase:sitelinks ?sitelinks }',
    '  OPTIONAL { ?item wdt:P18 ?image }',
    '  OPTIONAL { ?item wdt:P373 ?commonsCategory }',
    '  OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/> }',
    '}',
  ].join('\n')
}

interface Binding {
  type: string
  value: string
}
type Row = Partial<
  Record<
    'item' | 'sitelinks' | 'image' | 'commonsCategory' | 'article',
    Binding
  >
>

const ENTITY = 'http://www.wikidata.org/entity/'
const FILE_PATH =
  /^https?:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\/(.+)$/
const ENWIKI = /^https:\/\/en\.wikipedia\.org\/wiki\/(.+)$/

/**
 * Items by QID from a SPARQL JSON answer. An item with several images (a row
 * each) keeps the first. QIDs Wikidata doesn't know (deleted, or merged into
 * another) come back with no data, and are left out.
 */
export function parseSparql(body: unknown): Map<string, WikidataItem> {
  const rows = (body as { results?: { bindings?: Row[] } })?.results?.bindings
  if (!Array.isArray(rows)) throw new Error('Wikidata: no results in answer')
  const items = new Map<string, WikidataItem>()
  for (const row of rows) {
    const uri = row.item?.value ?? ''
    if (!uri.startsWith(ENTITY)) continue
    const qid = uri.slice(ENTITY.length)
    const sitelinks = Number(row.sitelinks?.value)
    const image = decode(FILE_PATH.exec(row.image?.value ?? '')?.[1])
    const category = row.commonsCategory?.value.trim() || null
    const title = decode(ENWIKI.exec(row.article?.value ?? '')?.[1])
    const known = items.get(qid)
    if (known) {
      known.image ??= image
      known.commonsCategory ??= category
      known.enwikiTitle ??= title
      continue
    }
    if (!row.sitelinks && !image && !category && !title) continue
    items.set(qid, {
      sitelinks: Number.isFinite(sitelinks) && sitelinks >= 0 ? sitelinks : 0,
      image,
      commonsCategory: category,
      enwikiTitle: title,
    })
  }
  return items
}

function decode(encoded: string | undefined): string | null {
  if (!encoded) return null
  try {
    return decodeURIComponent(encoded)
  } catch {
    return null
  }
}

/** Fetches the items, WIKIDATA_BATCH per query. */
export async function fetchWikidata(
  qids: readonly string[],
  client: WikimediaClient,
): Promise<Map<string, WikidataItem>> {
  const items = new Map<string, WikidataItem>()
  const unique = [...new Set(qids)]
  for (let i = 0; i < unique.length; i += WIKIDATA_BATCH) {
    const body = await client.getJson(SPARQL_URL, {
      method: 'POST',
      body: new URLSearchParams({
        query: buildSparql(unique.slice(i, i + WIKIDATA_BATCH)),
      }),
      accept: 'application/sparql-results+json',
    })
    for (const [qid, item] of parseSparql(body)) items.set(qid, item)
  }
  return items
}
