/**
 * Storage Adapters
 * Platform-specific implementations of the StorageAdapter interface
 */

// Memory adapter (for testing)
export { MemoryStorageAdapter, createMemoryStorage } from './memory';

// Web adapter (API-based)
export {
  ApiStorageAdapter,
  createWebStorage,
  type ApiStorageAdapterOptions,
  ApiClient,
  ApiClientError,
  createApiClient,
  type ApiClientOptions,
  type ApiResponse,
} from './web';

// Desktop adapter (Tauri)
export {
  createDesktopStorage,
  createTauriStorage,
  DesktopStorageAdapterPlaceholder,
  DesktopStorageAdapter,
} from './desktop';

// Native adapter (React Native - placeholder)
export {
  createNativeStorage,
  NativeStorageAdapterPlaceholder,
  type NativeStorageOptions,
} from './native';

// Team adapter (encrypted team vaults)
export {
  TeamStorageAdapter,
  createTeamStorage,
  // Types
  type TeamStorageConfig,
  type TeamVaultSession,
  type VaultLockState,
  type EncryptedString,
  type QueueStats,
  // Key management
  deriveVaultKey,
  isUnlocked,
  getLockState,
  clearSession,
  clearAllSessions,
} from './team';
