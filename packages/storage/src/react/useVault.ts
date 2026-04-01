/**
 * Vault Operations Hook
 * Provides vault-level operations with loading and error state
 */

import { useCallback, useState } from 'react';
import type { Vault, VaultConfig, VaultCreate, VaultUpdate, VaultStats, VaultListItem } from '@goalrate-app/shared';
import type { StorageResult } from '../interface';
import { useStorageContext } from './StorageProvider';

// ============================================================================
// TYPES
// ============================================================================

export interface UseVaultReturn {
  /** Current vault (if open) */
  vault: Vault | null;
  /** List of available vaults */
  vaults: VaultListItem[];
  /** Whether a vault operation is in progress */
  loading: boolean;
  /** Error message from last operation */
  error: string | null;
  /** Open a vault by identifier */
  openVault: (identifier: string) => Promise<boolean>;
  /** Close the current vault */
  closeVault: () => Promise<void>;
  /** Create a new vault */
  createVault: (data: VaultCreate) => Promise<StorageResult<VaultConfig>>;
  /** Update vault metadata */
  updateVault: (id: string, data: VaultUpdate) => Promise<StorageResult<VaultConfig>>;
  /** Delete a vault */
  deleteVault: (id: string) => Promise<StorageResult<void>>;
  /** Get vault statistics */
  getVaultStats: (vaultId: string) => Promise<StorageResult<VaultStats>>;
  /** Refresh the vault list */
  refreshVaults: () => Promise<void>;
  /** Clear error state */
  clearError: () => void;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for vault operations
 * Provides CRUD operations and state management for vaults
 */
export function useVault(): UseVaultReturn {
  const context = useStorageContext();
  const [operationLoading, setOperationLoading] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

  const createVault = useCallback(
    async (data: VaultCreate): Promise<StorageResult<VaultConfig>> => {
      setOperationLoading(true);
      setOperationError(null);

      const result = await context.adapter.createVault(data);

      if (!result.success) {
        setOperationError(result.error?.message || 'Failed to create vault');
      } else {
        // Refresh vault list after creation
        await context.refreshVaults();
      }

      setOperationLoading(false);
      return result;
    },
    [context]
  );

  const updateVault = useCallback(
    async (id: string, data: VaultUpdate): Promise<StorageResult<VaultConfig>> => {
      setOperationLoading(true);
      setOperationError(null);

      const result = await context.adapter.updateVault(id, data);

      if (!result.success) {
        setOperationError(result.error?.message || 'Failed to update vault');
      } else {
        // Refresh vault list after update
        await context.refreshVaults();
      }

      setOperationLoading(false);
      return result;
    },
    [context]
  );

  const deleteVault = useCallback(
    async (id: string): Promise<StorageResult<void>> => {
      setOperationLoading(true);
      setOperationError(null);

      const result = await context.adapter.deleteVault(id);

      if (!result.success) {
        setOperationError(result.error?.message || 'Failed to delete vault');
      } else {
        // Refresh vault list after deletion
        await context.refreshVaults();
      }

      setOperationLoading(false);
      return result;
    },
    [context]
  );

  const getVaultStats = useCallback(
    async (vaultId: string): Promise<StorageResult<VaultStats>> => {
      return context.adapter.getVaultStats(vaultId);
    },
    [context.adapter]
  );

  const openVault = useCallback(
    async (identifier: string): Promise<boolean> => {
      await context.openVault(identifier);
      return context.currentVault !== null;
    },
    [context]
  );

  const clearError = useCallback(() => {
    setOperationError(null);
    context.clearError();
  }, [context]);

  return {
    vault: context.currentVault,
    vaults: context.vaults,
    loading: context.loading || operationLoading,
    error: operationError || context.error,
    openVault,
    closeVault: context.closeVault,
    createVault,
    updateVault,
    deleteVault,
    getVaultStats,
    refreshVaults: context.refreshVaults,
    clearError,
  };
}
