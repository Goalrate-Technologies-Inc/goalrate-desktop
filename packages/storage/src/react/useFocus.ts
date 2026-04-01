/**
 * Focus Operations Hook
 * Provides operations for focus day management
 */

import { useCallback, useState, useEffect } from 'react';
import type { FocusDay, FocusCandidate, FocusVelocity } from '@goalrate-app/shared';
import type { StorageResult } from '../interface';
import { useStorageContext, useCurrentVault } from './StorageProvider';

// ============================================================================
// TYPES
// ============================================================================

export interface UseFocusReturn {
  /** Current focus day */
  focusDay: FocusDay | null;
  /** Focus candidates for selection */
  candidates: FocusCandidate[];
  /** Velocity metrics */
  velocity: FocusVelocity | null;
  /** Whether loading */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Fetch focus day for a date */
  fetchFocusDay: (date: string) => Promise<void>;
  /** Save focus day */
  saveFocusDay: (focusDay: FocusDay) => Promise<StorageResult<FocusDay>>;
  /** Complete a focus item */
  completeItem: (date: string, itemId: string) => Promise<StorageResult<FocusDay>>;
  /** Defer a focus item to another date */
  deferItem: (date: string, itemId: string, targetDate: string) => Promise<StorageResult<FocusDay>>;
  /** Gather focus candidates */
  gatherCandidates: (date: string) => Promise<void>;
  /** Fetch velocity metrics */
  fetchVelocity: () => Promise<void>;
  /** Clear error */
  clearError: () => void;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for focus day operations
 */
export function useFocus(date?: string): UseFocusReturn {
  const context = useStorageContext();
  const vault = useCurrentVault();
  const [focusDay, setFocusDay] = useState<FocusDay | null>(null);
  const [candidates, setCandidates] = useState<FocusCandidate[]>([]);
  const [velocity, setVelocity] = useState<FocusVelocity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFocusDay = useCallback(
    async (d: string) => {
      if (!vault) {
        setFocusDay(null);
        return;
      }

      setLoading(true);
      setError(null);

      const result = await context.adapter.getFocusDay(vault.id, d);

      if (result.success) {
        setFocusDay(result.data || null);
      } else {
        // If not found, that's okay - return null
        if (result.error?.code === 'ITEM_NOT_FOUND') {
          setFocusDay(null);
        } else {
          setError(result.error?.message || 'Failed to fetch focus day');
        }
      }

      setLoading(false);
    },
    [context.adapter, vault]
  );

  // Auto-fetch when date changes
  useEffect(() => {
    if (date && vault && context.initialized) {
      fetchFocusDay(date);
    }
  }, [date, vault?.id, context.initialized, fetchFocusDay]);

  const saveFocusDay = useCallback(
    async (fd: FocusDay): Promise<StorageResult<FocusDay>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.saveFocusDay(vault.id, fd);

      if (result.success && result.data) {
        setFocusDay(result.data);
      }

      return result;
    },
    [context.adapter, vault]
  );

  const completeItem = useCallback(
    async (d: string, itemId: string): Promise<StorageResult<FocusDay>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.completeFocusItem(vault.id, d, itemId);

      if (result.success && result.data) {
        setFocusDay(result.data);
      }

      return result;
    },
    [context.adapter, vault]
  );

  const deferItem = useCallback(
    async (d: string, itemId: string, targetDate: string): Promise<StorageResult<FocusDay>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.deferFocusItem(vault.id, d, itemId, targetDate);

      if (result.success && result.data) {
        setFocusDay(result.data);
      }

      return result;
    },
    [context.adapter, vault]
  );

  const gatherCandidates = useCallback(
    async (_d: string) => {
      if (!vault) {
        setCandidates([]);
        return;
      }

      setLoading(true);
      setError(null);

      const result = await context.adapter.gatherFocusCandidates(vault.id);

      if (result.success) {
        setCandidates(result.data || []);
      } else {
        setError(result.error?.message || 'Failed to gather candidates');
      }

      setLoading(false);
    },
    [context.adapter, vault]
  );

  const fetchVelocity = useCallback(async () => {
    if (!vault) {
      setVelocity(null);
      return;
    }

    const result = await context.adapter.getFocusVelocity(vault.id);

    if (result.success) {
      setVelocity(result.data || null);
    }
  }, [context.adapter, vault]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    focusDay,
    candidates,
    velocity,
    loading,
    error,
    fetchFocusDay,
    saveFocusDay,
    completeItem,
    deferItem,
    gatherCandidates,
    fetchVelocity,
    clearError,
  };
}

/**
 * Get today's date in YYYY-MM-DD format
 */
export function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Hook for today's focus
 * Convenience wrapper around useFocus with today's date
 */
export function useTodayFocus(): UseFocusReturn {
  return useFocus(getTodayDate());
}
