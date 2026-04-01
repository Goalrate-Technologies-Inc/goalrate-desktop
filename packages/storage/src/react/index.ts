/**
 * React Integration
 * Provider, hooks, and utilities for React applications
 */

// Provider
export {
  StorageProvider,
  useStorage,
  useStorageContext,
  useStorageReady,
  useCurrentVault,
  type StorageProviderProps,
  type StorageState,
  type StorageContextValue,
} from './StorageProvider';

// Vault hook
export { useVault, type UseVaultReturn } from './useVault';

// Goals hooks
export { useGoals, useGoalTasks, type UseGoalsReturn, type UseGoalTasksReturn } from './useGoals';

// Projects hooks
export {
  useProjects,
  useEpics,
  useSprints,
  type UseProjectsReturn,
  type UseEpicsReturn,
  type UseSprintsReturn,
} from './useProjects';

// Focus hooks
export {
  useFocus,
  useTodayFocus,
  getTodayDate,
  type UseFocusReturn,
} from './useFocus';

// Team vault hooks
export {
  useTeamVault,
  validateTeamPassword,
  isValidTeamPassword,
  MIN_TEAM_PASSWORD_LENGTH,
  type UseTeamVaultReturn,
  type UseTeamVaultOptions,
} from './useTeamVault';

// Team storage provider
export {
  TeamStorageProvider,
  useTeamStorage,
  useTeamStorageContext,
  useTeamStorageReady,
  useVaultLockState,
  type TeamStorageProviderProps,
  type TeamStorageState,
  type TeamStorageContextValue,
} from './TeamStorageProvider';
