/** Explicit type arguments in loose mode: known and unknown keys both compile. */
import { useFlag } from '@klor/react'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
function assertType<T extends true>(): T | void {}

const known = useFlag<boolean>('checkout_v2', true)
assertType<Equal<typeof known, boolean>>()

const later = useFlag<number>('not_generated_yet', 3)
assertType<Equal<typeof later, number>>()
