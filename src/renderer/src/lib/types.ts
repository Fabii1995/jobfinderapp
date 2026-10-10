// Single import point for shared (main/renderer) types and constants.
export type {
  Job,
  LastRefresh,
  SourceOutcome,
  Company,
  Ats
} from '../../../shared/ipc'
export { ROLES, ROLE_LABELS } from '../../../shared/roles'
export type { Role } from '../../../shared/roles'
export type {
  JSearchStatus,
  JSearchRunSummary,
  JSearchRunResult,
  JSearchSetKeyResult,
  JSearchClearSeenResult,
  JSearchDropped,
  DroppedJob,
  DroppedReason,
  SerpapiStatus,
  DeepSearchProvider
} from '../../../shared/jsearch'
export { MAX_API_KEY_LENGTH, DROPPED_REASONS } from '../../../shared/jsearch'
