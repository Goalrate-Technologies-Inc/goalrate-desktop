/**
 * @goalrate-app/crypto - X25519 Key Exchange
 *
 * X25519 (Curve25519) Elliptic Curve Diffie-Hellman key exchange.
 * Used for secure key sharing between team members.
 *
 * @example
 * ```typescript
 * import {
 *   generateX25519KeyPair,
 *   deriveSharedSecret,
 *   exportX25519PublicKey,
 *   importX25519PublicKey,
 * } from '@goalrate-app/crypto/x25519';
 *
 * // Generate a key pair for Alice
 * const aliceKeyPair = generateX25519KeyPair();
 *
 * // Generate a key pair for Bob
 * const bobKeyPair = generateX25519KeyPair();
 *
 * // Derive shared secret (both sides get the same result)
 * const aliceShared = deriveSharedSecret(aliceKeyPair.privateKey, bobKeyPair.publicKey);
 * const bobShared = deriveSharedSecret(bobKeyPair.privateKey, aliceKeyPair.publicKey);
 * // aliceShared === bobShared
 * ```
 *
 * @packageDocumentation
 */

import { x25519 } from '@noble/curves/ed25519.js';
import { CryptoError } from './errors';
import { bytesToBase64, base64ToBytes } from './keys';

// =============================================================================
// CONSTANTS
// =============================================================================

/** X25519 key length (256 bits / 32 bytes) */
export const X25519_KEY_LENGTH = 32;

// =============================================================================
// TYPE DEFINITIONS
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
// KEY GENERATION
// =============================================================================

/**
 * Generate a new X25519 key pair for key exchange.
 *
 * The private key is generated using cryptographically secure random bytes.
 * The public key is derived from the private key using the X25519 algorithm.
 *
 * @returns X25519 key pair with 32-byte public and private keys
 *
 * @example
 * ```typescript
 * const keyPair = generateX25519KeyPair();
 * console.log('Public key:', keyPair.publicKey.length); // 32
 * console.log('Private key:', keyPair.privateKey.length); // 32
 * ```
 */
export function generateX25519KeyPair(): X25519KeyPair {
  // Generate random 32-byte private key
  const privateKey = x25519.utils.randomSecretKey();

  // Derive public key from private key
  const publicKey = x25519.getPublicKey(privateKey);

  return {
    publicKey,
    privateKey,
  };
}

/**
 * Generate an X25519 key pair and export as base64 strings.
 *
 * This is a convenience function that combines key generation and export.
 *
 * @returns Key pair with base64-encoded keys
 *
 * @example
 * ```typescript
 * const exported = generateX25519KeyPairExported();
 * // Store publicKeyBase64 on server
 * // Store privateKeyBase64 securely on client (encrypted)
 * ```
 */
export function generateX25519KeyPairExported(): ExportedX25519KeyPair {
  const keyPair = generateX25519KeyPair();
  return {
    publicKeyBase64: exportX25519PublicKey(keyPair.publicKey),
    privateKeyBase64: exportX25519PrivateKey(keyPair.privateKey),
  };
}

// =============================================================================
// KEY EXPORT / IMPORT
// =============================================================================

/**
 * Export an X25519 public key to base64 string.
 *
 * @param publicKey - 32-byte public key
 * @returns Base64-encoded public key
 *
 * @throws {CryptoError} If key is invalid length
 */
export function exportX25519PublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== X25519_KEY_LENGTH) {
    throw new CryptoError(
      'INVALID_KEY_LENGTH',
      `X25519 public key must be ${X25519_KEY_LENGTH} bytes, got ${publicKey.length}`
    );
  }
  return bytesToBase64(publicKey);
}

/**
 * Export an X25519 private key to base64 string.
 *
 * WARNING: Private keys should be encrypted before storage!
 *
 * @param privateKey - 32-byte private key
 * @returns Base64-encoded private key
 *
 * @throws {CryptoError} If key is invalid length
 */
export function exportX25519PrivateKey(privateKey: Uint8Array): string {
  if (privateKey.length !== X25519_KEY_LENGTH) {
    throw new CryptoError(
      'INVALID_KEY_LENGTH',
      `X25519 private key must be ${X25519_KEY_LENGTH} bytes, got ${privateKey.length}`
    );
  }
  return bytesToBase64(privateKey);
}

/**
 * Import an X25519 public key from base64 string.
 *
 * @param base64 - Base64-encoded public key
 * @returns 32-byte public key
 *
 * @throws {CryptoError} If base64 is invalid or key is wrong length
 */
export function importX25519PublicKey(base64: string): Uint8Array {
  let publicKey: Uint8Array;
  try {
    publicKey = base64ToBytes(base64);
  } catch {
    throw new CryptoError('INVALID_FORMAT', 'Invalid base64 encoding for X25519 public key');
  }

  if (publicKey.length !== X25519_KEY_LENGTH) {
    throw new CryptoError(
      'INVALID_KEY_LENGTH',
      `X25519 public key must be ${X25519_KEY_LENGTH} bytes, got ${publicKey.length}`
    );
  }

  return publicKey;
}

/**
 * Import an X25519 private key from base64 string.
 *
 * @param base64 - Base64-encoded private key
 * @returns 32-byte private key
 *
 * @throws {CryptoError} If base64 is invalid or key is wrong length
 */
export function importX25519PrivateKey(base64: string): Uint8Array {
  let privateKey: Uint8Array;
  try {
    privateKey = base64ToBytes(base64);
  } catch {
    throw new CryptoError('INVALID_FORMAT', 'Invalid base64 encoding for X25519 private key');
  }

  if (privateKey.length !== X25519_KEY_LENGTH) {
    throw new CryptoError(
      'INVALID_KEY_LENGTH',
      `X25519 private key must be ${X25519_KEY_LENGTH} bytes, got ${privateKey.length}`
    );
  }

  return privateKey;
}

// =============================================================================
// KEY EXCHANGE
// =============================================================================

/**
 * Derive a shared secret using X25519 key exchange.
 *
 * Both parties can derive the same shared secret using their private key
 * and the other party's public key. The shared secret can then be used
 * as a symmetric encryption key.
 *
 * @param privateKey - Your 32-byte private key
 * @param publicKey - Other party's 32-byte public key
 * @returns 32-byte shared secret
 *
 * @throws {CryptoError} If keys are invalid
 *
 * @example
 * ```typescript
 * // Alice derives shared secret with Bob's public key
 * const aliceShared = deriveSharedSecret(alicePrivateKey, bobPublicKey);
 *
 * // Bob derives same shared secret with Alice's public key
 * const bobShared = deriveSharedSecret(bobPrivateKey, alicePublicKey);
 *
 * // Both secrets are identical and can be used for encryption
 * ```
 */
export function deriveSharedSecret(
  privateKey: Uint8Array,
  publicKey: Uint8Array
): Uint8Array {
  if (privateKey.length !== X25519_KEY_LENGTH) {
    throw new CryptoError(
      'INVALID_KEY_LENGTH',
      `X25519 private key must be ${X25519_KEY_LENGTH} bytes, got ${privateKey.length}`
    );
  }

  if (publicKey.length !== X25519_KEY_LENGTH) {
    throw new CryptoError(
      'INVALID_KEY_LENGTH',
      `X25519 public key must be ${X25519_KEY_LENGTH} bytes, got ${publicKey.length}`
    );
  }

  try {
    return x25519.getSharedSecret(privateKey, publicKey);
  } catch (error) {
    throw new CryptoError(
      'KEY_DERIVATION_FAILED',
      `Failed to derive X25519 shared secret: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Derive a shared secret from base64-encoded keys.
 *
 * Convenience function that handles base64 decoding.
 *
 * @param privateKeyBase64 - Base64-encoded private key
 * @param publicKeyBase64 - Base64-encoded public key
 * @returns 32-byte shared secret
 */
export function deriveSharedSecretFromBase64(
  privateKeyBase64: string,
  publicKeyBase64: string
): Uint8Array {
  const privateKey = importX25519PrivateKey(privateKeyBase64);
  const publicKey = importX25519PublicKey(publicKeyBase64);
  return deriveSharedSecret(privateKey, publicKey);
}

/**
 * Get the public key from a private key.
 *
 * Useful when you have a stored private key and need to regenerate the public key.
 *
 * @param privateKey - 32-byte private key
 * @returns 32-byte public key
 *
 * @throws {CryptoError} If private key is invalid
 */
export function getPublicKeyFromPrivate(privateKey: Uint8Array): Uint8Array {
  if (privateKey.length !== X25519_KEY_LENGTH) {
    throw new CryptoError(
      'INVALID_KEY_LENGTH',
      `X25519 private key must be ${X25519_KEY_LENGTH} bytes, got ${privateKey.length}`
    );
  }

  return x25519.getPublicKey(privateKey);
}
