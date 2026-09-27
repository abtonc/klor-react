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
