/**
 * Bucketing for percentage rollouts.
 *
 * Two properties matter and both are load-bearing:
 *
 *  1. **Stable**, the same user lands in the same bucket on every platform, on
 *     every app launch, forever. Nothing here reads the clock or `Math.random`.
 *  2. **Monotonic**, raising a rollout from 10% to 20% never re-shuffles the
 *     first 10%, because the bucket is fixed and only the threshold moves.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

/** FNV-1a, 32-bit. Chosen for being tiny, dependency-free, and well distributed. */
export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

/** Total buckets. 10000 gives rollouts two decimal places of resolution. */
export const BUCKET_COUNT = 10_000

/** Maps a user to a stable bucket in `[0, BUCKET_COUNT)` for one flag. */
export function bucketOf(salt: string, flagKey: string, bucketValue: string): number {
  return fnv1a32(`${salt}:${flagKey}:${bucketValue}`) % BUCKET_COUNT
}

/**
 * Whether a user falls inside a rollout. `percentage` is 0-100; values outside
 * that range are clamped so a malformed snapshot can't accidentally enable a
 * flag for everyone.
 */
export function isInRollout(
  salt: string,
  flagKey: string,
  bucketValue: string,
  percentage: number,
): boolean {
  if (!Number.isFinite(percentage) || percentage <= 0) return false
  if (percentage >= 100) return true
  const threshold = Math.round((percentage / 100) * BUCKET_COUNT)
  return bucketOf(salt, flagKey, bucketValue) < threshold
}

/**
 * Picks one of several weighted arms for a user, stably.
 *
 * Bucketed on a different string from `isInRollout`, which matters: if the
 * same bucket decided both, raising a rollout from 10% to 20% would move the
 * newcomers into arms non-uniformly, and every existing user would keep an
 * assignment correlated with how early they joined. Separating them keeps the
 * two decisions independent.
 *
 * Returns the index of the chosen arm, or -1 if the weights are unusable, so
 * the caller can fall back rather than serve arm zero to everybody.
 */
export function variantIndexFor(
  salt: string,
  flagKey: string,
  bucketValue: string,
  weights: readonly number[],
): number {
  const usable = weights.map((weight) =>
    Number.isFinite(weight) && weight > 0 ? weight : 0,
  )
  const total = usable.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return -1

  const bucket = bucketOf(`${salt}:variant`, flagKey, bucketValue)
  // Scaled into the same 0..BUCKET_COUNT space the rollout uses, so the
  // resolution of a split matches the resolution of a percentage.
  let cursor = 0
  for (let index = 0; index < usable.length; index++) {
    cursor += (usable[index]! / total) * BUCKET_COUNT
    if (bucket < cursor) return index
  }
  return usable.length - 1
}
