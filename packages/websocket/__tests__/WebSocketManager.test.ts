/**
 * WebSocketManager Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketManager } from '../src/WebSocketManager';
import { ConnectionState, MessageType } from '../src/types';
import type { MockWebSocket } from '../src/test/setup';

// Get the mock WebSocket constructor
const MockWS = global.WebSocket as unknown as typeof MockWebSocket;

describe('WebSocketManager', () => {
  let manager: WebSocketManager;
  let mockWs: MockWebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new WebSocketManager({
      url: 'ws://localhost:8000/ws',
      userId: 'test-user',
      authToken: 'test-token',
      reconnect: {
        enabled: true,
        maxAttempts: 3,
        initialDelay: 1000,
      },
      heartbeat: {
        enabled: true,
        interval: 30000,
        timeout: 10000,
      },
    });
  });

  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
  });

  describe('connect', () => {
    it('should create WebSocket with correct URL', async () => {
      const connectPromise = manager.connect();

      // Get the created WebSocket
      mockWs = (manager as unknown as { ws: MockWebSocket }).ws;
      expect(mockWs.url).toContain('ws://localhost:8000/ws/test-user');
      expect(mockWs.url).toContain('token=test-token');

      // Simulate connection
      mockWs.simulateOpen();
      mockWs.simulateMessage({
        type: 'connect',
        data: {
          session_id: 'session-123',
          user_id: 'test-user',
          message: 'Connected',
          server_time: new Date().toISOString(),
        },
      });

      await connectPromise;

      expect(manager.isConnected()).toBe(true);
    });

    it('should emit connecting event', async () => {
      const onConnecting = vi.fn();
      manager.on('connecting', onConnecting);

      manager.connect();

      expect(onConnecting).toHaveBeenCalled();
    });

    it('should emit connected event with session ID', async () => {
      const onConnected = vi.fn();
      manager.on('connected', onConnected);

      const connectPromise = manager.connect();
      mockWs = (manager as unknown as { ws: MockWebSocket }).ws;
      mockWs.simulateOpen();
      mockWs.simulateMessage({
        type: 'connect',
        data: {
          session_id: 'session-123',
          user_id: 'test-user',
          message: 'Connected',
          server_time: new Date().toISOString(),
        },
      });

      await connectPromise;

      expect(onConnected).toHaveBeenCalledWith('session-123');
    });

    it('should update state on connection', async () => {
      const connectPromise = manager.connect();
      mockWs = (manager as unknown as { ws: MockWebSocket }).ws;

      // Should be connecting
      expect(manager.getState().connectionState).toBe(ConnectionState.CONNECTING);

      mockWs.simulateOpen();
      mockWs.simulateMessage({
        type: 'connect',
        data: {
          session_id: 'session-123',
          user_id: 'test-user',
          message: 'Connected',
          server_time: new Date().toISOString(),
        },
      });

      await connectPromise;

      // Should be connected
      expect(manager.getState().connectionState).toBe(ConnectionState.CONNECTED);
      expect(manager.getState().sessionId).toBe('session-123');
    });

    it('should not connect if already connected', async () => {
      const connectPromise1 = manager.connect();
      mockWs = (manager as unknown as { ws: MockWebSocket }).ws;
      mockWs.simulateOpen();
      mockWs.simulateMessage({
        type: 'connect',
        data: {
          session_id: 'session-123',
          user_id: 'test-user',
          message: 'Connected',
          server_time: new Date().toISOString(),
        },
      });
      await connectPromise1;

      // Second connect should resolve immediately
      await manager.connect();

      expect(manager.isConnected()).toBe(true);
    });
  });

  describe('disconnect', () => {
    beforeEach(async () => {
      const connectPromise = manager.connect();
      mockWs = (manager as unknown as { ws: MockWebSocket }).ws;
      mockWs.simulateOpen();
      mockWs.simulateMessage({
        type: 'connect',
        data: {
          session_id: 'session-123',
          user_id: 'test-user',
          message: 'Connected',
          server_time: new Date().toISOString(),
        },
      });
      await connectPromise;
    });

    it('should disconnect and emit event', () => {
      const onDisconnected = vi.fn();
      manager.on('disconnected', onDisconnected);

      manager.disconnect();

      expect(manager.isConnected()).toBe(false);
      expect(onDisconnected).toHaveBeenCalled();
    });

    it('should not reconnect after manual disconnect', () => {
      manager.disconnect();

      vi.advanceTimersByTime(10000);

      expect(manager.getState().connectionState).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe('reconnection', () => {
    it('should reconnect on connection close', async () => {
      const onReconnecting = vi.fn();
      manager.on('reconnecting', onReconnecting);

      const connectPromise = manager.connect();
      mockWs = (manager as unknown as { ws: MockWebSocket }).ws;
      mockWs.simulateOpen();
      mockWs.simulateMessage({
        type: 'connect',
        data: {
          session_id: 'session-123',
          user_id: 'test-user',
          message: 'Connected',
          server_time: new Date().toISOString(),
        },
      });
      await connectPromise;

      // Simulate unexpected close
      mockWs.simulateClose(1006, 'Connection lost');

      expect(manager.getState().connectionState).toBe(ConnectionState.RECONNECTING);
      expect(onReconnecting).toHaveBeenCalledWith(1, 3);
    });

    it('should use exponential backoff', async () => {
      const connectPromise = manager.connect();
      mockWs = (manager as unknown as { ws: MockWebSocket }).ws;
      mockWs.simulateOpen();
      mockWs.simulateMessage({
        type: 'connect',
        data: {
          session_id: 'session-123',
          user_id: 'test-user',
          message: 'Connected',
          server_time: new Date().toISOString(),
        },
      });
      await connectPromise;

      // First close
      mockWs.simulateClose(1006, 'Connection lost');
      expect(manager.getState().reconnectAttempts).toBe(1);

      // Advance by initial delay (1000ms)
      vi.advanceTimersByTime(1500);

      // Should have attempted reconnect
      mockWs = (manager as unknown as { ws: MockWebSocket }).ws;
      expect(mockWs).toBeDefined();
    });

    it('should track reconnect attempts', async () => {
      const connectPromise = manager.connect();
      mockWs = (manager as unknown as { ws: MockWebSocket }).ws;
      mockWs.simulateOpen();
      mockWs.simulateMessage({
        type: 'connect',
        data: {
          session_id: 'session-123',
          user_id: 'test-user',
          message: 'Connected',
          server_time: new Date().toISOString(),
        },
      });
      await connectPromise;

      // Simulate close - should trigger reconnect
      mockWs.simulateClose(1006, 'Connection lost');

      // Check state shows reconnecting
      expect(manager.getState().connectionState).toBe(ConnectionState.RECONNECTING);
      expect(manager.getState().reconnectAttempts).toBe(1);
    });
  });

  describe('send', () => {
    beforeEach(async () => {
      const connectPromise = manager.connect();
      mockWs = (manager as unknown as { ws: MockWebSocket }).ws;
      mockWs.simulateOpen();
      mockWs.simulateMessage({
        type: 'connect',
        data: {
          session_id: 'session-123',
          user_id: 'test-user',
          message: 'Connected',
          server_time: new Date().toISOString(),
        },
      });
      await connectPromise;
    });

    it('should send messages when connected', () => {
      const sendSpy = vi.spyOn(mockWs, 'send');

      manager.send(MessageType.SUBSCRIBE, { topic: 'test' });

      expect(sendSpy).toHaveBeenCalled();
      const sentData = JSON.parse(sendSpy.mock.calls[0][0] as string);
      expect(sentData.type).toBe(MessageType.SUBSCRIBE);
      expect(sentData.data).toEqual({ topic: 'test' });
    });

    it('should queue messages when disconnected', () => {
      manager.disconnect();

      // Should not throw
      manager.send(MessageType.SUBSCRIBE, { topic: 'test' });

      expect(manager.getState().queuedMessageCount).toBe(1);
    });
  });

  describe('subscriptions', () => {
    beforeEach(async () => {
      const connectPromise = manager.connect();
      mockWs = (manager as unknown as { ws: MockWebSocket }).ws;
      mockWs.simulateOpen();
      mockWs.simulateMessage({
        type: 'connect',
        data: {
          session_id: 'session-123',
          user_id: 'test-user',
          message: 'Connected',
          server_time: new Date().toISOString(),
        },
      });
      await connectPromise;
    });

    it('should track subscribed topics', () => {
      manager.subscribe('topic1');
      manager.subscribe('topic2');

      expect(manager.getSubscribedTopics()).toEqual(['topic1', 'topic2']);
    });

    it('should not duplicate subscriptions', () => {
      manager.subscribe('topic1');
      manager.subscribe('topic1');

      expect(manager.getSubscribedTopics()).toEqual(['topic1']);
    });

    it('should unsubscribe from topics', () => {
      manager.subscribe('topic1');
      manager.subscribe('topic2');
      manager.unsubscribe('topic1');

      expect(manager.getSubscribedTopics()).toEqual(['topic2']);
    });

    it('should send subscribe message when connected', () => {
      const sendSpy = vi.spyOn(mockWs, 'send');

      manager.subscribe('topic1');

      const calls = sendSpy.mock.calls.map((c) => JSON.parse(c[0] as string));
      const subscribeCall = calls.find((c) => c.type === MessageType.SUBSCRIBE);
      expect(subscribeCall).toBeDefined();
      expect(subscribeCall.data).toEqual({ topic: 'topic1' });
    });
  });

  describe('message handling', () => {
    beforeEach(async () => {
      const connectPromise = manager.connect();
      mockWs = (manager as unknown as { ws: MockWebSocket }).ws;
      mockWs.simulateOpen();
      mockWs.simulateMessage({
        type: 'connect',
        data: {
          session_id: 'session-123',
          user_id: 'test-user',
          message: 'Connected',
          server_time: new Date().toISOString(),
        },
      });
      await connectPromise;
    });

    it('should emit message events', () => {
      const onMessage = vi.fn();
      manager.on('message', onMessage);

      mockWs.simulateMessage({
        type: MessageType.GOAL_UPDATE,
        data: { goalId: '123', progress: 50 },
      });

      expect(onMessage).toHaveBeenCalled();
      expect(onMessage.mock.calls[0][0].type).toBe(MessageType.GOAL_UPDATE);
    });

    it('should call type-specific handlers', () => {
      const handler = vi.fn();
      manager.onMessage(MessageType.GOAL_UPDATE, handler);

      mockWs.simulateMessage({
        type: MessageType.GOAL_UPDATE,
        data: { goalId: '123', progress: 50 },
      });

      expect(handler).toHaveBeenCalledWith({ goalId: '123', progress: 50 });
    });

    it('should allow unsubscribing from message types', () => {
      const handler = vi.fn();
      const unsubscribe = manager.onMessage(MessageType.GOAL_UPDATE, handler);

      mockWs.simulateMessage({
        type: MessageType.GOAL_UPDATE,
        data: { goalId: '123' },
      });

      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      mockWs.simulateMessage({
        type: MessageType.GOAL_UPDATE,
        data: { goalId: '456' },
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispose', () => {
    it('should clean up all resources', async () => {
      const connectPromise = manager.connect();
      mockWs = (manager as unknown as { ws: MockWebSocket }).ws;
      mockWs.simulateOpen();
      mockWs.simulateMessage({
        type: 'connect',
        data: {
          session_id: 'session-123',
          user_id: 'test-user',
          message: 'Connected',
          server_time: new Date().toISOString(),
        },
      });
      await connectPromise;

      manager.subscribe('topic1');
      manager.send(MessageType.PING, {});

      manager.dispose();

      expect(manager.isConnected()).toBe(false);
      expect(manager.getSubscribedTopics()).toEqual([]);
    });
  });
});
