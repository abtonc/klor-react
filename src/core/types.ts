/**
 * Wire format and evaluation types. This module is the contract between the
 * dashboard's snapshot compiler and every SDK entrypoint, changing anything
 * here means bumping `SNAPSHOT_VERSION` and teaching the compiler to emit both.
 */

export const SNAPSHOT_VERSION = 1

export type FlagValueType = 'bool' | 'string' | 'number' | 'json'

export type FlagValue = boolean | string | number | JsonValue

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type Platform = 'ios' | 'android' | 'web'

/**
 * Operators a rule condition can use. Kept deliberately small: every operator
 * here has one obvious meaning and is cheap to evaluate on-device.
 */
export type Operator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'semverEq'
  | 'semverGt'
  | 'semverGte'
  | 'semverLt'
  | 'semverLte'
  | 'exists'
  | 'notExists'

export interface Condition {
  /** `userId` and `deviceId` are reserved; everything else comes from `attributes`. */
  attribute: string
  op: Operator
  /** Ignored by `exists` / `notExists`. */
  values?: Array<string | number | boolean>
}

export interface Rollout {
  /** 0-100. The share of *matching* users this rule applies to. */
  percentage: number
  /** Attribute whose value buckets the user. Defaults to `userId`. */
  bucketBy?: string
  /** Per-flag constant so two flags at 10% don't target the same users. */
  salt: string
}

/** One arm of a split, with a share of the traffic relative to its siblings. */
export interface Variant {
  value: FlagValue
  /** Relative weight. Shares are `weight / sum(weights)`, so they need not total 100. */
  weight: number
}

export interface Rule {
  id: string
  description?: string
  /** All conditions must match. An empty array matches everyone. */
  conditions: Condition[]
  /** When present, only this share of matching users take the rule. */
  rollout?: Rollout
  /**
   * The value served to everyone the rule applies to.
   *
   * Always present, even when `variants` is set, and then it carries the first
   * variant. That redundancy is deliberate: an SDK built before variants
   * existed reads this field and ignores the one it does not know, so a newer
   * payload degrades to a sensible single value instead of breaking an app
   * that cannot be patched.
   */
  value: FlagValue
  /**
   * Splits the rule's traffic across several values.
   *
   * Separate from `rollout`, which answers a different question: the rollout
   * decides *whether* a user is in the rule at all, the variants decide *which*
   * value those users get. Assignment is bucketed on a different hash from the
   * rollout, so widening the rollout never re-shuffles the split.
   */
  variants?: Variant[]
}

export interface FlagDefinition {
  type: FlagValueType
  /** When false the flag serves its default and rules are skipped entirely. */
  enabled: boolean
  default: FlagValue
  rules: Rule[]
}

export interface VersionGate {
  /** Below this, the app is unusable and the gate is `forced`. */
  minSupportedVersion: string
  /** Below this but at or above min, the gate is `optional`. */
  latestVersion: string
  storeUrl?: string
  forcedMessage?: string
  optionalMessage?: string
}

export interface Snapshot {
  v: typeof SNAPSHOT_VERSION
  /** Monotonic per environment. Also the rollback handle. */
  seq: number
  environment: { id: string; key: string }
  publishedAt: string
  flags: Record<string, FlagDefinition>
  gates: Partial<Record<Exclude<Platform, 'web'>, VersionGate>>
  /** Exact versions pulled from circulation, per platform. */
  blockedBuilds: Partial<Record<Exclude<Platform, 'web'>, string[]>>
}

/** Everything known about the current user, used to evaluate rules. */
export interface KlorContext {
  userId?: string
  /** Falls back to `userId` for bucketing when no userId is set. */
  deviceId?: string
  attributes?: Record<string, string | number | boolean | undefined>
}

export type EvaluationReason =
  | 'default'
  | 'disabled'
  | 'rule'
  | 'unknownFlag'
  | 'notReady'
  | 'typeMismatch'
  /** Forced locally on this device, by devtools or by `setOverride`. */
  | 'override'

export interface Evaluation<T = FlagValue> {
  value: T
  reason: EvaluationReason
  ruleId?: string
}

export type VersionGateStatus = 'none' | 'optional' | 'forced'

export interface VersionGateResult {
  status: VersionGateStatus
  /** Why the gate fired, for logging. `blocked` means this exact build was pulled. */
  reason: 'none' | 'blocked' | 'belowMinimum' | 'behindLatest' | 'notReady'
  currentVersion?: string
  latestVersion?: string
  storeUrl?: string
  message?: string
}

/* -------------------------------------------------------------------------- */
/* Typed flag keys, opt-in                                                    */
/* -------------------------------------------------------------------------- */

declare global {
  /**
   * Your project's flags, key to value type. Empty unless you fill it in, and
   * while it is empty every key is a plain `string` and nothing below changes
   * how the SDK types a read.
   *
   * `npx @klor/cli types` writes a declaration file that fills it in from your
   * project, after which keys autocomplete, a mistyped key fails the build, and
   * a fallback of the wrong type is refused. Writing it by hand works the same:
   *
   * ```ts
   * declare global {
   *   interface KlorFlags {
   *     checkout_v2: boolean
   *   }
   * }
   * export {}
   * ```
   *
   * Global rather than an augmentation of this module, and that is load-bearing.
   * TypeScript's incremental builds (`tsc -b`, `next build`, any `incremental`
   * tsconfig) re-check a file only when something it imports changes, unless
   * the changed file touches the global scope. Nothing imports the generated
   * file, so as a module augmentation a regenerated list went unnoticed by a
   * warm build: a flag removed in the dashboard still compiled until the cache
   * was cleared. A global declaration makes every file be re-checked.
   */
  interface KlorFlags {}

  /**
   * Options for typed keys. Set `strict: false` to keep autocomplete and typed
   * values for the keys in `KlorFlags` while still accepting any other string,
   * for a codebase that reads flags faster than it regenerates types.
   */
  interface KlorTypeOptions {}
}

/** A key listed in `KlorFlags`. Named for the error message it appears in. */
type KnownFlagKey = keyof KlorFlags & string

/** What a flag read accepts as a key: any string, or only registered keys. */
export type FlagKey = [KnownFlagKey] extends [never]
  ? string
  : KlorTypeOptions extends { strict: false }
    ? KnownFlagKey | (string & {})
    : KnownFlagKey

/** What a flag read accepts as a fallback for `K`. */
export type FlagFallback<K extends string> = K extends KnownFlagKey
  ? Extract<KlorFlags[K], FlagValue>
  : FlagValue

/**
 * The type a flag read returns.
 *
 * A registered scalar flag returns its registered type. A JSON flag returns the
 * fallback's type, since the shape of a JSON value is something only the app
 * knows. An unregistered key returns exactly the fallback's type, as it did
 * before typed keys existed, so a generic wrapper such as
 * `function read<T extends FlagValue>(key: string, fallback: T): T` keeps
 * compiling.
 *
 * When `K` is the whole of `FlagKey` it was not inferred from a key but left at
 * its default, which happens only when the caller wrote the fallback's type
 * themselves, as in `useFlag<Theme>('theme', fallback)`. That caller asked for
 * `T`, and gets it: anything else would be a union of every registered type.
 */
export type FlagResult<K extends string, T> = [FlagKey] extends [K]
  ? T
  : K extends KnownFlagKey
    ? KlorFlags[K] extends boolean | string | number
      ? KlorFlags[K]
      : T
    : T
