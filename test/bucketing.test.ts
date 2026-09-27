import { describe, expect, it } from 'vitest'
import { BUCKET_COUNT, bucketOf, isInRollout, variantIndexFor } from '../src/core/hash.js'

const SALT = 'salt-a1b2c3'
const FLAG = 'checkout_v2'
const users = Array.from({ length: 100_000 }, (_, i) => `user-${i}`)

describe('rollout bucketing', () => {
  it('lands within 1% of the target share', () => {
    for (const target of [1, 10, 25, 50, 75, 99]) {
      const included = users.filter((u) => isInRollout(SALT, FLAG, u, target)).length
      const actual = (included / users.length) * 100
      expect(Math.abs(actual - target)).toBeLessThan(1)
    }
  })

  it('is stable across calls', () => {
    for (const user of users.slice(0, 1000)) {
      expect(bucketOf(SALT, FLAG, user)).toBe(bucketOf(SALT, FLAG, user))
    }
  })

  it('never drops a user when the percentage is raised', () => {
    // The property that makes a gradual rollout safe: going 10% -> 20% must
    // only ever add users. Anyone already seeing the feature keeps seeing it.
    let previous = users.filter((u) => isInRollout(SALT, FLAG, u, 5))
    for (const target of [10, 20, 40, 60, 80, 100]) {
      const current = new Set(users.filter((u) => isInRollout(SALT, FLAG, u, target)))
      for (const user of previous) expect(current.has(user)).toBe(true)
      previous = [...current]
    }
  })

  it('gives two flags at the same percentage different populations', () => {
    // Without a per-flag salt, every 10% rollout would hit the same unlucky
    // 10% of users, who would then be the only ones ever seeing anything new.
    const a = new Set(users.filter((u) => isInRollout('salt-one', 'flag_a', u, 10)))
    const b = users.filter((u) => isInRollout('salt-two', 'flag_b', u, 10))
    const overlap = b.filter((u) => a.has(u)).length / b.length
    expect(overlap).toBeLessThan(0.2)
  })

  it('treats 0 and 100 as absolute', () => {
    expect(users.some((u) => isInRollout(SALT, FLAG, u, 0))).toBe(false)
    expect(users.every((u) => isInRollout(SALT, FLAG, u, 100))).toBe(true)
    // A malformed snapshot must not accidentally ship to everyone.
    expect(users.some((u) => isInRollout(SALT, FLAG, u, -5))).toBe(false)
    expect(users.every((u) => isInRollout(SALT, FLAG, u, 250))).toBe(true)
  })

  it('stays inside the bucket range', () => {
    for (const user of users.slice(0, 5000)) {
      const bucket = bucketOf(SALT, FLAG, user)
      expect(bucket).toBeGreaterThanOrEqual(0)
      expect(bucket).toBeLessThan(BUCKET_COUNT)
    }
  })
})

describe('weighted variants', () => {
  const weights = [1, 1, 1]

  it('splits close to the declared shares', () => {
    const counts = [0, 0, 0]
    for (let i = 0; i < 30_000; i++) {
      const index = variantIndexFor('salt', 'checkout_v2', `user-${i}`, weights)
      counts[index] = (counts[index] ?? 0) + 1
    }

    // Three equal arms over 30k users: each within a point of a third.
    for (const count of counts) {
      expect(Math.abs(count / 30_000 - 1 / 3)).toBeLessThan(0.01)
    }
  })

  it('honours unequal weights, and does not need them to total 100', () => {
    const counts = [0, 0]
    for (let i = 0; i < 20_000; i++) {
      const index = variantIndexFor('salt', 'checkout_v2', `user-${i}`, [3, 1])
      counts[index] = (counts[index] ?? 0) + 1
    }
    expect(Math.abs((counts[0] ?? 0) / 20_000 - 0.75)).toBeLessThan(0.01)
  })

  it('assigns the same user the same arm every time', () => {
    for (let i = 0; i < 500; i++) {
      const first = variantIndexFor('salt', 'checkout_v2', `user-${i}`, weights)
      const again = variantIndexFor('salt', 'checkout_v2', `user-${i}`, weights)
      expect(again).toBe(first)
    }
  })

  /* The reason variant assignment hashes a different string from rollout
     inclusion. If one bucket decided both, everyone's arm would correlate with
     how early they entered the rollout, and widening it would skew the split. */
  it('is independent of whether the rollout widens', () => {
    const inTen = []
    const inFifty = []
    for (let i = 0; i < 5_000; i++) {
      const user = `user-${i}`
      if (isInRollout('salt', 'checkout_v2', user, 10)) {
        inTen.push(variantIndexFor('salt', 'checkout_v2', user, weights))
      }
      if (isInRollout('salt', 'checkout_v2', user, 50)) {
        inFifty.push(variantIndexFor('salt', 'checkout_v2', user, weights))
      }
    }

    const share = (list: number[], arm: number) =>
      list.filter((index) => index === arm).length / list.length

    // The wider rollout admits five times as many people and still splits evenly.
    expect(inFifty.length).toBeGreaterThan(inTen.length * 3)
    for (const arm of [0, 1, 2]) {
      expect(Math.abs(share(inFifty, arm) - 1 / 3)).toBeLessThan(0.03)
    }
  })

  it('refuses rather than defaulting to the first arm when weights are unusable', () => {
    expect(variantIndexFor('salt', 'k', 'user-1', [0, 0])).toBe(-1)
    expect(variantIndexFor('salt', 'k', 'user-1', [])).toBe(-1)
    expect(variantIndexFor('salt', 'k', 'user-1', [Number.NaN])).toBe(-1)
  })
})
