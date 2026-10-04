/**
 * Explicit type arguments, as written against 0.3.0. One argument names the
 * fallback's type, and the read returns exactly that type, on every API.
 */
import { createKlorClient, useFlag, useFlagDetail } from '@klor/react'
import { KlorServerClient } from '@klor/react/server'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
function assertType<T extends true>(): T | void {}

type Theme = { mode: string; density: string }
const fallbackTheme: Theme = { mode: 'light', density: 'compact' }

const theme = useFlag<Theme>('theme', fallbackTheme)
assertType<Equal<typeof theme, Theme>>()

const on = useFlag<boolean>('checkout_v2', false)
assertType<Equal<typeof on, boolean>>()

const detail = useFlagDetail<number>('max_items', 25)
assertType<Equal<typeof detail.value, number>>()

declare const server: KlorServerClient
export async function onServer() {
  const value = await server.getFlag<string>('greeting', 'hello')
  assertType<Equal<typeof value, string>>()
  const full = await server.getFlagDetail<Theme>('theme', fallbackTheme, { userId: 'u' })
  assertType<Equal<typeof full.value, Theme>>()
}

const client = createKlorClient({ apiKey: 'klor_pub_x' })
const evaluated = client.evaluate<boolean>('checkout_v2', true, {})
assertType<Equal<typeof evaluated.value, boolean>>()

// @ts-expect-error a fallback that does not match the type argument
useFlag<boolean>('checkout_v2', 'yes')
