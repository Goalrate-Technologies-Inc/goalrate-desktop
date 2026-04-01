/**
 * @goalrate-app/crypto - Type definitions
 *
 * Types and constants for AES-256-GCM encryption.
 * Designed for compatibility with the Rust goalrate-crypto crate.
 */

// =============================================================================
// CONSTANTS
// =============================================================================

/** Nonce length for AES-GCM (96 bits / 12 bytes) */
export const NONCE_LENGTH = 12;

/** Key length for AES-256 (256 bits / 32 bytes) */
export const KEY_LENGTH = 32;

/** Recommended salt length for PBKDF2 (128 bits / 16 bytes) */
export const SALT_LENGTH = 16;

/** Default PBKDF2 iteration count (matches Rust crate) */
export const DEFAULT_ITERATIONS = 100_000;

/** Separator used in encrypted data format */
export const ENCRYPTED_DATA_SEPARATOR = '.';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Supported key derivation algorithms
 */
export type KeyDerivationAlgorithm = 'PBKDF2-SHA256';

/**
 * Parameters for key derivation (stored with encrypted vault)
 */
export interface KeyDerivationParams {
  /** Base64 encoded salt (16 bytes recommended) */
  salt: string;
  /** Number of PBKDF2 iterations (default: 100,000) */
  iterations: number;
  /** Key derivation algorithm identifier */
  algorithm: KeyDerivationAlgorithm;
}

/**
 * Vault encryption configuration (stored in vault config)
 */
export interface VaultEncryptionConfig {
  /** Whether encryption is enabled for this vault */
  enabled: boolean;
  /** Key derivation parameters */
  keyDerivation: KeyDerivationParams;
  /** When encryption was first enabled (ISO date string) */
  createdAt: string;
}

/**
 * Result of encryption operations
 * Format: base64(nonce).base64(ciphertext_with_tag)
 *
 * This format is compatible with the Rust goalrate-crypto crate,
 * allowing cross-platform encryption/decryption.
 */
export type EncryptedString = string;

/**
 * Options for key derivation
 */
export interface DeriveKeyOptions {
  /** Number of PBKDF2 iterations (default: DEFAULT_ITERATIONS) */
  iterations?: number;
}

/**
 * Options for salt generation
 */
export interface GenerateSaltOptions {
  /** Salt length in bytes (default: SALT_LENGTH) */
  length?: number;
}

// =============================================================================
// X25519 TYPES (re-exported from x25519.ts for convenience)
// =============================================================================

/**
 * X25519 key pair containing public and private keys
 */
export interface X25519KeyPair {
  /** Public key (32 bytes) - safe to share */
  publicKey: Uint8Array;
  /** Private key (32 bytes) - keep secret! */
  privateKey: Uint8Array;
}

/**
 * X25519 key pair with keys exported as base64 strings
 */
export interface ExportedX25519KeyPair {
  /** Base64-encoded public key */
  publicKeyBase64: string;
  /** Base64-encoded private key */
  privateKeyBase64: string;
}

// =============================================================================
// CHACHA20POLY1305 TYPES (re-exported from chacha.ts for convenience)
// =============================================================================

/**
 * Wrapped vault key containing all data needed for unwrapping
 */
export interface WrappedVaultKey {
  /** Ephemeral public key used for this wrapping (base64) */
  ephemeralPublicKey: string;
  /** Encrypted vault key with authentication tag (base64) */
  encryptedKey: string;
  /** Nonce used for encryption (base64) */
  nonce: string;
}

/**
 * Vault key share record for storing in database
 */
export interface VaultKeyShare {
  /** Unique identifier for this share */
  id: string;
  /** Vault this key is for */
  vaultId: string;
  /** User ID of the recipient */
  recipientUserId: string;
  /** Wrapped key data */
  wrappedKey: WrappedVaultKey;
  /** User ID who granted access */
  grantedBy: string;
  /** ISO timestamp when access was granted */
  grantedAt: string;
  /** Access level granted */
  accessLevel: 'admin' | 'member' | 'viewer';
  /** ISO timestamp when access was revoked (if revoked) */
  revokedAt?: string;
}

/**
 * Access levels for vault key shares
 */
export type VaultKeyShareAccessLevel = 'admin' | 'member' | 'viewer';
