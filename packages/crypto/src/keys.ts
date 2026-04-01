/**
 * @goalrate-app/crypto - Key Management
 *
 * Key generation, derivation, and management functions using Web Crypto API.
 * Compatible with the Rust goalrate-crypto crate for cross-platform usage.
 */

import {
  KEY_LENGTH,
  SALT_LENGTH,
  DEFAULT_ITERATIONS,
  type DeriveKeyOptions,
  type GenerateSaltOptions,
} from './types';
import { CryptoError, assertCryptoAvailable } from './errors';

const toArrayBufferView = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(bytes) as Uint8Array<ArrayBuffer>;

// =============================================================================
// KEY GENERATION
// =============================================================================

/**
 * Generate a random AES-256 encryption key
 *
 * @returns A CryptoKey suitable for AES-GCM encryption
 * @throws CryptoError if key generation fails
 *
 * @example
 * ```typescript
 * const key = await generateKey();
 * const encrypted = await encrypt('secret data', key);
 * ```
 */
export async function generateKey(): Promise<CryptoKey> {
  assertCryptoAvailable();

  try {
    return await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: KEY_LENGTH * 8, // 256 bits
      },
      true, // extractable
      ['encrypt', 'decrypt']
    );
  } catch (error) {
    throw CryptoError.from(error, 'ENCRYPTION_FAILED');
  }
}

// =============================================================================
// KEY DERIVATION
// =============================================================================

/**
 * Derive an AES-256 key from a password using PBKDF2-SHA256
 *
 * Uses the same parameters as the Rust goalrate-crypto crate:
 * - Algorithm: PBKDF2-HMAC-SHA256
 * - Iterations: 100,000 (configurable)
 * - Key length: 256 bits
 *
 * @param password - The password to derive the key from
 * @param salt - Salt bytes (use generateSalt() to create)
 * @param options - Optional key derivation parameters
 * @returns A CryptoKey suitable for AES-GCM encryption
 * @throws CryptoError if key derivation fails
 *
 * @example
 * ```typescript
 * const salt = generateSalt();
 * const key = await deriveKey('mypassword', salt);
 * ```
 */
export async function deriveKey(
  password: string,
  salt: Uint8Array,
  options: DeriveKeyOptions = {}
): Promise<CryptoKey> {
  assertCryptoAvailable();

  const iterations = options.iterations ?? DEFAULT_ITERATIONS;

  try {
    // Import password as key material
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      toArrayBufferView(new TextEncoder().encode(password)),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    // Derive AES key using PBKDF2
    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: toArrayBufferView(salt),
        iterations,
        hash: 'SHA-256',
      },
      passwordKey,
      {
        name: 'AES-GCM',
        length: KEY_LENGTH * 8, // 256 bits
      },
      true, // extractable
      ['encrypt', 'decrypt']
    );
  } catch (error) {
    throw CryptoError.from(error, 'KEY_DERIVATION_FAILED');
  }
}

// =============================================================================
// SALT GENERATION
// =============================================================================

/**
 * Generate a cryptographically secure random salt
 *
 * @param options - Optional salt generation parameters
 * @returns Random salt bytes
 *
 * @example
 * ```typescript
 * const salt = generateSalt(); // 16 bytes by default
 * const salt32 = generateSalt({ length: 32 }); // 32 bytes
 * ```
 */
export function generateSalt(options: GenerateSaltOptions = {}): Uint8Array {
  assertCryptoAvailable();

  const length = options.length ?? SALT_LENGTH;
  const salt = new Uint8Array(length);
  crypto.getRandomValues(salt);
  return salt;
}

// =============================================================================
// KEY EXPORT / IMPORT
// =============================================================================

/**
 * Export a CryptoKey to raw bytes
 *
 * Useful for storing keys or transmitting them securely.
 * The exported material should be treated as highly sensitive.
 *
 * @param key - The CryptoKey to export
 * @returns Raw key material as Uint8Array (32 bytes for AES-256)
 * @throws CryptoError if export fails
 *
 * @example
 * ```typescript
 * const key = await generateKey();
 * const keyBytes = await exportKey(key);
 * // Store keyBytes securely...
 * ```
 */
export async function exportKey(key: CryptoKey): Promise<Uint8Array> {
  assertCryptoAvailable();

  try {
    const keyBuffer = await crypto.subtle.exportKey('raw', key);
    return new Uint8Array(keyBuffer);
  } catch (error) {
    throw CryptoError.from(error, 'KEY_EXPORT_FAILED');
  }
}

/**
 * Import raw key material as a CryptoKey
 *
 * @param keyMaterial - Raw key bytes (must be 32 bytes for AES-256)
 * @returns A CryptoKey suitable for AES-GCM encryption
 * @throws CryptoError if import fails or key length is invalid
 *
 * @example
 * ```typescript
 * // Restore a previously exported key
 * const key = await importKey(storedKeyBytes);
 * ```
 */
export async function importKey(keyMaterial: Uint8Array): Promise<CryptoKey> {
  assertCryptoAvailable();

  if (keyMaterial.length !== KEY_LENGTH) {
    throw new CryptoError(
      'INVALID_KEY_LENGTH',
      `Invalid key length: expected ${KEY_LENGTH} bytes, got ${keyMaterial.length}`
    );
  }

  try {
    return await crypto.subtle.importKey(
      'raw',
      toArrayBufferView(keyMaterial),
      { name: 'AES-GCM', length: KEY_LENGTH * 8 },
      true, // extractable
      ['encrypt', 'decrypt']
    );
  } catch (error) {
    throw CryptoError.from(error, 'KEY_IMPORT_FAILED');
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Convert bytes to Base64 string
 *
 * @param bytes - Bytes to encode
 * @returns Base64 encoded string
 */
export function bytesToBase64(bytes: Uint8Array): string {
  // Use standard Base64 encoding (not URL-safe) to match Rust crate
  const binary = String.fromCharCode(...bytes);
  return btoa(binary);
}

/**
 * Convert Base64 string to bytes
 *
 * @param base64 - Base64 encoded string
 * @returns Decoded bytes
 * @throws CryptoError if Base64 is invalid
 */
export function base64ToBytes(base64: string): Uint8Array {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (error) {
    throw new CryptoError('INVALID_FORMAT', 'Invalid Base64 encoding', error);
  }
}
