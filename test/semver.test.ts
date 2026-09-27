import { describe, expect, it } from 'vitest'
import { compareVersions, parseVersion } from '../src/core/semver.js'

describe('compareVersions', () => {
  it('compares segments numerically, not lexically', () => {
    // The classic bug: "2.10.0" < "2.9.0" under string comparison.
    expect(compareVersions('2.10.0', '2.9.0')).toBe(1)
    expect(compareVersions('2.9.0', '2.10.0')).toBe(-1)
    expect(compareVersions('10.0.0', '9.99.99')).toBe(1)
  })

  it('treats missing segments as zero', () => {
    expect(compareVersions('2.4', '2.4.0')).toBe(0)
    expect(compareVersions('2', '2.0.0')).toBe(0)
    expect(compareVersions('2.4', '2.4.1')).toBe(-1)
  })

  it('handles four-segment build versions some Android apps ship', () => {
    expect(compareVersions('2.4.0.1187', '2.4.0.1186')).toBe(1)
    expect(compareVersions('2.4.0.1187', '2.4.0')).toBe(1)
  })

  it('tolerates a leading v and build metadata', () => {
    expect(compareVersions('v2.4.0', '2.4.0')).toBe(0)
    expect(compareVersions('2.4.0+build.99', '2.4.0')).toBe(0)
  })

  it('ranks a release above its prereleases', () => {
    expect(compareVersions('1.0.0', '1.0.0-rc1')).toBe(1)
    expect(compareVersions('1.0.0-rc1', '1.0.0-rc2')).toBe(-1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
    // Numeric identifiers rank below alphanumeric ones, per semver.
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1)
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1)
  })

  it('returns null rather than guessing at garbage', () => {
    expect(compareVersions('not-a-version', '1.0.0')).toBeNull()
    expect(compareVersions('1.0.0', '')).toBeNull()
    expect(parseVersion('¯\\_(ツ)_/¯')).toBeNull()
  })
})
