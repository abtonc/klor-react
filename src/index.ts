export { KlorProvider } from './react/provider.js'
export type { KlorProviderProps } from './react/provider.js'
export { useFlag, useFlagDetail, useKlor, useVersionGate } from './react/hooks.js'
export type { UseKlorResult, UseVersionGateOptions } from './react/hooks.js'

export { createKlorClient, KlorClient } from './core/client.js'
export type { KlorClientOptions, KlorState, KlorStatus } from './core/client.js'
export { KlorHttpError } from './core/transport.js'
export type { KlorStorage } from './core/storage.js'
export type { EvaluationEvent, TelemetryOptions } from './core/telemetry.js'

// Also exported for tooling that compiles or inspects snapshots, the
// dashboard's publisher builds payloads against exactly these types.
export { SNAPSHOT_VERSION } from './core/types.js'
export { SDK_VERSION } from './core/version.js'
export { evaluateFlag, evaluateFromSnapshot, evaluateVersionGate } from './core/evaluate.js'
export type {
  Condition,
  Evaluation,
  EvaluationReason,
  FlagDefinition,
  FlagValue,
  FlagValueType,
  KlorContext,
  Operator,
  Platform,
  Rollout,
  Rule,
  Snapshot,
  VersionGate,
  VersionGateResult,
  VersionGateStatus,
} from './core/types.js'
