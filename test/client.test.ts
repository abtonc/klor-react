import { describe, expect, it, vi } from 'vitest'
import { KlorClient } from '../src/core/client.js'
import { SNAPSHOT_VERSION } from '../src/core/types.js'
import type { Snapshot } from '../src/core/types.js'

const SNAPSHOT: Snapshot = {
  v: SNAPSHOT_VERSION,
  seq: 7,
  environment: { id: 'env_1', key: 'prod' },
  publishedAt: new Date(0).toISOString(),
  flags: {
    checkout_v2: { type: 'bool', enabled: true, default: false, rules: [] },
    max_items: { type: 'number', enabled: true, default: 25, rules: [] },
  },
  gates: {},
  blockedBuilds: {},
}

function client(options = {}) {
  return new KlorClient({
    apiKey: 'klor_pub_test',
    storage: false,
    initialSnapshot: SNAPSHOT,
    telemetry: { enabled: false },
    ...options,
  })
}

/** A fetch that never settles on its own, so only the timeout can end it. */
function hangingFetch() {
  const calls: Array<AbortSignal | undefined> = []
  const impl = ((_url: string, init: RequestInit) => {
    calls.push(init.signal ?? undefined)
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })
  }) as unknown as typeof fetch
  return { calls, impl }
}

describe('a stalled request', () => {
  it('is abandoned, and does not wedge every later refresh', async () => {
    const { calls, impl } = hangingFetch()
    const errors: unknown[] = []

    const client = new KlorClient({
      apiKey: 'klor_pub_test',
      fetchImpl: impl,
      storage: false,
      requestTimeout: 25,
      telemetry: { enabled: false },
      onError: (error) => errors.push(error),
    })

    await client.refresh()
    expect(calls).toHaveLength(1)

    // The regression that matters. Concurrent callers share one in-flight
    // promise, so a request that never settles used to fold every subsequent
    // refresh into itself and the client stopped updating for good.
    await client.refresh()
    expect(calls).toHaveLength(2)

    expect(errors).toHaveLength(2)
    expect(client.getState().status).toBe('error')
  })

  it('can be switched off for callers that want to wait forever', async () => {
    const { calls, impl } = hangingFetch()
    const client = new KlorClient({
      apiKey: 'klor_pub_test',
      fetchImpl: impl,
      storage: false,
      requestTimeout: 0,
      telemetry: { enabled: false },
    })

    void client.refresh()
    await new Promise((done) => setTimeout(done, 20))
    expect(calls[0]).toBeUndefined()
  })
})

describe('polling', () => {
  it('scatters each wait, so a fleet does not arrive together', () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(globalThis, 'setTimeout')
    const random = vi.spyOn(Math, 'random')

    try {
      const delays = []
      for (const value of [0, 0.5, 1]) {
        random.mockReturnValue(value)
        spy.mockClear()

        const client = new KlorClient({
          apiKey: 'klor_pub_test',
          fetchImpl: (() => new Promise(() => {})) as unknown as typeof fetch,
          storage: false,
          refreshInterval: 300_000,
          telemetry: { enabled: false },
        })
        client.start()
        delays.push(spy.mock.calls.map(([, delay]) => delay).find((d) => typeof d === 'number' && d > 1_000))
        client.stop()
      }

      // A tenth either side of five minutes, and never the same number twice.
      expect(delays).toEqual([270_000, 300_000, 330_000])
    } finally {
      random.mockRestore()
      spy.mockRestore()
      vi.useRealTimers()
    }
  })
})

describe('local overrides', () => {
  it('win over the published value', () => {
    const klor = client()
    expect(klor.evaluate('checkout_v2', false, {}).value).toBe(false)

    klor.setOverride('checkout_v2', true)
    const forced = klor.evaluate('checkout_v2', false, {})
    expect(forced.value).toBe(true)
    expect(forced.reason).toBe('override')

    klor.clearOverride('checkout_v2')
    expect(klor.evaluate('checkout_v2', false, {}).value).toBe(false)
  })

  it('are ignored when the type is wrong', () => {
    const klor = client()
    // Serving this would reproduce, on one machine, exactly the silent-fallback
    // failure the type check exists to prevent.
    klor.setOverride('max_items', 'lots')
    const result = klor.evaluate('max_items', 0, {})
    expect(result.value).toBe(25)
    expect(result.reason).toBe('default')
  })

  it('are never counted as usage', () => {
    const sent: unknown[][] = []
    const klor = client({
      telemetry: { enabled: true, flushInterval: 0 },
      fetchImpl: ((_url: string, init: RequestInit) => {
        sent.push(JSON.parse(String(init.body)).events)
        return Promise.resolve(new Response('{}', { status: 200 }))
      }) as unknown as typeof fetch,
    })

    klor.setOverride('checkout_v2', true)
    klor.recordEvaluation('checkout_v2', true, 'override')
    klor.flushTelemetry()
    expect(sent).toHaveLength(0)

    klor.recordEvaluation('checkout_v2', false, 'default')
    klor.flushTelemetry()
    expect(sent.flat()).toHaveLength(1)
  })

  it('notify subscribers, so a panel and the app agree', () => {
    const klor = client()
    let notified = 0
    klor.subscribe(() => (notified += 1))

    klor.setOverride('checkout_v2', true)
    klor.clearOverrides()

    expect(notified).toBe(2)
    expect(klor.getState().overrides).toEqual({})
  })
})

describe('what the app actually asked for', () => {
  const snapshot: Snapshot = {
    v: SNAPSHOT_VERSION,
    seq: 1,
    environment: { id: 'e', key: 'prod' },
    publishedAt: new Date(0).toISOString(),
    flags: { checkout_v2: { type: 'bool' as const, enabled: true, default: true, rules: [] } },
    gates: {},
    blockedBuilds: {},
  }

  const client = () =>
    new KlorClient({
      apiKey: 'klor_pub_test',
      storage: false,
      initialSnapshot: snapshot,
      telemetry: { enabled: false },
    })

  it('records a key the snapshot does not contain', () => {
    const klor = client()
    const result = klor.evaluate('typo_in_the_key', false, {})
    klor.recordEvaluation('typo_in_the_key', result.value, result.reason)

    /* The whole point: devtools lists what was published, so a key the code
       reads and nobody published is exactly what it could not show. */
    expect(klor.getState().requested['typo_in_the_key']).toEqual({
      value: false,
      reason: 'unknownFlag',
    })
  })

  it('records a type mismatch, which reads as a dead flag otherwise', () => {
    const klor = client()
    const result = klor.evaluate('checkout_v2', 'a string', {})
    klor.recordEvaluation('checkout_v2', result.value, result.reason)

    expect(klor.getState().requested['checkout_v2']?.reason).toBe('typeMismatch')
  })

  it('notifies once per distinct outcome, not per read', () => {
    const klor = client()
    let notified = 0
    klor.subscribe(() => (notified += 1))

    for (let i = 0; i < 5; i++) klor.recordEvaluation('checkout_v2', true, 'default')
    expect(notified).toBe(1)

    // A changed outcome is worth a notification; a repeat of it is not.
    klor.recordEvaluation('checkout_v2', false, 'rule')
    expect(notified).toBe(2)
  })
})

describe('a fallback that is a fresh object every render', () => {
  it('does not notify forever', () => {
    const klor = new KlorClient({
      apiKey: 'klor_pub_test',
      storage: false,
      telemetry: { enabled: false },
    })

    let notified = 0
    klor.subscribe(() => (notified += 1))

    /* The shape a real app has: an inline literal fallback, so the value is a
       new reference every time. Comparing references here notifies on every
       render, which re-renders, which produces another new literal. The hooks
       call this from an effect keyed on the outcome, so that is not a wasted
       update but a loop the app never recovers from. */
    for (let i = 0; i < 10; i++) {
      klor.recordEvaluation('theme', { mode: 'fallback' }, 'unknownFlag')
    }

    expect(notified).toBe(1)
  })
})

describe('base URL', () => {
  it('treats an empty string as the default, as an unset env var gives', async () => {
    const urls: string[] = []
    const impl = (async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify(SNAPSHOT), { headers: { etag: '"a"' } })
    }) as unknown as typeof fetch
    await client({ baseUrl: '', fetchImpl: impl }).refresh()
    expect(urls[0]).toMatch(/^https:\/\/edge\.klor\.dev\//)
  })
})
