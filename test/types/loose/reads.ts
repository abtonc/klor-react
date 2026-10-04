/** A loose registry: known keys are typed, unknown keys still compile. */
import { useFlag } from '@klor/react'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
function assertType<T extends true>(): T | void {}

const checkout = useFlag('checkout_v2', true)
assertType<Equal<typeof checkout, boolean>>()

// @ts-expect-error known keys still refuse a fallback of the wrong type
useFlag('checkout_v2', 1)

const later: string = useFlag('not_generated_yet', 'x')

const dynamicKey: string = 'from_somewhere'
useFlag(dynamicKey, 0)

export { later }
