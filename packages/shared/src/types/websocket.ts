/**
 * WebSocket Types
 * Type-safe WebSocket communication types
 */

// ============================================================================
// CONNECTION STATE
// ============================================================================

/**
 * WebSocket connection states
 */
export enum ConnectionState {
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  RECONNECTING = 'RECONNECTING',
  ERROR = 'ERROR',
}

// ============================================================================
// MESSAGE TYPES
// ============================================================================

/**
 * WebSocket message types - matches backend MessageType enum
 */
export enum MessageType {
  // Connection management
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  PING = 'ping',
  PONG = 'pong',
  ERROR = 'error',

  // Subscription management
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',
  SUBSCRIBED = 'subscribed',
  UNSUBSCRIBED = 'unsubscribed',

  // Activity updates
  ACTIVITY_UPDATE = 'activity_update',
  ACTIVITY_CREATED = 'activity_created',
  ACTIVITY_DELETED = 'activity_deleted',

  // Goal updates
  GOAL_UPDATE = 'goal_update',
  GOAL_PROGRESS = 'goal_progress',
  GOAL_COMPLETED = 'goal_completed',

  // Project updates
  PROJECT_UPDATE = 'project_update',
  TASK_UPDATE = 'task_update',

  // Social updates
  FOLLOW_UPDATE = 'follow_update',
  NOTIFICATION = 'notification',

  // Presence
  PRESENCE_UPDATE = 'presence_update',
  USER_ONLINE = 'user_online',
  USER_OFFLINE = 'user_offline',

  // Workspace updates
  WORKSPACE_UPDATE = 'workspace_update',
  MEMBER_UPDATE = 'member_update',

  // Sync operations
  DATA_SYNC = 'data_sync',           // Client sending entity changes
  SYNC_ACK = 'sync_ack',             // Server confirming change applied
  SYNC_REJECT = 'sync_reject',       // Server rejecting change
  ENTITY_CHANGED = 'entity_changed', // Server broadcasting entity update to other clients
}

// ============================================================================
// MESSAGE PAYLOADS
// ============================================================================

/**
 * Generic WebSocket message
 */
export interface WebSocketMessage<T = unknown> {
  type: MessageType | string;
  data?: T;
  timestamp?: string;
  userId?: string;
  topic?: string;
}

/**
 * Subscribe payload
 */
export interface SubscribePayload {
  topic: string;
}

/**
 * Activity update payload
 */
export interface ActivityUpdatePayload {
  activityId: string;
  type: string;
  userId: string;
  entityType: string;
  entityId: string;
}

/**
 * Goal update payload
 */
export interface GoalUpdatePayload {
  goalId: string;
  progress?: number;
  status?: string;
  title?: string;
}

/**
 * Project update payload
 */
export interface ProjectUpdatePayload {
  projectId: string;
  update: Record<string, unknown>;
}

/**
 * Presence payload
 */
export interface PresencePayload {
  userId: string;
  status: 'online' | 'offline' | 'away';
  lastSeen?: string;
}

/**
 * Notification payload
 */
export interface NotificationPayload {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

// ============================================================================
// SYNC PAYLOADS
// ============================================================================

/**
 * Syncable entity types
 */
export type SyncableEntityType = 'goal' | 'project' | 'task' | 'epic' | 'sprint' | 'goal_task';

/**
 * Data sync payload - client sending entity changes
 */
export interface DataSyncPayload {
  /** Client-generated request ID for matching ACK */
  requestId: string;
  /** Type of entity being synced */
  entityType: SyncableEntityType;
  /** ID of the entity */
  entityId: string;
  /** ID of the vault containing the entity */
  vaultId: string;
  /** Fields being changed with their new values */
  changes: Record<string, unknown>;
  /** Version the client is basing changes on */
  baseVersion: number;
  /** ISO timestamp of when change was made */
  timestamp: string;
  /** Client-side timestamp for LWW conflict resolution */
  clientTimestamp?: string;
}

/**
 * Sync acknowledgment payload - server confirming change applied
 */
export interface SyncAckPayload {
  /** Request ID from original DataSyncPayload */
  requestId: string;
  /** Type of entity that was synced */
  entityType: string;
  /** ID of the entity */
  entityId: string;
  /** New version after update */
  newVersion: number;
  /** Server timestamp of update */
  timestamp: string;
  /** True if conflict was auto-resolved by LWW (client timestamp was newer) */
  resolvedByLWW?: boolean;
  /** Server's write_timestamp for LWW comparison */
  writeTimestamp?: string;
}

/**
 * Sync reject reasons
 */
export type SyncRejectReason = 'conflict' | 'validation' | 'permission' | 'not_found';

/**
 * Sync reject payload - server rejecting change
 */
export interface SyncRejectPayload {
  /** Request ID from original DataSyncPayload */
  requestId: string;
  /** Type of entity */
  entityType: string;
  /** ID of the entity */
  entityId: string;
  /** Reason for rejection */
  reason: SyncRejectReason;
  /** Current version on server (for conflict) */
  currentVersion?: number;
  /** Current data on server (for conflict resolution) */
  currentData?: Record<string, unknown>;
  /** Human-readable error message */
  message: string;
  /** LWW resolution suggestion when reason is 'conflict' */
  lwwResolution?: 'local' | 'server';
  /** Server's write_timestamp for LWW comparison */
  serverTimestamp?: string;
}

/**
 * Entity changed payload - server broadcasting update to other clients
 */
export interface EntityChangedPayload {
  /** Type of entity that changed */
  entityType: string;
  /** ID of the entity */
  entityId: string;
  /** ID of the vault containing the entity */
  vaultId: string;
  /** Fields that changed with their new values */
  changes: Record<string, unknown>;
  /** New version after update */
  newVersion: number;
  /** ID of user who made the change */
  updatedBy: string;
  /** Server timestamp of update */
  timestamp: string;
  /** Server's write_timestamp for the entity */
  writeTimestamp?: string;
}

// ============================================================================
// TOPIC HELPERS
// ============================================================================

/**
 * Standard topic patterns for subscriptions
 */
export const TOPICS = {
  // User-specific topics
  user: (userId: string) => `user:${userId}`,
  userNotifications: (userId: string) => `user:${userId}:notifications`,
  userActivity: (userId: string) => `user:${userId}:activity`,

  // Goal topics
  goal: (goalId: string) => `goal:${goalId}`,
  userGoals: (userId: string) => `user:${userId}:goals`,

  // Project topics
  project: (projectId: string) => `project:${projectId}`,
  projectStories: (projectId: string) => `project:${projectId}:stories`,

  // Workspace topics
  workspace: (workspaceId: string) => `workspace:${workspaceId}`,
  workspaceMembers: (workspaceId: string) => `workspace:${workspaceId}:members`,

  // Vault/sync topics
  vault: (vaultId: string) => `vault:${vaultId}`,
  vaultSync: (vaultId: string) => `vault:${vaultId}:sync`,
  entity: (entityType: string, entityId: string) => `entity:${entityType}:${entityId}`,

  // Global topics
  feed: 'feed',
  presence: 'presence',
} as const;

// ============================================================================
// WEBSOCKET CONFIG
// ============================================================================

/**
 * WebSocket connection configuration
 */
export interface WebSocketConfig {
  url: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
  pongTimeout?: number;
}

/**
 * WebSocket connection state
 */
export interface WebSocketState {
  connectionState: ConnectionState;
  reconnectAttempts: number;
  lastPingAt?: Date;
  lastPongAt?: Date;
  subscribedTopics: string[];
}
