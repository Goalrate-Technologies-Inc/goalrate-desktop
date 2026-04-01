/**
 * Error Handling Utilities for Storage Adapter
 */

import type { StorageError, StorageErrorCode, StorageResult } from './interface';

// Re-export types for convenience
export type { StorageError, StorageErrorCode } from './interface';

// ============================================================================
// ERROR CREATION
// ============================================================================

/**
 * Create a storage error with consistent structure
 */
export function createStorageError(
  code: StorageErrorCode,
  message: string,
  cause?: unknown,
  details?: Record<string, unknown>
): StorageError {
  return {
    code,
    message,
    details,
    cause: cause instanceof Error ? cause : undefined,
  };
}

// ============================================================================
// RESULT WRAPPING
// ============================================================================

/**
 * Wrap a successful result value in StorageResult
 */
export function wrapSuccess<T>(data: T): StorageResult<T> {
  return { success: true, data };
}

/**
 * Wrap an error in StorageResult
 */
export function wrapError<T>(error: StorageError): StorageResult<T> {
  return { success: false, error };
}

/**
 * Wrap a result value in StorageResult (overloaded for convenience)
 */
export function wrapResult<T>(data: T): StorageResult<T>;
export function wrapResult<T>(data: undefined, error: StorageError): StorageResult<T>;
export function wrapResult<T>(data: T | undefined, error?: StorageError): StorageResult<T> {
  if (error) {
    return { success: false, error };
  }
  return { success: true, data: data as T };
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard for checking if result is successful
 */
export function isSuccess<T>(
  result: StorageResult<T>
): result is StorageResult<T> & { success: true; data: T } {
  return result.success && result.data !== undefined;
}

/**
 * Type guard for checking if result is an error
 */
export function isError<T>(
  result: StorageResult<T>
): result is StorageResult<T> & { success: false; error: StorageError } {
  return !result.success && result.error !== undefined;
}

/**
 * Type guard for StorageError
 */
export function isStorageError(error: unknown): error is StorageError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof (error as StorageError).code === 'string' &&
    typeof (error as StorageError).message === 'string'
  );
}

// ============================================================================
// ERROR CONVERSION
// ============================================================================

/**
 * Convert unknown error to StorageError
 */
export function toStorageError(
  error: unknown,
  fallbackMessage = 'An error occurred'
): StorageError {
  if (isStorageError(error)) {
    return error;
  }

  if (error instanceof Error) {
    // Check for common error types
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      return createStorageError('NETWORK_ERROR', 'Network request failed', error);
    }
    if (error.message.includes('not found') || error.message.includes('404')) {
      return createStorageError('ITEM_NOT_FOUND', error.message, error);
    }
    if (error.message.includes('permission') || error.message.includes('403')) {
      return createStorageError('PERMISSION_DENIED', error.message, error);
    }
    if (error.message.includes('already exists') || error.message.includes('409')) {
      return createStorageError('ITEM_ALREADY_EXISTS', error.message, error);
    }
    if (error.message.includes('validation') || error.message.includes('invalid')) {
      return createStorageError('VALIDATION_ERROR', error.message, error);
    }
    return createStorageError('UNKNOWN_ERROR', error.message, error);
  }

  if (typeof error === 'string') {
    return createStorageError('UNKNOWN_ERROR', error);
  }

  return createStorageError('UNKNOWN_ERROR', fallbackMessage, error);
}

// ============================================================================
// ASYNC HELPERS
// ============================================================================

/**
 * Async wrapper that catches errors and returns StorageResult
 */
export async function tryCatch<T>(
  operation: () => Promise<T>,
  errorContext?: string
): Promise<StorageResult<T>> {
  try {
    const data = await operation();
    return wrapSuccess(data);
  } catch (error) {
    const storageError = toStorageError(error, errorContext);
    return wrapError(storageError);
  }
}

/**
 * Async wrapper with custom error mapping
 */
export async function tryCatchWithMapping<T>(
  operation: () => Promise<T>,
  errorMapper: (error: unknown) => StorageError
): Promise<StorageResult<T>> {
  try {
    const data = await operation();
    return wrapSuccess(data);
  } catch (error) {
    return wrapError(errorMapper(error));
  }
}

// ============================================================================
// ERROR MESSAGES
// ============================================================================

/**
 * Map storage error code to user-friendly message
 */
export function getErrorMessage(code: StorageErrorCode): string {
  const messages: Record<StorageErrorCode, string> = {
    VAULT_NOT_FOUND: 'The vault could not be found. It may have been moved or deleted.',
    VAULT_NOT_OPEN: 'No vault is currently open. Please open a vault first.',
    VAULT_ALREADY_EXISTS: 'A vault already exists at this location.',
    VAULT_LOCKED: 'The vault is currently locked by another process.',
    ITEM_NOT_FOUND: 'The requested item could not be found.',
    ITEM_ALREADY_EXISTS: 'An item with this identifier already exists.',
    PERMISSION_DENIED: 'You do not have permission to perform this action.',
    VALIDATION_ERROR: 'The provided data is invalid.',
    NETWORK_ERROR: 'A network error occurred. Please check your connection.',
    SYNC_CONFLICT: 'A sync conflict was detected. Please resolve before continuing.',
    STORAGE_FULL: 'Storage is full. Please free up space to continue.',
    ENCRYPTION_ERROR: 'An encryption error occurred.',
    NOT_IMPLEMENTED: 'This feature is not yet implemented for your platform.',
    UNKNOWN_ERROR: 'An unexpected error occurred.',
  };
  return messages[code];
}

/**
 * Get formatted error message including details
 */
export function formatErrorMessage(error: StorageError): string {
  const baseMessage = error.message || getErrorMessage(error.code);
  if (error.details) {
    const detailStr = Object.entries(error.details)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
    return `${baseMessage} (${detailStr})`;
  }
  return baseMessage;
}

// ============================================================================
// RESULT UTILITIES
// ============================================================================

/**
 * Unwrap a result, throwing if it's an error
 */
export function unwrap<T>(result: StorageResult<T>): T {
  if (isSuccess(result)) {
    return result.data;
  }
  throw new Error(result.error?.message || 'Unknown error');
}

/**
 * Unwrap a result with a default value for errors
 */
export function unwrapOr<T>(result: StorageResult<T>, defaultValue: T): T {
  if (isSuccess(result)) {
    return result.data;
  }
  return defaultValue;
}

/**
 * Map a successful result to a new value
 */
export function mapResult<T, U>(
  result: StorageResult<T>,
  mapper: (data: T) => U
): StorageResult<U> {
  if (isSuccess(result)) {
    return wrapSuccess(mapper(result.data));
  }
  return result as unknown as StorageResult<U>;
}

/**
 * Chain multiple async operations, stopping on first error
 */
export async function chainResults<T>(
  operations: Array<() => Promise<StorageResult<T>>>
): Promise<StorageResult<T[]>> {
  const results: T[] = [];

  for (const operation of operations) {
    const result = await operation();
    if (!isSuccess(result)) {
      return wrapError(result.error!);
    }
    results.push(result.data);
  }

  return wrapSuccess(results);
}
