/**
 * React Hooks Exports
 */

// Core hooks
export { useWebSocket, type UseWebSocketReturn } from './useWebSocket';
export { useConnectionState, type UseConnectionStateReturn } from './useConnectionState';
export {
  useSubscription,
  useSubscriptions,
  type UseSubscriptionOptions,
} from './useSubscription';
export {
  useMessage,
  useMessages,
  useMessageState,
  useMessageHistory,
  type MessageHandler,
  type UseMessageOptions,
} from './useMessage';

// Domain hooks
export {
  usePresence,
  type UsePresenceOptions,
  type UsePresenceReturn,
} from './usePresence';
export {
  useEntityViewers,
  type UseEntityViewersOptions,
  type UseEntityViewersReturn,
} from './useEntityViewers';
export {
  useEntityEditors,
  type UseEntityEditorsOptions,
  type UseEntityEditorsReturn,
} from './useEntityEditors';

// Sync hooks
export {
  useOptimisticUpdate,
  type UseOptimisticUpdateOptions,
} from './useOptimisticUpdate';
export {
  useSyncStatus,
  type UseSyncStatusOptions,
} from './useSyncStatus';
export {
  useConflictResolution,
  type UseConflictResolutionOptions,
} from './useConflictResolution';
export {
  useRemoteChanges,
  type UseRemoteChangesOptions,
  type UseRemoteChangesReturn,
} from './useRemoteChanges';
