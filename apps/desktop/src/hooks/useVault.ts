import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStorage } from '@goalrate-app/storage/react';
import type { Vault, VaultListItem } from '@goalrate-app/shared';

/** Update the window title to reflect the current vault state */
async function updateWindowTitle(vaultName: string | null): Promise<void> {
  try {
    const title = vaultName ? `${vaultName} - GoalRate` : 'GoalRate';
    await invoke('set_window_title', { title });
  } catch (e) {
    // Silently ignore errors - window title is non-critical
    console.warn('Failed to update window title:', e);
  }
}

export interface UseVaultReturn {
  vault: Vault | null;
  vaults: VaultListItem[];
  loading: boolean;
  error: string | null;
  listVaults: () => Promise<void>;
  openVault: (identifier: string) => Promise<void>;
  closeVault: () => Promise<void>;
}

export function useVault(): UseVaultReturn {
  const storage = useStorage();
  const [vault, setVault] = useState<Vault | null>(null);
  const [vaults, setVaults] = useState<VaultListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listVaults = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await storage.listVaults();
      if (result.success) {
        setVaults(result.data);
      } else {
        setError(result.error?.message || 'Failed to list vaults');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [storage]);

  const openVault = useCallback(async (identifier: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await storage.openVault(identifier);
      if (result.success) {
        setVault(result.data);
        // Update window title with vault name
        await updateWindowTitle(result.data.config.name);
      } else {
        setError(result.error?.message || 'Failed to open vault');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [storage]);

  const closeVault = useCallback(async () => {
    if (!vault) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await storage.closeVault(vault.id);
      if (result.success) {
        setVault(null);
        // Reset window title
        await updateWindowTitle(null);
      } else {
        setError(result.error?.message || 'Failed to close vault');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [storage, vault]);

  return {
    vault,
    vaults,
    loading,
    error,
    listVaults,
    openVault,
    closeVault,
  };
}
