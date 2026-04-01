/**
 * OfflineSyncManager
 * Coordinates offline queue with WebSocket sync
 * Handles network state changes and sync orchestration
 */

import type { SyncableEntityType, SyncAckPayload, SyncRejectPayload } from '@goalrate-app/shared';
import { MessageType } from '@goalrate-app/shared';
import { OfflineQueue } from './OfflineQueue';
import type {
  PersistedQueueEntry,
  OfflineSyncManagerConfig,
  NetworkState,
  OfflineSyncStatus,
  OfflineStorageAdapter,
  SyncResult,
  SyncHistoryEntry,
} from './types';
import { DEFAULT_SYNC_MANAGER_CONFIG } from './types';
import type { WebSocketManager } from '../WebSocketManager';

// ============================================================================
// NETWORK INFO INTERFACE
// ============================================================================

/**
 * Interface for network info library
 * Matches @react-native-community/netinfo API
 */
export interface NetInfoState {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  type: string;
}

export type NetInfoSubscription = () => void;

export interface NetInfoModule {
  fetch(): Promise<NetInfoState>;
  addEventListener(
    listener: (state: NetInfoState) => void
  ): NetInfoSubscription;
}

// ============================================================================
// SYNC STATUS LISTENER
// ============================================================================

type SyncStatusListener = (status: OfflineSyncStatus) => void;

// ============================================================================
// OFFLINE SYNC MANAGER CLASS
// ============================================================================

/**
 * OfflineSyncManager coordinates offline queue with live sync
 */
export class OfflineSyncManager {
  private queue: OfflineQueue;
  private config: OfflineSyncManagerConfig;
  private wsManager: WebSocketManager | null = null;
  private netInfo: NetInfoModule | null = null;

  private networkState: NetworkState = {
    isConnected: true,
    isInternetReachable: null,
    type: null,
  };

  private netInfoSubscription: NetInfoSubscription | null = null;
  private isSyncing = false;
  private syncAbortController: AbortController | null = null;
  private statusListeners: Set<SyncStatusListener> = new Set();
  private pendingRequestMap: Map<string, string> = new Map(); // requestId -> queueEntryId
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupCallbacks: (() => void)[] = [];
  private syncHistory: SyncHistoryEntry[] = [];

  /**
   * Create a new OfflineSyncManager
   * @param storage Storage adapter (AsyncStorage)
   * @param config Configuration options
   */
  constructor(
    storage: OfflineStorageAdapter,
    config: Partial<OfflineSyncManagerConfig> = {}
  ) {
    this.config = { ...DEFAULT_SYNC_MANAGER_CONFIG, ...config };
    this.queue = new OfflineQueue(storage, config);
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  /**
   * Initialize the sync manager
   * @param netInfo Optional NetInfo module for network monitoring
   */
  async initialize(netInfo?: NetInfoModule): Promise<void> {
    await this.queue.initialize();

    if (netInfo) {
      this.netInfo = netInfo;
      await this.setupNetworkListener();
    }

    this.setupQueueListeners();
  }

  /**
   * Set the WebSocket manager reference
   */
  setWebSocketManager(wsManager: WebSocketManager): void {
    this.wsManager = wsManager;
    this.setupWebSocketListeners();
  }

  // ==========================================================================
  // QUEUE OPERATIONS
  // ==========================================================================

  /**
   * Queue an update for offline sync
   */
  async queueUpdate(
    entityType: SyncableEntityType,
    entityId: string,
    vaultId: string,
    changes: Record<string, unknown>,
    previousData: Record<string, unknown>,
    baseVersion: number,
    priority: number = 10
  ): Promise<PersistedQueueEntry> {
    const entry = await this.queue.enqueue(
      entityType,
      entityId,
      vaultId,
      changes,
      previousData,
      baseVersion,
      priority
    );

    // If online, try to sync immediately
    if (this.isOnline() && this.isWebSocketConnected()) {
      this.trySyncEntry(entry).catch(console.error);
    }

    await this.notifyStatusChange();
    return entry;
  }

  /**
   * Get queue for direct access
   */
  getQueue(): OfflineQueue {
    return this.queue;
  }

  // ==========================================================================
  // SYNC OPERATIONS
  // ==========================================================================

  /**
   * Start syncing all pending entries
   */
  async syncAll(): Promise<SyncResult> {
    if (this.isSyncing) {
      return { successful: 0, failed: 0, failedEntryIds: [], errors: [] };
    }

    if (!this.isOnline() || !this.isWebSocketConnected()) {
      return { successful: 0, failed: 0, failedEntryIds: [], errors: [] };
    }

    this.isSyncing = true;
    this.syncAbortController = new AbortController();
    await this.notifyStatusChange();

    let successful = 0;
    let failed = 0;
    const failedEntryIds: string[] = [];
    const errors: Array<{ entryId: string; error: string }> = [];

    try {
      await this.queue.updateMeta({
        lastSyncAttempt: new Date().toISOString(),
      });

      const pendingEntries = await this.queue.getPendingEntries();

      this.emit('syncStarted', { count: pendingEntries.length });

      const batchSize = this.config.syncBatchSize ?? 10;

      for (let i = 0; i < pendingEntries.length; i += batchSize) {
        if (this.syncAbortController.signal.aborted) {
          break;
        }

        const batch = pendingEntries.slice(i, i + batchSize);

        for (const entry of batch) {
          try {
            const success = await this.trySyncEntry(entry);
            if (success) {
              successful++;
            } else {
              failed++;
              failedEntryIds.push(entry.id);
            }
          } catch (error) {
            failed++;
            failedEntryIds.push(entry.id);
            errors.push({
              entryId: entry.id,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }

        // Delay between batches
        if (i + batchSize < pendingEntries.length) {
          await this.delay(this.config.batchDelay ?? 100);
        }
      }

      if (successful > 0) {
        await this.queue.updateMeta({
          lastSuccessfulSync: new Date().toISOString(),
        });
      }

      this.emit('syncCompleted', { successful, failed });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.emit('syncFailed', { error: errorMessage, entriesAffected: failed });
    } finally {
      this.isSyncing = false;
      this.syncAbortController = null;
      await this.notifyStatusChange();
    }

    return { successful, failed, failedEntryIds, errors };
  }

  /**
   * Cancel ongoing sync
   */
  cancelSync(): void {
    this.syncAbortController?.abort();
  }

  /**
   * Retry failed entries
   */
  async retryFailed(): Promise<void> {
    const count = await this.queue.resetFailedEntries();
    if (count > 0 && this.isOnline() && this.isWebSocketConnected()) {
      await this.syncAll();
    }
  }

  // ==========================================================================
  // STATUS & STATE
  // ==========================================================================

  /**
   * Get current sync status
   */
  async getStatus(): Promise<OfflineSyncStatus> {
    const stats = await this.queue.getStats();
    const pendingCount =
      stats.byStatus.pending +
      stats.byStatus.retrying +
      stats.byStatus.syncing;

    let state: OfflineSyncStatus['state'] = 'idle';
    if (this.isSyncing) {
      state = 'syncing';
    } else if (!this.isOnline()) {
      state = 'offline';
    } else if (stats.byStatus.failed > 0) {
      state = 'error';
    }

    return {
      state,
      pendingCount,
      failedCount: stats.byStatus.failed,
      isSyncing: this.isSyncing,
      isOnline: this.isOnline(),
      lastSyncAt: stats.lastSuccessfulSync,
      error: null,
      progress: this.calculateProgress(stats.total, pendingCount),
    };
  }

  /**
   * Subscribe to sync status changes
   */
  onStatusChange(listener: SyncStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * Check if online
   */
  isOnline(): boolean {
    return (
      this.networkState.isConnected === true &&
      this.networkState.isInternetReachable !== false
    );
  }

  /**
   * Check if WebSocket is connected
   */
  isWebSocketConnected(): boolean {
    return this.wsManager?.isConnected() ?? false;
  }

  /**
   * Get current network state
   */
  getNetworkState(): NetworkState {
    return { ...this.networkState };
  }

  /**
   * Get sync history
   */
  getSyncHistory(): SyncHistoryEntry[] {
    return [...this.syncHistory];
  }

  // ==========================================================================
  // PRIVATE: NETWORK HANDLING
  // ==========================================================================

  private async setupNetworkListener(): Promise<void> {
    if (!this.netInfo) {
      return;
    }

    // Get initial state
    try {
      const state = await this.netInfo.fetch();
      this.updateNetworkState(state);
    } catch (error) {
      console.error('Failed to get initial network state:', error);
    }

    // Subscribe to changes
    this.netInfoSubscription = this.netInfo.addEventListener(
      (state: NetInfoState) => {
        const wasOnline = this.isOnline();
        this.updateNetworkState(state);
        const isNowOnline = this.isOnline();

        // Trigger sync when coming back online
        if (
          !wasOnline &&
          isNowOnline &&
          this.config.autoSyncOnReconnect
        ) {
          this.scheduleReconnectSync();
        }

        this.notifyStatusChange().catch(console.error);
      }
    );
  }

  private updateNetworkState(state: NetInfoState): void {
    const previousState = { ...this.networkState };

    this.networkState = {
      isConnected: state.isConnected ?? false,
      isInternetReachable: state.isInternetReachable,
      type: state.type,
    };

    if (
      previousState.isConnected !== this.networkState.isConnected ||
      previousState.isInternetReachable !== this.networkState.isInternetReachable
    ) {
      this.emit('networkStateChanged', { state: this.networkState });
    }
  }

  // ==========================================================================
  // PRIVATE: QUEUE LISTENERS
  // ==========================================================================

  private setupQueueListeners(): void {
    this.cleanupCallbacks.push(
      this.queue.on('entryAdded', () => {
        this.notifyStatusChange().catch(console.error);
      }),
      this.queue.on('entryUpdated', () => {
        this.notifyStatusChange().catch(console.error);
      }),
      this.queue.on('entryRemoved', () => {
        this.notifyStatusChange().catch(console.error);
      })
    );
  }

  // ==========================================================================
  // PRIVATE: WEBSOCKET LISTENERS
  // ==========================================================================

  private setupWebSocketListeners(): void {
    if (!this.wsManager) {
      return;
    }

    // Listen for sync acknowledgments
    const ackCleanup = this.wsManager.onMessage<SyncAckPayload>(
      MessageType.SYNC_ACK,
      (payload) => {
        this.handleSyncAck(payload).catch(console.error);
      }
    );
    this.cleanupCallbacks.push(ackCleanup);

    // Listen for sync rejections
    const rejectCleanup = this.wsManager.onMessage<SyncRejectPayload>(
      MessageType.SYNC_REJECT,
      (payload) => {
        this.handleSyncReject(payload).catch(console.error);
      }
    );
    this.cleanupCallbacks.push(rejectCleanup);

    // Listen for connection events
    this.wsManager.on('connected', () => {
      if (this.config.autoSyncOnReconnect) {
        this.scheduleReconnectSync();
      }
    });
  }

  private scheduleReconnectSync(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.syncAll().catch(console.error);
    }, this.config.reconnectSyncDelay);
  }

  // ==========================================================================
  // PRIVATE: SYNC ENTRY
  // ==========================================================================

  private async trySyncEntry(entry: PersistedQueueEntry): Promise<boolean> {
    if (!this.wsManager?.isConnected()) {
      return false;
    }

    try {
      await this.queue.updateEntryStatus(entry.id, 'syncing');

      // Track request for correlation
      this.pendingRequestMap.set(entry.requestId, entry.id);

      // Send via WebSocket
      this.wsManager.send(MessageType.DATA_SYNC, {
        requestId: entry.requestId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        vaultId: entry.vaultId,
        changes: entry.changes,
        baseVersion: entry.baseVersion,
        timestamp: entry.queuedAt,
        clientTimestamp: entry.clientTimestamp,
      });

      return true;
    } catch (error) {
      await this.queue.failEntry(
        entry.id,
        error instanceof Error ? error.message : 'Failed to send'
      );
      return false;
    }
  }

  // ==========================================================================
  // PRIVATE: RESPONSE HANDLERS
  // ==========================================================================

  private async handleSyncAck(payload: SyncAckPayload): Promise<void> {
    const entryId = this.pendingRequestMap.get(payload.requestId);
    if (!entryId) {
      return;
    }

    const entry = await this.queue.getEntry(entryId);

    this.pendingRequestMap.delete(payload.requestId);
    await this.queue.completeEntry(entryId);

    // Add to sync history
    if (entry) {
      this.addToHistory({
        id: payload.requestId,
        entryId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        result: 'success',
        timestamp: new Date().toISOString(),
        newVersion: payload.newVersion,
        resolvedByLWW: payload.resolvedByLWW,
      });
    }

    await this.notifyStatusChange();
  }

  private async handleSyncReject(payload: SyncRejectPayload): Promise<void> {
    const entryId = this.pendingRequestMap.get(payload.requestId);
    if (!entryId) {
      return;
    }

    const entry = await this.queue.getEntry(entryId);

    this.pendingRequestMap.delete(payload.requestId);
    await this.queue.failEntry(entryId, payload.message);

    // Add to sync history
    if (entry) {
      this.addToHistory({
        id: payload.requestId,
        entryId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        result: payload.reason === 'conflict' ? 'conflict' : 'failed',
        error: payload.message,
        timestamp: new Date().toISOString(),
      });
    }

    await this.notifyStatusChange();
  }

  // ==========================================================================
  // PRIVATE: HISTORY
  // ==========================================================================

  private addToHistory(entry: SyncHistoryEntry): void {
    this.syncHistory.unshift(entry);

    // Trim history to max size
    if (this.syncHistory.length > this.config.maxHistoryEntries) {
      this.syncHistory = this.syncHistory.slice(
        0,
        this.config.maxHistoryEntries
      );
    }
  }

  // ==========================================================================
  // PRIVATE: UTILITIES
  // ==========================================================================

  private calculateProgress(total: number, pending: number): number {
    if (total === 0) {
      return 100;
    }
    const completed = total - pending;
    return Math.round((completed / total) * 100);
  }

  private async notifyStatusChange(): Promise<void> {
    const status = await this.getStatus();
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (error) {
        console.error('Error in sync status listener:', error);
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Event emitter for internal events
  private eventListeners: Map<string, Set<(data: unknown) => void>> =
    new Map();

  private emit(event: string, data: unknown): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.netInfoSubscription?.();
    this.cleanupCallbacks.forEach((cleanup) => cleanup());
    this.statusListeners.clear();
    this.eventListeners.clear();
    this.queue.dispose();
  }
}
