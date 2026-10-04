/** Explicit type arguments with a generated registry: still compile, keys still checked. */
import { useFlag } from '@klor/react'
import { KlorServerClient } from '@klor/react/server'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
function assertType<T extends true>(): T | void {}

type Theme = { color: string }

const theme = useFlag<Theme>('theme', { color: 'red' })
assertType<Equal<typeof theme, Theme>>()

const on = useFlag<boolean>('checkout_v2', false)
assertType<Equal<typeof on, boolean>>()

// @ts-expect-error a typo is still a typo with a type argument
useFlag<boolean>('chekout_v2', false)

declare const server: KlorServerClient
export async function onServer() {
  const max = await server.getFlag<number>('max_items', 5)
  assertType<Equal<typeof max, number>>()
}
