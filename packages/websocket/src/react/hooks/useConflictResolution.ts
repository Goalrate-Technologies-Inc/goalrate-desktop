/**
 * useConflictResolution Hook
 * Manages sync conflicts with resolution strategies
 */

import { useState, useCallback, useMemo } from 'react';
import type { SyncConflict, UseConflictResolutionReturn } from '../../sync/types';

// ============================================================================
// TYPES
// ============================================================================

export interface UseConflictResolutionOptions {
  /** Maximum number of conflicts to keep in history */
  maxConflicts?: number;
  /** Callback when a conflict is added */
  onConflictAdded?: (conflict: SyncConflict) => void;
  /** Callback when a conflict is resolved */
  onConflictResolved?: (conflictId: string, resolution: 'local' | 'server' | 'merged') => void;
  /** Callback when a conflict is dismissed */
  onConflictDismissed?: (conflictId: string) => void;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for managing sync conflicts
 *
 * This hook provides a way to track and resolve conflicts that occur during
 * optimistic updates. It works in conjunction with useOptimisticUpdate's
 * onConflict callback.
 *
 * @example
 * ```tsx
 * const { conflicts, hasConflicts, resolveConflict, dismissConflict, addConflict } = useConflictResolution();
 *
 * // Connect to useOptimisticUpdate
 * const { applyUpdate } = useOptimisticUpdate({
 *   entityType: 'project',
 *   entityId: project.id,
 *   vaultId: workspace.id,
 *   initialData: project,
 *   initialVersion: project.version,
 *   onConflict: addConflict, // Add conflicts to the manager
 * });
 *
 * // Show conflict resolution UI when conflicts exist
 * if (hasConflicts) {
 *   return <ConflictResolutionDialog conflict={conflicts[0]} onResolve={...} />;
 * }
 * ```
 */
/**
 * Extended return type with additional utilities
 */
export interface UseConflictResolutionExtendedReturn extends UseConflictResolutionReturn {
  /** Add a new conflict to the list */
  addConflict: (conflict: SyncConflict) => void;
  /** Get a specific conflict by ID */
  getConflict: (conflictId: string) => SyncConflict | undefined;
  /** Get conflicts for a specific entity */
  getEntityConflicts: (entityType: string, entityId: string) => SyncConflict[];
  /** Clear all conflicts */
  clearConflicts: () => void;
  /** Get the oldest conflict (first to resolve) */
  oldestConflict: SyncConflict | null;
}

export function useConflictResolution(
  options: UseConflictResolutionOptions = {},
): UseConflictResolutionExtendedReturn {
  const {
    maxConflicts = 50,
    onConflictAdded,
    onConflictResolved,
    onConflictDismissed,
  } = options;

  // State
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);

  // Computed values
  const hasConflicts = conflicts.length > 0;
  const conflictCount = conflicts.length;

  /**
   * Add a new conflict to the list
   */
  const addConflict = useCallback(
    (conflict: SyncConflict) => {
      setConflicts((prev) => {
        // Check if conflict already exists (same entity)
        const existingIndex = prev.findIndex(
          (c) =>
            c.entityType === conflict.entityType &&
            c.entityId === conflict.entityId &&
            c.vaultId === conflict.vaultId,
        );

        let newConflicts: SyncConflict[];

        if (existingIndex >= 0) {
          // Replace existing conflict with updated one
          newConflicts = [...prev];
          newConflicts[existingIndex] = conflict;
        } else {
          // Add new conflict
          newConflicts = [...prev, conflict];
        }

        // Trim to max size (remove oldest first)
        if (newConflicts.length > maxConflicts) {
          newConflicts = newConflicts.slice(-maxConflicts);
        }

        return newConflicts;
      });

      onConflictAdded?.(conflict);
    },
    [maxConflicts, onConflictAdded],
  );

  /**
   * Resolve a conflict with the specified strategy
   *
   * @param conflictId - ID of the conflict to resolve
   * @param resolution - Strategy: 'local' (retry with local changes), 'server' (accept server version), 'merged' (use custom merged data)
   * @param mergedData - Required when resolution is 'merged'
   */
  const resolveConflict = useCallback(
    (
      conflictId: string,
      resolution: 'local' | 'server' | 'merged',
      _mergedData?: Record<string, unknown>,
    ) => {
      setConflicts((prev) => {
        const conflictIndex = prev.findIndex((c) => c.id === conflictId);
        if (conflictIndex < 0) {
          return prev;
        }

        // Remove from active conflicts (it's now resolved)
        const newConflicts = prev.filter((c) => c.id !== conflictId);

        return newConflicts;
      });

      // Call resolution callback
      onConflictResolved?.(conflictId, resolution);
    },
    [onConflictResolved],
  );

  /**
   * Dismiss a conflict without resolving it
   * This removes it from the list but doesn't trigger any sync action
   */
  const dismissConflict = useCallback(
    (conflictId: string) => {
      setConflicts((prev) => prev.filter((c) => c.id !== conflictId));
      onConflictDismissed?.(conflictId);
    },
    [onConflictDismissed],
  );

  /**
   * Get a specific conflict by ID
   */
  const getConflict = useCallback(
    (conflictId: string): SyncConflict | undefined => {
      return conflicts.find((c) => c.id === conflictId);
    },
    [conflicts],
  );

  /**
   * Get conflicts for a specific entity
   */
  const getEntityConflicts = useCallback(
    (entityType: string, entityId: string): SyncConflict[] => {
      return conflicts.filter((c) => c.entityType === entityType && c.entityId === entityId);
    },
    [conflicts],
  );

  /**
   * Clear all conflicts
   */
  const clearConflicts = useCallback(() => {
    setConflicts([]);
  }, []);

  /**
   * Get the oldest conflict (first to resolve)
   */
  const oldestConflict = useMemo(() => {
    if (conflicts.length === 0) {
      return null;
    }
    return conflicts.reduce((oldest, current) =>
      current.detectedAt < oldest.detectedAt ? current : oldest,
    );
  }, [conflicts]);

  return {
    // Core interface (matches UseConflictResolutionReturn)
    conflicts,
    hasConflicts,
    conflictCount,
    resolveConflict,
    dismissConflict,

    // Extended functionality
    addConflict,
    getConflict,
    getEntityConflicts,
    clearConflicts,
    oldestConflict,
  };
}

export type { UseConflictResolutionReturn };
