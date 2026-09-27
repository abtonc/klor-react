import { describe, expect, it } from 'vitest'
import { evaluateFlag, evaluateFromSnapshot, evaluateVersionGate, matchCondition } from '../src/core/evaluate.js'
import type { FlagDefinition, Snapshot } from '../src/core/types.js'

const ctx = (attributes: Record<string, string | number | boolean>, userId?: string) => ({
  userId,
  attributes,
})

describe('matchCondition', () => {
  const ios = ctx({ platform: 'ios', appVersion: '2.4.0', seats: 12, beta: true })

  it('handles equality and membership', () => {
    expect(matchCondition({ attribute: 'platform', op: 'eq', values: ['ios'] }, ios)).toBe(true)
    expect(matchCondition({ attribute: 'platform', op: 'eq', values: ['android'] }, ios)).toBe(false)
    expect(matchCondition({ attribute: 'platform', op: 'in', values: ['ios', 'android'] }, ios)).toBe(true)
    expect(matchCondition({ attribute: 'platform', op: 'notIn', values: ['android'] }, ios)).toBe(true)
  })

  it('handles string and numeric comparison', () => {
    expect(matchCondition({ attribute: 'platform', op: 'startsWith', values: ['i'] }, ios)).toBe(true)
    expect(matchCondition({ attribute: 'seats', op: 'gte', values: [10] }, ios)).toBe(true)
    expect(matchCondition({ attribute: 'seats', op: 'lt', values: [10] }, ios)).toBe(false)
  })

  it('handles semver ranges', () => {
    expect(matchCondition({ attribute: 'appVersion', op: 'semverGte', values: ['2.4.0'] }, ios)).toBe(true)
    expect(matchCondition({ attribute: 'appVersion', op: 'semverLt', values: ['2.10.0'] }, ios)).toBe(true)
    expect(matchCondition({ attribute: 'appVersion', op: 'semverGt', values: ['2.4.0'] }, ios)).toBe(false)
  })

  it('refuses to match on an attribute it was never given', () => {
    // Including neq: you cannot prove a user isn't on iOS when you don't know
    // what they're on. Matching here would silently widen every exclusion rule.
    expect(matchCondition({ attribute: 'country', op: 'eq', values: ['US'] }, ios)).toBe(false)
    expect(matchCondition({ attribute: 'country', op: 'neq', values: ['US'] }, ios)).toBe(false)
    expect(matchCondition({ attribute: 'country', op: 'exists' }, ios)).toBe(false)
    expect(matchCondition({ attribute: 'country', op: 'notExists' }, ios)).toBe(true)
  })

  it('ignores operators from a newer snapshot format', () => {
    const unknown = { attribute: 'platform', op: 'matchesRegex' as never, values: ['^i'] }
    expect(matchCondition(unknown, ios)).toBe(false)
  })
})

describe('evaluateFlag', () => {
  const definition: FlagDefinition = {
    type: 'bool',
    enabled: true,
    default: false,
    rules: [
      { id: 'r-internal', conditions: [{ attribute: 'email', op: 'endsWith', values: ['@klor.dev'] }], value: true },
      {
        id: 'r-ios-rollout',
        conditions: [{ attribute: 'platform', op: 'eq', values: ['ios'] }],
        rollout: { percentage: 100, bucketBy: 'userId', salt: 's' },
        value: true,
      },
    ],
  }

  it('takes the first matching rule in order', () => {
    const result = evaluateFlag('checkout_v2', definition, ctx({ email: 'a@klor.dev', platform: 'android' }, 'u1'))
    expect(result).toMatchObject({ value: true, reason: 'rule', ruleId: 'r-internal' })
  })

  it('falls through to the default when nothing matches', () => {
    const result = evaluateFlag('checkout_v2', definition, ctx({ platform: 'android' }, 'u1'))
    expect(result).toMatchObject({ value: false, reason: 'default' })
  })

  it('skips rules entirely when the flag is disabled', () => {
    const off = { ...definition, enabled: false }
    const result = evaluateFlag('checkout_v2', off, ctx({ email: 'a@klor.dev' }, 'u1'))
    expect(result).toMatchObject({ value: false, reason: 'disabled' })
  })

  it('falls through when a matching rule excludes the user by rollout', () => {
    const zero: FlagDefinition = {
      ...definition,
      rules: [{ ...definition.rules[1]!, rollout: { percentage: 0, bucketBy: 'userId', salt: 's' } }],
    }
    expect(evaluateFlag('f', zero, ctx({ platform: 'ios' }, 'u1')).reason).toBe('default')
  })

  it('skips a rollout when there is nothing stable to bucket on', () => {
    // Bucketing on nothing would re-roll on every launch, flickering the flag.
    const anonymous = ctx({ platform: 'ios' })
    const half: FlagDefinition = {
      ...definition,
      rules: [{ ...definition.rules[1]!, rollout: { percentage: 50, bucketBy: 'userId', salt: 's' } }],
    }
    expect(evaluateFlag('f', half, anonymous).reason).toBe('default')
  })
})

describe('evaluateFromSnapshot', () => {
  const snapshot: Snapshot = {
    v: 1,
    seq: 42,
    environment: { id: 'env_1', key: 'prod' },
    publishedAt: '2026-09-13T00:00:00.000Z',
    flags: {
      checkout_v2: { type: 'bool', enabled: true, default: true, rules: [] },
      max_items: { type: 'number', enabled: true, default: 25, rules: [] },
    },
    gates: {},
    blockedBuilds: {},
  }

  it('serves the fallback before any snapshot exists', () => {
    expect(evaluateFromSnapshot(null, 'checkout_v2', false, {})).toMatchObject({
      value: false,
      reason: 'notReady',
    })
  })

  it('serves the fallback for an unknown key', () => {
    expect(evaluateFromSnapshot(snapshot, 'nope', false, {})).toMatchObject({ reason: 'unknownFlag' })
  })

  it('serves the fallback when the type does not match what was asked for', () => {
    // A dashboard typo must not hand a number to code expecting a boolean.
    expect(evaluateFromSnapshot(snapshot, 'max_items', false, {})).toMatchObject({
      value: false,
      reason: 'typeMismatch',
    })
  })

  it('serves the real value when everything lines up', () => {
    expect(evaluateFromSnapshot(snapshot, 'checkout_v2', false, {}).value).toBe(true)
    expect(evaluateFromSnapshot(snapshot, 'max_items', 0, {}).value).toBe(25)
  })
})

describe('evaluateVersionGate', () => {
  const snapshot: Snapshot = {
    v: 1,
    seq: 7,
    environment: { id: 'env_1', key: 'prod' },
    publishedAt: '2026-09-13T00:00:00.000Z',
    flags: {},
    gates: {
      ios: {
        minSupportedVersion: '2.0.0',
        latestVersion: '2.5.0',
        storeUrl: 'https://apps.apple.com/app/id123',
        forcedMessage: 'Update to keep using the app.',
        optionalMessage: 'A new version is available.',
      },
    },
    blockedBuilds: { ios: ['2.3.1'] },
  }

  it('forces an update below the minimum supported version', () => {
    expect(evaluateVersionGate(snapshot, 'ios', '1.9.0')).toMatchObject({
      status: 'forced',
      reason: 'belowMinimum',
    })
  })

  it('forces an update on a blocked build even though it clears the minimum', () => {
    // 2.3.1 is well above the 2.0.0 floor, but it was pulled during an incident.
    expect(evaluateVersionGate(snapshot, 'ios', '2.3.1')).toMatchObject({
      status: 'forced',
      reason: 'blocked',
    })
  })

  it('suggests an update behind the latest version', () => {
    expect(evaluateVersionGate(snapshot, 'ios', '2.4.0')).toMatchObject({
      status: 'optional',
      reason: 'behindLatest',
      latestVersion: '2.5.0',
    })
  })

  it('says nothing on the latest version or ahead of it', () => {
    expect(evaluateVersionGate(snapshot, 'ios', '2.5.0').status).toBe('none')
    expect(evaluateVersionGate(snapshot, 'ios', '2.6.0').status).toBe('none')
  })

  it('fails open on an unparseable version or an ungated platform', () => {
    // Locking every user out because a version string was malformed is a far
    // worse outcome than missing one update prompt.
    expect(evaluateVersionGate(snapshot, 'ios', 'nightly').status).toBe('none')
    expect(evaluateVersionGate(snapshot, 'android', '1.0.0').status).toBe('none')
    expect(evaluateVersionGate(null, 'ios', '1.0.0').status).toBe('none')
  })

  it('distinguishes "no snapshot yet" from "not a gated platform"', () => {
    // A web app never has a platform to gate, and must not look like it is
    // permanently waiting for data.
    expect(evaluateVersionGate(null, 'ios', '1.0.0').reason).toBe('notReady')
    expect(evaluateVersionGate(snapshot, undefined, '1.0.0').reason).toBe('none')
    expect(evaluateVersionGate(snapshot, 'ios', undefined).reason).toBe('none')
  })
})

describe('a rule that splits its traffic', () => {
  const flag = (variants: Array<{ value: unknown; weight: number }>) => ({
    type: 'string' as const,
    enabled: true,
    default: 'control',
    rules: [
      {
        id: 'r_split',
        conditions: [],
        rollout: { percentage: 100, bucketBy: 'userId' as const, salt: 's1' },
        // Carries the first arm, for readers that predate variants.
        value: variants[0]?.value as string,
        variants: variants as never,
      },
    ],
  })

  it('serves one of the arms, and the same one every time', () => {
    const definition = flag([
      { value: 'a', weight: 1 },
      { value: 'b', weight: 1 },
    ])

    const first = evaluateFlag('exp', definition, { userId: 'user-9' })
    expect(['a', 'b']).toContain(first.value)
    expect(first.reason).toBe('rule')
    expect(first.ruleId).toBe('r_split')
    expect(evaluateFlag('exp', definition, { userId: 'user-9' }).value).toBe(first.value)
  })

  it('reaches every arm across a population', () => {
    const definition = flag([
      { value: 'a', weight: 1 },
      { value: 'b', weight: 1 },
      { value: 'c', weight: 1 },
    ])

    const seen = new Set<unknown>()
    for (let i = 0; i < 200; i++) {
      seen.add(evaluateFlag('exp', definition, { userId: `user-${i}` }).value)
    }
    expect(seen).toEqual(new Set(['a', 'b', 'c']))
  })

  /* Without something stable to bucket on there is no honest assignment, and a
     random one would flip the arm on every launch. `rule.value` exists for
     exactly this, which is also what an older SDK reads.

     No rollout on this one on purpose: a rule that *has* a rollout already
     skips an unbucketable user before variants are ever consulted. */
  it('falls back to the rule value when there is nothing to bucket on', () => {
    const definition = {
      type: 'string' as const,
      enabled: true,
      default: 'control',
      rules: [
        {
          id: 'r_split',
          conditions: [],
          value: 'a',
          variants: [
            { value: 'a', weight: 1 },
            { value: 'b', weight: 1 },
          ],
        },
      ],
    }

    const result = evaluateFlag('exp', definition, {})
    expect(result.value).toBe('a')
    expect(result.reason).toBe('rule')
  })

  it('falls back when the weights are all zero', () => {
    const definition = flag([
      { value: 'a', weight: 0 },
      { value: 'b', weight: 0 },
    ])
    expect(evaluateFlag('exp', definition, { userId: 'user-1' }).value).toBe('a')
  })

  it('still respects the rollout that gates entry to the rule', () => {
    const definition = flag([
      { value: 'a', weight: 1 },
      { value: 'b', weight: 1 },
    ])
    definition.rules[0]!.rollout = { percentage: 0, bucketBy: 'userId', salt: 's1' }

    // Nobody is in the rule at all, so nobody gets an arm.
    expect(evaluateFlag('exp', definition, { userId: 'user-1' }).reason).toBe('default')
  })
})
