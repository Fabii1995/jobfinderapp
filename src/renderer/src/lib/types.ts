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
  SerpapiStatus,
  DeepSearchProvider
} from '../../../shared/jsearch'
export { MAX_API_KEY_LENGTH } from '../../../shared/jsearch'
