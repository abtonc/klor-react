'use client'

import { useState } from 'react'
import {
  KlorProvider,
  createKlorClient,
  useFlag,
  useFlagDetail,
  useKlor,
  useVersionGate,
} from '@klor/react'
import { KlorDevtools } from '@klor/react/devtools'
import type { KlorContext, Snapshot } from '@klor/react'

/**
 * Everything the browser half of the SDK can do, rendered into the DOM so the
 * integration test can read it back.
 *
 * The client is created in a `useState` initialiser rather than at module
 * scope. That is still once per mount (not per render) and it is the only way
 * to seed it with a snapshot the server already fetched, which is what stops
 * the first paint showing fallback values.
 */
export function ClientReadings({
  context,
  initialSnapshot,
}: {
  context: KlorContext
  initialSnapshot: Snapshot | null
}) {
  const [client] = useState(() =>
    createKlorClient({
      apiKey: process.env['NEXT_PUBLIC_KLOR_PUBLIC_KEY'] ?? '',
      baseUrl: process.env['NEXT_PUBLIC_KLOR_BASE_URL'] ?? '',
      // Short, so the test can watch a republish land without waiting minutes.
      refreshInterval: 30_000,
      // Overrides survive a reload, which is what makes the panel useful for
      // more than a single page view.
      persistOverrides: true,
      ...(initialSnapshot ? { initialSnapshot } : {}),
    }),
  )

  return (
    <KlorProvider client={client} context={context}>
      <Readings />
      {/* Imported from the devtools subpath, which is the only way to prove
          that entry point survives another bundler. */}
      <KlorDevtools />
    </KlorProvider>
  )
}

function Readings() {
  const checkout = useFlag('checkout_v2', false)
  const greeting = useFlag('greeting', 'fallback-greeting')
  const maxItems = useFlag('max_items', -1)
  const theme = useFlag('theme', { mode: 'fallback', density: 'fallback' })
  const betaBanner = useFlag('beta_banner', false)

  // A public key must never see a flag marked sensitive.
  const sensitive = useFlag('internal_margin', { margin: -1 })

  // Asking for a boolean from a string flag yields the fallback, not a cast.
  const mistyped = useFlag('greeting', false)

  const detail = useFlagDetail('checkout_v2', false)
  const unknown = useFlagDetail('no_such_flag_anywhere', 'fallback')
  const klor = useKlor()
  const gate = useVersionGate()

  return (
    <section>
      <h2>Client</h2>
      <dl>
        <Row id="client-checkout_v2" label="checkout_v2" value={checkout} />
        <Row id="client-greeting" label="greeting" value={greeting} />
        <Row id="client-max_items" label="max_items" value={maxItems} />
        <Row id="client-theme" label="theme" value={theme} />
        <Row id="client-beta_banner" label="beta_banner" value={betaBanner} />
        <Row id="client-internal_margin" label="internal_margin (sensitive)" value={sensitive} />
        <Row id="client-mistyped" label="greeting as boolean" value={mistyped} />

        <Row id="client-reason" label="checkout_v2 reason" value={detail.reason} />
        <Row id="client-rule-id" label="checkout_v2 ruleId" value={detail.ruleId ?? 'none'} />
        <Row id="client-unknown-reason" label="unknown flag reason" value={unknown.reason} />
        <Row id="client-unknown-value" label="unknown flag value" value={unknown.value} />

        <Row id="client-ready" label="isReady" value={klor.isReady} />
        <Row id="client-stale" label="isStale" value={klor.isStale} />
        <Row id="client-seq" label="snapshot seq" value={klor.seq} />

        <Row id="client-gate-status" label="gate status" value={gate.status} />
        <Row id="client-gate-reason" label="gate reason" value={gate.reason} />
        <Row id="client-gate-message" label="gate message" value={gate.message ?? 'none'} />
        <Row id="client-gate-latest" label="gate latestVersion" value={gate.latestVersion ?? 'none'} />
      </dl>

      <button type="button" data-testid="refresh" onClick={() => void klor.refresh()}>
        Refresh
      </button>
      <button
        type="button"
        data-testid="flush-telemetry"
        onClick={() => klor.flushTelemetry()}
      >
        Flush telemetry
      </button>
    </section>
  )
}

function Row({ id, label, value }: { id: string; label: string; value: unknown }) {
  return (
    <>
      <dt style={{ color: '#9b96a8', fontSize: 12 }}>{label}</dt>
      <dd data-testid={id} style={{ margin: '0 0 0.5rem' }}>
        {typeof value === 'string' ? value : JSON.stringify(value)}
      </dd>
    </>
  )
}
