/**
 * @goalrate-app/crypto - AES-256-GCM Encryption
 *
 * Authenticated encryption using AES-256-GCM via Web Crypto API.
 * Output format is compatible with the Rust goalrate-crypto crate.
 *
 * Format: base64(nonce).base64(ciphertext_with_tag)
 */

import {
  NONCE_LENGTH,
  ENCRYPTED_DATA_SEPARATOR,
  type EncryptedString,
} from './types';
import { CryptoError, assertCryptoAvailable } from './errors';
import { bytesToBase64, base64ToBytes } from './keys';

const toArrayBufferView = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(bytes) as Uint8Array<ArrayBuffer>;

// =============================================================================
// ENCRYPTION
// =============================================================================

/**
 * Encrypt data using AES-256-GCM
 *
 * Returns a string in the format: base64(nonce).base64(ciphertext_with_tag)
 * This format is compatible with the Rust goalrate-crypto crate.
 *
 * @param data - Data to encrypt (string or bytes)
 * @param key - AES-256 encryption key
 * @returns Encrypted data as a formatted string
 * @throws CryptoError if encryption fails
 *
 * @example
 * ```typescript
 * const key = await generateKey();
 * const encrypted = await encrypt('secret message', key);
 * // encrypted = "base64nonce.base64ciphertext"
 * ```
 */
export async function encrypt(
  data: string | Uint8Array,
  key: CryptoKey
): Promise<EncryptedString> {
  assertCryptoAvailable();

  // Convert string to bytes if needed
  const plaintext = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data;

  // Generate random 12-byte nonce
  const nonce = new Uint8Array(NONCE_LENGTH);
  crypto.getRandomValues(nonce);

  try {
    // Encrypt using AES-GCM (automatically includes authentication tag)
    const ciphertextBuffer = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBufferView(nonce),
        // No additional authenticated data (AAD) - matches Rust crate
      },
      key,
      toArrayBufferView(plaintext)
    );

    const ciphertext = new Uint8Array(ciphertextBuffer);

    // Format: nonce.ciphertext (both Base64 encoded)
    const nonceB64 = bytesToBase64(nonce);
    const ciphertextB64 = bytesToBase64(ciphertext);

    return `${nonceB64}${ENCRYPTED_DATA_SEPARATOR}${ciphertextB64}`;
  } catch (error) {
    throw CryptoError.from(error, 'ENCRYPTION_FAILED');
  }
}

/**
 * Encrypt a string and return formatted ciphertext
 *
 * Convenience wrapper around encrypt() for string data.
 *
 * @param data - String to encrypt
 * @param key - AES-256 encryption key
 * @returns Encrypted data as a formatted string
 * @throws CryptoError if encryption fails
 */
export async function encryptString(
  data: string,
  key: CryptoKey
): Promise<EncryptedString> {
  return encrypt(data, key);
}

// =============================================================================
// DECRYPTION
// =============================================================================

/**
 * Decrypt data using AES-256-GCM
 *
 * Expects input in the format: base64(nonce).base64(ciphertext_with_tag)
 * This format is compatible with the Rust goalrate-crypto crate.
 *
 * @param encrypted - Encrypted data string (nonce.ciphertext format)
 * @param key - AES-256 decryption key (must match encryption key)
 * @returns Decrypted data as bytes
 * @throws CryptoError if decryption fails or data is tampered
 *
 * @example
 * ```typescript
 * const decrypted = await decrypt(encrypted, key);
 * const text = new TextDecoder().decode(decrypted);
 * ```
 */
export async function decrypt(
  encrypted: EncryptedString,
  key: CryptoKey
): Promise<Uint8Array> {
  assertCryptoAvailable();

  // Parse format: nonce.ciphertext
  const parts = encrypted.split(ENCRYPTED_DATA_SEPARATOR);
  if (parts.length !== 2) {
    throw new CryptoError(
      'INVALID_FORMAT',
      `Invalid encrypted data format: expected "nonce${ENCRYPTED_DATA_SEPARATOR}ciphertext", got ${parts.length} parts`
    );
  }

  const [nonceB64, ciphertextB64] = parts;

  // Decode Base64
  let nonce: Uint8Array;
  let ciphertext: Uint8Array;

  try {
    nonce = base64ToBytes(nonceB64!);
    ciphertext = base64ToBytes(ciphertextB64!);
  } catch (error) {
    if (error instanceof CryptoError) {
      throw error;
    }
    throw new CryptoError('INVALID_FORMAT', 'Failed to decode Base64 data', error);
  }

  // Validate nonce length
  if (nonce.length !== NONCE_LENGTH) {
    throw new CryptoError(
      'INVALID_NONCE',
      `Invalid nonce length: expected ${NONCE_LENGTH} bytes, got ${nonce.length}`
    );
  }

  try {
    // Decrypt using AES-GCM (automatically verifies authentication tag)
    const plaintextBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBufferView(nonce),
      },
      key,
      toArrayBufferView(ciphertext)
    );

    return new Uint8Array(plaintextBuffer);
  } catch (error) {
    // AES-GCM throws an error if authentication fails (tampering detected)
    throw new CryptoError(
      'TAMPERING_DETECTED',
      'Decryption failed: authentication tag verification failed. Data may have been tampered with or wrong key used.',
      error
    );
  }
}

/**
 * Decrypt to a UTF-8 string
 *
 * Convenience wrapper around decrypt() that returns a string.
 *
 * @param encrypted - Encrypted data string (nonce.ciphertext format)
 * @param key - AES-256 decryption key
 * @returns Decrypted string
 * @throws CryptoError if decryption fails or data is not valid UTF-8
 *
 * @example
 * ```typescript
 * const key = await generateKey();
 * const encrypted = await encryptString('Hello, World!', key);
 * const decrypted = await decryptString(encrypted, key);
 * // decrypted === 'Hello, World!'
 * ```
 */
export async function decryptString(
  encrypted: EncryptedString,
  key: CryptoKey
): Promise<string> {
  const bytes = await decrypt(encrypted, key);

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new CryptoError(
      'DECRYPTION_FAILED',
      'Decrypted data is not valid UTF-8',
      error
    );
  }
}
