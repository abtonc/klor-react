/**
 * No registry: every key is a string and every read is typed exactly as it was
 * before typed keys existed.
 */
import { useFlag, useFlagDetail } from '@klor/react'
import { KlorServerClient } from '@klor/react/server'
import type { FlagValue } from '@klor/react'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
function assertType<T extends true>(): T | void {}

const flag: boolean = useFlag('anything_at_all', false)
const text: string = useFlag('banner', 'hello')
const count: number = useFlag('max_items', 3)

const theme = useFlag('theme', { color: 'red' })
assertType<Equal<typeof theme, { color: string }>>()

const detail = useFlagDetail('anything_at_all', true as boolean)
assertType<Equal<typeof detail.value, boolean>>()

const dynamicKey: string = 'from_somewhere'
useFlag(dynamicKey, 0)

declare const server: KlorServerClient

/* The shape of a helper many apps already have. It must keep compiling on an
   upgrade, which rules out any transformation of `T` on this path. */
async function readFlag<T extends FlagValue>(key: string, fallback: T): Promise<T> {
  return server.getFlag(key, fallback)
}
function useNamedFlag<T extends FlagValue>(key: string, fallback: T): T {
  return useFlag(key, fallback)
}

export { flag, text, count, readFlag, useNamedFlag }
