import { fnv1a32 } from './hash.js'

/**
 * Minimal persistence contract. Deliberately matches the shape of both
 * `localStorage` and React Native's AsyncStorage, so wiring either one up is a
 * pass-through rather than an adapter, and `react-native` never becomes a
 * dependency of this package.
 */
export interface KlorStorage {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): void | Promise<void>
}

function memoryStorage(): KlorStorage {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  }
}

/** `localStorage` where it exists and is usable, memory everywhere else. */
export function defaultStorage(): KlorStorage {
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      // Safari in private mode exposes localStorage but throws on write.
      const probe = '__klor_probe__'
      globalThis.localStorage.setItem(probe, '1')
      globalThis.localStorage.removeItem(probe)
      return globalThis.localStorage
    }
  } catch {
    // Fall through to memory.
  }
  return memoryStorage()
}

/**
 * Namespaces cached snapshots per API key without ever writing the key itself
 * to disk, two environments in one app must not read each other's cache.
 */
export function cacheKeyFor(apiKey: string): string {
  return `klor:v1:${fnv1a32(apiKey).toString(36)}`
}
