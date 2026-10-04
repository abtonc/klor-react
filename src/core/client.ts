import { evaluateFromSnapshot, evaluateVersionGate } from './evaluate.js'
import { cacheKeyFor, defaultStorage } from './storage.js'
import { DEFAULT_BASE_URL, fetchSnapshot, isSnapshot, sendEvents } from './transport.js'
import { Telemetry } from './telemetry.js'
import type { KlorStorage } from './storage.js'
import type { TelemetryOptions } from './telemetry.js'
import type {
  Evaluation,
  FlagFallback,
  FlagKey,
  FlagResult,
  EvaluationReason,
  FlagValue,
  KlorContext,
  Snapshot,
  VersionGateResult,
} from './types.js'

/** Guards against a misconfigured app polling the edge every second. */
export const MIN_REFRESH_INTERVAL_MS = 30_000
export const DEFAULT_REFRESH_INTERVAL_MS = 300_000

/**
 * How long a config request may hang before it is abandoned.
 *
 * Without this a captive portal or a half-open socket stalls one request
 * forever, and because concurrent refreshes share the in-flight promise, every
 * later refresh is folded into the dead one. The client then stops updating for
 * the life of the process, which in a shipped binary is unfixable.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

/**
 * How far either side of the interval each poll is scattered.
 *
 * Every client starts its clock at app launch, and a push notification wakes
 * them together, so a fixed interval turns a large install base into a
 * synchronised stampede. Has to be in the binary from the first release: it
 * cannot be added to copies already in the field.
 */
const REFRESH_JITTER = 0.1

export interface KlorClientOptions {
  /** A public key (`klor_pub_…`) on clients, or a private key on servers. */
  apiKey: string
  baseUrl?: string
  /** Pass AsyncStorage or MMKV in React Native. `false` disables persistence. */
  storage?: KlorStorage | false
  /** Polling cadence in ms. `0` polls only on mount and on foreground. */
  refreshInterval?: number
  /** Abandon a config request after this many ms. `0` waits forever. */
  requestTimeout?: number
  /** Web only; React Native should supply `subscribeToForeground` instead. */
  refreshOnForeground?: boolean
  /**
   * Lets React Native drive foreground refreshes without this package importing
   * `react-native`:
   *
   * ```ts
   * subscribeToForeground: (onForeground) => {
   *   const sub = AppState.addEventListener('change', (s) => s === 'active' && onForeground())
   *   return () => sub.remove()
   * }
   * ```
   */
  subscribeToForeground?: (onForeground: () => void) => () => void
  /**
   * The other half of the same story, and the one that is easy to miss.
   *
   * Usage counters are buffered in memory and flushed on a timer. On the web
   * the SDK also flushes when the page is hidden, because that is when a buffer
   * would otherwise be lost. React Native has no `document` and therefore no
   * such event, so without this hook a mobile app that is backgrounded inside
   * the flush interval loses whatever it had counted, which is most sessions.
   *
   * ```ts
   * subscribeToBackground: (onBackground) => {
   *   const sub = AppState.addEventListener('change', (s) => s !== 'active' && onBackground())
   *   return () => sub.remove()
   * }
   * ```
   */
  subscribeToBackground?: (onBackground: () => void) => () => void
  /** Server-rendered snapshot, so hydration never flashes fallback values. */
  initialSnapshot?: Snapshot
  /**
   * Values forced on this device, which win over whatever is published.
   *
   * For local development and for tests: a developer can exercise the "on" path
   * without editing configuration that other people are also reading. Overrides
   * never reach the server and are never reported as usage.
   */
  overrides?: Record<string, FlagValue>
  /** Persist overrides across reloads. Off by default; devtools turns it on. */
  persistOverrides?: boolean
  fetchImpl?: typeof fetch
  onError?: (error: unknown) => void
  /**
   * Anonymous usage counters, which flags are read, how often, and which value
   * they served. Never carries user or device identifiers. Pass
   * `{ enabled: false }` to send nothing.
   */
  telemetry?: TelemetryOptions
}

export type KlorStatus = 'idle' | 'loading' | 'ready' | 'error'
export type SnapshotSource = 'none' | 'initial' | 'cache' | 'network'

export interface KlorState {
  snapshot: Snapshot | null
  status: KlorStatus
  source: SnapshotSource
  /** Epoch ms of the last successful network sync, including 304s. */
  lastSyncedAt: number | null
  error: unknown
  /** Values forced on this device, which win over the published snapshot. */
  overrides: Readonly<Record<string, FlagValue>>
  /**
   * Flags the application has actually asked for, and what it last got.
   *
   * Kept separately from the snapshot because the interesting case is the
   * difference between the two: a key the code reads that the snapshot does
   * not contain is the most common integration mistake there is, and it is
   * invisible to anything that only lists what was published.
   */
  requested: Readonly<Record<string, { value: FlagValue; reason: EvaluationReason }>>
}

export class KlorClient {
  readonly #options: KlorClientOptions
  readonly #baseUrl: string
  readonly #storage: KlorStorage | null
  readonly #cacheKey: string
  readonly #listeners = new Set<() => void>()

  #state: KlorState
  #etag: string | undefined
  #timer: ReturnType<typeof setTimeout> | undefined
  #unsubscribeForeground: (() => void) | undefined
  #unsubscribeBackground: (() => void) | undefined
  #inFlight: Promise<void> | undefined
  #started = false

  readonly #telemetry: Telemetry

  constructor(options: KlorClientOptions) {
    if (!options.apiKey) throw new Error('createKlorClient requires an apiKey')

    this.#options = options
    // `||`, not `??`: an unset environment variable usually arrives as an
    // empty string, and that has to mean the default, not the current origin.
    this.#baseUrl = options.baseUrl || DEFAULT_BASE_URL
    this.#storage = options.storage === false ? null : (options.storage ?? defaultStorage())
    this.#cacheKey = cacheKeyFor(options.apiKey)
    this.#telemetry = new Telemetry({
      ...options.telemetry,
      send: (events) => {
        void sendEvents({
          baseUrl: this.#baseUrl,
          apiKey: options.apiKey,
          events,
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        }).catch((error: unknown) => this.#reportError(error))
      },
    })
    this.#state = {
      snapshot: options.initialSnapshot ?? null,
      status: options.initialSnapshot ? 'ready' : 'idle',
      source: options.initialSnapshot ? 'initial' : 'none',
      lastSyncedAt: null,
      error: null,
      overrides: options.overrides ? { ...options.overrides } : {},
      requested: {},
    }
  }

  getState = (): KlorState => this.#state

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => void this.#listeners.delete(listener)
  }

  #setState(patch: Partial<KlorState>): void {
    this.#state = { ...this.#state, ...patch }
    for (const listener of this.#listeners) listener()
  }

  #reportError(error: unknown): void {
    this.#options.onError?.(error)
  }

  /**
   * Begins syncing. Idempotent, so a React StrictMode double-mount or two
   * providers sharing one client won't set up two polls.
   */
  start(): void {
    if (this.#started) return
    this.#started = true

    void this.#hydrateOverrides()
    void this.#hydrateFromCache().then(() => this.refresh())

    const interval = this.#options.refreshInterval ?? DEFAULT_REFRESH_INTERVAL_MS
    if (interval > 0) this.#scheduleRefresh(Math.max(interval, MIN_REFRESH_INTERVAL_MS))

    this.#unsubscribeForeground = this.#watchForeground()
    this.#unsubscribeBackground = this.#options.subscribeToBackground?.(() =>
      this.#telemetry.flush(),
    )
    this.#telemetry.start()
  }

  stop(): void {
    this.#started = false
    this.#telemetry.stop()
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined
    this.#unsubscribeForeground?.()
    this.#unsubscribeForeground = undefined
    this.#unsubscribeBackground?.()
    this.#unsubscribeBackground = undefined
  }

  /**
   * Chains one poll to the next rather than using setInterval, so each wait can
   * carry its own jitter and a slow request cannot stack up behind itself.
   */
  #scheduleRefresh(interval: number): void {
    const spread = interval * REFRESH_JITTER * (Math.random() * 2 - 1)
    this.#timer = setTimeout(
      () => {
        void this.refresh().finally(() => {
          if (this.#started) this.#scheduleRefresh(interval)
        })
      },
      Math.max(1_000, interval + spread),
    )
  }

  #watchForeground(): (() => void) | undefined {
    if (this.#options.subscribeToForeground) {
      return this.#options.subscribeToForeground(() => void this.refresh())
    }
    if (this.#options.refreshOnForeground === false) return undefined
    if (typeof document === 'undefined' || !document.addEventListener) return undefined

    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }

  /**
   * Loads the last known snapshot from disk so a cold start on a dead network
   * serves real values instead of fallbacks. Never overwrites a fresher one.
   */
  async #hydrateFromCache(): Promise<void> {
    if (!this.#storage || this.#state.snapshot) return
    try {
      const raw = await this.#storage.getItem(this.#cacheKey)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (!isSnapshot(parsed)) return
      if (this.#state.snapshot) return
      this.#setState({ snapshot: parsed, status: 'ready', source: 'cache' })
    } catch (error) {
      this.#reportError(error)
    }
  }

  /** Fetches the current snapshot. Concurrent callers share one request. */
  refresh = (): Promise<void> => {
    this.#inFlight ??= this.#doRefresh().finally(() => {
      this.#inFlight = undefined
    })
    return this.#inFlight
  }

  async #doRefresh(): Promise<void> {
    if (this.#state.status === 'idle') this.#setState({ status: 'loading' })

    const timeout = this.#options.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT_MS
    const deadline = timeout > 0 ? new AbortController() : undefined
    const abort = deadline
      ? setTimeout(() => deadline.abort(new Error(`Config request timed out after ${timeout}ms`)), timeout)
      : undefined

    try {
      const result = await fetchSnapshot({
        baseUrl: this.#baseUrl,
        apiKey: this.#options.apiKey,
        etag: this.#etag,
        fetchImpl: this.#options.fetchImpl,
        ...(deadline ? { signal: deadline.signal } : {}),
      })

      if (result.status === 'notModified') {
        this.#setState({ status: 'ready', lastSyncedAt: Date.now(), error: null })
        return
      }

      this.#etag = result.etag
      this.#setState({
        snapshot: result.snapshot ?? null,
        status: 'ready',
        source: 'network',
        lastSyncedAt: Date.now(),
        error: null,
      })

      if (this.#storage && result.snapshot) {
        try {
          await this.#storage.setItem(this.#cacheKey, JSON.stringify(result.snapshot))
        } catch (error) {
          this.#reportError(error)
        }
      }
    } catch (error) {
      this.#reportError(error)
      // A failed refresh keeps serving the snapshot already in hand. Losing the
      // network must never mean losing your config.
      this.#setState({
        status: this.#state.snapshot ? 'ready' : 'error',
        error,
      })
    } finally {
      if (abort) clearTimeout(abort)
    }
  }

  // Fallback type first, key type defaulted: see the note above `useFlag`.
  evaluate = <T extends FlagFallback<K>, K extends FlagKey = FlagKey>(
    flagKey: K,
    fallback: T,
    context: KlorContext,
  ): Evaluation<FlagResult<K, T>> => {
    const override = this.#state.overrides[flagKey]
    // A mismatched override is ignored rather than served: it would otherwise
    // reproduce, on one developer's machine only, the exact silent-fallback
    // failure the type check exists to prevent.
    if (override !== undefined && typeof override === typeof fallback) {
      return { value: override as FlagResult<K, T>, reason: 'override' }
    }
    // The evaluator returns the fallback's type; `FlagResult` only narrows or
    // widens that at the type level, so the value itself is unchanged.
    return evaluateFromSnapshot(this.#state.snapshot, flagKey, fallback, context) as Evaluation<
      FlagResult<K, T>
    >
  }

  /** Forces a value on this device until it is cleared. */
  setOverride = (flagKey: string, value: FlagValue): void => {
    this.#writeOverrides({ ...this.#state.overrides, [flagKey]: value })
  }

  clearOverride = (flagKey: string): void => {
    const { [flagKey]: _removed, ...rest } = this.#state.overrides
    this.#writeOverrides(rest)
  }

  clearOverrides = (): void => this.#writeOverrides({})

  #writeOverrides(overrides: Record<string, FlagValue>): void {
    this.#setState({ overrides })
    if (!this.#storage || !this.#options.persistOverrides) return
    void Promise.resolve(
      Object.keys(overrides).length === 0
        ? this.#storage.setItem(`${this.#cacheKey}:overrides`, '{}')
        : this.#storage.setItem(`${this.#cacheKey}:overrides`, JSON.stringify(overrides)),
    ).catch((error: unknown) => this.#reportError(error))
  }

  async #hydrateOverrides(): Promise<void> {
    if (!this.#storage || !this.#options.persistOverrides) return
    try {
      const raw = await this.#storage.getItem(`${this.#cacheKey}:overrides`)
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        this.#setState({ overrides: parsed as Record<string, FlagValue> })
      }
    } catch (error) {
      this.#reportError(error)
    }
  }

  versionGate = (
    platform: 'ios' | 'android' | undefined,
    currentVersion: string | undefined,
  ): VersionGateResult => evaluateVersionGate(this.#state.snapshot, platform, currentVersion)

  /**
   * Records that a flag was read. Called by the hooks once per distinct
   * outcome; safe to call directly from non-React code.
   */
  recordEvaluation = (flagKey: string, value: FlagValue, reason: EvaluationReason): void => {
    /* Recorded before the telemetry opt-out below, because this never leaves
       the device: it is what lets devtools show a key the app asked for and
       the snapshot does not have. Called once per distinct outcome rather than
       per render, so the comparison here settles immediately. */
    /* Compared by content, not by identity. A fallback is very often an inline
       object literal, so `{ margin: -1 }` is a new reference on every render;
       comparing references would report a change every time, notify, re-render,
       produce another new literal and never settle. The hooks call this from an
       effect keyed on the outcome, so an identity comparison here is an
       infinite loop rather than a missed update. */
    const seen = this.#state.requested[flagKey]
    const unchanged =
      seen !== undefined &&
      seen.reason === reason &&
      (Object.is(seen.value, value) || JSON.stringify(seen.value) === JSON.stringify(value))

    if (!unchanged) {
      this.#setState({ requested: { ...this.#state.requested, [flagKey]: { value, reason } } })
    }

    // A locally forced value says nothing about what the fleet is reading, and
    // counting it would make a developer's toggling look like real traffic.
    if (reason === 'override') return
    this.#telemetry.record(flagKey, value, reason)
  }

  /** Sends any buffered usage counters immediately. */
  flushTelemetry = (): void => this.#telemetry.flush()

  /** All flag keys in the current snapshot, for debugging and dev tooling. */
  keys = (): string[] => Object.keys(this.#state.snapshot?.flags ?? {})
}

export function createKlorClient(options: KlorClientOptions): KlorClient {
  return new KlorClient(options)
}
