import { compareVersions } from './semver.js'
import { isInRollout, variantIndexFor } from './hash.js'
import type {
  Condition,
  Evaluation,
  FlagDefinition,
  FlagValue,
  FlagValueType,
  KlorContext,
  Snapshot,
  VersionGateResult,
} from './types.js'

/**
 * Resolves an attribute name against a context. `userId` and `deviceId` are
 * reserved and read from the top level; everything else, `platform`,
 * `appVersion`, `country`, and anything the host app invents, comes from
 * `attributes`.
 */
export function resolveAttribute(
  context: KlorContext,
  attribute: string,
): string | number | boolean | undefined {
  if (attribute === 'userId') return context.userId
  if (attribute === 'deviceId') return context.deviceId
  return context.attributes?.[attribute]
}

function asString(value: string | number | boolean): string {
  return typeof value === 'string' ? value : String(value)
}

export function matchCondition(condition: Condition, context: KlorContext): boolean {
  const actual = resolveAttribute(context, condition.attribute)
  const values = condition.values ?? []

  if (condition.op === 'exists') return actual !== undefined
  if (condition.op === 'notExists') return actual === undefined

  // An absent attribute can never satisfy a comparison. Notably this means
  // `neq` is false for a missing attribute rather than true; you cannot prove
  // a user isn't on iOS when you were never told what they're on.
  if (actual === undefined) return false

  switch (condition.op) {
    case 'eq':
      return values.some((value) => value === actual)
    case 'neq':
      return !values.some((value) => value === actual)
    case 'in':
      return values.includes(actual)
    case 'notIn':
      return !values.includes(actual)

    case 'contains':
      return values.some((value) => asString(actual).includes(asString(value)))
    case 'notContains':
      return !values.some((value) => asString(actual).includes(asString(value)))
    case 'startsWith':
      return values.some((value) => asString(actual).startsWith(asString(value)))
    case 'endsWith':
      return values.some((value) => asString(actual).endsWith(asString(value)))

    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const left = Number(actual)
      const right = Number(values[0])
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false
      if (condition.op === 'gt') return left > right
      if (condition.op === 'gte') return left >= right
      if (condition.op === 'lt') return left < right
      return left <= right
    }

    case 'semverEq':
    case 'semverGt':
    case 'semverGte':
    case 'semverLt':
    case 'semverLte': {
      const target = values[0]
      if (target === undefined) return false
      const order = compareVersions(asString(actual), asString(target))
      if (order === null) return false
      if (condition.op === 'semverEq') return order === 0
      if (condition.op === 'semverGt') return order > 0
      if (condition.op === 'semverGte') return order >= 0
      if (condition.op === 'semverLt') return order < 0
      return order <= 0
    }

    default:
      // An operator this SDK version doesn't know about. Never match, so an
      // older SDK reading a newer snapshot degrades to the default value.
      return false
  }
}

/** Picks the value used to bucket a user, preferring the rule's own choice. */
function bucketValueFor(context: KlorContext, bucketBy: string | undefined): string | undefined {
  if (bucketBy) {
    const explicit = resolveAttribute(context, bucketBy)
    if (explicit !== undefined) return asString(explicit)
    return undefined
  }
  if (context.userId !== undefined) return context.userId
  if (context.deviceId !== undefined) return context.deviceId
  return undefined
}

/**
 * Evaluates one flag. Rules are ordered and the first fully matching rule wins.
 *
 * A rule with a rollout applies to that share of *matching* users; everyone
 * else falls through to the next rule and ultimately to the default. That makes
 * "roll this out to 25% of iOS users" read the way it sounds.
 */
export function evaluateFlag(
  flagKey: string,
  definition: FlagDefinition,
  context: KlorContext,
): Evaluation {
  if (!definition.enabled) {
    return { value: definition.default, reason: 'disabled' }
  }

  for (const rule of definition.rules) {
    if (!rule.conditions.every((condition) => matchCondition(condition, context))) continue

    if (rule.rollout) {
      const bucketValue = bucketValueFor(context, rule.rollout.bucketBy)
      // With nothing stable to bucket on, skip rather than guess, a random
      // assignment would flip the flag on every app launch.
      if (bucketValue === undefined) continue
      if (!isInRollout(rule.rollout.salt, flagKey, bucketValue, rule.rollout.percentage)) continue
    }

    if (rule.variants && rule.variants.length > 0) {
      const bucketValue = bucketValueFor(context, rule.rollout?.bucketBy)
      const salt = rule.rollout?.salt ?? rule.id

      if (bucketValue !== undefined) {
        const index = variantIndexFor(
          salt,
          flagKey,
          bucketValue,
          rule.variants.map((variant) => variant.weight),
        )
        const chosen = rule.variants[index]
        if (chosen) return { value: chosen.value, reason: 'rule', ruleId: rule.id }
      }

      // Nothing stable to bucket on, or unusable weights. `rule.value` carries
      // the first variant for exactly this case.
    }

    return { value: rule.value, reason: 'rule', ruleId: rule.id }
  }

  return { value: definition.default, reason: 'default' }
}

export function matchesType(value: unknown, type: FlagValueType): boolean {
  switch (type) {
    case 'bool':
      return typeof value === 'boolean'
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'json':
      return value !== undefined
  }
}

/**
 * Evaluates a flag against a snapshot, falling back whenever anything is off,
 * no snapshot yet, unknown key, or a value whose type doesn't match what the
 * caller asked for. A config SDK must never be the reason an app crashes.
 */
export function evaluateFromSnapshot<T extends FlagValue>(
  snapshot: Snapshot | null,
  flagKey: string,
  fallback: T,
  context: KlorContext,
): Evaluation<T> {
  if (!snapshot) return { value: fallback, reason: 'notReady' }

  const definition = snapshot.flags[flagKey]
  if (!definition) return { value: fallback, reason: 'unknownFlag' }

  const result = evaluateFlag(flagKey, definition, context)
  if (typeof result.value !== typeof fallback) {
    return { value: fallback, reason: 'typeMismatch' }
  }
  return { value: result.value as T, reason: result.reason, ruleId: result.ruleId }
}

/**
 * Decides whether the running build should be updated.
 *
 * Order matters: an explicitly blocked build is forced even if it is above the
 * minimum supported version, because blocking is what you reach for during an
 * incident. Anything unparseable produces `none`, a gate that can't read the
 * version must not lock users out of the app.
 */
export function evaluateVersionGate(
  snapshot: Snapshot | null,
  platform: 'ios' | 'android' | undefined,
  currentVersion: string | undefined,
): VersionGateResult {
  // `notReady` means "no snapshot yet" and nothing else. A web app calling
  // this has no gated platform, and reporting `notReady` forever would read as
  // a bug rather than as "gating does not apply to you".
  if (!snapshot) return { status: 'none', reason: 'notReady', currentVersion }
  if (!platform || !currentVersion) return { status: 'none', reason: 'none', currentVersion }

  const gate = snapshot.gates[platform]
  const blocked = snapshot.blockedBuilds[platform] ?? []

  if (blocked.some((version) => compareVersions(version, currentVersion) === 0)) {
    return {
      status: 'forced',
      reason: 'blocked',
      currentVersion,
      latestVersion: gate?.latestVersion,
      storeUrl: gate?.storeUrl,
      message: gate?.forcedMessage,
    }
  }

  if (!gate) return { status: 'none', reason: 'none', currentVersion }

  if (compareVersions(currentVersion, gate.minSupportedVersion) === -1) {
    return {
      status: 'forced',
      reason: 'belowMinimum',
      currentVersion,
      latestVersion: gate.latestVersion,
      storeUrl: gate.storeUrl,
      message: gate.forcedMessage,
    }
  }

  if (compareVersions(currentVersion, gate.latestVersion) === -1) {
    return {
      status: 'optional',
      reason: 'behindLatest',
      currentVersion,
      latestVersion: gate.latestVersion,
      storeUrl: gate.storeUrl,
      message: gate.optionalMessage,
    }
  }

  return { status: 'none', reason: 'none', currentVersion, latestVersion: gate.latestVersion }
}
