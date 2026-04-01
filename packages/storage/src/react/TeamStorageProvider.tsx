/**
 * Team Storage Provider
 * React context provider for team vault storage with encryption support
 */

import React, {
  createContext,
  useContext,
  useMemo,
  useEffect,
  useState,
  useCallback,
} from 'react';
import type { Vault, VaultListItem } from '@goalrate-app/shared';
import type { VaultLockState, QueueStats } from '../adapters/team/types';
import { TeamStorageAdapter } from '../adapters/team/TeamStorageAdapter';
import { getLockState, clearAllSessions } from '../adapters/team/keys';

// ============================================================================
// CONTEXT TYPES
// ============================================================================

/**
 * Team storage state managed by the provider
 */
export interface TeamStorageState {
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
  /** Lock state for the current vault (if it's a team vault) */
  lockState: VaultLockState;
  /** Whether the current vault is encrypted */
  isEncrypted: boolean;
}

/**
 * Full context value including state and actions
 */
export interface TeamStorageContextValue extends TeamStorageState {
  /** The storage adapter instance */
  adapter: TeamStorageAdapter;
  /** Open a vault by identifier */
  openVault: (identifier: string) => Promise<void>;
  /** Close the current vault */
  closeVault: () => Promise<void>;
  /** Refresh the vault list */
  refreshVaults: () => Promise<void>;
  /** Clear any error state */
  clearError: () => void;
  /** Unlock a team vault with a password */
  unlockVault: (password: string) => Promise<boolean>;
  /** Lock the current vault */
  lockVault: () => void;
  /** Lock all vaults (e.g., on logout) */
  lockAllVaults: () => void;
  /** Get queue statistics for the current vault */
  getQueueStats: () => QueueStats | null;
}

// ============================================================================
// CONTEXT
// ============================================================================

const TeamStorageContext = createContext<TeamStorageContextValue | null>(null);

// ============================================================================
// PROVIDER PROPS
// ============================================================================

export interface TeamStorageProviderProps {
  /** The team storage adapter to use */
  adapter: TeamStorageAdapter;
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
  /**
   * Callback when vault unlock is required
   */
  onUnlockRequired?: (vaultId: string) => void;
  /**
   * Callback when vault is unlocked
   */
  onUnlocked?: (vaultId: string) => void;
  /**
   * Callback when vault is locked
   */
  onLocked?: (vaultId: string) => void;
}

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

/**
 * Team Storage Provider component
 * Provides team storage adapter with encryption support to the component tree
 */
export function TeamStorageProvider({
  adapter,
  children,
  autoInitialize = true,
  autoOpenVaultId,
  onInitialized,
  onError,
  onUnlockRequired,
  onUnlocked,
  onLocked,
}: TeamStorageProviderProps): React.ReactElement {
  const [state, setState] = useState<TeamStorageState>({
    initialized: false,
    currentVault: null,
    vaults: [],
    loading: true,
    error: null,
    lockState: 'locked',
    isEncrypted: false,
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

      if (!mounted) {
        return;
      }

      if (!initResult.success) {
        const errorMsg = initResult.error?.message || 'Failed to initialize storage';
        setState((prev) => ({ ...prev, loading: false, error: errorMsg }));
        onError?.(errorMsg);
        return;
      }

      // Load vault list
      const vaultsResult = await adapter.listVaults();

      if (!mounted) {
        return;
      }

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
      let lockState: VaultLockState = 'locked';
      let isEncrypted = false;

      if (autoOpenVaultId && vaults.some((v) => v.id === autoOpenVaultId)) {
        const openResult = await adapter.openVault(autoOpenVaultId);
        if (openResult.success && openResult.data) {
          currentVault = openResult.data;
          isEncrypted = currentVault.encrypted ?? false;
          lockState = isEncrypted ? getLockState(autoOpenVaultId) : 'unlocked';

          // If encrypted and locked, notify
          if (isEncrypted && lockState === 'locked') {
            onUnlockRequired?.(autoOpenVaultId);
          }
        }
      }

      setState({
        initialized: true,
        currentVault,
        vaults,
        loading: false,
        error: null,
        lockState,
        isEncrypted,
      });

      onInitialized?.();
    }

    initialize();

    return () => {
      mounted = false;
    };
  }, [adapter, autoInitialize, autoOpenVaultId, onInitialized, onError, onUnlockRequired]);

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

      const vault = result.data;
      const isEncrypted = vault?.encrypted ?? false;
      const lockState = isEncrypted ? getLockState(identifier) : 'unlocked';

      setState((prev) => ({
        ...prev,
        currentVault: vault || null,
        loading: false,
        error: null,
        lockState,
        isEncrypted,
      }));

      // If encrypted and locked, notify
      if (vault && isEncrypted && lockState === 'locked') {
        onUnlockRequired?.(identifier);
      }
    },
    [adapter, onError, onUnlockRequired]
  );

  // Close vault
  const closeVault = useCallback(async () => {
    if (!state.currentVault) {
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));

    await adapter.closeVault(state.currentVault.id);

    setState((prev) => ({
      ...prev,
      currentVault: null,
      loading: false,
      lockState: 'locked',
      isEncrypted: false,
    }));

    onLocked?.(state.currentVault.id);
  }, [adapter, state.currentVault, onLocked]);

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

  // Unlock vault
  const unlockVault = useCallback(
    async (password: string): Promise<boolean> => {
      if (!state.currentVault || !state.currentVault.encryptionConfig) {
        setState((prev) => ({
          ...prev,
          error: 'No encrypted vault to unlock',
        }));
        return false;
      }

      setState((prev) => ({ ...prev, lockState: 'unlocking', error: null }));

      try {
        await adapter.unlockVault(
          state.currentVault.id,
          password,
          state.currentVault.encryptionConfig
        );

        setState((prev) => ({
          ...prev,
          lockState: 'unlocked',
        }));

        onUnlocked?.(state.currentVault.id);
        return true;
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : 'Failed to unlock vault';

        // Make error messages user-friendly
        let userMessage = errorMsg;
        if (errorMsg.includes('decrypt') || errorMsg.includes('tag')) {
          userMessage = 'Incorrect password. Please try again.';
        }

        setState((prev) => ({
          ...prev,
          lockState: 'locked',
          error: userMessage,
        }));

        onError?.(userMessage);
        return false;
      }
    },
    [adapter, state.currentVault, onUnlocked, onError]
  );

  // Lock vault
  const lockVault = useCallback((): void => {
    if (!state.currentVault) {
      return;
    }

    adapter.lockVault(state.currentVault.id);

    setState((prev) => ({
      ...prev,
      lockState: 'locked',
    }));

    onLocked?.(state.currentVault.id);
  }, [adapter, state.currentVault, onLocked]);

  // Lock all vaults
  const lockAllVaults = useCallback((): void => {
    for (const vault of state.vaults) {
      adapter.lockVault(vault.id);
    }
    clearAllSessions();

    setState((prev) => ({
      ...prev,
      lockState: 'locked',
    }));

    if (state.currentVault) {
      onLocked?.(state.currentVault.id);
    }
  }, [adapter, state.vaults, state.currentVault, onLocked]);

  // Get queue stats
  const getQueueStats = useCallback((): QueueStats | null => {
    if (!state.currentVault) {
      return null;
    }
    return adapter.getQueueStats(state.currentVault.id);
  }, [adapter, state.currentVault]);

  // Memoize context value
  const value = useMemo<TeamStorageContextValue>(
    () => ({
      ...state,
      adapter,
      openVault,
      closeVault,
      refreshVaults,
      clearError,
      unlockVault,
      lockVault,
      lockAllVaults,
      getQueueStats,
    }),
    [
      state,
      adapter,
      openVault,
      closeVault,
      refreshVaults,
      clearError,
      unlockVault,
      lockVault,
      lockAllVaults,
      getQueueStats,
    ]
  );

  return (
    <TeamStorageContext.Provider value={value}>
      {children}
    </TeamStorageContext.Provider>
  );
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Access the team storage adapter directly
 * @throws Error if used outside TeamStorageProvider
 */
export function useTeamStorage(): TeamStorageAdapter {
  const context = useContext(TeamStorageContext);
  if (!context) {
    throw new Error('useTeamStorage must be used within a TeamStorageProvider');
  }
  return context.adapter;
}

/**
 * Access the full team storage context including state
 * @throws Error if used outside TeamStorageProvider
 */
export function useTeamStorageContext(): TeamStorageContextValue {
  const context = useContext(TeamStorageContext);
  if (!context) {
    throw new Error('useTeamStorageContext must be used within a TeamStorageProvider');
  }
  return context;
}

/**
 * Check if team storage is initialized and ready
 */
export function useTeamStorageReady(): boolean {
  const context = useContext(TeamStorageContext);
  return context?.initialized ?? false;
}

/**
 * Get the current vault lock state
 */
export function useVaultLockState(): {
  lockState: VaultLockState;
  isUnlocked: boolean;
  isEncrypted: boolean;
} {
  const context = useContext(TeamStorageContext);
  return {
    lockState: context?.lockState ?? 'locked',
    isUnlocked: context?.lockState === 'unlocked',
    isEncrypted: context?.isEncrypted ?? false,
  };
}
