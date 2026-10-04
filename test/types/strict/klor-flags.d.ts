// The shape `klor types` writes.
import type { JsonValue } from '@klor/react/core'

declare global {
  interface KlorFlags {
    checkout_v2: boolean
    banner_text: string
    max_items: number
    theme: JsonValue
  }
}

export {}
