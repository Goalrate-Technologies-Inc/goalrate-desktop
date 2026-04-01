/**
 * useRemoteChanges Hook
 * Tracks changes made by other users to a specific entity
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { EntityChangedPayload } from '@goalrate-app/shared';
import { MessageType, TOPICS } from '@goalrate-app/shared';
import { useWebSocketContext } from '../WebSocketContext';

// ============================================================================
// TYPES
// ============================================================================

export interface UseRemoteChangesOptions {
  /** Type of entity to track */
  entityType: string;
  /** ID of the entity */
  entityId: string;
  /** Vault/workspace ID */
  vaultId: string;
  /** Maximum number of changes to keep in history */
  maxHistory?: number;
  /** Whether hook is enabled */
  enabled?: boolean;
  /** Callback when a remote change is received */
  onRemoteChange?: (change: EntityChangedPayload) => void;
}

export interface UseRemoteChangesReturn<T = Record<string, unknown>> {
  /** List of remote changes received (newest first) */
  remoteChanges: EntityChangedPayload[];
  /** Most recent change */
  lastChange: EntityChangedPayload | null;
  /** User ID of the person who made the last change */
  updatedBy: string | null;
  /** Timestamp of the last change */
  lastUpdatedAt: Date | null;
  /** Clear all tracked changes */
  clearChanges: () => void;
  /** Whether there are any remote changes */
  hasChanges: boolean;
  /** Number of remote changes */
  changeCount: number;
  /** Apply changes to data object */
  applyChangesToData: (data: T) => T;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for tracking remote changes made by other users
 *
 * This hook subscribes to the vault sync topic and filters for changes
 * to a specific entity. It's useful for:
 * - Showing "X is editing" indicators
 * - Displaying real-time updates from other users
 * - Detecting when to refresh data
 *
 * @example
 * ```tsx
 * const { lastChange, updatedBy, hasChanges } = useRemoteChanges({
 *   entityType: 'project',
 *   entityId: project.id,
 *   vaultId: workspace.id,
 *   onRemoteChange: (change) => {
 *     // Optionally react to changes
 *     toast.info(`${change.updatedBy} updated this project`);
 *   },
 * });
 *
 * // Show indicator when someone else is editing
 * {hasChanges && (
 *   <span className="text-sm text-gray-500">
 *     Recently updated by {updatedBy}
 *   </span>
 * )}
 * ```
 */
export function useRemoteChanges<T extends Record<string, unknown> = Record<string, unknown>>(
  options: UseRemoteChangesOptions,
): UseRemoteChangesReturn<T> {
  const {
    entityType,
    entityId,
    vaultId,
    maxHistory = 20,
    enabled = true,
    onRemoteChange,
  } = options;

  const { manager } = useWebSocketContext();

  // State
  const [remoteChanges, setRemoteChanges] = useState<EntityChangedPayload[]>([]);

  // Computed values
  const lastChange = remoteChanges.length > 0 ? remoteChanges[0] : null;
  const updatedBy = lastChange?.updatedBy ?? null;
  const lastUpdatedAt = lastChange ? new Date(lastChange.timestamp) : null;
  const hasChanges = remoteChanges.length > 0;
  const changeCount = remoteChanges.length;

  /**
   * Clear all tracked changes
   */
  const clearChanges = useCallback(() => {
    setRemoteChanges([]);
  }, []);

  /**
   * Apply accumulated changes to a data object
   * Useful for merging remote changes with local data
   */
  const applyChangesToData = useCallback(
    (data: T): T => {
      if (remoteChanges.length === 0) {
        return data;
      }

      // Apply changes in order (oldest to newest)
      let result = { ...data };
      const changesOldestFirst = [...remoteChanges].reverse();

      for (const change of changesOldestFirst) {
        result = { ...result, ...change.changes } as T;
      }

      return result;
    },
    [remoteChanges],
  );

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

  // Listen for ENTITY_CHANGED messages
  useEffect(() => {
    if (!manager || !enabled) {
      return;
    }

    const cleanup = manager.onMessage<EntityChangedPayload>(
      MessageType.ENTITY_CHANGED,
      (payload) => {
        // Filter for our specific entity
        if (payload.entityType !== entityType || payload.entityId !== entityId) {
          return;
        }

        // Filter for our vault
        if (payload.vaultId !== vaultId) {
          return;
        }

        // Add to changes list (newest first)
        setRemoteChanges((prev) => {
          const newChanges = [payload, ...prev];
          // Trim to max size
          if (newChanges.length > maxHistory) {
            return newChanges.slice(0, maxHistory);
          }
          return newChanges;
        });

        // Call callback
        onRemoteChange?.(payload);
      },
    );

    return cleanup;
  }, [manager, enabled, entityType, entityId, vaultId, maxHistory, onRemoteChange]);

  // Get the latest version from changes
  const latestVersion = useMemo(() => {
    if (remoteChanges.length === 0) {
      return null;
    }
    return Math.max(...remoteChanges.map((c) => c.newVersion));
  }, [remoteChanges]);

  return {
    remoteChanges,
    lastChange,
    updatedBy,
    lastUpdatedAt,
    clearChanges,
    hasChanges,
    changeCount,
    applyChangesToData,
    latestVersion,
  } as UseRemoteChangesReturn<T> & { latestVersion: number | null };
}
