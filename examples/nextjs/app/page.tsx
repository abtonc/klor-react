import { createKlorServerClient } from '@klor/react/server'
import { ClientReadings } from './client-readings'
import type { KlorContext } from '@klor/react'

// Nothing here may be cached, so a newly published snapshot shows on the next
// request.
export const dynamic = 'force-dynamic'

/**
 * The server half, in a React Server Component.
 *
 * Two clients are created deliberately: one with the **private** key, which is
 * what a server would use and which also sees flags marked sensitive, and one
 * with the **public** key, used only to fetch the snapshot handed to the
 * browser. Passing the private client's snapshot to the client would publish
 * every sensitive flag, so the example shows the correct split rather than the
 * convenient one.
 */
const server = createKlorServerClient({
  apiKey: process.env['KLOR_SECRET_KEY'] ?? '',
  baseUrl: process.env['KLOR_BASE_URL'] ?? '',
  ttlMs: 0,
})

const publicServer = createKlorServerClient({
  apiKey: process.env['NEXT_PUBLIC_KLOR_PUBLIC_KEY'] ?? '',
  baseUrl: process.env['KLOR_BASE_URL'] ?? '',
  ttlMs: 0,
})

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const one = (key: string, fallback: string) => {
    const value = params[key]
    return (Array.isArray(value) ? value[0] : value) ?? fallback
  }

  const context: KlorContext = {
    userId: one('userId', 'user-0'),
    attributes: {
      platform: one('platform', 'web'),
      country: one('country', 'US'),
      appVersion: one('appVersion', '2.4.0'),
    },
  }

  await server.refresh()
  await publicServer.refresh()

  const [checkout, greeting, maxItems, theme, sensitive, all, gate, snapshot] = await Promise.all([
    server.getFlag('checkout_v2', false, context),
    server.getFlag('greeting', 'fallback-greeting', context),
    server.getFlag('max_items', -1, context),
    server.getFlag('theme', { mode: 'fallback' }, context),
    // The private key is the only way to read this one.
    server.getFlag('internal_margin', { margin: -1 }, context),
    server.getAllFlags(context),
    server.getVersionGate('ios', one('appVersion', '2.4.0')),
    // Public snapshot, safe to hand to the browser.
    publicServer.getSnapshot(),
  ])

  return (
    <main>
      <h1>Klor integration example</h1>

      <section>
        <h2>Server</h2>
        <dl>
          <Row id="server-checkout_v2" label="checkout_v2" value={checkout} />
          <Row id="server-greeting" label="greeting" value={greeting} />
          <Row id="server-max_items" label="max_items" value={maxItems} />
          <Row id="server-theme" label="theme" value={theme} />
          <Row id="server-internal_margin" label="internal_margin (sensitive)" value={sensitive} />
          <Row id="server-all-keys" label="getAllFlags keys" value={Object.keys(all).sort()} />
          <Row id="server-gate-status" label="ios gate status" value={gate.status} />
          <Row id="server-gate-reason" label="ios gate reason" value={gate.reason} />
          <Row id="server-snapshot-seq" label="public snapshot seq" value={snapshot?.seq ?? null} />
          <Row
            id="server-snapshot-has-sensitive"
            label="public snapshot contains sensitive flag"
            value={snapshot ? 'internal_margin' in snapshot.flags : 'no-snapshot'}
          />
        </dl>
      </section>

      <ClientReadings context={context} initialSnapshot={snapshot} />
    </main>
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
