/**
 * @goalrate-app/crypto - IndexedDB Private Key Storage
 *
 * Secure browser-based storage for X25519 private keys.
 * Private keys are encrypted with a password-derived key using AES-256-GCM
 * before being stored in IndexedDB.
 *
 * @example
 * ```typescript
 * import { PrivateKeyStore } from '@goalrate-app/crypto/privateKeyStore';
 *
 * const store = new PrivateKeyStore();
 * await store.init();
 *
 * // Store a private key
 * await store.store(userId, privateKeyBytes, password);
 *
 * // Retrieve the private key
 * const privateKey = await store.retrieve(userId, password);
 *
 * // Check if a key exists
 * const exists = await store.exists(userId);
 *
 * // Delete a stored key
 * await store.delete(userId);
 * ```
 *
 * @packageDocumentation
 */

import { deriveKey, generateSalt, bytesToBase64, base64ToBytes } from './keys';
import { encrypt, decrypt } from './aes';
import { CryptoError } from './errors';

// =============================================================================
// CONSTANTS
// =============================================================================

/** IndexedDB database name */
const DB_NAME = 'goalrate-private-keys';

/** IndexedDB database version */
const DB_VERSION = 1;

/** Object store name for private keys */
const STORE_NAME = 'private-keys';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Stored private key record
 */
export interface StoredPrivateKey {
  /** User ID that owns this key */
  userId: string;
  /** Encrypted private key (AES-256-GCM ciphertext) */
  encryptedPrivateKey: string;
  /** Salt used for key derivation (base64) */
  salt: string;
  /** ISO timestamp when the key was stored */
  createdAt: string;
  /** Algorithm identifier */
  algorithm: 'X25519';
}

/**
 * Private key store interface
 */
export interface IPrivateKeyStore {
  /** Initialize the store (open/create database) */
  init(): Promise<void>;
  /** Store an encrypted private key */
  store(userId: string, privateKey: Uint8Array, password: string): Promise<void>;
  /** Retrieve and decrypt a private key */
  retrieve(userId: string, password: string): Promise<Uint8Array>;
  /** Delete a stored private key */
  delete(userId: string): Promise<void>;
  /** Check if a private key exists for a user */
  exists(userId: string): Promise<boolean>;
  /** Get the stored record (without decrypting) */
  getRecord(userId: string): Promise<StoredPrivateKey | null>;
  /** Close the database connection */
  close(): void;
}

// =============================================================================
// PRIVATE KEY STORE IMPLEMENTATION
// =============================================================================

/**
 * IndexedDB-based secure storage for user private keys
 *
 * Private keys are encrypted at rest using AES-256-GCM with a key
 * derived from the user's password using PBKDF2 (100K iterations).
 *
 * Security considerations:
 * - Private keys never leave the browser unencrypted
 * - Password is required for every retrieval operation
 * - Salt is unique per stored key
 * - No key escrow - lost password = lost access
 */
export class PrivateKeyStore implements IPrivateKeyStore {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the IndexedDB database
   *
   * Creates the database and object store if they don't exist.
   * Safe to call multiple times - will reuse existing connection.
   *
   * @throws CryptoError if IndexedDB is not available or initialization fails
   */
  async init(): Promise<void> {
    // Return existing initialization if in progress
    if (this.initPromise) {
      return this.initPromise;
    }

    // Return immediately if already initialized
    if (this.db) {
      return;
    }

    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    // Check for IndexedDB availability
    if (typeof indexedDB === 'undefined') {
      throw new CryptoError(
        'INDEXEDDB_NOT_AVAILABLE',
        'IndexedDB is not available in this environment'
      );
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        this.initPromise = null;
        reject(
          new CryptoError(
            'INDEXEDDB_OPEN_FAILED',
            `Failed to open IndexedDB: ${request.error?.message || 'Unknown error'}`
          )
        );
      };

      request.onsuccess = () => {
        this.db = request.result;

        // Handle database being closed unexpectedly
        this.db.onclose = () => {
          this.db = null;
          this.initPromise = null;
        };

        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create the private keys object store
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });
  }

  /**
   * Ensure database is initialized before operations
   */
  private async ensureInitialized(): Promise<IDBDatabase> {
    await this.init();
    if (!this.db) {
      throw new CryptoError('INDEXEDDB_NOT_INITIALIZED', 'Database not initialized');
    }
    return this.db;
  }

  /**
   * Store a private key encrypted with the user's password
   *
   * @param userId - User ID that owns this key
   * @param privateKey - Raw private key bytes (32 bytes for X25519)
   * @param password - Password to encrypt the key with
   * @throws CryptoError if encryption or storage fails
   *
   * @example
   * ```typescript
   * const store = new PrivateKeyStore();
   * await store.init();
   * await store.store('user-123', privateKeyBytes, 'secure-password');
   * ```
   */
  async store(userId: string, privateKey: Uint8Array, password: string): Promise<void> {
    if (!userId || typeof userId !== 'string') {
      throw new CryptoError('INVALID_USER_ID', 'User ID must be a non-empty string');
    }

    if (privateKey.length !== 32) {
      throw new CryptoError(
        'INVALID_KEY_LENGTH',
        `Invalid private key length: expected 32 bytes, got ${privateKey.length}`
      );
    }

    if (!password || typeof password !== 'string') {
      throw new CryptoError('INVALID_PASSWORD', 'Password must be a non-empty string');
    }

    const db = await this.ensureInitialized();

    // Generate salt and derive encryption key from password
    const salt = generateSalt();
    const encryptionKey = await deriveKey(password, salt);

    // Encrypt the private key
    const encryptedPrivateKey = await encrypt(privateKey, encryptionKey);

    // Create the record
    const record: StoredPrivateKey = {
      userId,
      encryptedPrivateKey,
      salt: bytesToBase64(salt),
      createdAt: new Date().toISOString(),
      algorithm: 'X25519',
    };

    // Store in IndexedDB
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(record);

      request.onerror = () => {
        reject(
          new CryptoError(
            'INDEXEDDB_STORE_FAILED',
            `Failed to store private key: ${request.error?.message || 'Unknown error'}`
          )
        );
      };

      request.onsuccess = () => {
        resolve();
      };
    });
  }

  /**
   * Retrieve and decrypt a stored private key
   *
   * @param userId - User ID that owns the key
   * @param password - Password to decrypt the key with
   * @returns The decrypted private key bytes
   * @throws CryptoError if key not found, decryption fails, or password is wrong
   *
   * @example
   * ```typescript
   * const store = new PrivateKeyStore();
   * await store.init();
   * const privateKey = await store.retrieve('user-123', 'secure-password');
   * ```
   */
  async retrieve(userId: string, password: string): Promise<Uint8Array> {
    if (!userId || typeof userId !== 'string') {
      throw new CryptoError('INVALID_USER_ID', 'User ID must be a non-empty string');
    }

    if (!password || typeof password !== 'string') {
      throw new CryptoError('INVALID_PASSWORD', 'Password must be a non-empty string');
    }

    const record = await this.getRecord(userId);

    if (!record) {
      throw new CryptoError('KEY_NOT_FOUND', `No private key found for user: ${userId}`);
    }

    // Derive decryption key from password
    const salt = base64ToBytes(record.salt);
    const decryptionKey = await deriveKey(password, salt);

    // Decrypt the private key
    try {
      const privateKey = await decrypt(record.encryptedPrivateKey, decryptionKey);
      return privateKey;
    } catch (error) {
      // Re-throw with more specific message for wrong password
      // AES-GCM authentication failure (TAMPERING_DETECTED) typically means wrong key/password
      if (error instanceof CryptoError && error.code === 'TAMPERING_DETECTED') {
        throw new CryptoError(
          'WRONG_PASSWORD',
          'Failed to decrypt private key. The password may be incorrect.'
        );
      }
      throw error;
    }
  }

  /**
   * Delete a stored private key
   *
   * @param userId - User ID whose key should be deleted
   * @throws CryptoError if deletion fails
   *
   * @example
   * ```typescript
   * const store = new PrivateKeyStore();
   * await store.init();
   * await store.delete('user-123');
   * ```
   */
  async delete(userId: string): Promise<void> {
    if (!userId || typeof userId !== 'string') {
      throw new CryptoError('INVALID_USER_ID', 'User ID must be a non-empty string');
    }

    const db = await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(userId);

      request.onerror = () => {
        reject(
          new CryptoError(
            'INDEXEDDB_DELETE_FAILED',
            `Failed to delete private key: ${request.error?.message || 'Unknown error'}`
          )
        );
      };

      request.onsuccess = () => {
        resolve();
      };
    });
  }

  /**
   * Check if a private key exists for a user
   *
   * @param userId - User ID to check
   * @returns true if a key exists, false otherwise
   *
   * @example
   * ```typescript
   * const store = new PrivateKeyStore();
   * await store.init();
   * if (await store.exists('user-123')) {
   *   console.log('Key exists');
   * }
   * ```
   */
  async exists(userId: string): Promise<boolean> {
    if (!userId || typeof userId !== 'string') {
      return false;
    }

    const record = await this.getRecord(userId);
    return record !== null;
  }

  /**
   * Get the stored record without decrypting
   *
   * Useful for checking metadata without requiring the password.
   *
   * @param userId - User ID to look up
   * @returns The stored record or null if not found
   *
   * @example
   * ```typescript
   * const record = await store.getRecord('user-123');
   * if (record) {
   *   console.log(`Key created at: ${record.createdAt}`);
   * }
   * ```
   */
  async getRecord(userId: string): Promise<StoredPrivateKey | null> {
    if (!userId || typeof userId !== 'string') {
      return null;
    }

    const db = await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(userId);

      request.onerror = () => {
        reject(
          new CryptoError(
            'INDEXEDDB_GET_FAILED',
            `Failed to get private key: ${request.error?.message || 'Unknown error'}`
          )
        );
      };

      request.onsuccess = () => {
        resolve(request.result || null);
      };
    });
  }

  /**
   * Close the database connection
   *
   * Call this when the store is no longer needed to free resources.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }

  /**
   * Delete the entire database
   *
   * WARNING: This permanently deletes all stored private keys!
   * Use with extreme caution.
   *
   * @returns Promise that resolves when deletion is complete
   */
  static async deleteDatabase(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      throw new CryptoError(
        'INDEXEDDB_NOT_AVAILABLE',
        'IndexedDB is not available in this environment'
      );
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);

      request.onerror = () => {
        reject(
          new CryptoError(
            'INDEXEDDB_DELETE_DB_FAILED',
            `Failed to delete database: ${request.error?.message || 'Unknown error'}`
          )
        );
      };

      request.onsuccess = () => {
        resolve();
      };
    });
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Global store instance for convenience
 */
let globalStore: PrivateKeyStore | null = null;

/**
 * Get or create the global private key store
 *
 * @returns The initialized global store
 *
 * @example
 * ```typescript
 * const store = await getPrivateKeyStore();
 * await store.store(userId, privateKey, password);
 * ```
 */
export async function getPrivateKeyStore(): Promise<PrivateKeyStore> {
  if (!globalStore) {
    globalStore = new PrivateKeyStore();
  }
  await globalStore.init();
  return globalStore;
}

/**
 * Reset the global store instance
 *
 * Primarily for testing purposes. Closes and clears the global store.
 */
export function resetGlobalPrivateKeyStore(): void {
  if (globalStore) {
    globalStore.close();
    globalStore = null;
  }
}

/**
 * Store a private key using the global store
 *
 * @param userId - User ID that owns this key
 * @param privateKey - Raw private key bytes
 * @param password - Password to encrypt the key with
 */
export async function storePrivateKey(
  userId: string,
  privateKey: Uint8Array,
  password: string
): Promise<void> {
  const store = await getPrivateKeyStore();
  return store.store(userId, privateKey, password);
}

/**
 * Retrieve a private key using the global store
 *
 * @param userId - User ID that owns the key
 * @param password - Password to decrypt the key with
 * @returns The decrypted private key bytes
 */
export async function retrievePrivateKey(
  userId: string,
  password: string
): Promise<Uint8Array> {
  const store = await getPrivateKeyStore();
  return store.retrieve(userId, password);
}

/**
 * Delete a private key using the global store
 *
 * @param userId - User ID whose key should be deleted
 */
export async function deletePrivateKey(userId: string): Promise<void> {
  const store = await getPrivateKeyStore();
  return store.delete(userId);
}

/**
 * Check if a private key exists using the global store
 *
 * @param userId - User ID to check
 * @returns true if a key exists
 */
export async function hasPrivateKey(userId: string): Promise<boolean> {
  const store = await getPrivateKeyStore();
  return store.exists(userId);
}
