// Single import point for shared (main/renderer) types and constants.
export type {
  Job,
  JobStats,
  LastRefresh,
  SourceOutcome,
  RefreshResponse,
  Company,
  CompaniesListResponse
} from '../../../shared/ipc'
export { ROLES, ROLE_LABELS } from '../../../shared/roles'
export type { Role } from '../../../shared/roles'
