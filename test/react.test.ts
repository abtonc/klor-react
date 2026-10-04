import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { KlorClient } from '../src/core/client.js'
import { SNAPSHOT_VERSION } from '../src/core/types.js'
import { KlorProvider } from '../src/react/provider.js'
import { useFlag, useFlagDetail, useKlor, useVersionGate } from '../src/react/hooks.js'
import type { KlorContext, Snapshot } from '../src/core/types.js'

/*
 * The React bindings, rendered to a string. A server render runs every hook
 * once with no DOM, which is exactly the first frame of an app: what a
 * component shows before anything has been fetched, and what it shows when a
 * snapshot was already in hand. Effects do not run, so nothing here starts a
 * refresh or records telemetry.
 */

const SNAPSHOT: Snapshot = {
  v: SNAPSHOT_VERSION,
  seq: 42,
  environment: { id: 'env_1', key: 'prod' },
  publishedAt: new Date(0).toISOString(),
  flags: {
    checkout_v2: { type: 'bool', enabled: true, default: false, rules: [] },
    banner: {
      type: 'string',
      enabled: true,
      default: 'everyone',
      rules: [
        {
          id: 'r1',
          conditions: [{ attribute: 'country', op: 'eq', values: ['TR'] }],
          value: 'turkey',
        },
      ],
    },
    paused: {
      type: 'string',
      enabled: false,
      default: 'default',
      rules: [{ id: 'r1', conditions: [], value: 'rule' }],
    },
  },
  gates: { ios: { minSupportedVersion: '2.0.0', latestVersion: '2.4.0', storeUrl: 'https://apps.apple.com/x' } },
  blockedBuilds: { ios: ['2.3.1'] },
}

function client(snapshot: Snapshot | null = SNAPSHOT) {
  return new KlorClient({
    apiKey: 'klor_pub_test',
    storage: false,
    telemetry: { enabled: false },
    refreshInterval: 0,
    refreshOnForeground: false,
    ...(snapshot ? { initialSnapshot: snapshot } : {}),
  })
}

/** Renders a hook inside a provider and returns what it produced. */
function renderHook<T>(hook: () => T, options: { client?: KlorClient; context?: KlorContext } = {}): T {
  let result: T | undefined
  function Probe() {
    result = hook()
    return null
  }
  renderToString(
    createElement(KlorProvider, {
      client: options.client ?? client(),
      context: options.context,
      children: createElement(Probe),
    }),
  )
  return result as T
}

describe('useFlag', () => {
  it('returns the fallback until a snapshot arrives, and never throws', () => {
    expect(renderHook(() => useFlag('checkout_v2', true), { client: client(null) })).toBe(true)
  })

  it('reads the published value', () => {
    expect(renderHook(() => useFlag('checkout_v2', true))).toBe(false)
  })

  it('evaluates rules against the provider context', () => {
    expect(renderHook(() => useFlag('banner', 'fallback'), { context: { attributes: { country: 'TR' } } })).toBe(
      'turkey',
    )
    expect(renderHook(() => useFlag('banner', 'fallback'), { context: { attributes: { country: 'DE' } } })).toBe(
      'everyone',
    )
  })

  it('serves the default of a paused flag, skipping its rules', () => {
    expect(renderHook(() => useFlag('paused', 'fallback'))).toBe('default')
  })

  it('falls back on an unknown key or a type that does not match', () => {
    expect(renderHook(() => useFlagDetail('nope', 'fallback'))).toMatchObject({
      value: 'fallback',
      reason: 'unknownFlag',
    })
    expect(renderHook(() => useFlag('checkout_v2', 'not a boolean'))).toBe('not a boolean')
  })

  it('applies a local override from the client', () => {
    const overridden = client()
    overridden.setOverride('checkout_v2', true)
    expect(renderHook(() => useFlag('checkout_v2', false), { client: overridden })).toBe(true)
  })
})

describe('useKlor', () => {
  it('is not ready without a snapshot', () => {
    expect(renderHook(() => useKlor(), { client: client(null) })).toMatchObject({
      isReady: false,
      isStale: false,
      seq: null,
    })
  })

  it('reports the snapshot being served', () => {
    const result = renderHook(() => useKlor())
    expect(result.isReady).toBe(true)
    expect(result.seq).toBe(42)
    expect(typeof result.refresh).toBe('function')
  })
})

describe('useVersionGate', () => {
  const ios = (appVersion: string) => ({ attributes: { platform: 'ios', appVersion } })

  it('reads platform and version from the provider context', () => {
    expect(renderHook(() => useVersionGate(), { context: ios('1.9.0') }).status).toBe('forced')
    expect(renderHook(() => useVersionGate(), { context: ios('2.3.1') }).status).toBe('forced')
    expect(renderHook(() => useVersionGate(), { context: ios('2.3.5') }).status).toBe('optional')
    expect(renderHook(() => useVersionGate(), { context: ios('2.4.0') }).status).toBe('none')
  })

  it('lets explicit options win over the context', () => {
    expect(
      renderHook(() => useVersionGate({ platform: 'ios', version: '1.0.0' }), { context: ios('9.9.9') }).status,
    ).toBe('forced')
  })

  it('does not gate a platform it does not know', () => {
    expect(renderHook(() => useVersionGate(), { context: { attributes: { platform: 'web', appVersion: '1.0.0' } } }).status).toBe(
      'none',
    )
  })
})

describe('outside a provider', () => {
  it('says what to do instead of failing obscurely', () => {
    function Bare() {
      useFlag('checkout_v2', false)
      return null
    }
    expect(() => renderToString(createElement(Bare))).toThrow(/inside <KlorProvider>/)
  })
})

describe('the devtools panel', () => {
  // Imported here so the rest of the file does not depend on the panel.
  const render = async (props: Record<string, unknown>, klor = client()) => {
    const { KlorDevtools } = await import('../src/devtools/index.js')
    return renderToString(
      createElement(KlorProvider, { client: klor, children: createElement(KlorDevtools, props) }),
    )
  }

  it('renders nothing when disabled, so one mount point can be gated by environment', async () => {
    expect(await render({ enabled: false })).toBe('')
  })

  it('starts as a launcher that counts local overrides', async () => {
    const overridden = client()
    overridden.setOverride('checkout_v2', true)
    const html = await render({}, overridden)
    expect(html).toContain('data-klor-devtools="closed"')
    expect(html).toContain('Open Klor devtools')
    expect(html).toMatch(/>1</)
  })

  it('lists every flag, putting a key the app reads but nobody published first', async () => {
    const klor = client()
    klor.recordEvaluation('never_published', false, 'unknownFlag')
    const html = await render({ defaultOpen: true }, klor)
    expect(html).toContain('data-klor-devtools="open"')
    expect(html).toContain('#0042')
    const unpublished = html.indexOf('never_published')
    expect(unpublished).toBeGreaterThan(-1)
    expect(unpublished).toBeLessThan(html.indexOf('checkout_v2'))
  })
})
