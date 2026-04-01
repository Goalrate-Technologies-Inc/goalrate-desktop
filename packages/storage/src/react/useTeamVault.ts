/**
 * Team Vault Hook
 * Manages team vault unlock/lock state and encryption key lifecycle
 */

import { useCallback, useState, useEffect } from 'react';
import type { VaultEncryptionConfig } from '@goalrate-app/shared';
import type { VaultLockState, QueueStats } from '../adapters/team/types';
import {
  createSession,
  getLockState,
  clearSession,
  clearAllSessions,
  getActiveSessions,
} from '../adapters/team/keys';
import { TeamStorageAdapter } from '../adapters/team/TeamStorageAdapter';

// ============================================================================
// TYPES
// ============================================================================

export interface UseTeamVaultReturn {
  /** Lock state for the current vault */
  lockState: VaultLockState;
  /** Whether the vault is unlocked */
  isUnlocked: boolean;
  /** Whether an unlock operation is in progress */
  unlocking: boolean;
  /** Error from last unlock attempt */
  unlockError: string | null;
  /** Unlock a team vault with a password */
  unlockVault: (
    vaultId: string,
    password: string,
    encryptionConfig: VaultEncryptionConfig
  ) => Promise<boolean>;
  /** Lock the current vault */
  lockVault: (vaultId: string) => void;
  /** Lock all vaults (e.g., on logout) */
  lockAllVaults: () => void;
  /** Get queue statistics for a vault */
  getQueueStats: (vaultId: string) => QueueStats | null;
  /** Get all active sessions */
  activeSessions: Array<{ vaultId: string; createdAt: Date; state: VaultLockState }>;
  /** Clear the unlock error */
  clearUnlockError: () => void;
}

export interface UseTeamVaultOptions {
  /** The team storage adapter instance */
  adapter?: TeamStorageAdapter;
  /** The vault ID to manage (optional, for single-vault mode) */
  vaultId?: string;
  /** Callback when vault is unlocked */
  onUnlock?: (vaultId: string) => void;
  /** Callback when vault is locked */
  onLock?: (vaultId: string) => void;
  /** Callback when unlock fails */
  onUnlockError?: (vaultId: string, error: Error) => void;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook for managing team vault encryption and lock state
 *
 * @example
 * ```tsx
 * function TeamVaultManager({ vaultId, encryptionConfig }) {
 *   const {
 *     isUnlocked,
 *     unlocking,
 *     unlockError,
 *     unlockVault,
 *     lockVault,
 *   } = useTeamVault({ vaultId });
 *
 *   const handleUnlock = async (password: string) => {
 *     const success = await unlockVault(vaultId, password, encryptionConfig);
 *     if (success) {
 *       // Vault is now unlocked, data operations will work
 *     }
 *   };
 *
 *   if (!isUnlocked) {
 *     return <PasswordPrompt onSubmit={handleUnlock} error={unlockError} />;
 *   }
 *
 *   return <VaultContent vaultId={vaultId} />;
 * }
 * ```
 */
export function useTeamVault(options: UseTeamVaultOptions = {}): UseTeamVaultReturn {
  const { adapter, vaultId, onUnlock, onLock, onUnlockError } = options;

  const [lockState, setLockState] = useState<VaultLockState>(
    vaultId ? getLockState(vaultId) : 'locked'
  );
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [activeSessions, setActiveSessions] = useState(getActiveSessions());

  // Update lock state when vaultId changes
  useEffect(() => {
    if (vaultId) {
      setLockState(getLockState(vaultId));
    }
  }, [vaultId]);

  // Refresh active sessions periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveSessions(getActiveSessions());
      if (vaultId) {
        setLockState(getLockState(vaultId));
      }
    }, 5000); // Every 5 seconds

    return () => clearInterval(interval);
  }, [vaultId]);

  const unlockVault = useCallback(
    async (
      targetVaultId: string,
      password: string,
      encryptionConfig: VaultEncryptionConfig
    ): Promise<boolean> => {
      setUnlocking(true);
      setUnlockError(null);

      try {
        // If adapter is provided, use it (it handles session creation internally)
        if (adapter) {
          await adapter.unlockVault(targetVaultId, password, encryptionConfig);
        } else {
          // Otherwise, just create the session directly
          await createSession(targetVaultId, password, encryptionConfig);
        }

        setLockState('unlocked');
        setActiveSessions(getActiveSessions());
        onUnlock?.(targetVaultId);
        return true;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to unlock vault';

        // Check for specific error types
        let userMessage = errorMessage;
        if (errorMessage.includes('decrypt') || errorMessage.includes('tag')) {
          userMessage = 'Incorrect password. Please try again.';
        } else if (errorMessage.includes('salt') || errorMessage.includes('config')) {
          userMessage = 'Invalid vault encryption configuration.';
        }

        setUnlockError(userMessage);
        setLockState('locked');
        onUnlockError?.(targetVaultId, error as Error);
        return false;
      } finally {
        setUnlocking(false);
      }
    },
    [adapter, onUnlock, onUnlockError]
  );

  const lockVaultCallback = useCallback(
    (targetVaultId: string) => {
      if (adapter) {
        adapter.lockVault(targetVaultId);
      } else {
        clearSession(targetVaultId);
      }

      if (targetVaultId === vaultId) {
        setLockState('locked');
      }
      setActiveSessions(getActiveSessions());
      onLock?.(targetVaultId);
    },
    [adapter, vaultId, onLock]
  );

  const lockAllVaults = useCallback(() => {
    const sessions = getActiveSessions();
    for (const session of sessions) {
      if (adapter) {
        adapter.lockVault(session.vaultId);
      }
    }
    clearAllSessions();
    setLockState('locked');
    setActiveSessions([]);
  }, [adapter]);

  const getQueueStats = useCallback(
    (targetVaultId: string): QueueStats | null => {
      if (!adapter) {
        return null;
      }
      return adapter.getQueueStats(targetVaultId);
    },
    [adapter]
  );

  const clearUnlockError = useCallback(() => {
    setUnlockError(null);
  }, []);

  return {
    lockState,
    isUnlocked: lockState === 'unlocked',
    unlocking,
    unlockError,
    unlockVault,
    lockVault: lockVaultCallback,
    lockAllVaults,
    getQueueStats,
    activeSessions,
    clearUnlockError,
  };
}

// ============================================================================
// PASSWORD VALIDATION UTILITIES
// ============================================================================

/**
 * Minimum password length for team vaults
 */
export const MIN_TEAM_PASSWORD_LENGTH = 12;

/**
 * Validate a team vault password
 *
 * @param password - The password to validate
 * @returns An error message, or null if valid
 */
export function validateTeamPassword(password: string): string | null {
  if (password.length < MIN_TEAM_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_TEAM_PASSWORD_LENGTH} characters`;
  }

  // Check for at least one uppercase letter
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }

  // Check for at least one lowercase letter
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter';
  }

  // Check for at least one number
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number';
  }

  // Check for at least one special character
  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'Password must contain at least one special character';
  }

  return null;
}

/**
 * Check if a password meets team vault requirements
 *
 * @param password - The password to check
 * @returns True if the password is valid
 */
export function isValidTeamPassword(password: string): boolean {
  return validateTeamPassword(password) === null;
}
