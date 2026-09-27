# @klor/react

Remote config, feature flags, and mobile update gating for React and React Native.

One package for the browser, the device, and your server. Values are edited at
[klor.dev](https://klor.dev), published as immutable snapshots to the edge, and evaluated
**on the device**, so reads are synchronous, work offline, and no user context ever leaves
the app.

```bash
pnpm add @klor/react
```

## Quick start

```tsx
import { KlorProvider, createKlorClient, useFlag } from '@klor/react'

const klor = createKlorClient({ apiKey: 'klor_pub_…' })

function App() {
  return (
    <KlorProvider client={klor} context={{ userId: user.id }}>
      <Checkout />
    </KlorProvider>
  )
}

function Checkout() {
  const newCheckout = useFlag('checkout_v2', false)
  return newCheckout ? <OneTapCheckout /> : <CardForm />
}
```

The second argument is what you get when Klor has nothing to say, before the first fetch, on a
dead network, or if the key does not exist. Choose the behaviour you want if Klor were not
installed at all.

`useFlag` is synchronous. It never suspends, never throws, and already returns that fallback until
the first snapshot arrives, so there is no loading state to handle.

## React Native

The package has no `react-native` dependency, which is what lets one install serve both platforms.
Two things get passed in instead:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState } from 'react-native'

const klor = createKlorClient({
  apiKey: 'klor_pub_…',
  storage: AsyncStorage,
  subscribeToForeground: (refresh) => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh())
    return () => sub.remove()
  },
  subscribeToBackground: (flush) => {
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && flush())
    return () => sub.remove()
  },
})
```

Without `storage`, a cold start with no network serves fallbacks instead of the last known config.
On mobile, that is the case most worth covering.

`subscribeToBackground` is the one people skip. Usage counters are buffered in memory and flushed on
a timer; on the web the SDK also flushes when the page is hidden, and React Native has no such
event, so without it an app backgrounded inside the flush interval loses what it counted.

A runnable Expo app is in [`examples/expo`](https://github.com/abtonc/klor-react/tree/main/examples/expo).

## Update gating

Klor ships no UI. `useVersionGate()` returns a verdict and the copy to show; you render the prompt,
so it looks like your app.

```tsx
const gate = useVersionGate()
if (gate.status === 'forced') return <UpdateRequired {...gate} />
```

## On the server

`@klor/react/server` imports no React and runs on Node, Bun, and Cloudflare Workers. A private key
also sees flags marked sensitive, which are stripped from every payload a public key receives.

```ts
import { createKlorServerClient } from '@klor/react/server'

const klor = createKlorServerClient({ apiKey: process.env.KLOR_SECRET_KEY })
const pricing = await klor.getFlag('internal_pricing', { margin: 0.3 }, { userId: user.id })
```

> Public keys (`klor_pub_…`) are safe in client code. Private keys (`klor_sec_…`) must never be
> bundled into an app or sent to a browser; anything shipped in a binary can be extracted.

## Examples

- [`examples/expo`](https://github.com/abtonc/klor-react/tree/main/examples/expo): Expo Router app with AsyncStorage, foreground refresh, background flush, and an update gate.
- [`examples/nextjs`](https://github.com/abtonc/klor-react/tree/main/examples/nextjs): Next.js App Router, reading flags in a Server Component with a private key and hydrating the client from the public snapshot.

## Devtools

```tsx
import { KlorDevtools } from '@klor/react/devtools'

<KlorProvider client={klor} context={context}>
  <App />
  {process.env.NODE_ENV !== 'production' && <KlorDevtools />}
</KlorProvider>
```

A panel listing every flag with the value it is serving and why, and a switch to force one locally.
Overrides never leave the device and are never counted as usage, so you can exercise the "on" path
of a flag without editing config other people are reading. Its own entrypoint, so it stays out of
your production bundle unless you put it there.

## Integrating with a coding agent

There is a paste-ready brief at [klor.dev/docs/agent](https://klor.dev/docs/agent), and machine-
readable docs at [klor.dev/llms.txt](https://klor.dev/llms.txt) and
[klor.dev/llms-full.txt](https://klor.dev/llms-full.txt).

## Documentation

Full documentation lives at **[klor.dev/docs](https://klor.dev/docs)**.

## Dependencies

None. React is an optional peer dependency, because the server entrypoint does not need it.

## License

MIT
