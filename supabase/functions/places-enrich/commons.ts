// Photo counts and photo credits from Wikimedia Commons (action API, 50
// titles per request). We link to Commons thumbnails and never copy images.
import type { WikimediaClient } from './wikimedia.ts'

export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
/** Titles per request (the action API's limit without bot rights). */
export const COMMONS_BATCH = 50
/** Longest credit kept, in characters. */
export const MAX_CREDIT_LENGTH = 200

export interface ImageInfo {
  /** The file name as Commons spells it, without 'File:'. */
  file: string
  /** The author, as plain text. */
  credit: string | null
  /** e.g. 'CC BY-SA 4.0', 'Public domain'. */
  license: string | null
}

interface Page {
  title?: string
  missing?: boolean
  categoryinfo?: { files?: number }
  imageinfo?: {
    extmetadata?: Record<string, { value?: unknown } | undefined>
  }[]
}
interface QueryAnswer {
  query?: {
    normalized?: { from: string; to: string }[]
    pages?: Page[]
  }
}

/**
 * Pages of a formatversion=2 answer, by each title as it was asked for
 * (Commons normalizes titles, e.g. underscores to spaces).
 */
export function pagesByRequestedTitle(body: unknown): Map<string, Page> {
  const query = (body as QueryAnswer)?.query
  if (!Array.isArray(query?.pages))
    throw new Error('Commons: no pages in answer')
  const byTitle = new Map<string, Page>()
  for (const page of query.pages) if (page.title) byTitle.set(page.title, page)
  for (const { from, to } of query.normalized ?? []) {
    const page = byTitle.get(to)
    if (page) byTitle.set(from, page)
  }
  return byTitle
}

async function queryInBatches(
  titles: readonly string[],
  params: Record<string, string>,
  client: WikimediaClient,
  each: (title: string, page: Page | undefined) => void,
) {
  const unique = [...new Set(titles)]
  for (let i = 0; i < unique.length; i += COMMONS_BATCH) {
    const batch = unique.slice(i, i + COMMONS_BATCH)
    const url = new URL(COMMONS_API)
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      ...params,
      titles: batch.join('|'),
    }).toString()
    const pages = pagesByRequestedTitle(await client.getJson(url.href))
    for (const title of batch) each(title, pages.get(title))
  }
}

/**
 * Files in each Commons category (P373 values, without 'Category:'). A
 * category Commons doesn't have counts 0.
 */
export async function fetchCategoryFiles(
  categories: readonly string[],
  client: WikimediaClient,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  await queryInBatches(
    categories.map((c) => `Category:${c}`),
    { prop: 'categoryinfo' },
    client,
    (title, page) => {
      const files = Number(page?.categoryinfo?.files)
      counts.set(
        title.slice('Category:'.length),
        Number.isFinite(files) && files > 0 ? files : 0,
      )
    },
  )
  return counts
}

/**
 * Author and licence of each file (P18 values, without 'File:'). Files that
 * no longer exist on Commons are left out.
 */
export async function fetchImageInfo(
  files: readonly string[],
  client: WikimediaClient,
): Promise<Map<string, ImageInfo>> {
  const info = new Map<string, ImageInfo>()
  await queryInBatches(
    files.map((f) => `File:${f}`),
    {
      prop: 'imageinfo',
      iiprop: 'extmetadata',
      iiextmetadatafilter: 'Artist|LicenseShortName',
    },
    client,
    (title, page) => {
      const meta = page?.imageinfo?.[0]?.extmetadata
      if (!page || page.missing || !meta || !page.title) return
      info.set(title.slice('File:'.length), {
        file: page.title.replace(/^File:/, ''),
        credit: plainText(meta.Artist?.value),
        license: plainText(meta.LicenseShortName?.value),
      })
    },
  )
  return info
}

/**
 * Commons metadata is HTML: drops hidden elements (Commons adds e.g. a hidden
 * 'Unknown author'), tags and entities, and collapses whitespace.
 */
export function plainText(html: unknown): string | null {
  if (typeof html !== 'string') return null
  const text = html
    .replace(/<(\w+)[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, code: string) => {
      const lower = code.toLowerCase()
      if (lower.startsWith('#x'))
        return String.fromCodePoint(parseInt(lower.slice(2), 16))
      if (lower.startsWith('#'))
        return String.fromCodePoint(Number(lower.slice(1)))
      return ENTITIES[lower] ?? entity
    })
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return null
  return text.length > MAX_CREDIT_LENGTH
    ? text.slice(0, MAX_CREDIT_LENGTH - 1).trimEnd() + '…'
    : text
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}
