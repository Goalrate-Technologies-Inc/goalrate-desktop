/**
 * HeartbeatManager Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HeartbeatManager } from '../src/HeartbeatManager';
import { MessageType } from '../src/types';

describe('HeartbeatManager', () => {
  let sendPing: ReturnType<typeof vi.fn>;
  let onTimeout: ReturnType<typeof vi.fn>;
  let heartbeat: HeartbeatManager;

  beforeEach(() => {
    vi.useFakeTimers();
    sendPing = vi.fn();
    onTimeout = vi.fn();
    heartbeat = new HeartbeatManager(sendPing, onTimeout, {
      interval: 30000,
      timeout: 10000,
    });
  });

  afterEach(() => {
    heartbeat.stop();
    vi.useRealTimers();
  });

  describe('start', () => {
    it('should start the heartbeat', () => {
      heartbeat.start();

      const state = heartbeat.getState();
      expect(state.active).toBe(true);
    });

    it('should send initial ping immediately', () => {
      heartbeat.start();

      expect(sendPing).toHaveBeenCalledTimes(1);
    });

    it('should not start if already active', () => {
      heartbeat.start();
      heartbeat.start();

      expect(sendPing).toHaveBeenCalledTimes(1);
    });

    it('should send ping at regular intervals', () => {
      heartbeat.start();

      expect(sendPing).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(30000);
      expect(sendPing).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(30000);
      expect(sendPing).toHaveBeenCalledTimes(3);
    });
  });

  describe('stop', () => {
    it('should stop the heartbeat', () => {
      heartbeat.start();
      heartbeat.stop();

      const state = heartbeat.getState();
      expect(state.active).toBe(false);
    });

    it('should clear intervals and timeouts', () => {
      heartbeat.start();
      heartbeat.stop();

      vi.advanceTimersByTime(60000);

      // Should not send more pings after stop
      expect(sendPing).toHaveBeenCalledTimes(1);
    });
  });

  describe('reset', () => {
    it('should reset state', () => {
      heartbeat.start();
      heartbeat.receivedPong();
      heartbeat.reset();

      const state = heartbeat.getState();
      expect(state.active).toBe(false);
      expect(state.missedPongs).toBe(0);
      expect(state.lastPingSent).toBeUndefined();
      expect(state.lastPongReceived).toBeUndefined();
    });
  });

  describe('receivedPong', () => {
    it('should update last pong received', () => {
      heartbeat.start();
      heartbeat.receivedPong();

      const state = heartbeat.getState();
      expect(state.lastPongReceived).toBeDefined();
    });

    it('should reset missed pongs counter', () => {
      heartbeat.start();

      // Miss a pong
      vi.advanceTimersByTime(15000);

      const stateBefore = heartbeat.getState();
      expect(stateBefore.missedPongs).toBe(1);

      heartbeat.receivedPong();

      const stateAfter = heartbeat.getState();
      expect(stateAfter.missedPongs).toBe(0);
    });

    it('should prevent timeout callback when pong received in time', () => {
      heartbeat.start();

      vi.advanceTimersByTime(5000);
      heartbeat.receivedPong();
      vi.advanceTimersByTime(5000);

      expect(onTimeout).not.toHaveBeenCalled();
    });
  });

  describe('receivedMessage', () => {
    it('should clear timeout on any message', () => {
      heartbeat.start();

      vi.advanceTimersByTime(5000);
      heartbeat.receivedMessage();
      vi.advanceTimersByTime(5000);

      // Timeout should have been cleared
      expect(onTimeout).not.toHaveBeenCalled();
    });
  });

  describe('timeout handling', () => {
    it('should call onTimeout after 2 missed pongs', () => {
      heartbeat.start();

      // First timeout - increment missed pongs
      vi.advanceTimersByTime(10000);
      expect(onTimeout).not.toHaveBeenCalled();

      // Trigger next ping
      vi.advanceTimersByTime(20000);

      // Second timeout - should trigger callback
      vi.advanceTimersByTime(10000);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('should not call onTimeout if pong received after first miss', () => {
      heartbeat.start();

      // First timeout
      vi.advanceTimersByTime(10000);

      // Receive pong
      heartbeat.receivedPong();

      // Trigger next ping
      vi.advanceTimersByTime(20000);

      // This would be second timeout if pong wasn't received
      vi.advanceTimersByTime(10000);

      // But since pong was received, missed count reset to 1
      expect(onTimeout).not.toHaveBeenCalled();
    });
  });

  describe('getLatency', () => {
    it('should return null before any ping/pong', () => {
      expect(heartbeat.getLatency()).toBeNull();
    });

    it('should calculate latency', () => {
      heartbeat.start();

      vi.advanceTimersByTime(100);
      heartbeat.receivedPong();

      const latency = heartbeat.getLatency();
      expect(latency).toBeGreaterThanOrEqual(0);
    });
  });

  describe('isHealthy', () => {
    it('should return false when not active', () => {
      expect(heartbeat.isHealthy()).toBe(false);
    });

    it('should return true when active and no missed pongs', () => {
      heartbeat.start();
      heartbeat.receivedPong();

      expect(heartbeat.isHealthy()).toBe(true);
    });

    it('should return true with 1 missed pong', () => {
      heartbeat.start();

      vi.advanceTimersByTime(10000);

      expect(heartbeat.isHealthy()).toBe(true);
    });

    it('should return false with 2 or more missed pongs', () => {
      heartbeat.start();

      vi.advanceTimersByTime(10000); // First miss
      vi.advanceTimersByTime(30000); // Next ping
      vi.advanceTimersByTime(10000); // Second miss

      expect(heartbeat.isHealthy()).toBe(false);
    });
  });

  describe('static methods', () => {
    it('should create ping message', () => {
      const message = HeartbeatManager.createPingMessage();

      expect(message.type).toBe(MessageType.PING);
      expect(message.data.timestamp).toBeDefined();
    });

    it('should detect pong messages', () => {
      expect(HeartbeatManager.isPongMessage(MessageType.PONG)).toBe(true);
      expect(HeartbeatManager.isPongMessage('pong')).toBe(true);
      expect(HeartbeatManager.isPongMessage('PONG')).toBe(false);
      expect(HeartbeatManager.isPongMessage(MessageType.PING)).toBe(false);
    });
  });
});
