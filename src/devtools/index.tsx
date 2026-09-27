import { useMemo, useState } from 'react'
import { useKlorContext } from '../react/context.js'
import { useKlor, useKlorState } from '../react/hooks.js'
import type { CSSProperties } from 'react'
import type { FlagValue } from '../core/types.js'

/**
 * A flag inspector for development.
 *
 * Everything it shows already existed on the client: the snapshot, the reason a
 * value was chosen, the sequence number. What it adds is the ability to force a
 * value locally, which is the part that was genuinely missing. Without it the
 * only way to exercise the "on" path of a flag is to edit configuration other
 * people are also reading.
 *
 * Web only: it renders DOM. React Native has the same overrides through
 * `client.setOverride`, and no panel.
 *
 * Imported from `@klor/react/devtools` so it stays out of a production bundle
 * unless you put it there.
 */

export interface KlorDevtoolsProps {
  /** Render nothing when false, so a single mount point can be gated by env. */
  enabled?: boolean
  /** Which corner it sits in. */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  /** Open on first render, for when you are actively working in it. */
  defaultOpen?: boolean
}

const BRAND = '#7c5cff'
const INK = '#edebf2'
const MUTED = '#9b96a8'
const PANEL = '#121119'
const LINE = '#2a2735'

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const SANS = 'system-ui, -apple-system, sans-serif'

/** Whether a row is something the developer probably needs to act on. */
function isProblem(row: { definition?: unknown; requested?: { reason: string } }): boolean {
  return !row.definition || row.requested?.reason === 'typeMismatch'
}

const REASON_LABELS: Record<string, string> = {
  default: 'default value',
  disabled: 'flag is off',
  rule: 'matched a rule',
  unknownFlag: 'not in this snapshot',
  notReady: 'no snapshot yet',
  typeMismatch: 'type mismatch, using fallback',
  override: 'forced locally',
}

export function KlorDevtools({
  enabled = true,
  position = 'bottom-right',
  defaultOpen = false,
}: KlorDevtoolsProps) {
  const { client, context } = useKlorContext()
  const state = useKlorState()
  const klor = useKlor()
  const [open, setOpen] = useState(defaultOpen)
  const [filter, setFilter] = useState('')

  const rows = useMemo(() => {
    /* The union, not just the snapshot. A key the app reads that was never
       published is the most common integration mistake there is, and listing
       only what the snapshot contains is precisely how it stays invisible. */
    const published = Object.keys(state.snapshot?.flags ?? {})
    const asked = Object.keys(state.requested)
    const keys = [...new Set([...published, ...asked])].sort()

    return keys
      .filter((key) => key.includes(filter.trim()))
      .map((key) => {
        const definition = state.snapshot?.flags[key]
        const requested = state.requested[key]
        // Evaluated against the flag's own default, so the fallback can never be
        // the thing that decides the answer shown here.
        const fallback = (definition?.default ?? false) as FlagValue
        return {
          key,
          definition,
          requested,
          override: state.overrides[key],
          // A key with no definition cannot be evaluated; what the app last got
          // is the only truth available, and it is the useful one.
          evaluation: definition
            ? client.evaluate(key, fallback, context)
            : (requested ?? { value: undefined as unknown as FlagValue, reason: 'unknownFlag' }),
        }
      })
      // Problems first: an unpublished key or a type mismatch is the reason
      // somebody opened this panel.
      .sort((a, b) => Number(isProblem(b)) - Number(isProblem(a)))
  }, [client, context, filter, state.snapshot, state.overrides, state.requested])

  if (!enabled) return null

  const overrideCount = Object.keys(state.overrides).length
  const [vertical, horizontal] = position.split('-') as ['top' | 'bottom', 'left' | 'right']
  const anchor: CSSProperties = {
    position: 'fixed',
    [vertical]: 16,
    [horizontal]: 16,
    zIndex: 2_147_483_000,
    fontFamily: SANS,
  }

  if (!open) {
    return (
      <div data-klor-devtools="closed" style={anchor}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Klor devtools"
          style={styles.launcher}
        >
          <span style={{ fontFamily: MONO, letterSpacing: '-0.02em' }}>Klor.</span>
          {overrideCount > 0 && <span style={styles.pill}>{overrideCount}</span>}
        </button>
      </div>
    )
  }

  return (
    // A stable hook for tests and for anyone who needs to style around it.
    <div data-klor-devtools="open" style={{ ...anchor, width: 340, maxWidth: 'calc(100vw - 32px)' }}>
      <div style={styles.panel}>
        <header style={styles.header}>
          <span style={{ fontFamily: MONO, fontSize: 13, color: INK }}>Klor.</span>
          <span style={{ fontSize: 11, color: MUTED }}>
            {state.snapshot ? `#${String(klor.seq ?? 0).padStart(4, '0')}` : 'no snapshot'}
            {state.source !== 'none' && ` · ${state.source}`}
            {klor.isStale && ' · stale'}
          </span>
          <button type="button" onClick={() => void klor.refresh()} style={styles.ghost}>
            Refresh
          </button>
          <button type="button" onClick={() => setOpen(false)} style={styles.ghost} aria-label="Close">
            ×
          </button>
        </header>

        <div style={styles.toolbar}>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter flags"
            style={styles.input}
          />
          {overrideCount > 0 && (
            <button type="button" onClick={client.clearOverrides} style={styles.ghost}>
              Reset {overrideCount}
            </button>
          )}
        </div>

        <div style={styles.list}>
          {rows.length === 0 && (
            <p style={{ ...styles.empty }}>
              {state.snapshot ? 'No flags match.' : 'Waiting for the first snapshot.'}
            </p>
          )}

          {rows.map((row) => (
            <div key={row.key} style={styles.row}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <code style={styles.key}>{row.key}</code>
                {row.override !== undefined && <span style={styles.pill}>forced</span>}
                {!row.definition && <span style={styles.warning}>not published</span>}
                {row.definition && row.requested?.reason === 'typeMismatch' && (
                  <span style={styles.warning}>wrong type</span>
                )}
              </div>

              {!row.definition ? (
                <p style={{ ...styles.reason, marginTop: 6 }}>
                  Your code reads this and the snapshot does not contain it, so every read returns
                  the fallback. Either the key is misspelled or not created yet, or it is marked
                  sensitive, which a public key never receives.
                </p>
              ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <ValueControl
                  flagKey={row.key}
                  type={row.definition?.type ?? 'bool'}
                  value={row.evaluation.value}
                  onChange={(next) => client.setOverride(row.key, next)}
                />
                {row.override !== undefined && (
                  <button
                    type="button"
                    onClick={() => client.clearOverride(row.key)}
                    style={styles.ghost}
                  >
                    Clear
                  </button>
                )}
              </div>
              )}

              <p style={styles.reason}>
                {REASON_LABELS[row.evaluation.reason] ?? row.evaluation.reason}
                {'ruleId' in row.evaluation && row.evaluation.ruleId
                  ? ` · ${row.evaluation.ruleId}`
                  : ''}
                {row.definition ? '' : ' · never read successfully'}
              </p>
            </div>
          ))}
        </div>

        <footer style={styles.footer}>
          Overrides are local to this browser and are never reported as usage.
        </footer>
      </div>
    </div>
  )
}

/* Every control is labelled with the flag it belongs to. A panel of unlabelled
   switches is unreadable to a screen reader and unaddressable from a test. */
function ValueControl({
  flagKey,
  type,
  value,
  onChange,
}: {
  flagKey: string
  type: string
  value: FlagValue
  onChange: (value: FlagValue) => void
}) {
  const label = `Override ${flagKey}`

  if (type === 'bool') {
    const on = value === true
    return (
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={on}
        onClick={() => onChange(!on)}
        style={{ ...styles.switch, background: on ? BRAND : '#39344a' }}
      >
        <span style={{ ...styles.knob, left: on ? 22 : 3 }} />
      </button>
    )
  }

  if (type === 'number') {
    return (
      <input
        type="number"
        aria-label={label}
        value={String(value ?? 0)}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ ...styles.input, fontFamily: MONO }}
      />
    )
  }

  if (type === 'string') {
    return (
      <input
        aria-label={label}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        style={{ ...styles.input, fontFamily: MONO }}
      />
    )
  }

  // JSON. Shown, and editable only when it parses, so a half-typed object never
  // becomes the value the app is reading.
  return (
    <textarea
      aria-label={label}
      defaultValue={JSON.stringify(value)}
      onBlur={(event) => {
        try {
          onChange(JSON.parse(event.target.value) as FlagValue)
        } catch {
          event.target.value = JSON.stringify(value)
        }
      }}
      rows={2}
      style={{ ...styles.input, fontFamily: MONO, resize: 'vertical' }}
    />
  )
}

const styles: Record<string, CSSProperties> = {
  launcher: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    borderRadius: 999,
    border: `1px solid ${LINE}`,
    background: PANEL,
    color: INK,
    fontSize: 12,
    cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '70vh',
    borderRadius: 12,
    border: `1px solid ${LINE}`,
    background: PANEL,
    color: INK,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    borderBottom: `1px solid ${LINE}`,
  },
  toolbar: {
    display: 'flex',
    gap: 6,
    padding: '8px 12px',
    borderBottom: `1px solid ${LINE}`,
  },
  list: { overflowY: 'auto', padding: '4px 0' },
  row: { padding: '10px 12px', borderBottom: `1px solid ${LINE}` },
  key: { fontFamily: MONO, fontSize: 12.5, color: INK, wordBreak: 'break-all' },
  reason: { margin: '6px 0 0', fontSize: 11, color: MUTED },
  empty: { margin: 0, padding: '16px 12px', fontSize: 12, color: MUTED },
  input: {
    flex: 1,
    minWidth: 0,
    padding: '5px 8px',
    borderRadius: 6,
    border: `1px solid ${LINE}`,
    background: '#0e0d14',
    color: INK,
    fontSize: 12,
    fontFamily: SANS,
  },
  ghost: {
    padding: '4px 8px',
    borderRadius: 6,
    border: `1px solid ${LINE}`,
    background: 'transparent',
    color: MUTED,
    fontSize: 11,
    cursor: 'pointer',
  },
  warning: {
    padding: '1px 6px',
    borderRadius: 999,
    background: '#5b2330',
    color: '#ffd7de',
    fontSize: 10,
    lineHeight: '16px',
  },
  pill: {
    padding: '1px 6px',
    borderRadius: 999,
    background: BRAND,
    color: '#fff',
    fontSize: 10,
    lineHeight: '16px',
  },
  switch: {
    position: 'relative',
    width: 38,
    height: 22,
    borderRadius: 999,
    border: 'none',
    cursor: 'pointer',
    flexShrink: 0,
  },
  knob: {
    position: 'absolute',
    top: 3,
    width: 16,
    height: 16,
    borderRadius: '50%',
    background: '#fff',
    transition: 'left 150ms',
  },
  footer: {
    padding: '8px 12px',
    borderTop: `1px solid ${LINE}`,
    fontSize: 10.5,
    color: MUTED,
  },
}
