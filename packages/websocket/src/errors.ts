/**
 * WebSocket Error Handling
 */

// ============================================================================
// ERROR CODES
// ============================================================================

/**
 * WebSocket error codes
 */
export type WebSocketErrorCode =
  | 'CONNECTION_FAILED'
  | 'CONNECTION_CLOSED'
  | 'CONNECTION_TIMEOUT'
  | 'AUTHENTICATION_FAILED'
  | 'AUTHENTICATION_EXPIRED'
  | 'SEND_FAILED'
  | 'MESSAGE_TOO_LARGE'
  | 'QUEUE_FULL'
  | 'INVALID_MESSAGE'
  | 'HEARTBEAT_TIMEOUT'
  | 'MAX_RECONNECT_ATTEMPTS'
  | 'SUBSCRIPTION_FAILED'
  | 'UNKNOWN_ERROR';

/**
 * WebSocket close codes (from RFC 6455)
 */
export const CLOSE_CODES = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,
  UNSUPPORTED_DATA: 1003,
  NO_STATUS: 1005,
  ABNORMAL_CLOSURE: 1006,
  INVALID_PAYLOAD: 1007,
  POLICY_VIOLATION: 1008,
  MESSAGE_TOO_BIG: 1009,
  MANDATORY_EXTENSION: 1010,
  INTERNAL_ERROR: 1011,
  SERVICE_RESTART: 1012,
  TRY_AGAIN_LATER: 1013,
  BAD_GATEWAY: 1014,
  TLS_HANDSHAKE_FAILED: 1015,
  // Custom application codes (4000-4999)
  AUTH_FAILED: 4001,
  AUTH_EXPIRED: 4002,
  RATE_LIMITED: 4003,
  INVALID_TOKEN: 4004,
} as const;

// ============================================================================
// ERROR CLASS
// ============================================================================

/**
 * WebSocket error with typed code
 */
export class WebSocketError extends Error {
  readonly code: WebSocketErrorCode;
  readonly closeCode?: number;
  readonly cause?: Error;
  readonly timestamp: Date;
  readonly recoverable: boolean;

  constructor(
    code: WebSocketErrorCode,
    message: string,
    options?: {
      closeCode?: number;
      cause?: Error;
      recoverable?: boolean;
    }
  ) {
    super(message);
    this.name = 'WebSocketError';
    this.code = code;
    this.closeCode = options?.closeCode;
    this.cause = options?.cause;
    this.timestamp = new Date();
    this.recoverable = options?.recoverable ?? this.isRecoverableByDefault(code);

    // Maintain proper stack trace for where error was thrown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((Error as any).captureStackTrace) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Error as any).captureStackTrace(this, WebSocketError);
    }
  }

  /**
   * Determine if error is recoverable by default based on code
   */
  private isRecoverableByDefault(code: WebSocketErrorCode): boolean {
    switch (code) {
      case 'CONNECTION_FAILED':
      case 'CONNECTION_CLOSED':
      case 'CONNECTION_TIMEOUT':
      case 'SEND_FAILED':
      case 'HEARTBEAT_TIMEOUT':
        return true;
      case 'AUTHENTICATION_FAILED':
      case 'AUTHENTICATION_EXPIRED':
      case 'MAX_RECONNECT_ATTEMPTS':
      case 'INVALID_MESSAGE':
      case 'QUEUE_FULL':
      case 'MESSAGE_TOO_LARGE':
      case 'SUBSCRIPTION_FAILED':
      case 'UNKNOWN_ERROR':
        return false;
      default:
        return false;
    }
  }

  /**
   * Convert to plain object for serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      closeCode: this.closeCode,
      timestamp: this.timestamp.toISOString(),
      recoverable: this.recoverable,
      stack: this.stack,
    };
  }
}

// ============================================================================
// ERROR FACTORIES
// ============================================================================

/**
 * Create connection failed error
 */
export function connectionFailed(reason: string, cause?: Error): WebSocketError {
  return new WebSocketError('CONNECTION_FAILED', `Connection failed: ${reason}`, {
    cause,
    recoverable: true,
  });
}

/**
 * Create connection closed error
 */
export function connectionClosed(
  code: number,
  reason: string,
  wasClean: boolean
): WebSocketError {
  return new WebSocketError(
    'CONNECTION_CLOSED',
    `Connection closed: ${reason || 'No reason provided'}`,
    {
      closeCode: code,
      recoverable: !wasClean || code !== CLOSE_CODES.NORMAL,
    }
  );
}

/**
 * Create authentication failed error
 */
export function authenticationFailed(reason: string): WebSocketError {
  return new WebSocketError(
    'AUTHENTICATION_FAILED',
    `Authentication failed: ${reason}`,
    {
      closeCode: CLOSE_CODES.AUTH_FAILED,
      recoverable: false,
    }
  );
}

/**
 * Create authentication expired error
 */
export function authenticationExpired(): WebSocketError {
  return new WebSocketError(
    'AUTHENTICATION_EXPIRED',
    'Authentication token has expired',
    {
      closeCode: CLOSE_CODES.AUTH_EXPIRED,
      recoverable: true, // Can recover by refreshing token
    }
  );
}

/**
 * Create send failed error
 */
export function sendFailed(reason: string, cause?: Error): WebSocketError {
  return new WebSocketError('SEND_FAILED', `Failed to send message: ${reason}`, {
    cause,
    recoverable: true,
  });
}

/**
 * Create heartbeat timeout error
 */
export function heartbeatTimeout(): WebSocketError {
  return new WebSocketError(
    'HEARTBEAT_TIMEOUT',
    'Server did not respond to heartbeat',
    { recoverable: true }
  );
}

/**
 * Create max reconnect attempts error
 */
export function maxReconnectAttempts(attempts: number): WebSocketError {
  return new WebSocketError(
    'MAX_RECONNECT_ATTEMPTS',
    `Max reconnection attempts (${attempts}) reached`,
    { recoverable: false }
  );
}

/**
 * Create queue full error
 */
export function queueFull(maxSize: number): WebSocketError {
  return new WebSocketError(
    'QUEUE_FULL',
    `Message queue is full (max: ${maxSize})`,
    { recoverable: false }
  );
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if error is a WebSocketError
 */
export function isWebSocketError(error: unknown): error is WebSocketError {
  return error instanceof WebSocketError;
}

/**
 * Check if close code indicates authentication error
 */
export function isAuthError(closeCode: number): boolean {
  return (
    closeCode === CLOSE_CODES.AUTH_FAILED ||
    closeCode === CLOSE_CODES.AUTH_EXPIRED ||
    closeCode === CLOSE_CODES.INVALID_TOKEN
  );
}

/**
 * Check if close code indicates rate limiting
 */
export function isRateLimited(closeCode: number): boolean {
  return closeCode === CLOSE_CODES.RATE_LIMITED;
}

/**
 * Map close code to error code
 */
export function closeCodeToErrorCode(closeCode: number): WebSocketErrorCode {
  switch (closeCode) {
    case CLOSE_CODES.AUTH_FAILED:
    case CLOSE_CODES.INVALID_TOKEN:
      return 'AUTHENTICATION_FAILED';
    case CLOSE_CODES.AUTH_EXPIRED:
      return 'AUTHENTICATION_EXPIRED';
    case CLOSE_CODES.MESSAGE_TOO_BIG:
      return 'MESSAGE_TOO_LARGE';
    case CLOSE_CODES.ABNORMAL_CLOSURE:
    case CLOSE_CODES.INTERNAL_ERROR:
      return 'CONNECTION_CLOSED';
    default:
      return 'UNKNOWN_ERROR';
  }
}
