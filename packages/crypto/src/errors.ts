/**
 * @goalrate-app/crypto - Error handling
 *
 * Custom error types for cryptographic operations.
 * Mirrors error types from the Rust goalrate-crypto crate.
 */

/**
 * Error codes for cryptographic operations
 */
export type CryptoErrorCode =
  | 'ENCRYPTION_FAILED'
  | 'DECRYPTION_FAILED'
  | 'INVALID_KEY'
  | 'INVALID_KEY_LENGTH'
  | 'INVALID_NONCE'
  | 'KEY_DERIVATION_FAILED'
  | 'KEY_EXPORT_FAILED'
  | 'KEY_IMPORT_FAILED'
  | 'INVALID_FORMAT'
  | 'TAMPERING_DETECTED'
  | 'UNSUPPORTED_ENVIRONMENT'
  // IndexedDB private key store errors
  | 'INDEXEDDB_NOT_AVAILABLE'
  | 'INDEXEDDB_OPEN_FAILED'
  | 'INDEXEDDB_NOT_INITIALIZED'
  | 'INDEXEDDB_STORE_FAILED'
  | 'INDEXEDDB_GET_FAILED'
  | 'INDEXEDDB_DELETE_FAILED'
  | 'INDEXEDDB_DELETE_DB_FAILED'
  | 'INVALID_USER_ID'
  | 'INVALID_PASSWORD'
  | 'KEY_NOT_FOUND'
  | 'WRONG_PASSWORD';

/**
 * Error messages for each error code
 */
const ERROR_MESSAGES: Record<CryptoErrorCode, string> = {
  ENCRYPTION_FAILED: 'Encryption operation failed',
  DECRYPTION_FAILED: 'Decryption operation failed',
  INVALID_KEY: 'Invalid encryption key',
  INVALID_KEY_LENGTH: 'Invalid key length (expected 32 bytes for AES-256)',
  INVALID_NONCE: 'Invalid nonce length (expected 12 bytes for AES-GCM)',
  KEY_DERIVATION_FAILED: 'Key derivation failed',
  KEY_EXPORT_FAILED: 'Failed to export key material',
  KEY_IMPORT_FAILED: 'Failed to import key material',
  INVALID_FORMAT: 'Invalid encrypted data format (expected nonce.ciphertext)',
  TAMPERING_DETECTED: 'Data integrity check failed - possible tampering detected',
  UNSUPPORTED_ENVIRONMENT: 'Web Crypto API not available in this environment',
  // IndexedDB private key store errors
  INDEXEDDB_NOT_AVAILABLE: 'IndexedDB is not available in this environment',
  INDEXEDDB_OPEN_FAILED: 'Failed to open IndexedDB database',
  INDEXEDDB_NOT_INITIALIZED: 'IndexedDB database not initialized',
  INDEXEDDB_STORE_FAILED: 'Failed to store data in IndexedDB',
  INDEXEDDB_GET_FAILED: 'Failed to retrieve data from IndexedDB',
  INDEXEDDB_DELETE_FAILED: 'Failed to delete data from IndexedDB',
  INDEXEDDB_DELETE_DB_FAILED: 'Failed to delete IndexedDB database',
  INVALID_USER_ID: 'User ID must be a non-empty string',
  INVALID_PASSWORD: 'Password must be a non-empty string',
  KEY_NOT_FOUND: 'Private key not found for user',
  WRONG_PASSWORD: 'Failed to decrypt private key - password may be incorrect',
};

/**
 * Custom error class for cryptographic operations
 */
export class CryptoError extends Error {
  /**
   * Error code identifying the type of error
   */
  public readonly code: CryptoErrorCode;

  /**
   * Original error that caused this error (if any)
   */
  public readonly cause?: unknown;

  constructor(code: CryptoErrorCode, message?: string, cause?: unknown) {
    const errorMessage = message || ERROR_MESSAGES[code];
    super(errorMessage);

    this.name = 'CryptoError';
    this.code = code;
    this.cause = cause;

    // Maintain proper stack trace in V8 environments (Node.js)
    const errorConstructor = Error as typeof Error & {
      captureStackTrace?: (
        target: object,
        constructor?: new (
          code: CryptoErrorCode,
          message?: string,
          cause?: unknown
        ) => CryptoError
      ) => void;
    };
    if (typeof errorConstructor.captureStackTrace === 'function') {
      errorConstructor.captureStackTrace(this, CryptoError);
    }
  }

  /**
   * Create a CryptoError from an unknown error
   */
  static from(error: unknown, defaultCode: CryptoErrorCode = 'ENCRYPTION_FAILED'): CryptoError {
    if (error instanceof CryptoError) {
      return error;
    }

    if (error instanceof Error) {
      return new CryptoError(defaultCode, error.message, error);
    }

    return new CryptoError(defaultCode, String(error), error);
  }

  /**
   * Check if an error is a CryptoError with a specific code
   */
  static isCode(error: unknown, code: CryptoErrorCode): boolean {
    return error instanceof CryptoError && error.code === code;
  }
}

/**
 * Type guard to check if an error is a CryptoError
 */
export function isCryptoError(error: unknown): error is CryptoError {
  return error instanceof CryptoError;
}

/**
 * Assert that Web Crypto API is available
 * @throws CryptoError if Web Crypto API is not available
 */
export function assertCryptoAvailable(): void {
  if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
    throw new CryptoError(
      'UNSUPPORTED_ENVIRONMENT',
      'Web Crypto API is not available. Ensure you are running in a secure context (HTTPS) or a supported Node.js version (15+).'
    );
  }
}
