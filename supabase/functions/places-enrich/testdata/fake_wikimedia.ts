// Test-only: a fake of the Wikimedia APIs the worker calls, with a fake clock.
import { wikimediaClient } from '../wikimedia.ts'
import sparql from './sparql.json' with { type: 'json' }
import categoryinfo from './categoryinfo.json' with { type: 'json' }
import imageinfo from './imageinfo.json' with { type: 'json' }

export type Reply = (request: Request) => Response | Promise<Response>

/** Monthly pageviews answer: `views` for each of the given months. */
export function pageviewsAnswer(views: number[]): Response {
  return Response.json({
    items: views.map((v, i) => ({
      project: 'en.wikipedia',
      granularity: 'monthly',
      timestamp: `2025${String(i + 1).padStart(2, '0')}0100`,
      views: v,
    })),
  })
}

export interface FakeReplies {
  sparql?: Reply
  categoryinfo?: Reply
  imageinfo?: Reply
  pageviews?: Reply
}

/** Routes requests by API; by default every article has 1,200 views a month. */
export function fakeWikimedia(replies: FakeReplies = {}) {
  const requests: Request[] = []
  const {
    sparql: sparqlReply = () => Response.json(sparql),
    categoryinfo: categoryReply = () => Response.json(categoryinfo),
    imageinfo: imageReply = () => Response.json(imageinfo),
    pageviews: pageviewsReply = () => pageviewsAnswer(Array(12).fill(1200)),
  } = replies
  const fetchFn = ((input: URL | string, init?: RequestInit) => {
    const request = new Request(input, init)
    requests.push(request.clone())
    const url = new URL(request.url)
    if (url.host === 'query.wikidata.org')
      return Promise.resolve(sparqlReply(request))
    if (url.host === 'wikimedia.org')
      return Promise.resolve(pageviewsReply(request))
    const prop = url.searchParams.get('prop')
    if (prop === 'categoryinfo') return Promise.resolve(categoryReply(request))
    if (prop === 'imageinfo') return Promise.resolve(imageReply(request))
    return Promise.resolve(new Response('unexpected', { status: 500 }))
  }) as typeof fetch
  return { requests, fetchFn }
}

/** A clock that only moves when something sleeps (or a test moves it). */
export function fakeClock(start = Date.parse('2026-11-27T00:00:00Z')) {
  const clock = {
    time: start,
    sleeps: [] as number[],
    now: () => clock.time,
    sleep: (ms: number) => {
      clock.sleeps.push(ms)
      clock.time += ms
      return Promise.resolve()
    },
  }
  return clock
}

export function testClient(
  fetchFn: typeof fetch,
  clock = fakeClock(),
  budgetMs = 50_000,
) {
  return wikimediaClient({
    userAgent: 'Glovebox/1.0 (road-trip planner; ops@example.com)',
    fetchFn,
    now: clock.now,
    sleep: clock.sleep,
    deadline: clock.now() + budgetMs,
  })
}
