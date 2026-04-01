/**
 * @goalrate-app/crypto - ChaCha20Poly1305 Encryption
 *
 * ChaCha20Poly1305 authenticated encryption for vault key wrapping.
 * Used with X25519 key exchange to securely share vault keys.
 *
 * @example
 * ```typescript
 * import { wrapVaultKey, unwrapVaultKey } from '@goalrate-app/crypto/chacha';
 * import { generateX25519KeyPair } from '@goalrate-app/crypto/x25519';
 *
 * // Admin has the vault key and wants to share with team member
 * const vaultKey = new Uint8Array(32); // AES-256 key
 * const adminKeyPair = generateX25519KeyPair();
 * const memberPublicKey = getMemberPublicKey(); // from server
 *
 * // Wrap the vault key for the team member
 * const wrapped = wrapVaultKey(vaultKey, adminKeyPair.privateKey, memberPublicKey);
 *
 * // Team member can unwrap using their private key
 * const memberKeyPair = generateX25519KeyPair();
 * const unwrapped = unwrapVaultKey(wrapped, memberKeyPair.privateKey, adminKeyPair.publicKey);
 * ```
 *
 * @packageDocumentation
 */

import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { CryptoError } from './errors';
import { bytesToBase64, base64ToBytes } from './keys';
import {
  deriveSharedSecret,
  generateX25519KeyPair,
  exportX25519PublicKey,
  importX25519PublicKey,
  X25519_KEY_LENGTH,
} from './x25519';

// =============================================================================
// CONSTANTS
// =============================================================================

/** ChaCha20Poly1305 nonce length (96 bits / 12 bytes) */
export const CHACHA_NONCE_LENGTH = 12;

/** ChaCha20Poly1305 key length (256 bits / 32 bytes) */
export const CHACHA_KEY_LENGTH = 32;

/** ChaCha20Poly1305 authentication tag length (128 bits / 16 bytes) */
export const CHACHA_TAG_LENGTH = 16;

// =============================================================================
// TYPE DEFINITIONS
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

// =============================================================================
// LOW-LEVEL ENCRYPTION
// =============================================================================

/**
 * Encrypt data using ChaCha20Poly1305.
 *
 * @param plaintext - Data to encrypt
 * @param key - 32-byte encryption key
 * @param nonce - Optional 12-byte nonce (random if not provided)
 * @returns Encrypted data with authentication tag
 *
 * @throws {CryptoError} If key or nonce is invalid
 */
export function chachaEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  nonce?: Uint8Array
): { ciphertext: Uint8Array; nonce: Uint8Array } {
  if (key.length !== CHACHA_KEY_LENGTH) {
    throw new CryptoError(
      'INVALID_KEY_LENGTH',
      `ChaCha20Poly1305 key must be ${CHACHA_KEY_LENGTH} bytes, got ${key.length}`
    );
  }

  // Generate random nonce if not provided
  const actualNonce = nonce ?? randomBytes(CHACHA_NONCE_LENGTH);

  if (actualNonce.length !== CHACHA_NONCE_LENGTH) {
    throw new CryptoError(
      'INVALID_NONCE',
      `ChaCha20Poly1305 nonce must be ${CHACHA_NONCE_LENGTH} bytes, got ${actualNonce.length}`
    );
  }

  try {
    const cipher = chacha20poly1305(key, actualNonce);
    const ciphertext = cipher.encrypt(plaintext);

    return {
      ciphertext,
      nonce: actualNonce,
    };
  } catch (error) {
    throw new CryptoError(
      'ENCRYPTION_FAILED',
      `ChaCha20Poly1305 encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Decrypt data using ChaCha20Poly1305.
 *
 * @param ciphertext - Encrypted data with authentication tag
 * @param key - 32-byte decryption key
 * @param nonce - 12-byte nonce used during encryption
 * @returns Decrypted plaintext
 *
 * @throws {CryptoError} If decryption fails (wrong key, tampered data, etc.)
 */
export function chachaDecrypt(
  ciphertext: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array
): Uint8Array {
  if (key.length !== CHACHA_KEY_LENGTH) {
    throw new CryptoError(
      'INVALID_KEY_LENGTH',
      `ChaCha20Poly1305 key must be ${CHACHA_KEY_LENGTH} bytes, got ${key.length}`
    );
  }

  if (nonce.length !== CHACHA_NONCE_LENGTH) {
    throw new CryptoError(
      'INVALID_NONCE',
      `ChaCha20Poly1305 nonce must be ${CHACHA_NONCE_LENGTH} bytes, got ${nonce.length}`
    );
  }

  try {
    const cipher = chacha20poly1305(key, nonce);
    return cipher.decrypt(ciphertext);
  } catch (error) {
    throw new CryptoError(
      'DECRYPTION_FAILED',
      `ChaCha20Poly1305 decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// =============================================================================
// KEY WRAPPING
// =============================================================================

/**
 * Wrap a vault key for secure sharing with a recipient.
 *
 * This function:
 * 1. Generates an ephemeral X25519 key pair
 * 2. Derives a shared secret using sender's ephemeral private key and recipient's public key
 * 3. Encrypts the vault key using ChaCha20Poly1305 with the shared secret
 * 4. Returns the wrapped key with ephemeral public key (for recipient to derive same secret)
 *
 * The ephemeral key provides forward secrecy - compromising the sender's long-term key
 * won't compromise previously wrapped keys.
 *
 * @param vaultKey - 32-byte vault encryption key (AES-256)
 * @param recipientPublicKey - Recipient's X25519 public key
 * @returns Wrapped key data for storage/transmission
 *
 * @throws {CryptoError} If encryption fails
 *
 * @example
 * ```typescript
 * const wrapped = wrapVaultKey(vaultKey, memberPublicKey);
 * // Store wrapped in database as VaultKeyShare
 * ```
 */
export function wrapVaultKey(
  vaultKey: Uint8Array,
  recipientPublicKey: Uint8Array
): WrappedVaultKey {
  if (vaultKey.length !== X25519_KEY_LENGTH) {
    throw new CryptoError(
      'INVALID_KEY_LENGTH',
      `Vault key must be ${X25519_KEY_LENGTH} bytes, got ${vaultKey.length}`
    );
  }

  // Generate ephemeral key pair for forward secrecy
  const ephemeralKeyPair = generateX25519KeyPair();

  // Derive shared secret: ephemeral_private + recipient_public
  const sharedSecret = deriveSharedSecret(
    ephemeralKeyPair.privateKey,
    recipientPublicKey
  );

  // Encrypt vault key with shared secret
  const { ciphertext, nonce } = chachaEncrypt(vaultKey, sharedSecret);

  return {
    ephemeralPublicKey: exportX25519PublicKey(ephemeralKeyPair.publicKey),
    encryptedKey: bytesToBase64(ciphertext),
    nonce: bytesToBase64(nonce),
  };
}

/**
 * Wrap a vault key using base64-encoded recipient public key.
 *
 * @param vaultKey - 32-byte vault encryption key
 * @param recipientPublicKeyBase64 - Base64-encoded recipient public key
 * @returns Wrapped key data
 */
export function wrapVaultKeyWithBase64(
  vaultKey: Uint8Array,
  recipientPublicKeyBase64: string
): WrappedVaultKey {
  const recipientPublicKey = importX25519PublicKey(recipientPublicKeyBase64);
  return wrapVaultKey(vaultKey, recipientPublicKey);
}

/**
 * Unwrap a vault key using recipient's private key.
 *
 * This function:
 * 1. Extracts the ephemeral public key from the wrapped data
 * 2. Derives the same shared secret using recipient's private key + ephemeral public key
 * 3. Decrypts the vault key using ChaCha20Poly1305
 *
 * @param wrapped - Wrapped key data from wrapVaultKey
 * @param recipientPrivateKey - Recipient's X25519 private key
 * @returns 32-byte vault encryption key
 *
 * @throws {CryptoError} If decryption fails (wrong key, tampered data, etc.)
 *
 * @example
 * ```typescript
 * const wrapped = await fetchMyVaultKeyShare(vaultId);
 * const vaultKey = unwrapVaultKey(wrapped, myPrivateKey);
 * // Use vaultKey to decrypt vault data
 * ```
 */
export function unwrapVaultKey(
  wrapped: WrappedVaultKey,
  recipientPrivateKey: Uint8Array
): Uint8Array {
  // Import ephemeral public key
  const ephemeralPublicKey = importX25519PublicKey(wrapped.ephemeralPublicKey);

  // Derive shared secret: recipient_private + ephemeral_public
  const sharedSecret = deriveSharedSecret(recipientPrivateKey, ephemeralPublicKey);

  // Decode encrypted data
  let encryptedKey: Uint8Array;
  let nonce: Uint8Array;
  try {
    encryptedKey = base64ToBytes(wrapped.encryptedKey);
    nonce = base64ToBytes(wrapped.nonce);
  } catch {
    throw new CryptoError('INVALID_FORMAT', 'Invalid base64 in wrapped key data');
  }

  // Decrypt vault key
  return chachaDecrypt(encryptedKey, sharedSecret, nonce);
}

/**
 * Unwrap a vault key using base64-encoded recipient private key.
 *
 * @param wrapped - Wrapped key data
 * @param recipientPrivateKeyBase64 - Base64-encoded recipient private key
 * @returns 32-byte vault encryption key
 */
export function unwrapVaultKeyWithBase64(
  wrapped: WrappedVaultKey,
  recipientPrivateKeyBase64: string
): Uint8Array {
  const recipientPrivateKey = base64ToBytes(recipientPrivateKeyBase64);
  return unwrapVaultKey(wrapped, recipientPrivateKey);
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Encrypt arbitrary data with a shared secret derived from X25519 key exchange.
 *
 * This combines X25519 key exchange with ChaCha20Poly1305 encryption in a single
 * operation. The ephemeral public key is prepended to the output.
 *
 * @param plaintext - Data to encrypt
 * @param recipientPublicKey - Recipient's X25519 public key
 * @returns Encrypted data with ephemeral public key prefix
 */
export function encryptForRecipient(
  plaintext: Uint8Array,
  recipientPublicKey: Uint8Array
): { ephemeralPublicKey: Uint8Array; ciphertext: Uint8Array; nonce: Uint8Array } {
  const ephemeralKeyPair = generateX25519KeyPair();
  const sharedSecret = deriveSharedSecret(ephemeralKeyPair.privateKey, recipientPublicKey);
  const { ciphertext, nonce } = chachaEncrypt(plaintext, sharedSecret);

  return {
    ephemeralPublicKey: ephemeralKeyPair.publicKey,
    ciphertext,
    nonce,
  };
}

/**
 * Decrypt data that was encrypted with encryptForRecipient.
 *
 * @param ciphertext - Encrypted data
 * @param nonce - Nonce used during encryption
 * @param ephemeralPublicKey - Sender's ephemeral public key
 * @param recipientPrivateKey - Recipient's private key
 * @returns Decrypted plaintext
 */
export function decryptFromSender(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  ephemeralPublicKey: Uint8Array,
  recipientPrivateKey: Uint8Array
): Uint8Array {
  const sharedSecret = deriveSharedSecret(recipientPrivateKey, ephemeralPublicKey);
  return chachaDecrypt(ciphertext, sharedSecret, nonce);
}

/**
 * Generate a random nonce for ChaCha20Poly1305.
 *
 * @returns 12-byte random nonce
 */
export function generateChachaNonce(): Uint8Array {
  return randomBytes(CHACHA_NONCE_LENGTH);
}
