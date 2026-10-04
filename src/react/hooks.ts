import { useEffect, useSyncExternalStore } from 'react'
import { useKlorContext } from './context.js'
import { evaluateVersionGate } from '../core/evaluate.js'
import type { KlorState } from '../core/client.js'
import type {
  Evaluation,
  FlagFallback,
  FlagKey,
  FlagResult,
  VersionGateResult,
} from '../core/types.js'

/** Subscribes to the client's store. Exported for the devtools panel. */
export function useKlorState(): KlorState {
  const { client } = useKlorContext()
  return useSyncExternalStore(client.subscribe, client.getState, client.getState)
}

/*
 * Type parameter order on every read below is load-bearing: the fallback's type
 * comes first and the key's has a default, so a caller who writes one type
 * argument, `useFlag<Theme>(...)`, names the fallback as they did before typed
 * keys existed. With the key first, every such call stops compiling.
 */

/**
 * Reads a flag. Synchronous, never suspends, and never throws, before the
 * first snapshot arrives it returns `fallback`, which is also what it returns
 * if the key is unknown or its type doesn't match.
 *
 * ```ts
 * const showNewCheckout = useFlag('checkout_v2', false)
 * ```
 *
 * Keys are any string unless you opt into typed keys (see `KlorFlags`).
 */
export function useFlag<T extends FlagFallback<K>, K extends FlagKey = FlagKey>(
  flagKey: K,
  fallback: T,
): FlagResult<K, T> {
  return useFlagDetail(flagKey, fallback).value
}

/** `useFlag` plus why that value was chosen, useful in dev tools and logging. */
export function useFlagDetail<T extends FlagFallback<K>, K extends FlagKey = FlagKey>(
  flagKey: K,
  fallback: T,
): Evaluation<FlagResult<K, T>> {
  const { client, context } = useKlorContext()
  const state = useKlorState()
  // Through the client rather than the pure evaluator, so a local override is
  // applied here too. `state` is still read so a change to either the snapshot
  // or the overrides re-renders.
  void state
  const evaluation = client.evaluate(flagKey, fallback, context)

  // Recorded from an effect keyed on the outcome, so a flag read in a hot
  // render loop is counted once per distinct result rather than once per
  // render. Evaluation itself stays a pure function.
  useEffect(() => {
    client.recordEvaluation(flagKey, evaluation.value, evaluation.reason)
  }, [client, flagKey, evaluation.value, evaluation.reason])

  return evaluation
}

export interface UseKlorResult {
  /** True once any snapshot is in hand, from cache or network. */
  isReady: boolean
  /** True when the last refresh failed but a cached snapshot is still serving. */
  isStale: boolean
  lastSyncedAt: number | null
  error: unknown
  /** Snapshot sequence currently being served, for support and debugging. */
  seq: number | null
  refresh: () => Promise<void>
  /** Sends buffered usage counters immediately. */
  flushTelemetry: () => void
}

export function useKlor(): UseKlorResult {
  const { client } = useKlorContext()
  const state = useKlorState()
  return {
    isReady: state.snapshot !== null,
    isStale: state.error !== null && state.snapshot !== null,
    lastSyncedAt: state.lastSyncedAt,
    error: state.error,
    seq: state.snapshot?.seq ?? null,
    refresh: client.refresh,
    flushTelemetry: client.flushTelemetry,
  }
}

export interface UseVersionGateOptions {
  /** Defaults to the `platform` attribute on the provider's context. */
  platform?: 'ios' | 'android'
  /** Defaults to the `appVersion` attribute on the provider's context. */
  version?: string
}

/**
 * Decides whether the running build should update. Klor ships no UI, render
 * your own modal from the returned status.
 *
 * ```tsx
 * const gate = useVersionGate()
 * if (gate.status === 'forced') return <UpdateRequired {...gate} />
 * ```
 */
export function useVersionGate(options?: UseVersionGateOptions): VersionGateResult {
  const { context } = useKlorContext()
  const state = useKlorState()

  const platform = options?.platform ?? (context.attributes?.['platform'] as 'ios' | 'android' | undefined)
  const version = options?.version ?? (context.attributes?.['appVersion'] as string | undefined)

  return evaluateVersionGate(
    state.snapshot,
    platform === 'ios' || platform === 'android' ? platform : undefined,
    version,
  )
}
