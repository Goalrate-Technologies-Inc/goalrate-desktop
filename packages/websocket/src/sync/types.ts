/**
 * Sync Types
 * Types for real-time synchronization with optimistic updates
 */

import type { SyncStatus } from '@goalrate-app/shared';

// ============================================================================
// PENDING UPDATE
// ============================================================================

/**
 * Represents a pending update waiting for server confirmation
 */
export interface PendingUpdate {
  /** Unique request ID for tracking */
  requestId: string;
  /** Type of entity being updated */
  entityType: string;
  /** ID of the entity */
  entityId: string;
  /** Vault/workspace ID */
  vaultId: string;
  /** Fields being changed with new values */
  changes: Record<string, unknown>;
  /** Previous data before the optimistic update (for rollback) */
  previousData: Record<string, unknown>;
  /** Version the update is based on */
  baseVersion: number;
  /** Timestamp when update was initiated */
  timestamp: Date;
  /** ISO string timestamp for LWW conflict resolution */
  clientTimestamp: string;
  /** Current status of the pending update */
  status: 'pending' | 'sent' | 'acknowledged' | 'rejected';
  /** Number of retry attempts */
  retryCount: number;
  /** Error message if rejected */
  error?: string;
  /** Rejection reason if rejected */
  rejectReason?: 'conflict' | 'validation' | 'permission' | 'not_found';
}

// ============================================================================
// OPTIMISTIC UPDATE STATE
// ============================================================================

/**
 * State for optimistic update management
 */
export interface OptimisticUpdateState<T> {
  /** Original server data */
  serverData: T | null;
  /** Pending changes not yet confirmed */
  pendingChanges: Partial<T> | null;
  /** Data with pending changes applied (what user sees) */
  optimisticData: T | null;
  /** Current version from server */
  version: number;
  /** Current sync status */
  syncStatus: SyncStatus;
  /** Last successful sync timestamp */
  lastSyncAt: Date | null;
  /** Current error message */
  error: string | null;
}

// ============================================================================
// SYNC CONFLICT
// ============================================================================

/**
 * Represents a sync conflict that needs resolution
 */
export interface SyncConflict {
  /** Unique ID for this conflict */
  id: string;
  /** Type of entity */
  entityType: string;
  /** ID of the entity */
  entityId: string;
  /** Vault/workspace ID */
  vaultId: string;
  /** Local changes that were rejected */
  localChanges: Record<string, unknown>;
  /** Local version */
  localVersion: number;
  /** Current server data */
  serverData: Record<string, unknown>;
  /** Current server version */
  serverVersion: number;
  /** Fields that conflict */
  conflictingFields: string[];
  /** Timestamp of conflict detection */
  detectedAt: Date;
  /** Resolution strategy chosen */
  resolution?: 'local' | 'server' | 'merged';
  /** Merged data if resolution is 'merged' */
  mergedData?: Record<string, unknown>;
  /** Client-side timestamp when local write was attempted (for LWW) */
  localTimestamp?: string;
  /** Server's write_timestamp when conflict occurred (for LWW) */
  serverTimestamp?: string;
  /** Whether this conflict can be auto-resolved by LWW */
  autoResolvable?: boolean;
  /** Suggested resolution based on LWW comparison */
  autoResolution?: 'local' | 'server';
}

// ============================================================================
// SYNC MANAGER OPTIONS
// ============================================================================

/**
 * Configuration options for SyncManager
 */
export interface SyncManagerOptions {
  /** Maximum number of retry attempts */
  maxRetries?: number;
  /** Base delay for retry backoff (ms) */
  retryBaseDelay?: number;
  /** Maximum retry delay (ms) */
  retryMaxDelay?: number;
  /** TTL for pending updates (ms) */
  pendingUpdateTTL?: number;
  /** Callback when update is acknowledged */
  onAck?: (requestId: string, newVersion: number) => void;
  /** Callback when update is rejected */
  onReject?: (requestId: string, reason: string, serverData?: Record<string, unknown>) => void;
  /** Callback when conflict is detected */
  onConflict?: (conflict: SyncConflict) => void;
}

// ============================================================================
// SYNC EVENTS
// ============================================================================

/**
 * Events emitted by SyncManager
 */
export type SyncEventType =
  | 'updateQueued'
  | 'updateSent'
  | 'updateAcked'
  | 'updateRejected'
  | 'conflictDetected'
  | 'remoteChange'
  | 'statusChange';

/**
 * Event data for sync events
 */
export interface SyncEventData {
  updateQueued: { update: PendingUpdate };
  updateSent: { update: PendingUpdate };
  updateAcked: { requestId: string; newVersion: number };
  updateRejected: { requestId: string; reason: string; serverData?: Record<string, unknown> };
  conflictDetected: { conflict: SyncConflict };
  remoteChange: {
    entityType: string;
    entityId: string;
    vaultId: string;
    changes: Record<string, unknown>;
    newVersion: number;
    updatedBy: string;
  };
  statusChange: { status: SyncStatus };
}

// ============================================================================
// HOOK RETURN TYPES
// ============================================================================

/**
 * Return type for useOptimisticUpdate hook
 */
export interface UseOptimisticUpdateReturn<T> {
  /** Current data with optimistic changes applied */
  data: T | null;
  /** Apply a local change (optimistically) */
  applyUpdate: (changes: Partial<T>) => Promise<boolean>;
  /** Rollback pending changes */
  rollback: () => void;
  /** Current sync status */
  syncStatus: SyncStatus;
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Last successful sync timestamp */
  lastSyncAt: Date | null;
  /** Current error message */
  error: string | null;
  /** Current version */
  version: number;
}

/**
 * Return type for useSyncStatus hook
 */
export interface UseSyncStatusReturn {
  /** Overall sync status */
  status: SyncStatus;
  /** Last successful sync timestamp */
  lastSyncAt: Date | null;
  /** Number of pending updates */
  pendingCount: number;
  /** Whether currently syncing */
  isSyncing: boolean;
  /** Whether connected to server */
  isOnline: boolean;
  /** Retry syncing failed updates */
  retrySync: () => void;
}

/**
 * Return type for useConflictResolution hook
 */
export interface UseConflictResolutionReturn {
  /** List of unresolved conflicts */
  conflicts: SyncConflict[];
  /** Resolve a conflict with specified strategy */
  resolveConflict: (conflictId: string, resolution: 'local' | 'server' | 'merged', mergedData?: Record<string, unknown>) => void;
  /** Dismiss a conflict without resolving */
  dismissConflict: (conflictId: string) => void;
  /** Whether there are any conflicts */
  hasConflicts: boolean;
  /** Number of conflicts */
  conflictCount: number;
}
