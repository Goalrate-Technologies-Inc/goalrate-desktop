/**
 * @goalrate-app/websocket
 * WebSocket connection manager for real-time sync and presence
 */

// Core exports
export { WebSocketManager } from './WebSocketManager';
export { MessageQueue } from './MessageQueue';
export { HeartbeatManager } from './HeartbeatManager';

// Types
export type {
  WebSocketManagerConfig,
  WebSocketManagerState,
  WebSocketEventType,
  WebSocketEventHandler,
  WebSocketEventHandlers,
  QueuedMessage,
  UserPresence,
  EntityViewer,
  EntityEditor,
  WorkspacePresence,
  EntityPresence,
} from './types';

export { DEFAULT_CONFIG, TOPICS, ConnectionState, MessageType } from './types';

export type {
  WebSocketMessage,
  SubscribePayload,
  ActivityUpdatePayload,
  GoalUpdatePayload,
  ProjectUpdatePayload,
  PresencePayload,
  NotificationPayload,
} from './types';

// Errors
export {
  WebSocketError,
  connectionFailed,
  connectionClosed,
  authenticationFailed,
  authenticationExpired,
  sendFailed,
  heartbeatTimeout,
  maxReconnectAttempts,
  queueFull,
  isWebSocketError,
  isAuthError,
  isRateLimited,
  closeCodeToErrorCode,
  CLOSE_CODES,
} from './errors';

export type { WebSocketErrorCode } from './errors';

// Sync module
export { SyncManager } from './sync/SyncManager';
export type {
  PendingUpdate,
  OptimisticUpdateState,
  SyncConflict,
  SyncManagerOptions,
  SyncEventType,
  SyncEventData,
  UseOptimisticUpdateReturn,
  UseSyncStatusReturn,
  UseConflictResolutionReturn,
} from './sync/types';

// Offline module (for React Native)
export {
  OfflineQueue,
  OfflineSyncManager,
  DEFAULT_OFFLINE_QUEUE_CONFIG,
  DEFAULT_SYNC_MANAGER_CONFIG,
  DEFAULT_SYNC_STATUS,
} from './offline';
export type {
  PersistedQueueEntry,
  OfflineQueueEntryStatus,
  OfflineQueueConfig,
  OfflineSyncManagerConfig,
  NetworkState,
  OfflineSyncStatus,
  OfflineSyncState,
  OfflineQueueStats,
  SyncResult,
  SyncHistoryEntry,
  OfflineQueueEventType,
  OfflineQueueEventData,
  OfflineStorageAdapter,
  NetInfoState,
  NetInfoSubscription,
  NetInfoModule,
} from './offline';
