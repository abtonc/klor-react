import { describe, expect, it } from 'vitest'
import manifest from '../package.json'
import { SNAPSHOT_VERSION } from '../src/core/types.js'
import { SDK_VERSION } from '../src/core/version.js'
import { fetchSnapshot, isSnapshot } from '../src/core/transport.js'

const snapshot = (over: Record<string, unknown> = {}) => ({
  v: SNAPSHOT_VERSION,
  seq: 1,
  environment: { id: 'env_1', key: 'prod' },
  publishedAt: new Date(0).toISOString(),
  flags: {},
  gates: {},
  blockedBuilds: {},
  ...over,
})

describe('snapshot compatibility', () => {
  it('accepts the version it was built against', () => {
    expect(isSnapshot(snapshot())).toBe(true)
  })

  it('accepts a newer format version', () => {
    // The point of the whole exercise: a shipped binary cannot be patched, so
    // rejecting a future version would brick every copy in the field the day
    // one is published.
    expect(isSnapshot(snapshot({ v: SNAPSHOT_VERSION + 1, somethingNew: [1, 2] }))).toBe(true)
  })

  it('rejects a version older than this reader', () => {
    expect(isSnapshot(snapshot({ v: SNAPSHOT_VERSION - 1 }))).toBe(false)
  })

  it('rejects things that are not snapshots', () => {
    expect(isSnapshot(null)).toBe(false)
    expect(isSnapshot({ v: 'one', seq: 1, flags: {} })).toBe(false)
    expect(isSnapshot(snapshot({ flags: undefined }))).toBe(false)
  })
})

describe('requests', () => {
  it('reports its own version, so the field is knowable', async () => {
    let sent: Headers | undefined

    await fetchSnapshot({
      baseUrl: 'https://edge.example',
      apiKey: 'klor_pub_test',
      fetchImpl: ((_url: string, init: RequestInit) => {
        sent = new Headers(init.headers)
        return Promise.resolve(
          new Response(JSON.stringify(snapshot()), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }) as unknown as typeof fetch,
    })

    expect(sent?.get('x-klor-sdk')).toBe(SDK_VERSION)
  })

  it('reports the version it actually ships as', () => {
    // Bundled as a literal because a binary has no package.json to read. This
    // is what keeps the literal true.
    expect(SDK_VERSION).toBe(manifest.version)
  })
})
