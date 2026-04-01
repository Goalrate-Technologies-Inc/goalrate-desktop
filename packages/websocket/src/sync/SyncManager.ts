/**
 * SyncManager
 * Manages pending updates, handles server acknowledgments/rejections,
 * and coordinates real-time sync with optimistic concurrency control.
 */

import { v4 as uuidv4 } from 'uuid';
import type { WebSocketManager } from '../WebSocketManager';
import type {
  SyncAckPayload,
  SyncRejectPayload,
  EntityChangedPayload,
  DataSyncPayload,
} from '@goalrate-app/shared';
import type {
  PendingUpdate,
  SyncConflict,
  SyncManagerOptions,
  SyncEventType,
  SyncEventData,
} from './types';

type EventListener<T extends SyncEventType> = (data: SyncEventData[T]) => void;

/**
 * SyncManager handles the synchronization lifecycle:
 * 1. Queue optimistic updates
 * 2. Send updates via WebSocket
 * 3. Handle ACK/REJECT responses
 * 4. Detect and track conflicts
 * 5. Process remote changes from other clients
 */
export class SyncManager {
  private wsManager: WebSocketManager;
  private options: Required<SyncManagerOptions>;
  private pendingUpdates: Map<string, PendingUpdate> = new Map();
  private conflicts: Map<string, SyncConflict> = new Map();
  private listeners: Map<SyncEventType, Set<EventListener<SyncEventType>>> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(wsManager: WebSocketManager, options: SyncManagerOptions = {}) {
    this.wsManager = wsManager;
    this.options = {
      maxRetries: options.maxRetries ?? 3,
      retryBaseDelay: options.retryBaseDelay ?? 1000,
      retryMaxDelay: options.retryMaxDelay ?? 30000,
      pendingUpdateTTL: options.pendingUpdateTTL ?? 60000,
      onAck: options.onAck ?? (() => {}),
      onReject: options.onReject ?? (() => {}),
      onConflict: options.onConflict ?? (() => {}),
    };

    // Set up message listeners
    this.setupMessageListeners();

    // Start cleanup interval
    this.startCleanupInterval();
  }

  /**
   * Set up listeners for sync-related WebSocket messages
   */
  private setupMessageListeners(): void {
    // Listen for SYNC_ACK messages
    this.wsManager.onMessage('sync_ack', (payload: SyncAckPayload) => {
      this.handleAck(payload);
    });

    // Listen for SYNC_REJECT messages
    this.wsManager.onMessage('sync_reject', (payload: SyncRejectPayload) => {
      this.handleReject(payload);
    });

    // Listen for ENTITY_CHANGED messages (from other clients)
    this.wsManager.onMessage('entity_changed', (payload: EntityChangedPayload) => {
      this.handleRemoteChange(payload);
    });
  }

  /**
   * Start the cleanup interval for expired pending updates
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredUpdates();
    }, 10000); // Check every 10 seconds
  }

  /**
   * Stop the cleanup interval
   */
  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.pendingUpdates.clear();
    this.conflicts.clear();
    this.listeners.clear();
  }

  /**
   * Queue an update for sync
   */
  public queueUpdate(
    entityType: string,
    entityId: string,
    vaultId: string,
    changes: Record<string, unknown>,
    previousData: Record<string, unknown>,
    baseVersion: number,
  ): PendingUpdate {
    const requestId = uuidv4();
    const now = new Date();
    const update: PendingUpdate = {
      requestId,
      entityType,
      entityId,
      vaultId,
      changes,
      previousData,
      baseVersion,
      timestamp: now,
      clientTimestamp: now.toISOString(), // LWW timestamp
      status: 'pending',
      retryCount: 0,
    };

    this.pendingUpdates.set(requestId, update);
    this.emit('updateQueued', { update });

    // Send immediately if connected
    if (this.wsManager.isConnected()) {
      this.sendUpdate(update);
    }

    return update;
  }

  /**
   * Send a pending update via WebSocket
   */
  private sendUpdate(update: PendingUpdate): void {
    const payload: DataSyncPayload = {
      requestId: update.requestId,
      entityType: update.entityType as DataSyncPayload['entityType'],
      entityId: update.entityId,
      vaultId: update.vaultId,
      changes: update.changes,
      baseVersion: update.baseVersion,
      timestamp: update.timestamp.toISOString(),
      clientTimestamp: update.clientTimestamp, // LWW timestamp
    };

    this.wsManager.send('data_sync', payload);
    update.status = 'sent';
    this.emit('updateSent', { update });
  }

  /**
   * Handle SYNC_ACK from server
   */
  private handleAck(payload: SyncAckPayload): void {
    const update = this.pendingUpdates.get(payload.requestId);
    if (!update) {
      return; // Unknown request ID
    }

    update.status = 'acknowledged';
    this.pendingUpdates.delete(payload.requestId);

    this.emit('updateAcked', {
      requestId: payload.requestId,
      newVersion: payload.newVersion,
    });

    this.options.onAck(payload.requestId, payload.newVersion);
  }

  /**
   * Handle SYNC_REJECT from server
   */
  private handleReject(payload: SyncRejectPayload): void {
    const update = this.pendingUpdates.get(payload.requestId);
    if (!update) {
      return; // Unknown request ID
    }

    update.status = 'rejected';
    update.error = payload.message;
    update.rejectReason = payload.reason;

    // If it's a conflict, create a conflict record
    if (payload.reason === 'conflict' && payload.currentData && payload.currentVersion) {
      const conflict: SyncConflict = {
        id: uuidv4(),
        entityType: update.entityType,
        entityId: update.entityId,
        vaultId: update.vaultId,
        localChanges: update.changes,
        localVersion: update.baseVersion,
        serverData: payload.currentData,
        serverVersion: payload.currentVersion,
        conflictingFields: this.detectConflictingFields(update.changes, payload.currentData),
        detectedAt: new Date(),
        // LWW fields
        localTimestamp: update.clientTimestamp,
        serverTimestamp: payload.serverTimestamp,
        autoResolvable: !!payload.lwwResolution,
        autoResolution: payload.lwwResolution,
      };

      this.conflicts.set(conflict.id, conflict);
      this.emit('conflictDetected', { conflict });
      this.options.onConflict(conflict);
    }

    // Remove from pending
    this.pendingUpdates.delete(payload.requestId);

    this.emit('updateRejected', {
      requestId: payload.requestId,
      reason: payload.message,
      serverData: payload.currentData,
    });

    this.options.onReject(payload.requestId, payload.message, payload.currentData);
  }

  /**
   * Handle ENTITY_CHANGED from another client
   */
  private handleRemoteChange(payload: EntityChangedPayload): void {
    this.emit('remoteChange', {
      entityType: payload.entityType,
      entityId: payload.entityId,
      vaultId: payload.vaultId,
      changes: payload.changes,
      newVersion: payload.newVersion,
      updatedBy: payload.updatedBy,
    });
  }

  /**
   * Detect which fields conflict between local changes and server data
   */
  private detectConflictingFields(
    localChanges: Record<string, unknown>,
    serverData: Record<string, unknown>,
  ): string[] {
    const conflicting: string[] = [];
    for (const key of Object.keys(localChanges)) {
      if (key in serverData && localChanges[key] !== serverData[key]) {
        conflicting.push(key);
      }
    }
    return conflicting;
  }

  /**
   * Process pending updates (called when connection is restored)
   */
  public processPendingUpdates(): void {
    if (!this.wsManager.isConnected()) {
      return;
    }

    for (const update of this.pendingUpdates.values()) {
      if (update.status === 'pending' && update.retryCount < this.options.maxRetries) {
        update.retryCount++;
        this.sendUpdate(update);
      }
    }
  }

  /**
   * Clean up expired pending updates
   */
  private cleanupExpiredUpdates(): void {
    const now = Date.now();
    for (const [requestId, update] of this.pendingUpdates) {
      const age = now - update.timestamp.getTime();
      if (age > this.options.pendingUpdateTTL) {
        this.pendingUpdates.delete(requestId);
      }
    }
  }

  /**
   * Get a pending update by request ID
   */
  public getPendingUpdate(requestId: string): PendingUpdate | undefined {
    return this.pendingUpdates.get(requestId);
  }

  /**
   * Get all pending updates for an entity
   */
  public getPendingUpdatesForEntity(entityType: string, entityId: string): PendingUpdate[] {
    const updates: PendingUpdate[] = [];
    for (const update of this.pendingUpdates.values()) {
      if (update.entityType === entityType && update.entityId === entityId) {
        updates.push(update);
      }
    }
    return updates;
  }

  /**
   * Get all pending updates
   */
  public getAllPendingUpdates(): PendingUpdate[] {
    return Array.from(this.pendingUpdates.values());
  }

  /**
   * Get pending updates count
   */
  public getPendingCount(): number {
    return this.pendingUpdates.size;
  }

  /**
   * Get a conflict by ID
   */
  public getConflict(conflictId: string): SyncConflict | undefined {
    return this.conflicts.get(conflictId);
  }

  /**
   * Get all conflicts
   */
  public getAllConflicts(): SyncConflict[] {
    return Array.from(this.conflicts.values());
  }

  /**
   * Resolve a conflict
   */
  public resolveConflict(
    conflictId: string,
    resolution: 'local' | 'server' | 'merged',
    mergedData?: Record<string, unknown>,
  ): void {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) {
      return;
    }

    conflict.resolution = resolution;
    if (resolution === 'merged' && mergedData) {
      conflict.mergedData = mergedData;
    }

    // If resolution is 'local', re-queue the update with the new server version
    if (resolution === 'local') {
      this.queueUpdate(
        conflict.entityType,
        conflict.entityId,
        conflict.vaultId,
        conflict.localChanges,
        conflict.serverData,
        conflict.serverVersion, // Use server version as new base
      );
    }

    // If resolution is 'merged', queue the merged data
    if (resolution === 'merged' && mergedData) {
      this.queueUpdate(
        conflict.entityType,
        conflict.entityId,
        conflict.vaultId,
        mergedData,
        conflict.serverData,
        conflict.serverVersion,
      );
    }

    // Remove the conflict
    this.conflicts.delete(conflictId);
  }

  /**
   * Dismiss a conflict without resolving
   */
  public dismissConflict(conflictId: string): void {
    this.conflicts.delete(conflictId);
  }

  /**
   * Check if there are any conflicts
   */
  public hasConflicts(): boolean {
    return this.conflicts.size > 0;
  }

  /**
   * Get conflicts count
   */
  public getConflictsCount(): number {
    return this.conflicts.size;
  }

  // ==================== Event Emitter ====================

  /**
   * Subscribe to sync events
   */
  public on<T extends SyncEventType>(event: T, listener: EventListener<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener as EventListener<SyncEventType>);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(listener as EventListener<SyncEventType>);
    };
  }

  /**
   * Emit a sync event
   */
  private emit<T extends SyncEventType>(event: T, data: SyncEventData[T]): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in sync event listener for ${event}:`, error);
        }
      }
    }
  }
}
