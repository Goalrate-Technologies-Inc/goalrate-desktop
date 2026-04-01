/**
 * Offline Module Exports
 * Persistent offline queue and sync management for React Native
 */

// Core classes
export { OfflineQueue } from './OfflineQueue';
export { OfflineSyncManager } from './OfflineSyncManager';

// Types
export type {
  // Queue entry types
  PersistedQueueEntry,
  OfflineQueueEntryStatus,
  // Configuration
  OfflineQueueConfig,
  OfflineSyncManagerConfig,
  // State and status
  NetworkState,
  OfflineSyncStatus,
  OfflineSyncState,
  OfflineQueueStats,
  SyncResult,
  SyncHistoryEntry,
  // Events
  OfflineQueueEventType,
  OfflineQueueEventData,
  // Storage adapter
  OfflineStorageAdapter,
} from './types';

// Constants
export {
  DEFAULT_OFFLINE_QUEUE_CONFIG,
  DEFAULT_SYNC_MANAGER_CONFIG,
  DEFAULT_SYNC_STATUS,
} from './types';

// Network info types (for OfflineSyncManager.initialize)
export type {
  NetInfoState,
  NetInfoSubscription,
  NetInfoModule,
} from './OfflineSyncManager';
