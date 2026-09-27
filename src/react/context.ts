import { createContext, useContext } from 'react'
import type { KlorClient } from '../core/client.js'
import type { KlorContext } from '../core/types.js'

export interface KlorContextValue {
  client: KlorClient
  context: KlorContext
}

export const KlorReactContext = createContext<KlorContextValue | null>(null)

export function useKlorContext(): KlorContextValue {
  const value = useContext(KlorReactContext)
  if (!value) {
    throw new Error(
      'Klor hooks must be used inside <KlorProvider>. Wrap your app root with it and pass a client from createKlorClient().',
    )
  }
  return value
}
