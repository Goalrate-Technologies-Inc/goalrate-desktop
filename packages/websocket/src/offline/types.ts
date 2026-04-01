/**
 * Offline Queue Types
 * Types for persistent offline queue management in React Native
 */

import type { SyncableEntityType } from '@goalrate-app/shared';

// ============================================================================
// QUEUE ENTRY
// ============================================================================

/**
 * Status of an offline queue entry
 */
export type OfflineQueueEntryStatus =
  | 'pending' // Not yet attempted
  | 'syncing' // Currently being sent
  | 'retrying' // Failed, will retry
  | 'failed' // Max retries exceeded
  | 'completed'; // Successfully synced

/**
 * Persisted queue entry - stored in AsyncStorage
 */
export interface PersistedQueueEntry {
  /** Unique ID for this queue entry */
  id: string;
  /** Request ID for correlation with sync responses */
  requestId: string;
  /** Type of entity being synced */
  entityType: SyncableEntityType;
  /** ID of the entity */
  entityId: string;
  /** Vault/workspace ID */
  vaultId: string;
  /** Fields being changed */
  changes: Record<string, unknown>;
  /** Previous data for rollback */
  previousData: Record<string, unknown>;
  /** Base version for optimistic concurrency */
  baseVersion: number;
  /** ISO timestamp when queued */
  queuedAt: string;
  /** ISO timestamp for LWW conflict resolution */
  clientTimestamp: string;
  /** Number of sync attempts */
  attempts: number;
  /** Last attempt timestamp (ISO) */
  lastAttemptAt?: string;
  /** Last error message if failed */
  lastError?: string;
  /** Current status */
  status: OfflineQueueEntryStatus;
  /** Priority for ordering (lower = higher priority) */
  priority: number;
}

// ============================================================================
// QUEUE CONFIGURATION
// ============================================================================

/**
 * Offline queue configuration
 */
export interface OfflineQueueConfig {
  /** Storage key prefix for AsyncStorage */
  storageKeyPrefix: string;
  /** Maximum number of entries to queue */
  maxQueueSize: number;
  /** Entry TTL in milliseconds (default: 7 days) */
  entryTTL: number;
  /** Maximum retry attempts per entry */
  maxRetries: number;
  /** Base delay for exponential backoff (ms) */
  retryBaseDelay: number;
  /** Maximum retry delay (ms) */
  retryMaxDelay: number;
  /** Batch size for syncing */
  syncBatchSize: number;
  /** Delay between batches (ms) */
  batchDelay: number;
}

/**
 * Default queue configuration values
 */
export const DEFAULT_OFFLINE_QUEUE_CONFIG: OfflineQueueConfig = {
  storageKeyPrefix: '@goalrate/offline_sync',
  maxQueueSize: 500,
  entryTTL: 7 * 24 * 60 * 60 * 1000, // 7 days
  maxRetries: 5,
  retryBaseDelay: 1000,
  retryMaxDelay: 60000,
  syncBatchSize: 10,
  batchDelay: 100,
};

// ============================================================================
// QUEUE STATISTICS
// ============================================================================

/**
 * Queue statistics
 */
export interface OfflineQueueStats {
  /** Total entries in queue */
  total: number;
  /** Entries by status */
  byStatus: Record<OfflineQueueEntryStatus, number>;
  /** Oldest entry age in ms */
  oldestEntryAge: number | null;
  /** Estimated storage size in bytes */
  estimatedSize: number;
  /** Last sync attempt timestamp */
  lastSyncAttempt: Date | null;
  /** Last successful sync timestamp */
  lastSuccessfulSync: Date | null;
}

// ============================================================================
// NETWORK STATE
// ============================================================================

/**
 * Network state information
 */
export interface NetworkState {
  /** Whether network is connected */
  isConnected: boolean;
  /** Whether internet is reachable (null if unknown) */
  isInternetReachable: boolean | null;
  /** Network type (wifi, cellular, etc.) */
  type: string | null;
}

// ============================================================================
// SYNC STATUS
// ============================================================================

/**
 * Overall sync state for UI display
 */
export type OfflineSyncState = 'idle' | 'syncing' | 'offline' | 'error';

/**
 * Sync status for UI display
 */
export interface OfflineSyncStatus {
  /** Overall sync state */
  state: OfflineSyncState;
  /** Number of pending changes */
  pendingCount: number;
  /** Number of failed changes */
  failedCount: number;
  /** Whether currently syncing */
  isSyncing: boolean;
  /** Whether device is online */
  isOnline: boolean;
  /** Last sync timestamp */
  lastSyncAt: Date | null;
  /** Current error message */
  error: string | null;
  /** Sync progress (0-100) */
  progress: number;
}

/**
 * Default sync status
 */
export const DEFAULT_SYNC_STATUS: OfflineSyncStatus = {
  state: 'idle',
  pendingCount: 0,
  failedCount: 0,
  isSyncing: false,
  isOnline: true,
  lastSyncAt: null,
  error: null,
  progress: 100,
};

// ============================================================================
// SYNC HISTORY
// ============================================================================

/**
 * Sync history entry for debugging and user visibility
 */
export interface SyncHistoryEntry {
  /** Unique ID */
  id: string;
  /** Entry ID that was synced */
  entryId: string;
  /** Entity type */
  entityType: SyncableEntityType;
  /** Entity ID */
  entityId: string;
  /** Result of sync */
  result: 'success' | 'failed' | 'conflict';
  /** Error message if failed */
  error?: string;
  /** Timestamp of sync */
  timestamp: string;
  /** New version if successful */
  newVersion?: number;
  /** Whether LWW was used to resolve */
  resolvedByLWW?: boolean;
}

// ============================================================================
// EVENTS
// ============================================================================

/**
 * Events emitted by OfflineQueue
 */
export type OfflineQueueEventType =
  | 'entryAdded'
  | 'entryUpdated'
  | 'entryRemoved'
  | 'queueCleared'
  | 'syncStarted'
  | 'syncCompleted'
  | 'syncFailed'
  | 'networkStateChanged'
  | 'storageError';

/**
 * Event data for offline queue events
 */
export interface OfflineQueueEventData {
  entryAdded: { entry: PersistedQueueEntry };
  entryUpdated: {
    entry: PersistedQueueEntry;
    previousStatus: OfflineQueueEntryStatus;
  };
  entryRemoved: {
    entry: PersistedQueueEntry;
    reason: 'completed' | 'expired' | 'manual';
  };
  queueCleared: { count: number };
  syncStarted: { count: number };
  syncCompleted: { successful: number; failed: number };
  syncFailed: { error: string; entriesAffected: number };
  networkStateChanged: { state: NetworkState };
  storageError: { operation: string; error: string };
}

// ============================================================================
// SYNC MANAGER CONFIG
// ============================================================================

/**
 * Configuration for OfflineSyncManager
 */
export interface OfflineSyncManagerConfig extends Partial<OfflineQueueConfig> {
  /** Whether to auto-sync when coming online */
  autoSyncOnReconnect: boolean;
  /** Minimum delay before syncing after coming online (ms) */
  reconnectSyncDelay: number;
  /** Whether to sync in background */
  backgroundSync: boolean;
  /** Maximum sync history entries to keep */
  maxHistoryEntries: number;
}

/**
 * Default sync manager configuration
 */
export const DEFAULT_SYNC_MANAGER_CONFIG: OfflineSyncManagerConfig = {
  autoSyncOnReconnect: true,
  reconnectSyncDelay: 1000,
  backgroundSync: true,
  maxHistoryEntries: 100,
};

// ============================================================================
// SYNC RESULT
// ============================================================================

/**
 * Result of a sync operation
 */
export interface SyncResult {
  /** Number of successful syncs */
  successful: number;
  /** Number of failed syncs */
  failed: number;
  /** IDs of failed entries */
  failedEntryIds: string[];
  /** Errors encountered */
  errors: Array<{ entryId: string; error: string }>;
}

// ============================================================================
// STORAGE INTERFACE
// ============================================================================

/**
 * Abstraction over AsyncStorage for testability
 * Matches @react-native-async-storage/async-storage API
 */
export interface OfflineStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  multiRemove(keys: string[]): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}
