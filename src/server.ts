/**
 * Server entrypoint, `@klor/react/server`.
 *
 * Imports no React and touches no browser globals, so it runs on Node, Bun, and
 * Cloudflare Workers. Use it with a private key (`klor_sec_…`) to read flags
 * marked sensitive, which are stripped from the public snapshot.
 */

import { evaluateFromSnapshot, evaluateVersionGate } from './core/evaluate.js'
import { KlorClient } from './core/client.js'
import type {
  Evaluation,
  FlagFallback,
  FlagKey,
  FlagResult,
  FlagValue,
  KlorContext,
  Snapshot,
  VersionGateResult,
} from './core/types.js'

export interface KlorServerClientOptions {
  /** A private key. Public keys work too, but won't see sensitive flags. */
  apiKey: string
  baseUrl?: string
  /** How long a snapshot is served before revalidating. Default 30s. */
  ttlMs?: number
  fetchImpl?: typeof fetch
  onError?: (error: unknown) => void
}

const DEFAULT_TTL_MS = 30_000

export class KlorServerClient {
  readonly #client: KlorClient
  readonly #ttlMs: number
  #revalidating: Promise<void> | undefined

  constructor(options: KlorServerClientOptions) {
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.#client = new KlorClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      // No disk cache and no timers: a server process manages its own lifetime,
      // and a serverless invocation would never live long enough to poll.
      storage: false,
      refreshInterval: 0,
      refreshOnForeground: false,
      fetchImpl: options.fetchImpl,
      onError: options.onError,
    })
  }

  /**
   * Ensures a snapshot is loaded, then keeps it warm. The first call in a cold
   * process awaits the fetch; later calls serve from memory and revalidate in
   * the background once past the TTL, so request latency stays flat.
   */
  async ready(): Promise<void> {
    const state = this.#client.getState()

    if (!state.snapshot) {
      await this.#client.refresh()
      return
    }

    const age = state.lastSyncedAt === null ? Infinity : Date.now() - state.lastSyncedAt
    if (age > this.#ttlMs) {
      this.#revalidating ??= this.#client.refresh().finally(() => {
        this.#revalidating = undefined
      })
    }
  }

  async getFlag<T extends FlagFallback<K>, K extends FlagKey = FlagKey>(
    flagKey: K,
    fallback: T,
    context: KlorContext = {},
  ): Promise<FlagResult<K, T>> {
    return (await this.getFlagDetail(flagKey, fallback, context)).value
  }

  async getFlagDetail<T extends FlagFallback<K>, K extends FlagKey = FlagKey>(
    flagKey: K,
    fallback: T,
    context: KlorContext = {},
  ): Promise<Evaluation<FlagResult<K, T>>> {
    await this.ready()
    return evaluateFromSnapshot(
      this.#client.getState().snapshot,
      flagKey,
      fallback,
      context,
    ) as Evaluation<FlagResult<K, T>>
  }

  /** Every flag evaluated for one context, handy for hydrating a client. */
  async getAllFlags(context: KlorContext = {}): Promise<Record<string, FlagValue>> {
    await this.ready()
    const snapshot = this.#client.getState().snapshot
    if (!snapshot) return {}

    const result: Record<string, FlagValue> = {}
    for (const [key, definition] of Object.entries(snapshot.flags)) {
      result[key] = evaluateFromSnapshot(snapshot, key, definition.default, context).value
    }
    return result
  }

  async getVersionGate(
    platform: 'ios' | 'android',
    currentVersion: string,
  ): Promise<VersionGateResult> {
    await this.ready()
    return evaluateVersionGate(this.#client.getState().snapshot, platform, currentVersion)
  }

  /**
   * The raw snapshot, for passing to `createKlorClient({ initialSnapshot })` on
   * the client so hydration doesn't flash fallback values.
   *
   * Only safe to send to a browser when this client uses a **public** key, a
   * private-key snapshot contains flags marked sensitive.
   */
  async getSnapshot(): Promise<Snapshot | null> {
    await this.ready()
    return this.#client.getState().snapshot
  }

  /** Forces a revalidation regardless of TTL. */
  refresh(): Promise<void> {
    return this.#client.refresh()
  }
}

export function createKlorServerClient(options: KlorServerClientOptions): KlorServerClient {
  return new KlorServerClient(options)
}

export type {
  Evaluation,
  FlagValue,
  KlorContext,
  Snapshot,
  VersionGateResult,
} from './core/types.js'
export { KlorHttpError } from './core/transport.js'
