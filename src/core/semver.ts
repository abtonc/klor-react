/**
 * Version comparison for update gating.
 *
 * Deliberately more permissive than strict semver, because real app versions
 * are not strict semver: Android ships `2.4`, some teams ship a four-part
 * `2.4.0.1187`, and store metadata sometimes carries a leading `v`. Leading
 * numeric segments are compared element-wise with missing segments treated as
 * zero, so `2.4` and `2.4.0` are equal and `2.10.0` correctly beats `2.9.0`.
 */

export interface ParsedVersion {
  segments: number[]
  prerelease: string[]
}

const VERSION_PATTERN = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Returns `null` for anything unparseable, callers must fail open, not guess. */
export function parseVersion(input: string): ParsedVersion | null {
  if (typeof input !== 'string') return null
  const match = VERSION_PATTERN.exec(input.trim())
  if (!match?.[1]) return null
  return {
    segments: match[1].split('.').map((part) => Number.parseInt(part, 10)),
    prerelease: match[2] ? match[2].split('.') : [],
  }
}

function comparePrerelease(a: string[], b: string[]): -1 | 0 | 1 {
  // A version with no prerelease outranks one that has it: 1.0.0 > 1.0.0-rc1.
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i]
    const right = b[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    if (left === right) continue

    const leftNum = /^\d+$/.test(left) ? Number.parseInt(left, 10) : null
    const rightNum = /^\d+$/.test(right) ? Number.parseInt(right, 10) : null

    // Numeric identifiers always rank below alphanumeric ones.
    if (leftNum !== null && rightNum !== null) return leftNum < rightNum ? -1 : 1
    if (leftNum !== null) return -1
    if (rightNum !== null) return 1
    return left < right ? -1 : 1
  }
  return 0
}

/**
 * Returns -1, 0, or 1, or `null` when either side is unparseable, which the
 * gate treats as "no opinion" rather than forcing an update.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return null

  const length = Math.max(left.segments.length, right.segments.length)
  for (let i = 0; i < length; i++) {
    const l = left.segments[i] ?? 0
    const r = right.segments[i] ?? 0
    if (l !== r) return l < r ? -1 : 1
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}
