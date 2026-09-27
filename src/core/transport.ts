import { SNAPSHOT_VERSION } from './types.js'
import { SDK_VERSION } from './version.js'
import type { Snapshot } from './types.js'

export interface FetchResult {
  status: 'updated' | 'notModified'
  snapshot?: Snapshot
  etag?: string
}

export class KlorHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'KlorHttpError'
  }
}

export const DEFAULT_BASE_URL = 'https://edge.klor.dev'

/**
 * Accepts anything that is recognisably a snapshot, including a newer format
 * version than this SDK was built against.
 *
 * This is deliberately permissive, and it is the most consequential line in the
 * package. A shipped mobile binary cannot be patched: if this rejected `v: 2`,
 * every copy of this SDK in the field would start throwing the day a newer
 * format is published, keep serving its last cached snapshot until storage is
 * cleared, and then fall back forever. The evaluator already ignores rules and
 * operators it does not recognise, so a newer payload degrades rather than
 * breaks. Anything below `SNAPSHOT_VERSION` genuinely predates this reader.
 */
export function isSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Snapshot>
  return (
    typeof candidate.v === 'number' &&
    candidate.v >= SNAPSHOT_VERSION &&
    typeof candidate.seq === 'number' &&
    typeof candidate.flags === 'object' &&
    candidate.flags !== null
  )
}

/**
 * One conditional GET. An unchanged snapshot costs a 304 with no body, which is
 * what makes a five-minute poll across millions of devices affordable.
 */
export async function fetchSnapshot(options: {
  baseUrl: string
  apiKey: string
  etag?: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}): Promise<FetchResult> {
  const doFetch = options.fetchImpl ?? globalThis.fetch
  if (!doFetch) {
    throw new KlorHttpError('No fetch implementation available', 0)
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${options.apiKey}`,
    accept: 'application/json',
    // Sent so the read plane can tell which SDK versions are actually in the
    // field. Impossible to learn retroactively once binaries have shipped, and
    // the only basis on which an older client could ever be served a
    // compatible payload.
    'x-klor-sdk': SDK_VERSION,
  }
  if (options.etag) headers['if-none-match'] = options.etag

  const response = await doFetch(`${options.baseUrl.replace(/\/$/, '')}/v1/config`, {
    method: 'GET',
    headers,
    signal: options.signal,
  })

  if (response.status === 304) return { status: 'notModified' }

  if (!response.ok) {
    const detail =
      response.status === 401 || response.status === 403
        ? 'API key was rejected. Check that the key matches the environment you meant.'
        : `Config request failed with ${response.status}`
    throw new KlorHttpError(detail, response.status)
  }

  const body: unknown = await response.json()
  if (!isSnapshot(body)) {
    throw new KlorHttpError('Config response was not a snapshot this SDK understands', 200)
  }

  return {
    status: 'updated',
    snapshot: body,
    etag: response.headers.get('etag') ?? undefined,
  }
}

/**
 * Posts a batch of usage counters. Fire-and-forget by design: telemetry must
 * never delay or fail a config read, so callers ignore the outcome.
 */
export async function sendEvents(options: {
  baseUrl: string
  apiKey: string
  events: unknown[]
  fetchImpl?: typeof fetch
}): Promise<void> {
  const doFetch = options.fetchImpl ?? globalThis.fetch
  if (!doFetch || options.events.length === 0) return

  await doFetch(`${options.baseUrl.replace(/\/$/, '')}/v1/events`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      'content-type': 'application/json',
      'x-klor-sdk': SDK_VERSION,
    },
    body: JSON.stringify({ events: options.events }),
    keepalive: true,
  })
}
