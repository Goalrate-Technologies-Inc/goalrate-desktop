/**
 * Team Storage Adapter Types
 * Types for encrypted team vault storage with operation queuing
 */

import type { VaultEncryptionConfig } from '@goalrate-app/shared';
import type { ApiStorageAdapterOptions } from '../web/ApiStorageAdapter';

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

/**
 * Entity change event data for sync integration
 */
export interface EntityChangeEvent {
  /** Type of entity that changed */
  entityType: string;
  /** ID of the entity */
  entityId: string;
  /** Vault/workspace ID */
  vaultId: string;
  /** Type of change */
  changeType: 'create' | 'update' | 'delete';
  /** Fields that changed (for updates) */
  changes?: Record<string, unknown>;
  /** Current version after the change */
  version?: number;
}

/**
 * Configuration for the team storage adapter
 */
export interface TeamStorageConfig extends ApiStorageAdapterOptions {
  /**
   * Maximum number of operations to queue when vault is locked
   * @default 50
   */
  maxQueueSize?: number;

  /**
   * Timeout in milliseconds for queued operations
   * @default 300000 (5 minutes)
   */
  operationTimeout?: number;

  /**
   * Callback when vault requires unlock
   */
  onLockRequired?: (vaultId: string) => void;

  /**
   * Callback when queued operations are flushed
   */
  onQueueFlushed?: (operationCount: number) => void;

  /**
   * Callback when an entity is created, updated, or deleted.
   * Use this to integrate with real-time sync mechanisms like useOptimisticUpdate.
   */
  onEntityChange?: (event: EntityChangeEvent) => void;
}

/**
 * Default configuration values
 */
export const DEFAULT_TEAM_CONFIG = {
  maxQueueSize: 50,
  operationTimeout: 5 * 60 * 1000, // 5 minutes
} as const;

// ============================================================================
// SESSION TYPES
// ============================================================================

/**
 * Team vault session state
 */
export interface TeamVaultSession {
  /** The vault ID this session is for */
  vaultId: string;
  /** The derived encryption key (only in memory) */
  key: CryptoKey;
  /** When the session was created */
  createdAt: Date;
  /** Encryption configuration from the vault */
  encryptionConfig: VaultEncryptionConfig;
}

/**
 * Vault lock state
 */
export type VaultLockState = 'locked' | 'unlocking' | 'unlocked';

// ============================================================================
// ENCRYPTED DATA TYPES
// ============================================================================

/**
 * Wrapper for encrypted field data
 * Format matches the crypto package output: base64(nonce).base64(ciphertext)
 */
export type EncryptedString = string & { readonly __brand: 'EncryptedString' };

/**
 * Encrypted payload sent to/from the API
 * Contains both encrypted sensitive fields and unencrypted metadata
 */
export interface EncryptedPayload<T> {
  /** The encrypted JSON string containing sensitive fields */
  encrypted: EncryptedString;
  /** Unencrypted metadata for server-side queries */
  metadata: EncryptedPayloadMetadata<T>;
}

/**
 * Metadata extracted from an entity for server-side queries
 * These fields are NOT encrypted
 */
export interface EncryptedPayloadMetadata<T> {
  /** Entity ID */
  id: string;
  /** Entity type identifier */
  type: EntityType;
  /** Timestamp fields */
  created?: string;
  updated?: string;
  /** Status fields */
  status?: string;
  column?: string;
  /** Numeric fields */
  points?: number;
  priority?: string;
  /** Reference fields */
  parentId?: string;
  epicId?: string;
  sprintId?: string;
  /** Additional type-specific metadata */
  extra?: Partial<T>;
}

/**
 * Entity types for encrypted payloads
 */
export type EntityType =
  | 'goal'
  | 'goal_task'
  | 'project'
  | 'epic'
  | 'sprint'
  | 'focus_day';

// ============================================================================
// OPERATION QUEUE TYPES
// ============================================================================

/**
 * A pending operation waiting for vault unlock
 */
export interface PendingOperation<T = unknown> {
  /** Unique operation ID */
  id: string;
  /** The vault this operation is for */
  vaultId: string;
  /** Operation type for debugging */
  operationType: string;
  /** The operation to execute once unlocked */
  execute: () => Promise<T>;
  /** Promise resolve function */
  resolve: (value: T) => void;
  /** Promise reject function */
  reject: (error: Error) => void;
  /** When the operation was queued */
  queuedAt: Date;
  /** Timeout handle */
  timeoutId?: ReturnType<typeof setTimeout>;
}

/**
 * Queue statistics
 */
export interface QueueStats {
  /** Number of pending operations */
  pendingCount: number;
  /** Oldest operation timestamp */
  oldestOperation?: Date;
  /** Whether queue is at capacity */
  atCapacity: boolean;
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Team storage specific error codes
 */
export type TeamStorageErrorCode =
  | 'VAULT_LOCKED'
  | 'UNLOCK_FAILED'
  | 'QUEUE_FULL'
  | 'OPERATION_TIMEOUT'
  | 'ENCRYPTION_FAILED'
  | 'DECRYPTION_FAILED'
  | 'INVALID_PASSWORD'
  | 'SESSION_EXPIRED';

/**
 * Team storage error details
 */
export interface TeamStorageErrorDetails {
  code: TeamStorageErrorCode;
  vaultId?: string;
  operationType?: string;
  queueSize?: number;
}

// ============================================================================
// FIELD ENCRYPTION SPECIFICATION
// ============================================================================

/**
 * Specification of which fields to encrypt for each entity type
 */
export interface FieldEncryptionSpec {
  /** Fields containing sensitive text content */
  sensitiveFields: string[];
  /** Fields containing arrays of sensitive strings */
  sensitiveArrayFields: string[];
  /** Nested object paths with sensitive fields (e.g., 'measurable.unit') */
  nestedSensitiveFields: string[];
}

/**
 * Field encryption specifications by entity type
 */
export const ENCRYPTION_SPECS: Record<EntityType, FieldEncryptionSpec> = {
  goal: {
    sensitiveFields: ['title', 'specific'],
    sensitiveArrayFields: ['relevant', 'tags'],
    nestedSensitiveFields: ['measurable.unit'],
  },
  goal_task: {
    sensitiveFields: ['title'],
    sensitiveArrayFields: [],
    nestedSensitiveFields: ['subtasks.*.title'],
  },
  project: {
    sensitiveFields: ['title', 'description'],
    sensitiveArrayFields: ['tags'],
    nestedSensitiveFields: [],
  },
  epic: {
    sensitiveFields: ['title', 'description'],
    sensitiveArrayFields: [],
    nestedSensitiveFields: [],
  },
  sprint: {
    sensitiveFields: ['name', 'goal'],
    sensitiveArrayFields: [],
    nestedSensitiveFields: [
      'retrospective.went_well',
      'retrospective.to_improve',
      'retrospective.action_items',
    ],
  },
  focus_day: {
    sensitiveFields: ['reflection'],
    sensitiveArrayFields: [],
    nestedSensitiveFields: ['items.*.title', 'items.*.reason'],
  },
};
