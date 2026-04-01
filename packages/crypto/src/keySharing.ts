/**
 * @goalrate-app/crypto - Vault Key Sharing
 *
 * High-level functions for sharing vault encryption keys between team members.
 * Combines X25519 key exchange, ChaCha20Poly1305 encryption, and IndexedDB storage
 * to provide secure vault key sharing.
 *
 * @example
 * ```typescript
 * import { KeySharingManager } from '@goalrate-app/crypto/keySharing';
 *
 * const manager = new KeySharingManager({ apiBaseUrl: '/api' });
 *
 * // Generate and register user's key pair
 * await manager.setupUserKeys(userId, password);
 *
 * // Admin shares vault key with team member
 * const wrappedKey = await manager.shareVaultKey({
 *   vaultId,
 *   vaultKey,
 *   recipientUserId: memberId,
 *   accessLevel: 'member',
 * });
 *
 * // Team member receives and unwraps vault key
 * const vaultKey = await manager.receiveVaultKey({
 *   vaultId,
 *   password,
 * });
 * ```
 *
 * @packageDocumentation
 */

import {
  generateX25519KeyPair,
  exportX25519PublicKey,
  importX25519PublicKey,
} from './x25519';
import {
  wrapVaultKey,
  unwrapVaultKey,
} from './chacha';
import {
  PrivateKeyStore,
} from './privateKeyStore';
import { CryptoError } from './errors';
import type { VaultKeyShare, VaultKeyShareAccessLevel } from './types';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration for the key sharing manager
 */
export interface KeySharingConfig {
  /** Base URL for the API (e.g., '/api' or 'https://api.example.com') */
  apiBaseUrl: string;
  /** Custom fetch implementation (for testing or custom auth) */
  fetch?: typeof fetch;
  /** Custom private key store (for testing) */
  privateKeyStore?: PrivateKeyStore;
}

/**
 * User's public key as returned by the API
 */
export interface UserPublicKey {
  id: string;
  userId: string;
  publicKey: string; // base64
  algorithm: string;
  createdAt: string;
  isCurrent: boolean;
}

/**
 * Parameters for sharing a vault key
 */
export interface ShareVaultKeyParams {
  /** ID of the vault being shared */
  vaultId: string;
  /** The vault's encryption key (raw bytes) */
  vaultKey: Uint8Array;
  /** User ID of the recipient */
  recipientUserId: string;
  /** Access level to grant */
  accessLevel: VaultKeyShareAccessLevel;
  /** Current user's password (to retrieve their private key for signing) */
  password: string;
}

/**
 * Parameters for receiving a vault key share
 */
export interface ReceiveVaultKeyParams {
  /** ID of the vault */
  vaultId: string;
  /** Current user's password (to decrypt their private key) */
  password: string;
}

/**
 * Result of setting up user keys
 */
export interface SetupKeysResult {
  /** The user's public key (base64) */
  publicKey: string;
  /** Whether this is a new key pair (true) or existing (false) */
  isNew: boolean;
}

// =============================================================================
// KEY SHARING MANAGER
// =============================================================================

/**
 * Manager for vault key sharing operations
 *
 * Provides high-level methods for:
 * - Setting up user key pairs
 * - Sharing vault keys with team members
 * - Receiving shared vault keys
 * - Revoking access
 */
export class KeySharingManager {
  private config: Required<KeySharingConfig>;

  constructor(config: KeySharingConfig) {
    this.config = {
      apiBaseUrl: config.apiBaseUrl,
      fetch: config.fetch ?? globalThis.fetch.bind(globalThis),
      privateKeyStore: config.privateKeyStore ?? new PrivateKeyStore(),
    };
  }

  /**
   * Set up user's X25519 key pair
   *
   * Generates a new key pair if the user doesn't have one,
   * or retrieves the existing public key if they do.
   *
   * @param userId - Current user's ID
   * @param password - Password to encrypt the private key
   * @returns The user's public key
   */
  async setupUserKeys(userId: string, password: string): Promise<SetupKeysResult> {
    // Initialize the private key store
    await this.config.privateKeyStore.init();

    // Check if user already has a private key stored locally
    const hasLocalKey = await this.config.privateKeyStore.exists(userId);

    if (hasLocalKey) {
      // Verify we can decrypt the private key (correct password)
      try {
        await this.config.privateKeyStore.retrieve(userId, password);
      } catch (error) {
        if (error instanceof CryptoError && error.code === 'WRONG_PASSWORD') {
          throw error; // Re-throw wrong password error
        }
        // Other errors - key may be corrupted, regenerate
        console.warn('Local private key corrupted, regenerating...');
        await this.config.privateKeyStore.delete(userId);
      }

      // Check if we have a public key on the server
      const serverKey = await this.getMyPublicKey();
      if (serverKey) {
        return {
          publicKey: serverKey.publicKey,
          isNew: false,
        };
      }
    }

    // Generate new key pair
    const keyPair = generateX25519KeyPair();
    const publicKeyBase64 = exportX25519PublicKey(keyPair.publicKey);

    // Store private key locally (encrypted with password)
    await this.config.privateKeyStore.store(userId, keyPair.privateKey, password);

    // Register public key with server
    await this.registerPublicKey(publicKeyBase64);

    return {
      publicKey: publicKeyBase64,
      isNew: true,
    };
  }

  /**
   * Share a vault key with a team member
   *
   * Wraps the vault key with the recipient's public key and
   * stores the wrapped key on the server.
   *
   * @param params - Share parameters
   * @returns The created key share
   */
  async shareVaultKey(params: ShareVaultKeyParams): Promise<VaultKeyShare> {
    const { vaultId, vaultKey, recipientUserId, accessLevel } = params;

    // Validate vault key length
    if (vaultKey.length !== 32) {
      throw new CryptoError(
        'INVALID_KEY_LENGTH',
        `Invalid vault key length: expected 32 bytes, got ${vaultKey.length}`
      );
    }

    // Get recipient's public key
    const recipientPublicKey = await this.getUserPublicKey(recipientUserId);
    if (!recipientPublicKey) {
      throw new CryptoError(
        'KEY_NOT_FOUND',
        `No public key found for user: ${recipientUserId}. The user must set up their keys first.`
      );
    }

    // Import recipient's public key
    const recipientPubKeyBytes = importX25519PublicKey(recipientPublicKey.publicKey);

    // Wrap the vault key
    const wrappedKey = wrapVaultKey(vaultKey, recipientPubKeyBytes);

    // Store on server
    const response = await this.config.fetch(
      `${this.config.apiBaseUrl}/workspaces/${vaultId}/shares`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipientUserId,
          wrappedKeyJson: JSON.stringify(wrappedKey),
          accessLevel,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new CryptoError(
        'ENCRYPTION_FAILED',
        `Failed to share vault key: ${error}`
      );
    }

    return await response.json();
  }

  /**
   * Receive and unwrap a shared vault key
   *
   * Retrieves the wrapped key from the server and decrypts it
   * using the user's private key.
   *
   * @param params - Receive parameters
   * @returns The decrypted vault key
   */
  async receiveVaultKey(params: ReceiveVaultKeyParams): Promise<Uint8Array> {
    const { vaultId, password } = params;

    // Get the key share from server
    const response = await this.config.fetch(
      `${this.config.apiBaseUrl}/workspaces/${vaultId}/shares/me`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new CryptoError(
          'KEY_NOT_FOUND',
          `No vault key share found for vault: ${vaultId}`
        );
      }
      const error = await response.text();
      throw new CryptoError(
        'DECRYPTION_FAILED',
        `Failed to retrieve vault key share: ${error}`
      );
    }

    const keyShare: VaultKeyShare = await response.json();

    // Get user's private key from local storage
    const userId = keyShare.recipientUserId;
    await this.config.privateKeyStore.init();
    const privateKey = await this.config.privateKeyStore.retrieve(userId, password);

    // Unwrap the vault key
    const vaultKey = unwrapVaultKey(keyShare.wrappedKey, privateKey);

    return vaultKey;
  }

  /**
   * Revoke a user's access to a vault
   *
   * @param vaultId - ID of the vault
   * @param userId - ID of the user to revoke
   */
  async revokeAccess(vaultId: string, userId: string): Promise<void> {
    const response = await this.config.fetch(
      `${this.config.apiBaseUrl}/workspaces/${vaultId}/shares/${userId}`,
      {
        method: 'DELETE',
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new CryptoError(
        'ENCRYPTION_FAILED',
        `Failed to revoke access: ${error}`
      );
    }
  }

  /**
   * List all users who have access to a vault
   *
   * @param vaultId - ID of the vault
   * @returns List of key shares
   */
  async listVaultKeyShares(vaultId: string): Promise<VaultKeyShare[]> {
    const response = await this.config.fetch(
      `${this.config.apiBaseUrl}/workspaces/${vaultId}/shares`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new CryptoError(
        'ENCRYPTION_FAILED',
        `Failed to list vault key shares: ${error}`
      );
    }

    return await response.json();
  }

  /**
   * Update a user's access level for a vault
   *
   * @param vaultId - ID of the vault
   * @param userId - ID of the user
   * @param accessLevel - New access level
   */
  async updateAccessLevel(
    vaultId: string,
    userId: string,
    accessLevel: VaultKeyShareAccessLevel
  ): Promise<VaultKeyShare> {
    const response = await this.config.fetch(
      `${this.config.apiBaseUrl}/workspaces/${vaultId}/shares/${userId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accessLevel }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new CryptoError(
        'ENCRYPTION_FAILED',
        `Failed to update access level: ${error}`
      );
    }

    return await response.json();
  }

  /**
   * Check if a user has a private key stored locally
   *
   * @param userId - User ID to check
   * @returns true if the user has a local private key
   */
  async hasLocalPrivateKey(userId: string): Promise<boolean> {
    await this.config.privateKeyStore.init();
    return this.config.privateKeyStore.exists(userId);
  }

  /**
   * Delete the local private key
   *
   * WARNING: This will prevent the user from decrypting any shared vault keys!
   *
   * @param userId - User ID whose key to delete
   */
  async deleteLocalPrivateKey(userId: string): Promise<void> {
    await this.config.privateKeyStore.init();
    await this.config.privateKeyStore.delete(userId);
  }

  // =========================================================================
  // PRIVATE HELPER METHODS
  // =========================================================================

  /**
   * Register public key with the server
   */
  private async registerPublicKey(publicKey: string): Promise<UserPublicKey> {
    const response = await this.config.fetch(
      `${this.config.apiBaseUrl}/keys/me`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          publicKey,
          algorithm: 'X25519',
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new CryptoError(
        'KEY_DERIVATION_FAILED',
        `Failed to register public key: ${error}`
      );
    }

    return await response.json();
  }

  /**
   * Get the current user's public key from the server
   */
  private async getMyPublicKey(): Promise<UserPublicKey | null> {
    const response = await this.config.fetch(
      `${this.config.apiBaseUrl}/keys/me`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const error = await response.text();
      throw new CryptoError(
        'KEY_DERIVATION_FAILED',
        `Failed to get public key: ${error}`
      );
    }

    return await response.json();
  }

  /**
   * Get another user's public key from the server
   */
  private async getUserPublicKey(userId: string): Promise<UserPublicKey | null> {
    const response = await this.config.fetch(
      `${this.config.apiBaseUrl}/keys/users/${userId}/public-key`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const error = await response.text();
      throw new CryptoError(
        'KEY_DERIVATION_FAILED',
        `Failed to get user's public key: ${error}`
      );
    }

    return await response.json();
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Global key sharing manager instance
 */
let globalManager: KeySharingManager | null = null;

/**
 * Initialize the global key sharing manager
 *
 * @param config - Configuration for the manager
 * @returns The initialized manager
 */
export function initKeySharing(config: KeySharingConfig): KeySharingManager {
  globalManager = new KeySharingManager(config);
  return globalManager;
}

/**
 * Get the global key sharing manager
 *
 * @throws CryptoError if manager not initialized
 * @returns The global manager
 */
export function getKeySharing(): KeySharingManager {
  if (!globalManager) {
    throw new CryptoError(
      'INDEXEDDB_NOT_INITIALIZED',
      'Key sharing manager not initialized. Call initKeySharing() first.'
    );
  }
  return globalManager;
}

/**
 * Reset the global key sharing manager
 *
 * For testing purposes.
 */
export function resetKeySharing(): void {
  globalManager = null;
}
