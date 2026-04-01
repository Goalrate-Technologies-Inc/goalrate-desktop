/**
 * API Error codes for categorizing error types
 */
export type ApiErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

/**
 * API Error with typed error codes and structured data
 */
export class ApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;
  public readonly requestId?: string;
  public cause?: Error;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number = 0,
    details?: Record<string, unknown>,
    requestId?: string
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;

    // Maintain proper stack trace for where error was thrown (V8 only)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (Error as any).captureStackTrace === 'function') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Error as any).captureStackTrace(this, ApiError);
    }
  }

  /**
   * Convert to JSON for logging/serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      status: this.status,
      details: this.details,
      requestId: this.requestId,
    };
  }
}

/**
 * Type guard to check if an error is an ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Map HTTP status code to ApiErrorCode
 */
export function statusToErrorCode(status: number): ApiErrorCode {
  if (status === 401) {
    return 'UNAUTHORIZED';
  }
  if (status === 403) {
    return 'FORBIDDEN';
  }
  if (status === 404) {
    return 'NOT_FOUND';
  }
  if (status === 409) {
    return 'CONFLICT';
  }
  if (status === 422 || status === 400) {
    return 'VALIDATION_ERROR';
  }
  if (status === 429) {
    return 'RATE_LIMITED';
  }
  if (status >= 500) {
    return 'SERVER_ERROR';
  }
  return 'UNKNOWN';
}

/**
 * Create an ApiError from an HTTP response
 */
export function createApiError(
  status: number,
  message: string,
  data?: unknown,
  requestId?: string
): ApiError {
  const code = statusToErrorCode(status);
  const details =
    typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>)
      : data !== undefined
        ? { raw: data }
        : undefined;

  return new ApiError(code, message, status, details, requestId);
}

/**
 * Create a network error
 */
export function createNetworkError(
  message: string,
  cause?: Error
): ApiError {
  const error = new ApiError('NETWORK_ERROR', message, 0);
  if (cause) {
    error.cause = cause;
  }
  return error;
}

/**
 * Create a timeout error
 */
export function createTimeoutError(timeoutMs: number): ApiError {
  return new ApiError(
    'TIMEOUT',
    `Request timed out after ${timeoutMs}ms`,
    408
  );
}
