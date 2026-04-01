/**
 * WebSocket Package Types
 * Extends types from @goalrate-app/shared
 */

import type {
  WebSocketConfig as SharedWebSocketConfig,
  WebSocketState as SharedWebSocketState,
} from '@goalrate-app/shared';

// Re-export enums as values (they work as both types and values)
export { ConnectionState, MessageType, TOPICS } from '@goalrate-app/shared';

// Re-export other shared types
export type {
  WebSocketMessage,
  SubscribePayload,
  ActivityUpdatePayload,
  GoalUpdatePayload,
  ProjectUpdatePayload,
  PresencePayload,
  NotificationPayload,
} from '@goalrate-app/shared';

// Import for use in this file
import { ConnectionState, MessageType } from '@goalrate-app/shared';
import type { WebSocketMessage } from '@goalrate-app/shared';

// ============================================================================
// EXTENDED CONFIGURATION
// ============================================================================

/**
 * Extended WebSocket configuration with all options
 */
export interface WebSocketManagerConfig extends SharedWebSocketConfig {
  /** User ID for connection */
  userId: string;

  /** Authentication token (JWT) */
  authToken?: string;

  /** Base URL for WebSocket server */
  url: string;

  /** Reconnection settings */
  reconnect?: {
    /** Enable automatic reconnection (default: true) */
    enabled?: boolean;
    /** Initial delay in ms (default: 1000) */
    initialDelay?: number;
    /** Maximum delay in ms (default: 30000) */
    maxDelay?: number;
    /** Multiplier for exponential backoff (default: 2) */
    multiplier?: number;
    /** Maximum reconnection attempts (default: 10) */
    maxAttempts?: number;
    /** Add jitter to prevent thundering herd (default: true) */
    jitter?: boolean;
  };

  /** Heartbeat/ping settings */
  heartbeat?: {
    /** Enable heartbeat (default: true) */
    enabled?: boolean;
    /** Ping interval in ms (default: 30000) */
    interval?: number;
    /** Pong timeout in ms (default: 10000) */
    timeout?: number;
  };

  /** Message queue settings */
  queue?: {
    /** Enable message queuing during reconnection (default: true) */
    enabled?: boolean;
    /** Maximum queue size (default: 100) */
    maxSize?: number;
    /** Queue message TTL in ms (default: 60000) */
    messageTtl?: number;
  };
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  reconnect: {
    enabled: true,
    initialDelay: 1000,
    maxDelay: 30000,
    multiplier: 2,
    maxAttempts: 10,
    jitter: true,
  },
  heartbeat: {
    enabled: true,
    interval: 30000,
    timeout: 10000,
  },
  queue: {
    enabled: true,
    maxSize: 100,
    messageTtl: 60000,
  },
} as const;

// ============================================================================
// EXTENDED STATE
// ============================================================================

/**
 * Extended WebSocket state with additional tracking
 */
export interface WebSocketManagerState extends SharedWebSocketState {
  /** Current connection state */
  connectionState: ConnectionState;

  /** Number of reconnection attempts */
  reconnectAttempts: number;

  /** Currently subscribed topics */
  subscribedTopics: string[];

  /** Session ID from server */
  sessionId?: string;

  /** Last successful connection time */
  connectedAt?: Date;

  /** Last disconnection time */
  disconnectedAt?: Date;

  /** Last error message */
  lastError?: string;

  /** Number of queued messages */
  queuedMessageCount: number;
}

// ============================================================================
// EVENTS
// ============================================================================

/**
 * Event types emitted by WebSocketManager
 */
export type WebSocketEventType =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'message'
  | 'error'
  | 'stateChange';

/**
 * Event handler signatures
 */
export interface WebSocketEventHandlers {
  connecting: () => void;
  connected: (sessionId: string) => void;
  disconnected: (code: number, reason: string, wasClean: boolean) => void;
  reconnecting: (attempt: number, maxAttempts: number) => void;
  message: <T>(message: WebSocketMessage<T>) => void;
  error: (error: Error) => void;
  stateChange: (state: WebSocketManagerState) => void;
}

/**
 * Generic event handler type
 */
export type WebSocketEventHandler<E extends WebSocketEventType> =
  WebSocketEventHandlers[E];

// ============================================================================
// MESSAGE QUEUE
// ============================================================================

/**
 * Queued message with metadata
 */
export interface QueuedMessage<T = unknown> {
  /** Unique message ID */
  id: string;
  /** Message type */
  type: MessageType | string;
  /** Message data */
  data: T;
  /** Queue timestamp */
  queuedAt: Date;
  /** Number of send attempts */
  attempts: number;
}

// ============================================================================
// PRESENCE TYPES
// ============================================================================

/**
 * User presence information
 */
export interface UserPresence {
  userId: string;
  username: string;
  avatarUrl?: string;
  status: 'online' | 'offline' | 'away' | 'busy';
  lastActivity?: Date;
}

/**
 * Entity viewer information
 */
export interface EntityViewer {
  userId: string;
  username: string;
  avatarUrl?: string;
  startedAt: Date;
}

/**
 * Entity editor information
 */
export interface EntityEditor {
  userId: string;
  username: string;
  avatarUrl?: string;
  fieldName?: string;
  startedAt: Date;
}

/**
 * Presence state for a workspace
 */
export interface WorkspacePresence {
  workspaceId: string;
  users: UserPresence[];
  updatedAt: Date;
}

/**
 * Entity presence state
 */
export interface EntityPresence {
  entityType: string;
  entityId: string;
  viewers: EntityViewer[];
  editors: EntityEditor[];
  updatedAt: Date;
}
