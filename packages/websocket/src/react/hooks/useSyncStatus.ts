/**
 * useSyncStatus Hook
 * Tracks overall sync status for a vault
 */

import { useState, useCallback, useEffect } from 'react';
import type { SyncStatus, SyncAckPayload } from '@goalrate-app/shared';
import { MessageType, TOPICS } from '@goalrate-app/shared';
import type { UseSyncStatusReturn } from '../../sync/types';
import { useWebSocketContext } from '../WebSocketContext';

// ============================================================================
// TYPES
// ============================================================================

export interface UseSyncStatusOptions {
  /** Vault/workspace ID to track */
  vaultId: string;
  /** Whether hook is enabled */
  enabled?: boolean;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for tracking overall sync status for a vault
 *
 * @example
 * ```tsx
 * const { status, isSyncing, isOnline, pendingCount, retrySync } = useSyncStatus({
 *   vaultId: workspace.id,
 * });
 *
 * if (isSyncing) {
 *   return <span>Saving changes...</span>;
 * }
 * ```
 */
export function useSyncStatus(options: UseSyncStatusOptions): UseSyncStatusReturn {
  const { vaultId, enabled = true } = options;
  const { manager, isConnected } = useWebSocketContext();

  // State
  const [status, setStatus] = useState<SyncStatus>('synced');
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  // Computed values
  const resolvedStatus: SyncStatus = !isConnected
    ? 'offline'
    : status === 'offline'
      ? pendingCount > 0 ? 'pending' : 'synced'
      : status;
  const isSyncing = resolvedStatus === 'syncing';
  const isOnline = isConnected;

  // Retry syncing failed updates
  const retrySync = useCallback(() => {
    if (!manager || !enabled) {
      return;
    }

    // Set status to syncing - actual retry will be handled by SyncManager
    // Applications should connect SyncManager.processPendingUpdates to this
    setStatus('syncing');
  }, [manager, enabled]);

  // Listen for sync events to update status
  useEffect(() => {
    if (!manager || !enabled) {
      return;
    }

    const cleanups: (() => void)[] = [];

    // Listen for SYNC_ACK - successful sync
    cleanups.push(
      manager.onMessage<SyncAckPayload>(MessageType.SYNC_ACK, (payload) => {
        // Update last sync time and decrement pending count
        setLastSyncAt(new Date(payload.timestamp));
        setPendingCount((prev) => Math.max(0, prev - 1));

        // If no more pending, set to synced
        setPendingCount((current) => {
          if (current <= 1) {
            setStatus('synced');
          }
          return Math.max(0, current - 1);
        });
      }),
    );

    // Listen for SYNC_REJECT - failed sync
    cleanups.push(
      manager.onMessage(MessageType.SYNC_REJECT, () => {
        setPendingCount((prev) => Math.max(0, prev - 1));
        setStatus('error');
      }),
    );

    // Listen for DATA_SYNC being sent - increment pending
    cleanups.push(
      manager.onMessage(MessageType.DATA_SYNC, () => {
        setPendingCount((prev) => prev + 1);
        setStatus('syncing');
      }),
    );

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [manager, enabled]);

  // Subscribe to vault sync topic
  useEffect(() => {
    if (!manager || !enabled || !vaultId) {
      return;
    }

    const topic = TOPICS.vaultSync(vaultId);
    manager.subscribe(topic);

    return () => {
      manager.unsubscribe(topic);
    };
  }, [manager, enabled, vaultId]);

  return {
    status: resolvedStatus,
    lastSyncAt,
    pendingCount,
    isSyncing,
    isOnline,
    retrySync,
  };
}
