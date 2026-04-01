/**
 * @goalrate-app/crypto
 *
 * AES-256-GCM encryption package for Goalrate vault data.
 *
 * This package provides client-side encryption using the Web Crypto API,
 * with output format compatible with the Rust goalrate-crypto crate for
 * cross-platform encryption/decryption.
 *
 * @example
 * ```typescript
 * import {
 *   generateKey,
 *   deriveKey,
 *   generateSalt,
 *   encrypt,
 *   decrypt,
 *   encryptString,
 *   decryptString,
 * } from '@goalrate-app/crypto';
 *
 * // Generate a random key
 * const key = await generateKey();
 *
 * // Or derive from password
 * const salt = generateSalt();
 * const derivedKey = await deriveKey('mypassword', salt);
 *
 * // Encrypt and decrypt
 * const encrypted = await encryptString('secret data', key);
 * const decrypted = await decryptString(encrypted, key);
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export {
  // Constants
  NONCE_LENGTH,
  KEY_LENGTH,
  SALT_LENGTH,
  DEFAULT_ITERATIONS,
  ENCRYPTED_DATA_SEPARATOR,
  // Types
  type KeyDerivationAlgorithm,
  type KeyDerivationParams,
  type VaultEncryptionConfig,
  type EncryptedString,
  type DeriveKeyOptions,
  type GenerateSaltOptions,
  // X25519 types
  type X25519KeyPair,
  type ExportedX25519KeyPair,
  // ChaCha/Key sharing types
  type WrappedVaultKey,
  type VaultKeyShare,
  type VaultKeyShareAccessLevel,
} from './types';

// =============================================================================
// ERROR EXPORTS
// =============================================================================

export {
  CryptoError,
  isCryptoError,
  assertCryptoAvailable,
  type CryptoErrorCode,
} from './errors';

// =============================================================================
// KEY MANAGEMENT EXPORTS
// =============================================================================

export {
  generateKey,
  deriveKey,
  generateSalt,
  exportKey,
  importKey,
  bytesToBase64,
  base64ToBytes,
} from './keys';

// =============================================================================
// ENCRYPTION EXPORTS
// =============================================================================

export {
  encrypt,
  decrypt,
  encryptString,
  decryptString,
} from './aes';

// =============================================================================
// X25519 KEY EXCHANGE EXPORTS
// =============================================================================

export {
  // Constants
  X25519_KEY_LENGTH,
  // Key generation
  generateX25519KeyPair,
  generateX25519KeyPairExported,
  // Key import/export
  exportX25519PublicKey,
  exportX25519PrivateKey,
  importX25519PublicKey,
  importX25519PrivateKey,
  // Key exchange
  deriveSharedSecret,
  deriveSharedSecretFromBase64,
  getPublicKeyFromPrivate,
} from './x25519';

// =============================================================================
// CHACHA20POLY1305 ENCRYPTION EXPORTS
// =============================================================================

export {
  // Constants
  CHACHA_NONCE_LENGTH,
  CHACHA_KEY_LENGTH,
  CHACHA_TAG_LENGTH,
  // Low-level encryption
  chachaEncrypt,
  chachaDecrypt,
  // Key wrapping
  wrapVaultKey,
  wrapVaultKeyWithBase64,
  unwrapVaultKey,
  unwrapVaultKeyWithBase64,
  // Utility functions
  encryptForRecipient,
  decryptFromSender,
  generateChachaNonce,
} from './chacha';

// =============================================================================
// PRIVATE KEY STORE EXPORTS
// =============================================================================

export {
  // Types
  type StoredPrivateKey,
  type IPrivateKeyStore,
  // Class
  PrivateKeyStore,
  // Convenience functions
  getPrivateKeyStore,
  storePrivateKey,
  retrievePrivateKey,
  deletePrivateKey,
  hasPrivateKey,
  // Testing helpers
  resetGlobalPrivateKeyStore,
} from './privateKeyStore';

// =============================================================================
// KEY SHARING MANAGER EXPORTS
// =============================================================================

export {
  // Types
  type KeySharingConfig,
  type UserPublicKey,
  type ShareVaultKeyParams,
  type ReceiveVaultKeyParams,
  type SetupKeysResult,
  // Class
  KeySharingManager,
  // Global manager functions
  initKeySharing,
  getKeySharing,
  resetKeySharing,
} from './keySharing';
