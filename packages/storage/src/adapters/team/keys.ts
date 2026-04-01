/**
 * Team Storage Key Management
 * Vault key derivation and session management for team vaults
 */

import {
  deriveKey,
  base64ToBytes,
  DEFAULT_ITERATIONS,
} from '@goalrate-app/crypto';
import type { VaultEncryptionConfig } from '@goalrate-app/shared';
import type { TeamVaultSession, VaultLockState } from './types';

// ============================================================================
// KEY CACHE
// ============================================================================

/**
 * In-memory key cache
 * Keys are only stored in memory and never persisted
 */
const keyCache = new Map<string, TeamVaultSession>();

/**
 * Lock state per vault
 */
const lockStateMap = new Map<string, VaultLockState>();

// ============================================================================
// KEY DERIVATION
// ============================================================================

/**
 * Derive a vault encryption key from a password
 *
 * @param password - The user's password
 * @param encryptionConfig - The vault's encryption configuration containing salt and iterations
 * @returns The derived CryptoKey
 * @throws CryptoError if key derivation fails
 */
export async function deriveVaultKey(
  password: string,
  encryptionConfig: VaultEncryptionConfig
): Promise<CryptoKey> {
  const salt = base64ToBytes(encryptionConfig.salt);
  const iterations = encryptionConfig.iterations || DEFAULT_ITERATIONS;

  return deriveKey(password, salt, { iterations });
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * Create and cache a vault session
 *
 * @param vaultId - The vault ID
 * @param password - The user's password
 * @param encryptionConfig - The vault's encryption configuration
 * @returns The created session
 */
export async function createSession(
  vaultId: string,
  password: string,
  encryptionConfig: VaultEncryptionConfig
): Promise<TeamVaultSession> {
  // Set state to unlocking
  lockStateMap.set(vaultId, 'unlocking');

  try {
    // Derive the key
    const key = await deriveVaultKey(password, encryptionConfig);

    // Create the session
    const session: TeamVaultSession = {
      vaultId,
      key,
      createdAt: new Date(),
      encryptionConfig,
    };

    // Cache the session
    keyCache.set(vaultId, session);

    // Update state to unlocked
    lockStateMap.set(vaultId, 'unlocked');

    return session;
  } catch (error) {
    // Reset state on failure
    lockStateMap.set(vaultId, 'locked');
    throw error;
  }
}

/**
 * Get the cached session for a vault
 *
 * @param vaultId - The vault ID
 * @returns The cached session, or undefined if not found
 */
export function getSession(vaultId: string): TeamVaultSession | undefined {
  return keyCache.get(vaultId);
}

/**
 * Get the cached key for a vault
 *
 * @param vaultId - The vault ID
 * @returns The cached key, or undefined if not found
 */
export function getKey(vaultId: string): CryptoKey | undefined {
  const session = keyCache.get(vaultId);
  return session?.key;
}

/**
 * Check if a vault has an active session
 *
 * @param vaultId - The vault ID
 * @returns True if the vault has an active session
 */
export function hasSession(vaultId: string): boolean {
  return keyCache.has(vaultId);
}

/**
 * Get the lock state for a vault
 *
 * @param vaultId - The vault ID
 * @returns The lock state
 */
export function getLockState(vaultId: string): VaultLockState {
  return lockStateMap.get(vaultId) || 'locked';
}

/**
 * Check if a vault is unlocked
 *
 * @param vaultId - The vault ID
 * @returns True if the vault is unlocked
 */
export function isUnlocked(vaultId: string): boolean {
  return getLockState(vaultId) === 'unlocked';
}

/**
 * Clear the session for a vault (lock the vault)
 *
 * @param vaultId - The vault ID
 */
export function clearSession(vaultId: string): void {
  keyCache.delete(vaultId);
  lockStateMap.set(vaultId, 'locked');
}

/**
 * Clear all sessions (e.g., on logout)
 */
export function clearAllSessions(): void {
  keyCache.clear();
  lockStateMap.clear();
}

// ============================================================================
// SESSION INFO
// ============================================================================

/**
 * Get info about all active sessions
 */
export function getActiveSessions(): Array<{
  vaultId: string;
  createdAt: Date;
  state: VaultLockState;
}> {
  const sessions: Array<{
    vaultId: string;
    createdAt: Date;
    state: VaultLockState;
  }> = [];

  for (const [vaultId, session] of keyCache.entries()) {
    sessions.push({
      vaultId,
      createdAt: session.createdAt,
      state: getLockState(vaultId),
    });
  }

  return sessions;
}

/**
 * Get the number of active sessions
 */
export function getActiveSessionCount(): number {
  return keyCache.size;
}

// ============================================================================
// SESSION VALIDATION
// ============================================================================

/**
 * Validate that a vault key can decrypt data
 * This can be used to verify the password is correct
 *
 * @param vaultId - The vault ID
 * @param testDecrypt - A function that attempts to decrypt test data
 * @returns True if validation succeeds
 */
export async function validateSession(
  vaultId: string,
  testDecrypt: (key: CryptoKey) => Promise<boolean>
): Promise<boolean> {
  const key = getKey(vaultId);
  if (!key) {
    return false;
  }

  try {
    return await testDecrypt(key);
  } catch {
    // Decryption failed, session is invalid
    return false;
  }
}

// ============================================================================
// CLEANUP
// ============================================================================

/**
 * Session cleanup interval (check for stale sessions)
 */
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start automatic session cleanup
 * Removes sessions that have been inactive for too long
 *
 * @param maxAge - Maximum session age in milliseconds (default: 8 hours)
 * @param checkInterval - Interval between checks in milliseconds (default: 5 minutes)
 */
export function startSessionCleanup(
  maxAge: number = 8 * 60 * 60 * 1000,
  checkInterval: number = 5 * 60 * 1000
): void {
  if (cleanupInterval) {
    return;
  }

  cleanupInterval = setInterval(() => {
    const now = new Date();
    for (const [vaultId, session] of keyCache.entries()) {
      const age = now.getTime() - session.createdAt.getTime();
      if (age > maxAge) {
        clearSession(vaultId);
      }
    }
  }, checkInterval);
}

/**
 * Stop automatic session cleanup
 */
export function stopSessionCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
