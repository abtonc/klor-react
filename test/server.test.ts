import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKlorServerClient } from '../src/server.js'
import { SNAPSHOT_VERSION } from '../src/core/types.js'
import type { Snapshot } from '../src/core/types.js'

/*
 * `@klor/react/server`, against a fake read plane. The behaviour worth pinning
 * is the caching: a cold process waits for its first snapshot, a warm one
 * never waits, and a stale one answers from memory while exactly one
 * revalidation runs behind it.
 */

function snapshot(seq: number, checkoutDefault = false): Snapshot {
  return {
    v: SNAPSHOT_VERSION,
    seq,
    environment: { id: 'env_1', key: 'prod' },
    publishedAt: new Date(0).toISOString(),
    flags: {
      checkout_v2: { type: 'bool', enabled: true, default: checkoutDefault, rules: [] },
      internal_pricing: {
        type: 'number',
        enabled: true,
        default: 10,
        rules: [{ id: 'r1', conditions: [{ attribute: 'plan', op: 'eq', values: ['pro'] }], value: 20 }],
      },
    },
    gates: { android: { minSupportedVersion: '3.0.0', latestVersion: '3.2.0' } },
    blockedBuilds: {},
  }
}

/** A read plane that serves whatever `current` is, and counts requests. */
function readPlane(initial: Snapshot) {
  const plane = { current: initial, requests: 0, fail: false }
  const fetchImpl = (async () => {
    plane.requests++
    if (plane.fail) throw new Error('network down')
    return new Response(JSON.stringify(plane.current), {
      status: 200,
      headers: { 'content-type': 'application/json', etag: `"${plane.current.seq}"` },
    })
  }) as unknown as typeof fetch
  return { plane, fetchImpl }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('a cold process', () => {
  it('waits for the first snapshot, then serves from memory', async () => {
    const { plane, fetchImpl } = readPlane(snapshot(1, true))
    const klor = createKlorServerClient({ apiKey: 'klor_sec_test', fetchImpl })

    expect(await klor.getFlag('checkout_v2', false)).toBe(true)
    expect(await klor.getFlag('checkout_v2', false)).toBe(true)
    expect(plane.requests).toBe(1)
  })

  it('answers with the fallback when the read plane cannot be reached', async () => {
    const { plane, fetchImpl } = readPlane(snapshot(1, true))
    plane.fail = true
    const errors: unknown[] = []
    const klor = createKlorServerClient({ apiKey: 'klor_sec_test', fetchImpl, onError: (error) => errors.push(error) })

    expect(await klor.getFlag('checkout_v2', false)).toBe(false)
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('a warm process', () => {
  it('serves a stale snapshot at once and revalidates once behind it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { plane, fetchImpl } = readPlane(snapshot(1, false))
    const klor = createKlorServerClient({ apiKey: 'klor_sec_test', fetchImpl, ttlMs: 1_000 })

    expect(await klor.getFlag('checkout_v2', true)).toBe(false)
    plane.current = snapshot(2, true)

    // Inside the TTL: memory, no request.
    vi.setSystemTime(Date.now() + 500)
    expect(await klor.getFlag('checkout_v2', true)).toBe(false)
    expect(plane.requests).toBe(1)

    // Past it: the old value now, one revalidation however many ask.
    vi.setSystemTime(Date.now() + 1_000)
    const answers = await Promise.all([
      klor.getFlag('checkout_v2', false),
      klor.getFlag('checkout_v2', false),
      klor.getFlag('checkout_v2', false),
    ])
    expect(answers).toEqual([false, false, false])
    expect(plane.requests).toBe(2)

    // And the next read sees what the revalidation brought back.
    await klor.refresh()
    expect(await klor.getFlag('checkout_v2', false)).toBe(true)
  })
})

describe('evaluation', () => {
  it('evaluates rules for the context it is given', async () => {
    const { fetchImpl } = readPlane(snapshot(1))
    const klor = createKlorServerClient({ apiKey: 'klor_sec_test', fetchImpl })

    expect(await klor.getFlag('internal_pricing', 0, { attributes: { plan: 'pro' } })).toBe(20)
    expect(await klor.getFlag('internal_pricing', 0, { attributes: { plan: 'free' } })).toBe(10)
    expect(await klor.getFlagDetail('missing', 'x')).toMatchObject({ value: 'x', reason: 'unknownFlag' })
  })

  it('evaluates every flag for one context', async () => {
    const { fetchImpl } = readPlane(snapshot(1, true))
    const klor = createKlorServerClient({ apiKey: 'klor_sec_test', fetchImpl })

    expect(await klor.getAllFlags({ attributes: { plan: 'pro' } })).toEqual({
      checkout_v2: true,
      internal_pricing: 20,
    })
  })

  it('decides update gates, and hands back the raw snapshot for hydration', async () => {
    const { fetchImpl } = readPlane(snapshot(7))
    const klor = createKlorServerClient({ apiKey: 'klor_pub_test', fetchImpl })

    expect((await klor.getVersionGate('android', '2.9.0')).status).toBe('forced')
    expect((await klor.getVersionGate('android', '3.1.0')).status).toBe('optional')
    expect((await klor.getSnapshot())?.seq).toBe(7)
  })
})
