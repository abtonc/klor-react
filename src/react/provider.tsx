import { createElement, useEffect, useMemo } from 'react'
import { KlorReactContext } from './context.js'
import type { ReactNode } from 'react'
import type { KlorClient } from '../core/client.js'
import type { KlorContext } from '../core/types.js'

export interface KlorProviderProps {
  client: KlorClient
  /** Who the current user is. Changing it re-evaluates every flag immediately. */
  context?: KlorContext
  children: ReactNode
}

export function KlorProvider({ client, context, children }: KlorProviderProps) {
  useEffect(() => {
    client.start()
    return () => client.stop()
  }, [client])

  // Contexts are almost always written as an inline object literal, so compare
  // by value rather than identity; otherwise every parent render would
  // invalidate every flag downstream.
  const contextKey = JSON.stringify(context ?? {})
  const value = useMemo(
    () => ({ client, context: context ?? {} }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, contextKey],
  )

  return createElement(KlorReactContext.Provider, { value }, children)
}
