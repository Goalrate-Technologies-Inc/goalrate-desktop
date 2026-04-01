/**
 * Team Storage Adapter
 * Encrypted storage for team vaults with operation queuing
 *
 * @example
 * ```typescript
 * import { createTeamStorage, TeamStorageAdapter } from '@goalrate-app/storage/team';
 *
 * // Create a team storage adapter
 * const storage = createTeamStorage({
 *   baseUrl: 'https://api.goalrate.app',
 * });
 *
 * // Set authentication token
 * storage.setAccessToken(userToken);
 *
 * // Unlock a team vault (after getting encryption config from vault)
 * await storage.unlockVault(vaultId, password, vaultConfig.encryptionConfig);
 *
 * // Now operations work with transparent encryption
 * const goals = await storage.getGoals(vaultId);
 *
 * // Lock when done
 * storage.lockVault(vaultId);
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export {
  // Configuration
  type TeamStorageConfig,
  DEFAULT_TEAM_CONFIG,
  // Session types
  type TeamVaultSession,
  type VaultLockState,
  // Encrypted data types
  type EncryptedString,
  type EncryptedPayload,
  type EncryptedPayloadMetadata,
  type EntityType,
  // Queue types
  type PendingOperation,
  type QueueStats,
  // Error types
  type TeamStorageErrorCode,
  type TeamStorageErrorDetails,
  // Field encryption specs
  type FieldEncryptionSpec,
  ENCRYPTION_SPECS,
  // Sync integration
  type EntityChangeEvent,
} from './types';

// ============================================================================
// ENCRYPTION EXPORTS
// ============================================================================

export {
  // Generic utilities
  encryptValue,
  decryptValue,
  encryptArray,
  decryptArray,
  // Goal encryption
  encryptGoal,
  decryptGoal,
  encryptGoals,
  decryptGoals,
  type EncryptedGoal,
  // Goal task encryption
  encryptGoalTask,
  decryptGoalTask,
  encryptGoalTasks,
  decryptGoalTasks,
  type EncryptedGoalTask,
  type EncryptedSubtask,
  // Project encryption
  encryptProject,
  decryptProject,
  encryptProjects,
  decryptProjects,
  type EncryptedProject,
  // Epic encryption
  encryptEpic,
  decryptEpic,
  encryptEpics,
  decryptEpics,
  type EncryptedEpic,
  // Sprint encryption
  encryptSprint,
  decryptSprint,
  encryptSprints,
  decryptSprints,
  type EncryptedSprint,
  // Retrospective encryption
  encryptRetrospective,
  decryptRetrospective,
  type EncryptedRetrospective,
  type EncryptedRetrospectiveAction,
  // Focus day encryption
  encryptFocusDay,
  decryptFocusDay,
  type EncryptedFocusDay,
  type EncryptedFocusItem,
} from './encryption';

// ============================================================================
// KEY MANAGEMENT EXPORTS
// ============================================================================

export {
  // Key derivation
  deriveVaultKey,
  // Session management
  createSession,
  getSession,
  getKey,
  hasSession,
  getLockState,
  isUnlocked,
  clearSession,
  clearAllSessions,
  // Session info
  getActiveSessions,
  getActiveSessionCount,
  // Session validation
  validateSession,
  // Cleanup
  startSessionCleanup,
  stopSessionCleanup,
} from './keys';

// ============================================================================
// ADAPTER EXPORTS
// ============================================================================

export { TeamStorageAdapter } from './TeamStorageAdapter';

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

import type { TeamStorageConfig } from './types';
import { TeamStorageAdapter } from './TeamStorageAdapter';

/**
 * Create a team storage adapter
 *
 * @param config - Configuration options
 * @returns A new TeamStorageAdapter instance
 *
 * @example
 * ```typescript
 * const storage = createTeamStorage({
 *   baseUrl: 'https://api.goalrate.app',
 *   maxQueueSize: 100,
 *   operationTimeout: 10 * 60 * 1000, // 10 minutes
 *   onLockRequired: (vaultId) => {
 *     showUnlockDialog(vaultId);
 *   },
 * });
 * ```
 */
export function createTeamStorage(config: TeamStorageConfig): TeamStorageAdapter {
  return new TeamStorageAdapter(config);
}
