// The shape `klor types --loose` writes.
import type { JsonValue } from '@klor/react/core'

declare global {
  interface KlorFlags {
    checkout_v2: boolean
    theme: JsonValue
  }
  interface KlorTypeOptions {
    strict: false
  }
}

export {}
