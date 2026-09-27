import { describe, expect, it, vi } from 'vitest'
import { KlorClient } from '../src/core/client.js'
import { defaultStorage } from '../src/core/storage.js'
import { SNAPSHOT_VERSION } from '../src/core/types.js'
import type { KlorStorage } from '../src/core/storage.js'
import type { Snapshot } from '../src/core/types.js'

/**
 * The React Native paths, exercised in the environment React Native actually
 * provides: no `document`, no `localStorage`, an asynchronous storage adapter,
 * and foreground and background driven by `AppState` rather than by the DOM.
 *
 * Vitest runs in Node, where `document` is already undefined, so this file is
 * that environment without having to fake it. Everything the SDK claims about
 * mobile is claimed here, because the platform the product is about is the one
 * a browser test can never reach.
 */

const SNAPSHOT: Snapshot = {
  v: SNAPSHOT_VERSION,
  seq: 3,
  environment: { id: 'env_1', key: 'prod' },
  publishedAt: new Date(0).toISOString(),
  flags: { checkout_v2: { type: 'bool', enabled: true, default: true, rules: [] } },
  gates: {},
  blockedBuilds: {},
}

/** Shaped exactly like AsyncStorage: every method returns a promise. */
function asyncStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  const storage: KlorStorage = {
    getItem: (key) => Promise.resolve(map.get(key) ?? null),
    setItem: (key, value) => Promise.resolve(void map.set(key, value)),
  }
  return { storage, map }
}

const okFetch = (() =>
  Promise.resolve(
    new Response(JSON.stringify(SNAPSHOT), {
      status: 200,
      headers: { 'content-type': 'application/json', etag: '"abc"' },
    }),
  )) as unknown as typeof fetch

describe('on a device', () => {
  it('has no DOM to attach to, and does not look for one', () => {
    expect(typeof document).toBe('undefined')

    const client = new KlorClient({
      apiKey: 'klor_pub_test',
      fetchImpl: okFetch,
      storage: false,
      telemetry: { enabled: false },
    })

    // The web path registers a visibilitychange listener here. The point is
    // that its absence is silent rather than a crash on the first render of a
    // shipped app.
    expect(() => client.start()).not.toThrow()
    client.stop()
  })

  it('falls back to memory when there is no localStorage', async () => {
    const storage = defaultStorage()
    await storage.setItem('k', 'v')
    expect(await storage.getItem('k')).toBe('v')
  })

  it('hydrates from an asynchronous store before the network answers', async () => {
    const cached: Snapshot = { ...SNAPSHOT, seq: 1 }
    // The cache key is derived from the API key, so seed through the client.
    const { storage, map } = asyncStorage()
    const seeder = new KlorClient({
      apiKey: 'klor_pub_test',
      fetchImpl: okFetch,
      storage,
      telemetry: { enabled: false },
    })
    await seeder.refresh()
    expect([...map.values()][0]).toContain('checkout_v2')

    // A cold start with a dead network has to serve what is on disk, which on
    // mobile is the case most worth covering.
    const offline = new KlorClient({
      apiKey: 'klor_pub_test',
      fetchImpl: (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch,
      storage: { ...storage, getItem: () => Promise.resolve(JSON.stringify(cached)) },
      telemetry: { enabled: false },
    })
    offline.start()
    await vi.waitFor(() => expect(offline.getState().snapshot?.seq).toBe(1))
    expect(offline.getState().source).toBe('cache')
    expect(offline.evaluate('checkout_v2', false, {}).value).toBe(true)
    offline.stop()
  })

  it('refreshes when AppState says the app came forward', async () => {
    let onForeground: (() => void) | undefined
    let unsubscribed = false
    let requests = 0

    const client = new KlorClient({
      apiKey: 'klor_pub_test',
      storage: false,
      refreshInterval: 0,
      telemetry: { enabled: false },
      subscribeToForeground: (callback) => {
        onForeground = callback
        return () => (unsubscribed = true)
      },
      fetchImpl: (() => {
        requests += 1
        return okFetch('', {})
      }) as unknown as typeof fetch,
    })

    client.start()
    await vi.waitFor(() => expect(requests).toBe(1))

    onForeground?.()
    await vi.waitFor(() => expect(requests).toBe(2))

    client.stop()
    expect(unsubscribed).toBe(true)
  })

  it('flushes counters when the app is backgrounded', async () => {
    let onBackground: (() => void) | undefined
    const sent: unknown[][] = []

    const client = new KlorClient({
      apiKey: 'klor_pub_test',
      storage: false,
      refreshInterval: 0,
      subscribeToBackground: (callback) => {
        onBackground = callback
        return () => {}
      },
      fetchImpl: ((url: string, init: RequestInit) => {
        if (String(url).endsWith('/v1/events')) {
          sent.push(JSON.parse(String(init.body)).events)
          return Promise.resolve(new Response('{}', { status: 200 }))
        }
        return okFetch(url, init)
      }) as unknown as typeof fetch,
    })

    client.start()
    client.recordEvaluation('checkout_v2', true, 'default')

    /* Without this hook the buffer is only flushed on a timer, and an app
       backgrounded inside that interval loses what it counted, which on mobile
       is most sessions. The web gets this free from visibilitychange; React
       Native has no such event. */
    expect(sent).toHaveLength(0)
    onBackground?.()
    await vi.waitFor(() => expect(sent.flat()).toHaveLength(1))

    client.stop()
  })
})
