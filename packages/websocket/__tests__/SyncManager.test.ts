/**
 * SyncManager LWW (Last-Write-Wins) Tests
 *
 * Tests cover:
 * 1. clientTimestamp is captured when queueing updates
 * 2. clientTimestamp is included in DATA_SYNC messages
 * 3. LWW fields are populated when handling SYNC_REJECT
 * 4. Conflict records include LWW metadata
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SyncManager } from '../src/sync/SyncManager';
import type { WebSocketManager } from '../src/WebSocketManager';
import type { SyncConflict } from '../src/sync/types';

// Mock WebSocketManager
const createMockWebSocketManager = () => {
  const messageHandlers = new Map<string, (payload: unknown) => void>();

  const mockManager = {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    onMessage: vi.fn((type: string, handler: (payload: unknown) => void) => {
      messageHandlers.set(type, handler);
      return () => messageHandlers.delete(type);
    }),
    // Helper to simulate messages
    _simulateMessage: (type: string, payload: unknown) => {
      const handler = messageHandlers.get(type);
      if (handler) {
        handler(payload);
      }
    },
  } as unknown as WebSocketManager & {
    _simulateMessage: (type: string, payload: unknown) => void;
  };
  return mockManager;
};

describe('SyncManager LWW Features', () => {
  let syncManager: SyncManager;
  let mockWsManager: ReturnType<typeof createMockWebSocketManager>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWsManager = createMockWebSocketManager();
    syncManager = new SyncManager(mockWsManager as unknown as WebSocketManager, {
      maxRetries: 3,
      retryBaseDelay: 1000,
      retryMaxDelay: 30000,
      pendingUpdateTTL: 300000,
    });
  });

  afterEach(() => {
    syncManager.destroy();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('queueUpdate with clientTimestamp', () => {
    it('should capture clientTimestamp when queueing update', () => {
      const now = new Date('2026-01-18T12:00:00.000Z');
      vi.setSystemTime(now);

      const update = syncManager.queueUpdate(
        'goal',
        'goal-123',
        'vault-1',
        { title: 'Updated Title' },
        { title: 'Original Title' },
        5,
      );

      expect(update).toBeDefined();
      expect(update.clientTimestamp).toBe(now.toISOString());
    });

    it('should use ISO format for clientTimestamp', () => {
      const now = new Date('2026-01-18T12:00:00.123Z');
      vi.setSystemTime(now);

      const update = syncManager.queueUpdate(
        'project',
        'project-456',
        'vault-1',
        { description: 'New description' },
        { description: 'Old description' },
        3,
      );

      expect(update.clientTimestamp).toContain('2026-01-18T12:00:00');
      expect(update.clientTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should have unique clientTimestamps for sequential updates', () => {
      const update1 = syncManager.queueUpdate(
        'goal',
        'goal-1',
        'vault-1',
        { title: 'Title 1' },
        { title: 'Original 1' },
        1,
      );

      // Advance time
      vi.advanceTimersByTime(1);

      const update2 = syncManager.queueUpdate(
        'goal',
        'goal-2',
        'vault-1',
        { title: 'Title 2' },
        { title: 'Original 2' },
        1,
      );

      // Timestamps should be different (1ms apart)
      expect(update1.clientTimestamp).not.toBe(update2.clientTimestamp);
    });

    it('should store clientTimestamp in pending updates map', () => {
      const now = new Date('2026-01-18T15:30:00.000Z');
      vi.setSystemTime(now);

      const update = syncManager.queueUpdate(
        'task',
        'task-101',
        'vault-1',
        { status: 'done' },
        { status: 'pending' },
        2,
      );

      const retrieved = syncManager.getPendingUpdate(update.requestId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.clientTimestamp).toBe(now.toISOString());
    });
  });

  describe('DATA_SYNC message includes clientTimestamp', () => {
    it('should include clientTimestamp in DATA_SYNC payload', () => {
      const now = new Date('2026-01-18T12:30:00.000Z');
      vi.setSystemTime(now);

      syncManager.queueUpdate(
        'task',
        'task-789',
        'vault-1',
        { status: 'completed' },
        { status: 'in_progress' },
        10,
      );

      // The queueUpdate calls sendUpdate immediately if connected
      expect(mockWsManager.send).toHaveBeenCalledWith(
        'data_sync',
        expect.objectContaining({
          entityType: 'task',
          entityId: 'task-789',
          vaultId: 'vault-1',
          changes: { status: 'completed' },
          baseVersion: 10,
          clientTimestamp: now.toISOString(),
        }),
      );
    });

    it('should include requestId in DATA_SYNC payload', () => {
      const update = syncManager.queueUpdate(
        'goal',
        'goal-123',
        'vault-1',
        { title: 'Test' },
        { title: 'Original' },
        1,
      );

      expect(mockWsManager.send).toHaveBeenCalledWith(
        'data_sync',
        expect.objectContaining({
          requestId: update.requestId,
        }),
      );
    });
  });

  describe('SYNC_REJECT handling with LWW fields', () => {
    it('should populate LWW fields in conflict when server wins', () => {
      let capturedConflict: SyncConflict | null = null;

      const onConflict = (conflict: SyncConflict) => {
        capturedConflict = conflict;
      };

      // Recreate with conflict handler
      syncManager.destroy();
      syncManager = new SyncManager(mockWsManager as unknown as WebSocketManager, {
        onConflict,
      });

      const clientTimestamp = new Date('2026-01-18T12:00:00.000Z');
      vi.setSystemTime(clientTimestamp);

      const update = syncManager.queueUpdate(
        'goal',
        'goal-123',
        'vault-1',
        { title: 'Client Title' },
        { title: 'Original Title' },
        5,
      );

      // Simulate SYNC_REJECT with LWW fields
      const serverTimestamp = '2026-01-18T12:05:00.000Z'; // Server is newer
      mockWsManager._simulateMessage('sync_reject', {
        requestId: update.requestId,
        reason: 'conflict',
        message: 'Version conflict',
        currentVersion: 6,
        currentData: { title: 'Server Title', version: 6 },
        lwwResolution: 'server',
        serverTimestamp,
      });

      expect(capturedConflict).not.toBeNull();
      expect(capturedConflict?.localTimestamp).toBe(clientTimestamp.toISOString());
      expect(capturedConflict?.serverTimestamp).toBe(serverTimestamp);
      expect(capturedConflict?.autoResolvable).toBe(true);
      expect(capturedConflict?.autoResolution).toBe('server');
    });

    it('should mark conflict as auto-resolvable when LWW resolution provided', () => {
      let capturedConflict: SyncConflict | null = null;

      syncManager.destroy();
      syncManager = new SyncManager(mockWsManager as unknown as WebSocketManager, {
        onConflict: (conflict) => {
          capturedConflict = conflict;
        },
      });

      const update = syncManager.queueUpdate(
        'project',
        'project-456',
        'vault-1',
        { name: 'New Name' },
        { name: 'Old Name' },
        3,
      );

      mockWsManager._simulateMessage('sync_reject', {
        requestId: update.requestId,
        reason: 'conflict',
        message: 'Version conflict',
        currentVersion: 4,
        currentData: { name: 'Server Name', version: 4 },
        lwwResolution: 'local', // Local (client) would win
        serverTimestamp: '2026-01-18T11:55:00.000Z',
      });

      expect(capturedConflict?.autoResolvable).toBe(true);
      expect(capturedConflict?.autoResolution).toBe('local');
    });

    it('should not mark conflict as auto-resolvable when no LWW resolution', () => {
      let capturedConflict: SyncConflict | null = null;

      syncManager.destroy();
      syncManager = new SyncManager(mockWsManager as unknown as WebSocketManager, {
        onConflict: (conflict) => {
          capturedConflict = conflict;
        },
      });

      const update = syncManager.queueUpdate(
        'epic',
        'epic-789',
        'vault-1',
        { description: 'New desc' },
        { description: 'Old desc' },
        2,
      );

      // SYNC_REJECT without LWW fields (standard conflict)
      mockWsManager._simulateMessage('sync_reject', {
        requestId: update.requestId,
        reason: 'conflict',
        message: 'Version conflict',
        currentVersion: 3,
        currentData: { description: 'Server desc', version: 3 },
        // No lwwResolution or serverTimestamp
      });

      expect(capturedConflict?.autoResolvable).toBe(false);
      expect(capturedConflict?.autoResolution).toBeUndefined();
    });
  });

  describe('Conflict record structure', () => {
    it('should include all required LWW fields in SyncConflict', () => {
      let capturedConflict: SyncConflict | null = null;

      syncManager.destroy();
      syncManager = new SyncManager(mockWsManager as unknown as WebSocketManager, {
        onConflict: (conflict) => {
          capturedConflict = conflict;
        },
      });

      const clientTs = new Date('2026-01-18T12:00:00.000Z');
      vi.setSystemTime(clientTs);

      const update = syncManager.queueUpdate(
        'story',
        'story-101',
        'vault-1',
        { title: 'Client Story', points: 5 },
        { title: 'Original Story', points: 3 },
        7,
      );

      const serverTs = '2026-01-18T12:10:00.000Z';
      mockWsManager._simulateMessage('sync_reject', {
        requestId: update.requestId,
        reason: 'conflict',
        message: 'Version conflict',
        currentVersion: 8,
        currentData: { title: 'Server Story', points: 8, version: 8 },
        lwwResolution: 'server',
        serverTimestamp: serverTs,
      });

      // Verify all fields are present
      expect(capturedConflict).toMatchObject({
        entityType: 'story',
        entityId: 'story-101',
        vaultId: 'vault-1',
        localChanges: { title: 'Client Story', points: 5 },
        localVersion: 7,
        serverVersion: 8,
        localTimestamp: clientTs.toISOString(),
        serverTimestamp: serverTs,
        autoResolvable: true,
        autoResolution: 'server',
      });
    });

    it('should detect conflicting fields correctly', () => {
      let capturedConflict: SyncConflict | null = null;

      syncManager.destroy();
      syncManager = new SyncManager(mockWsManager as unknown as WebSocketManager, {
        onConflict: (conflict) => {
          capturedConflict = conflict;
        },
      });

      const update = syncManager.queueUpdate(
        'goal',
        'goal-999',
        'vault-1',
        { title: 'My Title', description: 'My Description' },
        { title: 'Original', description: 'Original Desc' },
        1,
      );

      mockWsManager._simulateMessage('sync_reject', {
        requestId: update.requestId,
        reason: 'conflict',
        message: 'Version conflict',
        currentVersion: 2,
        currentData: {
          title: 'Server Title', // Different from client
          description: 'Server Desc', // Different from client
          version: 2,
        },
        lwwResolution: 'server',
        serverTimestamp: '2026-01-18T12:00:00.000Z',
      });

      // Both fields should be conflicting
      expect(capturedConflict?.conflictingFields).toContain('title');
      expect(capturedConflict?.conflictingFields).toContain('description');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle multiple pending updates with different timestamps', () => {
      const timestamps: string[] = [];

      for (let i = 0; i < 3; i++) {
        const time = new Date(Date.now() + i * 100);
        vi.setSystemTime(time);

        const update = syncManager.queueUpdate(
          'goal',
          `goal-${i}`,
          'vault-1',
          { title: `Title ${i}` },
          { title: `Original ${i}` },
          1,
        );

        timestamps.push(update.clientTimestamp);
      }

      // All timestamps should be unique
      const uniqueTimestamps = new Set(timestamps);
      expect(uniqueTimestamps.size).toBe(3);
    });

    it('should preserve clientTimestamp after re-fetching from pending map', () => {
      const now = new Date('2026-01-18T12:00:00.000Z');
      vi.setSystemTime(now);

      const update = syncManager.queueUpdate(
        'goal',
        'goal-preserve',
        'vault-1',
        { title: 'Preserve Test' },
        { title: 'Original' },
        1,
      );

      const originalTimestamp = update.clientTimestamp;

      // Fetch from map
      const retrieved = syncManager.getPendingUpdate(update.requestId);
      expect(retrieved?.clientTimestamp).toBe(originalTimestamp);
    });

    it('should include correct timestamps when processing pending updates', () => {
      // Disconnect to prevent immediate send
      mockWsManager.isConnected.mockReturnValue(false);

      const now = new Date('2026-01-18T13:00:00.000Z');
      vi.setSystemTime(now);

      const update = syncManager.queueUpdate(
        'goal',
        'goal-pending',
        'vault-1',
        { title: 'Pending Test' },
        { title: 'Original' },
        1,
      );

      // Update wasn't sent (disconnected)
      expect(mockWsManager.send).not.toHaveBeenCalled();

      // Reconnect and process
      mockWsManager.isConnected.mockReturnValue(true);
      vi.advanceTimersByTime(5000);
      syncManager.processPendingUpdates();

      // Should send with original timestamp
      expect(mockWsManager.send).toHaveBeenCalledWith(
        'data_sync',
        expect.objectContaining({
          clientTimestamp: now.toISOString(),
        }),
      );
    });
  });

  describe('Conflict resolution with LWW', () => {
    it('should re-queue with server version when resolving conflict as local', () => {
      let capturedConflict: SyncConflict | null = null;

      syncManager.destroy();
      syncManager = new SyncManager(mockWsManager as unknown as WebSocketManager, {
        onConflict: (conflict) => {
          capturedConflict = conflict;
        },
      });

      const update = syncManager.queueUpdate(
        'goal',
        'goal-resolve',
        'vault-1',
        { title: 'Local Title' },
        { title: 'Original' },
        5,
      );

      // Simulate conflict
      mockWsManager._simulateMessage('sync_reject', {
        requestId: update.requestId,
        reason: 'conflict',
        message: 'Version conflict',
        currentVersion: 6,
        currentData: { title: 'Server Title' },
        lwwResolution: 'server',
        serverTimestamp: '2026-01-18T12:00:00.000Z',
      });

      expect(capturedConflict).not.toBeNull();

      // Clear previous calls
      mockWsManager.send.mockClear();

      // Resolve as 'local' (re-apply local changes)
      syncManager.resolveConflict(capturedConflict!.id, 'local');

      // Should re-queue with server's version as base
      expect(mockWsManager.send).toHaveBeenCalledWith(
        'data_sync',
        expect.objectContaining({
          changes: { title: 'Local Title' },
          baseVersion: 6, // Server's version
        }),
      );
    });
  });
});
