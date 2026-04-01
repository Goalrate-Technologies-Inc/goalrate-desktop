/**
 * Storage Provider
 * React context provider for storage adapter dependency injection
 */

import React, { createContext, useContext, useMemo, useEffect, useState, useCallback } from 'react';
import type { StorageAdapter } from '../interface';
import type { Vault, VaultListItem } from '@goalrate-app/shared';

// ============================================================================
// CONTEXT TYPES
// ============================================================================

/**
 * Storage state managed by the provider
 */
export interface StorageState {
  /** Whether the adapter has been initialized */
  initialized: boolean;
  /** The currently open vault */
  currentVault: Vault | null;
  /** List of available vaults */
  vaults: VaultListItem[];
  /** Whether a storage operation is in progress */
  loading: boolean;
  /** Error message if an operation failed */
  error: string | null;
}

/**
 * Full context value including state and actions
 */
export interface StorageContextValue extends StorageState {
  /** The storage adapter instance */
  adapter: StorageAdapter;
  /** Open a vault by identifier */
  openVault: (identifier: string) => Promise<void>;
  /** Close the current vault */
  closeVault: () => Promise<void>;
  /** Refresh the vault list */
  refreshVaults: () => Promise<void>;
  /** Clear any error state */
  clearError: () => void;
}

// ============================================================================
// CONTEXT
// ============================================================================

const StorageContext = createContext<StorageContextValue | null>(null);

// ============================================================================
// PROVIDER PROPS
// ============================================================================

export interface StorageProviderProps {
  /** The storage adapter to use */
  adapter: StorageAdapter;
  /** Children to render */
  children: React.ReactNode;
  /**
   * Auto-initialize adapter on mount
   * @default true
   */
  autoInitialize?: boolean;
  /**
   * Auto-open vault by ID on initialization
   */
  autoOpenVaultId?: string;
  /**
   * Callback when initialization completes
   */
  onInitialized?: () => void;
  /**
   * Callback when error occurs
   */
  onError?: (error: string) => void;
}

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

/**
 * Storage Provider component
 * Provides storage adapter and vault state to the component tree
 */
export function StorageProvider({
  adapter,
  children,
  autoInitialize = true,
  autoOpenVaultId,
  onInitialized,
  onError,
}: StorageProviderProps): React.ReactElement {
  const [state, setState] = useState<StorageState>({
    initialized: false,
    currentVault: null,
    vaults: [],
    loading: true,
    error: null,
  });

  // Initialize adapter
  useEffect(() => {
    if (!autoInitialize) {
      setState((prev) => ({ ...prev, loading: false }));
      return;
    }

    let mounted = true;

    async function initialize(): Promise<void> {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      const initResult = await adapter.initialize();

      if (!mounted) {return;}

      if (!initResult.success) {
        const errorMsg = initResult.error?.message || 'Failed to initialize storage';
        setState((prev) => ({ ...prev, loading: false, error: errorMsg }));
        onError?.(errorMsg);
        return;
      }

      // Load vault list
      const vaultsResult = await adapter.listVaults();

      if (!mounted) {return;}

      if (!vaultsResult.success) {
        const errorMsg = vaultsResult.error?.message || 'Failed to load vaults';
        setState((prev) => ({
          ...prev,
          initialized: true,
          loading: false,
          error: errorMsg,
        }));
        onError?.(errorMsg);
        return;
      }

      const vaults = vaultsResult.data || [];

      // Auto-open vault if specified
      let currentVault: Vault | null = null;
      if (autoOpenVaultId && vaults.some((v) => v.id === autoOpenVaultId)) {
        const openResult = await adapter.openVault(autoOpenVaultId);
        if (openResult.success && openResult.data) {
          currentVault = openResult.data;
        }
      }

      setState({
        initialized: true,
        currentVault,
        vaults,
        loading: false,
        error: null,
      });

      onInitialized?.();
    }

    initialize();

    return () => {
      mounted = false;
    };
  }, [adapter, autoInitialize, autoOpenVaultId, onInitialized, onError]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      adapter.dispose();
    };
  }, [adapter]);

  // Open vault
  const openVault = useCallback(
    async (identifier: string): Promise<void> => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      const result = await adapter.openVault(identifier);

      if (!result.success) {
        const errorMsg = result.error?.message || 'Failed to open vault';
        setState((prev) => ({ ...prev, loading: false, error: errorMsg }));
        onError?.(errorMsg);
        return;
      }

      setState((prev) => ({
        ...prev,
        currentVault: result.data || null,
        loading: false,
        error: null,
      }));
    },
    [adapter, onError]
  );

  // Close vault
  const closeVault = useCallback(async (): Promise<void> => {
    if (!state.currentVault) {
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));

    await adapter.closeVault(state.currentVault.id);

    setState((prev) => ({
      ...prev,
      currentVault: null,
      loading: false,
    }));
  }, [adapter, state.currentVault]);

  // Refresh vault list
  const refreshVaults = useCallback(async (): Promise<void> => {
    const result = await adapter.listVaults();

    if (result.success) {
      setState((prev) => ({
        ...prev,
        vaults: result.data || [],
      }));
    }
  }, [adapter]);

  // Clear error
  const clearError = useCallback((): void => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  // Memoize context value
  const value = useMemo<StorageContextValue>(
    () => ({
      ...state,
      adapter,
      openVault,
      closeVault,
      refreshVaults,
      clearError,
    }),
    [state, adapter, openVault, closeVault, refreshVaults, clearError]
  );

  return <StorageContext.Provider value={value}>{children}</StorageContext.Provider>;
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Access the storage adapter directly
 * @throws Error if used outside StorageProvider
 */
export function useStorage(): StorageAdapter {
  const context = useContext(StorageContext);
  if (!context) {
    throw new Error('useStorage must be used within a StorageProvider');
  }
  return context.adapter;
}

/**
 * Access the full storage context including state
 * @throws Error if used outside StorageProvider
 */
export function useStorageContext(): StorageContextValue {
  const context = useContext(StorageContext);
  if (!context) {
    throw new Error('useStorageContext must be used within a StorageProvider');
  }
  return context;
}

/**
 * Check if storage is initialized and ready
 */
export function useStorageReady(): boolean {
  const context = useContext(StorageContext);
  return context?.initialized ?? false;
}

/**
 * Get the current vault (if any)
 */
export function useCurrentVault(): Vault | null {
  const context = useContext(StorageContext);
  return context?.currentVault ?? null;
}
