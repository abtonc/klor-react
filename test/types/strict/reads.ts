/** A generated registry: known keys only, typed values, typed fallbacks. */
import { useFlag } from '@klor/react'
import { KlorServerClient } from '@klor/react/server'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
function assertType<T extends true>(): T | void {}

const checkout = useFlag('checkout_v2', false)
assertType<Equal<typeof checkout, boolean>>()

const banner = useFlag('banner_text', '')
assertType<Equal<typeof banner, string>>()

const max = useFlag('max_items', 10)
assertType<Equal<typeof max, number>>()

// JSON flags take their shape from the fallback.
const theme = useFlag('theme', { color: 'red' })
assertType<Equal<typeof theme, { color: string }>>()

// @ts-expect-error a key that is not in the project
useFlag('chekout_v2', false)

// @ts-expect-error a fallback of the wrong type
useFlag('checkout_v2', 'yes')

const dynamicKey: string = 'from_somewhere'
// @ts-expect-error an arbitrary string is not a known key
useFlag(dynamicKey, 0)

declare const server: KlorServerClient
export async function onServer() {
  const value = await server.getFlag('max_items', 5)
  assertType<Equal<typeof value, number>>()
  // @ts-expect-error unknown on the server too
  await server.getFlag('nope', 5)
}
