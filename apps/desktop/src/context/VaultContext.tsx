/* eslint-disable react-refresh/only-export-components */
/**
 * Vault Context for Desktop App
 *
 * Manages the currently open vault state and vault operations.
 */

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';

// =============================================================================
// Types
// =============================================================================

const COLUMN_CONFIG_STORAGE_KEY = 'goalrate.board.columns.v1';

export interface VaultConfig {
  id: string;
  name: string;
  path: string;
  vaultType: string;
  created: string;
  lastOpened?: string;
}

export interface VaultListItem {
  id: string;
  name: string;
  path: string;
  vaultType: string;
  lastOpened?: string;
}

export interface VaultStats {
  goalCount: number;
  projectCount: number;
  totalTasks: number;
  completedTasks: number;
}

interface VaultContextValue {
  /** Currently open vault */
  currentVault: VaultConfig | null;
  /** List of known vaults from registry */
  vaults: VaultListItem[];
  /** Whether vault operations are in progress */
  isLoading: boolean;
  /** Error from last operation */
  error: string | null;
  /** Create a new vault */
  createVault: (name: string, path?: string, vaultType?: string) => Promise<VaultConfig>;
  /** Open an existing vault */
  openVault: (path: string) => Promise<VaultConfig>;
  /** Close the current vault */
  closeVault: () => Promise<void>;
  /** Delete a vault from registry (doesn't delete files) */
  deleteVault: (vaultId: string) => Promise<void>;
  /** Rename a vault and update its path */
  renameVault: (vaultId: string, newPath: string) => Promise<VaultConfig>;
  /** Move a vault and update its path */
  moveVault: (vaultId: string, newPath: string) => Promise<VaultConfig>;
  /** Refresh the vault list */
  refreshVaults: () => Promise<void>;
  /** Get stats for current vault */
  getVaultStats: () => Promise<VaultStats | null>;
  /** Clear the current error */
  clearError: () => void;
}

// =============================================================================
// Context
// =============================================================================

const VaultContext = createContext<VaultContextValue | null>(null);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract error message from Tauri error response
 */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'object' && err !== null) {
    // Tauri errors come as objects with code and message
    const tauriError = err as { code?: string; message?: string };
    if (tauriError.message) {
      return tauriError.message;
    }
    // Try to stringify
    try {
      return JSON.stringify(err);
    } catch {
      return 'Unknown error';
    }
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'Unknown error';
}

function initializeEmptyBoardColumns(vaultId: string): void {
  if (typeof window === 'undefined' || !vaultId) {
    return;
  }
  try {
    const storage = (window as { localStorage?: Partial<Storage> }).localStorage;
    if (!storage || typeof storage.setItem !== 'function') {
      return;
    }
    storage.setItem(`${COLUMN_CONFIG_STORAGE_KEY}.${vaultId}`, JSON.stringify([]));
  } catch (err) {
    console.error('Failed to initialize board columns for vault:', err);
  }
}

// =============================================================================
// Provider
// =============================================================================

interface VaultProviderProps {
  children: ReactNode;
}

export function VaultProvider({ children }: VaultProviderProps): React.ReactElement {
  const [currentVault, setCurrentVault] = useState<VaultConfig | null>(null);
  const [vaults, setVaults] = useState<VaultListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Refresh the list of known vaults
   */
  const refreshVaults = useCallback(async (): Promise<void> => {
    try {
      const list = await invoke<VaultListItem[]>('list_vaults');
      setVaults(list);
    } catch (err) {
      console.error('Failed to list vaults:', err);
      // Don't set error for background refresh
    }
  }, []);

  /**
   * Load vault list on mount and auto-open the last used vault
   */
  useEffect(() => {
    let cancelled = false;
    async function init(): Promise<void> {
      try {
        const list = await invoke<VaultListItem[]>('list_vaults');
        if (cancelled) {return;}
        setVaults(list);

        // Auto-open the most recently opened vault
        if (list.length > 0 && !currentVault) {
          const sorted = [...list].sort((a, b) => {
            if (!a.lastOpened) {return 1;}
            if (!b.lastOpened) {return -1;}
            return b.lastOpened.localeCompare(a.lastOpened);
          });
          const lastUsed = sorted[0];
          if (lastUsed.lastOpened) {
            try {
              const config = await invoke<VaultConfig>('open_vault', { path: lastUsed.path });
              if (!cancelled) {
                setCurrentVault(config);
              }
            } catch (err) {
              console.warn('Failed to auto-open last vault:', err);
            }
          }
        }
      } catch (err) {
        console.error('Failed to list vaults:', err);
      }
    }
    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Create a new vault
   */
  const createVault = useCallback(async (
    name: string,
    path?: string,
    vaultType: string = 'private'
  ): Promise<VaultConfig> => {
    setIsLoading(true);
    setError(null);

    try {
      const data: Record<string, string> = { name, vaultType };
      if (path) {data.path = path;}
      const config = await invoke<VaultConfig>('create_vault', { data });
      initializeEmptyBoardColumns(config.id);
      setCurrentVault(config);
      await refreshVaults();
      return config;
    } catch (err) {
      const message = extractErrorMessage(err);
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, [refreshVaults]);

  /**
   * Open an existing vault
   */
  const openVault = useCallback(async (path: string): Promise<VaultConfig> => {
    setIsLoading(true);
    setError(null);

    try {
      const config = await invoke<VaultConfig>('open_vault', { path });
      setCurrentVault(config);
      await refreshVaults();
      return config;
    } catch (err) {
      const message = extractErrorMessage(err);
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, [refreshVaults]);

  /**
   * Close the current vault
   */
  const closeVault = useCallback(async (): Promise<void> => {
    if (!currentVault) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await invoke('close_vault', { vaultId: currentVault.id });
      setCurrentVault(null);
    } catch (err) {
      const message = extractErrorMessage(err);
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, [currentVault]);

  /**
   * Delete a vault from registry
   */
  const deleteVault = useCallback(async (vaultId: string): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      await invoke('delete_vault', { vaultId });
      if (currentVault?.id === vaultId) {
        setCurrentVault(null);
      }
      await refreshVaults();
    } catch (err) {
      const message = extractErrorMessage(err);
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, [currentVault, refreshVaults]);

  /**
   * Rename a vault
   */
  const renameVault = useCallback(async (
    vaultId: string,
    newPath: string
  ): Promise<VaultConfig> => {
    setIsLoading(true);
    setError(null);

    try {
      const config = await invoke<VaultConfig>('rename_vault', { vaultId, newPath });
      if (currentVault?.id === vaultId) {
        setCurrentVault(config);
      }
      await refreshVaults();
      return config;
    } catch (err) {
      const message = extractErrorMessage(err);
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, [currentVault, refreshVaults]);

  /**
   * Move a vault
   */
  const moveVault = useCallback(async (
    vaultId: string,
    newPath: string
  ): Promise<VaultConfig> => {
    setIsLoading(true);
    setError(null);

    try {
      const config = await invoke<VaultConfig>('move_vault', { vaultId, newPath });
      if (currentVault?.id === vaultId) {
        setCurrentVault(config);
      }
      await refreshVaults();
      return config;
    } catch (err) {
      const message = extractErrorMessage(err);
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  }, [currentVault, refreshVaults]);

  /**
   * Get stats for current vault
   */
  const getVaultStats = useCallback(async (): Promise<VaultStats | null> => {
    if (!currentVault) {
      return null;
    }

    try {
      return await invoke<VaultStats>('get_vault_stats', { vaultId: currentVault.id });
    } catch (err) {
      console.error('Failed to get vault stats:', err);
      return null;
    }
  }, [currentVault]);

  /**
   * Clear the current error
   */
  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  const value: VaultContextValue = {
    currentVault,
    vaults,
    isLoading,
    error,
    createVault,
    openVault,
    closeVault,
    deleteVault,
    renameVault,
    moveVault,
    refreshVaults,
    getVaultStats,
    clearError,
  };

  return (
    <VaultContext.Provider value={value}>
      {children}
    </VaultContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to access vault context
 */
export function useVault(): VaultContextValue {
  const context = useContext(VaultContext);
  if (!context) {
    throw new Error('useVault must be used within a VaultProvider');
  }
  return context;
}
