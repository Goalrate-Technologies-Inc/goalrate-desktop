/**
 * OfflineQueue
 * Persistent message queue using AsyncStorage for React Native
 * Survives app restart and handles offline-first sync
 */

import { v4 as uuidv4 } from 'uuid';
import type { SyncableEntityType } from '@goalrate-app/shared';
import type {
  PersistedQueueEntry,
  OfflineQueueConfig,
  OfflineQueueStats,
  OfflineQueueEntryStatus,
  OfflineQueueEventType,
  OfflineQueueEventData,
  OfflineStorageAdapter,
} from './types';
import { DEFAULT_OFFLINE_QUEUE_CONFIG } from './types';

// ============================================================================
// STORAGE KEYS
// ============================================================================

const QUEUE_INDEX_KEY_SUFFIX = ':queue_index';
const QUEUE_ENTRY_KEY_SUFFIX = ':entry:';
const QUEUE_META_KEY_SUFFIX = ':meta';

// ============================================================================
// OFFLINE QUEUE CLASS
// ============================================================================

/**
 * Persistent offline queue implementation
 * Uses AsyncStorage for persistence across app restarts
 */
export class OfflineQueue {
  private config: OfflineQueueConfig;
  private storage: OfflineStorageAdapter;
  private listeners: Map<
    OfflineQueueEventType,
    Set<(data: unknown) => void>
  > = new Map();
  private queueIndex: string[] = [];
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Create a new OfflineQueue
   * @param storage Storage adapter (AsyncStorage or mock for testing)
   * @param config Configuration options
   */
  constructor(
    storage: OfflineStorageAdapter,
    config: Partial<OfflineQueueConfig> = {}
  ) {
    this.storage = storage;
    this.config = { ...DEFAULT_OFFLINE_QUEUE_CONFIG, ...config };
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  /**
   * Initialize queue by loading index from storage
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    await this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      const indexKey = this.getIndexKey();
      const indexData = await this.storage.getItem(indexKey);

      if (indexData) {
        this.queueIndex = JSON.parse(indexData) as string[];
        // Clean up expired entries on init
        await this.cleanupExpired();
      }

      this.isInitialized = true;
    } catch (error) {
      this.emit('storageError', {
        operation: 'initialize',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // ==========================================================================
  // QUEUE OPERATIONS
  // ==========================================================================

  /**
   * Add entry to queue
   * @param entityType Type of entity being synced
   * @param entityId ID of the entity
   * @param vaultId Vault/workspace ID
   * @param changes Fields being changed
   * @param previousData Previous data for rollback
   * @param baseVersion Version being updated from
   * @param priority Priority (lower = higher priority, default 10)
   * @returns The created queue entry
   */
  async enqueue(
    entityType: SyncableEntityType,
    entityId: string,
    vaultId: string,
    changes: Record<string, unknown>,
    previousData: Record<string, unknown>,
    baseVersion: number,
    priority: number = 10
  ): Promise<PersistedQueueEntry> {
    await this.initialize();

    if (this.queueIndex.length >= this.config.maxQueueSize) {
      // Remove oldest completed/failed entries first
      await this.pruneQueue();

      if (this.queueIndex.length >= this.config.maxQueueSize) {
        throw new Error(
          `Offline queue is full (max: ${this.config.maxQueueSize})`
        );
      }
    }

    const now = new Date();
    const entry: PersistedQueueEntry = {
      id: uuidv4(),
      requestId: uuidv4(),
      entityType,
      entityId,
      vaultId,
      changes,
      previousData,
      baseVersion,
      queuedAt: now.toISOString(),
      clientTimestamp: now.toISOString(),
      attempts: 0,
      status: 'pending',
      priority,
    };

    await this.persistEntry(entry);
    this.queueIndex.push(entry.id);
    await this.persistIndex();

    this.emit('entryAdded', { entry });
    return entry;
  }

  /**
   * Get entry by ID
   */
  async getEntry(id: string): Promise<PersistedQueueEntry | null> {
    await this.initialize();

    try {
      const key = this.getEntryKey(id);
      const data = await this.storage.getItem(key);
      return data ? (JSON.parse(data) as PersistedQueueEntry) : null;
    } catch (error) {
      this.emit('storageError', {
        operation: 'getEntry',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Get all pending entries (sorted by priority and age)
   */
  async getPendingEntries(): Promise<PersistedQueueEntry[]> {
    await this.initialize();

    const entries: PersistedQueueEntry[] = [];

    for (const id of this.queueIndex) {
      const entry = await this.getEntry(id);
      if (
        entry &&
        (entry.status === 'pending' || entry.status === 'retrying')
      ) {
        entries.push(entry);
      }
    }

    // Sort by priority (lower = higher priority), then by age (older first)
    return entries.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return (
        new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime()
      );
    });
  }

  /**
   * Get entries by entity
   */
  async getEntriesByEntity(
    entityType: SyncableEntityType,
    entityId: string
  ): Promise<PersistedQueueEntry[]> {
    await this.initialize();

    const entries: PersistedQueueEntry[] = [];

    for (const id of this.queueIndex) {
      const entry = await this.getEntry(id);
      if (
        entry &&
        entry.entityType === entityType &&
        entry.entityId === entityId
      ) {
        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * Get all entries in queue
   */
  async getAllEntries(): Promise<PersistedQueueEntry[]> {
    await this.initialize();

    const entries: PersistedQueueEntry[] = [];

    for (const id of this.queueIndex) {
      const entry = await this.getEntry(id);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  // ==========================================================================
  // STATUS UPDATES
  // ==========================================================================

  /**
   * Update entry status
   */
  async updateEntryStatus(
    id: string,
    status: OfflineQueueEntryStatus,
    error?: string
  ): Promise<PersistedQueueEntry | null> {
    const entry = await this.getEntry(id);
    if (!entry) {
      return null;
    }

    const previousStatus = entry.status;
    entry.status = status;

    if (status === 'syncing' || status === 'retrying') {
      entry.attempts++;
      entry.lastAttemptAt = new Date().toISOString();
    }

    if (error) {
      entry.lastError = error;
    }

    await this.persistEntry(entry);
    this.emit('entryUpdated', { entry, previousStatus });

    return entry;
  }

  /**
   * Mark entry as completed and remove
   */
  async completeEntry(id: string): Promise<void> {
    await this.updateEntryStatus(id, 'completed');
    await this.removeEntry(id, 'completed');
  }

  /**
   * Mark entry as failed (or retrying if attempts remain)
   */
  async failEntry(id: string, error: string): Promise<void> {
    const entry = await this.getEntry(id);
    if (!entry) {
      return;
    }

    if (entry.attempts >= this.config.maxRetries) {
      await this.updateEntryStatus(id, 'failed', error);
    } else {
      await this.updateEntryStatus(id, 'retrying', error);
    }
  }

  /**
   * Reset failed entries to pending for retry
   */
  async resetFailedEntries(): Promise<number> {
    await this.initialize();

    let count = 0;

    for (const id of this.queueIndex) {
      const entry = await this.getEntry(id);
      if (entry && entry.status === 'failed') {
        entry.status = 'retrying';
        entry.attempts = 0;
        entry.lastError = undefined;
        await this.persistEntry(entry);
        count++;
      }
    }

    return count;
  }

  // ==========================================================================
  // REMOVAL OPERATIONS
  // ==========================================================================

  /**
   * Remove entry from queue
   */
  async removeEntry(
    id: string,
    reason: 'completed' | 'expired' | 'manual'
  ): Promise<void> {
    const entry = await this.getEntry(id);
    if (!entry) {
      return;
    }

    const key = this.getEntryKey(id);
    await this.storage.removeItem(key);

    const index = this.queueIndex.indexOf(id);
    if (index !== -1) {
      this.queueIndex.splice(index, 1);
      await this.persistIndex();
    }

    this.emit('entryRemoved', { entry, reason });
  }

  /**
   * Clear all entries
   */
  async clear(): Promise<void> {
    await this.initialize();

    const count = this.queueIndex.length;
    const keys = this.queueIndex.map((id) => this.getEntryKey(id));
    keys.push(this.getIndexKey());
    keys.push(this.getMetaKey());

    await this.storage.multiRemove(keys);
    this.queueIndex = [];

    this.emit('queueCleared', { count });
  }

  // ==========================================================================
  // STATISTICS & METADATA
  // ==========================================================================

  /**
   * Get queue statistics
   */
  async getStats(): Promise<OfflineQueueStats> {
    await this.initialize();

    const byStatus: Record<OfflineQueueEntryStatus, number> = {
      pending: 0,
      syncing: 0,
      retrying: 0,
      failed: 0,
      completed: 0,
    };

    let oldestEntryAge: number | null = null;
    let estimatedSize = 0;
    const now = Date.now();

    for (const id of this.queueIndex) {
      const entry = await this.getEntry(id);
      if (entry) {
        byStatus[entry.status]++;

        const entryAge = now - new Date(entry.queuedAt).getTime();
        if (oldestEntryAge === null || entryAge > oldestEntryAge) {
          oldestEntryAge = entryAge;
        }

        estimatedSize += JSON.stringify(entry).length;
      }
    }

    // Get metadata
    const metaKey = this.getMetaKey();
    const metaData = await this.storage.getItem(metaKey);
    const meta = metaData
      ? (JSON.parse(metaData) as Record<string, string>)
      : {};

    return {
      total: this.queueIndex.length,
      byStatus,
      oldestEntryAge,
      estimatedSize,
      lastSyncAttempt: meta.lastSyncAttempt
        ? new Date(meta.lastSyncAttempt)
        : null,
      lastSuccessfulSync: meta.lastSuccessfulSync
        ? new Date(meta.lastSuccessfulSync)
        : null,
    };
  }

  /**
   * Update metadata
   */
  async updateMeta(updates: Record<string, unknown>): Promise<void> {
    const metaKey = this.getMetaKey();
    const metaData = await this.storage.getItem(metaKey);
    const meta = metaData ? (JSON.parse(metaData) as Record<string, unknown>) : {};

    Object.assign(meta, updates);
    await this.storage.setItem(metaKey, JSON.stringify(meta));
  }

  /**
   * Get queue size
   */
  get size(): number {
    return this.queueIndex.length;
  }

  /**
   * Check if queue is empty
   */
  get isEmpty(): boolean {
    return this.queueIndex.length === 0;
  }

  /**
   * Check if queue is full
   */
  get isFull(): boolean {
    return this.queueIndex.length >= this.config.maxQueueSize;
  }

  // ==========================================================================
  // CLEANUP OPERATIONS
  // ==========================================================================

  /**
   * Clean up expired entries
   */
  private async cleanupExpired(): Promise<void> {
    const now = Date.now();
    const expiredIds: string[] = [];

    for (const id of this.queueIndex) {
      const entry = await this.getEntry(id);
      if (entry) {
        const age = now - new Date(entry.queuedAt).getTime();
        if (age > this.config.entryTTL) {
          expiredIds.push(id);
        }
      }
    }

    for (const id of expiredIds) {
      await this.removeEntry(id, 'expired');
    }
  }

  /**
   * Prune queue by removing completed/failed entries
   */
  private async pruneQueue(): Promise<void> {
    const toRemove: string[] = [];

    for (const id of this.queueIndex) {
      const entry = await this.getEntry(id);
      if (
        entry &&
        (entry.status === 'completed' || entry.status === 'failed')
      ) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      await this.removeEntry(id, 'manual');
    }
  }

  // ==========================================================================
  // STORAGE HELPERS
  // ==========================================================================

  private getIndexKey(): string {
    return `${this.config.storageKeyPrefix}${QUEUE_INDEX_KEY_SUFFIX}`;
  }

  private getEntryKey(id: string): string {
    return `${this.config.storageKeyPrefix}${QUEUE_ENTRY_KEY_SUFFIX}${id}`;
  }

  private getMetaKey(): string {
    return `${this.config.storageKeyPrefix}${QUEUE_META_KEY_SUFFIX}`;
  }

  private async persistEntry(entry: PersistedQueueEntry): Promise<void> {
    const key = this.getEntryKey(entry.id);
    await this.storage.setItem(key, JSON.stringify(entry));
  }

  private async persistIndex(): Promise<void> {
    const key = this.getIndexKey();
    await this.storage.setItem(key, JSON.stringify(this.queueIndex));
  }

  // ==========================================================================
  // EVENT EMITTER
  // ==========================================================================

  /**
   * Subscribe to queue events
   */
  on<T extends OfflineQueueEventType>(
    event: T,
    listener: (data: OfflineQueueEventData[T]) => void
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as (data: unknown) => void);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(listener as (data: unknown) => void);
    };
  }

  private emit<T extends OfflineQueueEventType>(
    event: T,
    data: OfflineQueueEventData[T]
  ): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data);
        } catch (error) {
          console.error(
            `Error in offline queue event listener for ${event}:`,
            error
          );
        }
      }
    }
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.listeners.clear();
    this.isInitialized = false;
    this.initPromise = null;
    this.queueIndex = [];
  }
}
