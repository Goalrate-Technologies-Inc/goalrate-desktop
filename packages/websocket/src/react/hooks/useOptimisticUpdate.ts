/**
 * useOptimisticUpdate Hook
 * Manages optimistic updates with server sync and conflict handling
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  SyncStatus,
  SyncAckPayload,
  SyncRejectPayload,
  EntityChangedPayload,
} from '@goalrate-app/shared';
import { MessageType, TOPICS } from '@goalrate-app/shared';
import type { UseOptimisticUpdateReturn, SyncConflict } from '../../sync/types';
import { useWebSocketContext } from '../WebSocketContext';

// ============================================================================
// TYPES
// ============================================================================

export interface UseOptimisticUpdateOptions<T> {
  /** Type of entity (project, goal, story, etc.) */
  entityType: string;
  /** ID of the entity */
  entityId: string;
  /** Vault/workspace ID */
  vaultId: string;
  /** Initial data from server */
  initialData: T | null;
  /** Initial version from server */
  initialVersion: number;
  /** Callback when sync error occurs */
  onSyncError?: (error: { reason: string; message: string; serverData?: Record<string, unknown> }) => void;
  /** Callback when remote change is received */
  onRemoteChange?: (changes: Record<string, unknown>, newVersion: number, updatedBy: string) => void;
  /** Callback when conflict is detected */
  onConflict?: (conflict: SyncConflict) => void;
  /** Whether hook is enabled (for conditional sync) */
  enabled?: boolean;
  /** Enable automatic LWW conflict resolution (default: true) */
  autoResolveLWW?: boolean;
  /** Callback when conflict is auto-resolved via LWW */
  onLWWResolved?: (resolution: 'local' | 'server', conflict: SyncConflict) => void;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for managing optimistic updates with server synchronization
 *
 * @example
 * ```tsx
 * const { data, applyUpdate, syncStatus, isDirty } = useOptimisticUpdate({
 *   entityType: 'project',
 *   entityId: project.id,
 *   vaultId: workspace.id,
 *   initialData: project,
 *   initialVersion: project.version,
 * });
 *
 * // Apply optimistic update
 * await applyUpdate({ title: 'New Title' });
 * ```
 */
export function useOptimisticUpdate<T extends Record<string, unknown>>(
  options: UseOptimisticUpdateOptions<T>,
): UseOptimisticUpdateReturn<T> {
  const {
    entityType,
    entityId,
    vaultId,
    initialData,
    initialVersion,
    onSyncError,
    onRemoteChange,
    onConflict,
    enabled = true,
    autoResolveLWW = true, // LWW enabled by default
    onLWWResolved,
  } = options;

  const { manager, isConnected } = useWebSocketContext();

  // State
  const [serverData, setServerData] = useState<T | null>(initialData);
  const [pendingChanges, setPendingChanges] = useState<Partial<T> | null>(null);
  const [version, setVersion] = useState(initialVersion);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isInitialNewer = initialVersion > version;
  const resolvedServerData = pendingChanges
    ? serverData
    : isInitialNewer
      ? initialData
      : serverData ?? initialData;
  const resolvedVersion = pendingChanges
    ? version
    : isInitialNewer
      ? initialVersion
      : version;
  const resolvedSyncStatus: SyncStatus = !isConnected
    ? 'offline'
    : syncStatus === 'offline'
      ? pendingChanges ? 'pending' : 'synced'
      : syncStatus;

  // Track pending request IDs (including clientTimestamp for LWW)
  const pendingRequestsRef = useRef<Map<string, { changes: Partial<T>; previousData: T | null; clientTimestamp: string }>>(
    new Map(),
  );

  // Compute optimistic data (server data merged with pending changes)
  const data = pendingChanges && resolvedServerData
    ? { ...resolvedServerData, ...pendingChanges }
    : resolvedServerData;

  // Generate unique request ID
  const generateRequestId = useCallback(() => {
    return `${entityType}-${entityId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }, [entityType, entityId]);

  // Apply optimistic update
  const applyUpdate = useCallback(
    async (changes: Partial<T>): Promise<boolean> => {
      if (!manager || !enabled) {
        return false;
      }

      const requestId = generateRequestId();
      if (isInitialNewer && !pendingChanges) {
        setServerData(initialData);
        setVersion(initialVersion);
      }

      const previousData = resolvedServerData;
      const clientTimestamp = new Date().toISOString(); // LWW timestamp

      // Store pending request for rollback (include clientTimestamp for LWW)
      pendingRequestsRef.current.set(requestId, { changes, previousData, clientTimestamp });

      // Apply changes optimistically
      setPendingChanges((prev) => ({ ...prev, ...changes }));
      setSyncStatus('syncing');
      setError(null);

      // Send to server with clientTimestamp for LWW
      manager.send(MessageType.DATA_SYNC, {
        requestId,
        entityType,
        entityId,
        vaultId,
        changes,
        baseVersion: resolvedVersion,
        timestamp: clientTimestamp,
        clientTimestamp, // LWW timestamp
      });

      return true;
    },
    [
      manager,
      enabled,
      entityType,
      entityId,
      vaultId,
      initialData,
      initialVersion,
      isInitialNewer,
      pendingChanges,
      resolvedServerData,
      resolvedVersion,
      generateRequestId,
    ],
  );

  // Rollback pending changes
  const rollback = useCallback(() => {
    setPendingChanges(null);
    setSyncStatus('synced');
    setError(null);
    pendingRequestsRef.current.clear();
  }, []);

  // Handle SYNC_ACK
  useEffect(() => {
    if (!manager || !enabled) {
      return;
    }

    const cleanup = manager.onMessage<SyncAckPayload>(MessageType.SYNC_ACK, (payload) => {
      // Check if this ACK is for our entity
      if (payload.entityType !== entityType || payload.entityId !== entityId) {
        return;
      }

      const pendingRequest = pendingRequestsRef.current.get(payload.requestId);
      if (pendingRequest) {
        // Update server data with confirmed changes
        setServerData((prev) => (prev ? { ...prev, ...pendingRequest.changes } : null));
        setVersion(payload.newVersion);
        setPendingChanges(null);
        setSyncStatus('synced');
        setLastSyncAt(new Date());
        setError(null);
        pendingRequestsRef.current.delete(payload.requestId);
      }
    });

    return cleanup;
  }, [manager, enabled, entityType, entityId]);

  // Handle SYNC_REJECT
  useEffect(() => {
    if (!manager || !enabled) {
      return;
    }

    const cleanup = manager.onMessage<SyncRejectPayload>(MessageType.SYNC_REJECT, (payload) => {
      // Check if this REJECT is for our entity
      if (payload.entityType !== entityType || payload.entityId !== entityId) {
        return;
      }

      const pendingRequest = pendingRequestsRef.current.get(payload.requestId);
      if (pendingRequest) {
        // Handle conflict
        if (payload.reason === 'conflict' && payload.currentData && payload.currentVersion) {
          // Create conflict for resolution (with LWW fields)
          const conflict: SyncConflict = {
            id: payload.requestId,
            entityType,
            entityId,
            vaultId,
            localChanges: pendingRequest.changes as Record<string, unknown>,
            localVersion: resolvedVersion,
            serverData: payload.currentData,
            serverVersion: payload.currentVersion,
            conflictingFields: Object.keys(pendingRequest.changes).filter(
              (key) => pendingRequest.changes[key as keyof Partial<T>] !== payload.currentData?.[key],
            ),
            detectedAt: new Date(),
            // LWW fields
            localTimestamp: pendingRequest.clientTimestamp,
            serverTimestamp: payload.serverTimestamp,
            autoResolvable: !!payload.lwwResolution,
            autoResolution: payload.lwwResolution,
          };

          // Check if we can auto-resolve via LWW
          if (autoResolveLWW && conflict.autoResolvable && conflict.autoResolution) {
            if (conflict.autoResolution === 'server') {
              // Server wins - accept server data
              setServerData(payload.currentData as T);
              setVersion(payload.currentVersion);
              setPendingChanges(null);
              setSyncStatus('synced');
              setLastSyncAt(new Date());
              setError(null);
              pendingRequestsRef.current.delete(payload.requestId);

              // Notify about auto-resolution
              onLWWResolved?.('server', conflict);
              return; // Don't show as error
            }
            // Note: 'local' wins case is handled by backend automatically accepting the update
          }

          // Manual resolution needed - update to server version and notify
          setServerData(payload.currentData as T);
          setVersion(payload.currentVersion);
          onConflict?.(conflict);
        }

        // Rollback pending changes
        setPendingChanges(null);
        setSyncStatus('error');
        setError(payload.message);
        pendingRequestsRef.current.delete(payload.requestId);

        onSyncError?.({
          reason: payload.reason,
          message: payload.message,
          serverData: payload.currentData,
        });
      }
    });

    return cleanup;
  }, [
    manager,
    enabled,
    entityType,
    entityId,
    vaultId,
    resolvedVersion,
    onConflict,
    onSyncError,
    autoResolveLWW,
    onLWWResolved,
  ]);

  // Handle ENTITY_CHANGED (remote changes from other clients)
  useEffect(() => {
    if (!manager || !enabled) {
      return;
    }

    const cleanup = manager.onMessage<EntityChangedPayload>(MessageType.ENTITY_CHANGED, (payload) => {
      // Check if this change is for our entity
      if (payload.entityType !== entityType || payload.entityId !== entityId) {
        return;
      }

      // Don't process if we have pending changes (could cause conflict)
      if (pendingChanges) {
        // Mark as having a potential conflict
        setSyncStatus('pending');
        return;
      }

      // Apply remote changes
      setServerData((prev) => (prev ? { ...prev, ...payload.changes } : null));
      setVersion(payload.newVersion);
      setLastSyncAt(new Date());

      onRemoteChange?.(payload.changes, payload.newVersion, payload.updatedBy);
    });

    return cleanup;
  }, [manager, enabled, entityType, entityId, pendingChanges, onRemoteChange]);

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
    data,
    applyUpdate,
    rollback,
    syncStatus: resolvedSyncStatus,
    isDirty: pendingChanges !== null,
    lastSyncAt,
    error,
    version: resolvedVersion,
  };
}
