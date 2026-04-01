/**
 * MessageQueue Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageQueue } from '../src/MessageQueue';
import { MessageType } from '../src/types';

describe('MessageQueue', () => {
  let queue: MessageQueue;

  beforeEach(() => {
    queue = new MessageQueue({ maxSize: 5, messageTtl: 1000 });
  });

  describe('enqueue', () => {
    it('should enqueue a message', () => {
      const msg = queue.enqueue(MessageType.SUBSCRIBE, { topic: 'test' });

      expect(msg.id).toBeDefined();
      expect(msg.type).toBe(MessageType.SUBSCRIBE);
      expect(msg.data).toEqual({ topic: 'test' });
      expect(msg.queuedAt).toBeInstanceOf(Date);
      expect(msg.attempts).toBe(0);
      expect(queue.size).toBe(1);
    });

    it('should enqueue multiple messages', () => {
      queue.enqueue(MessageType.SUBSCRIBE, { topic: 'test1' });
      queue.enqueue(MessageType.SUBSCRIBE, { topic: 'test2' });
      queue.enqueue(MessageType.SUBSCRIBE, { topic: 'test3' });

      expect(queue.size).toBe(3);
    });

    it('should throw when queue is full', () => {
      for (let i = 0; i < 5; i++) {
        queue.enqueue(MessageType.PING, { n: i });
      }

      expect(() => queue.enqueue(MessageType.PING, { n: 5 })).toThrow('queue is full');
    });

    it('should generate unique IDs', () => {
      const msg1 = queue.enqueue(MessageType.PING, {});
      const msg2 = queue.enqueue(MessageType.PING, {});

      expect(msg1.id).not.toBe(msg2.id);
    });
  });

  describe('dequeue', () => {
    it('should dequeue messages in FIFO order', () => {
      queue.enqueue(MessageType.SUBSCRIBE, { topic: 'first' });
      queue.enqueue(MessageType.SUBSCRIBE, { topic: 'second' });
      queue.enqueue(MessageType.SUBSCRIBE, { topic: 'third' });

      expect(queue.dequeue()?.data).toEqual({ topic: 'first' });
      expect(queue.dequeue()?.data).toEqual({ topic: 'second' });
      expect(queue.dequeue()?.data).toEqual({ topic: 'third' });
      expect(queue.dequeue()).toBeUndefined();
    });

    it('should return undefined for empty queue', () => {
      expect(queue.dequeue()).toBeUndefined();
    });
  });

  describe('peek', () => {
    it('should return oldest message without removing', () => {
      queue.enqueue(MessageType.SUBSCRIBE, { topic: 'first' });
      queue.enqueue(MessageType.SUBSCRIBE, { topic: 'second' });

      expect(queue.peek()?.data).toEqual({ topic: 'first' });
      expect(queue.size).toBe(2);
      expect(queue.peek()?.data).toEqual({ topic: 'first' });
    });

    it('should return undefined for empty queue', () => {
      expect(queue.peek()).toBeUndefined();
    });
  });

  describe('drain', () => {
    it('should return all messages and clear queue', () => {
      queue.enqueue(MessageType.SUBSCRIBE, { topic: 'first' });
      queue.enqueue(MessageType.SUBSCRIBE, { topic: 'second' });
      queue.enqueue(MessageType.SUBSCRIBE, { topic: 'third' });

      const messages = queue.drain();

      expect(messages.length).toBe(3);
      expect(messages[0].data).toEqual({ topic: 'first' });
      expect(messages[1].data).toEqual({ topic: 'second' });
      expect(messages[2].data).toEqual({ topic: 'third' });
      expect(queue.isEmpty).toBe(true);
    });

    it('should return empty array for empty queue', () => {
      expect(queue.drain()).toEqual([]);
    });
  });

  describe('clear', () => {
    it('should clear all messages', () => {
      queue.enqueue(MessageType.SUBSCRIBE, { topic: 'first' });
      queue.enqueue(MessageType.SUBSCRIBE, { topic: 'second' });

      queue.clear();

      expect(queue.isEmpty).toBe(true);
      expect(queue.size).toBe(0);
    });
  });

  describe('expired messages', () => {
    it('should remove expired messages on dequeue', async () => {
      const shortTtlQueue = new MessageQueue({ maxSize: 10, messageTtl: 50 });

      shortTtlQueue.enqueue(MessageType.SUBSCRIBE, { topic: 'old' });

      // Wait for message to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(shortTtlQueue.dequeue()).toBeUndefined();
      expect(shortTtlQueue.isEmpty).toBe(true);
    });

    it('should remove expired messages on enqueue (freeing space)', async () => {
      const shortTtlQueue = new MessageQueue({ maxSize: 2, messageTtl: 50 });

      shortTtlQueue.enqueue(MessageType.PING, { n: 1 });
      shortTtlQueue.enqueue(MessageType.PING, { n: 2 });

      // Wait for messages to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should be able to enqueue now that expired messages are removed
      expect(() => shortTtlQueue.enqueue(MessageType.PING, { n: 3 })).not.toThrow();
    });
  });

  describe('markAttempt', () => {
    it('should increment attempts for a message', () => {
      const msg = queue.enqueue(MessageType.PING, {});

      queue.markAttempt(msg.id);
      queue.markAttempt(msg.id);

      const dequeued = queue.dequeue();
      expect(dequeued?.attempts).toBe(2);
    });

    it('should do nothing for non-existent message', () => {
      expect(() => queue.markAttempt('non-existent')).not.toThrow();
    });
  });

  describe('remove', () => {
    it('should remove a specific message by ID', () => {
      const msg1 = queue.enqueue(MessageType.PING, { n: 1 });
      queue.enqueue(MessageType.PING, { n: 2 });
      queue.enqueue(MessageType.PING, { n: 3 });

      const removed = queue.remove(msg1.id);

      expect(removed).toBe(true);
      expect(queue.size).toBe(2);
      expect(queue.dequeue()?.data).toEqual({ n: 2 });
    });

    it('should return false for non-existent message', () => {
      expect(queue.remove('non-existent')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return queue statistics', () => {
      queue.enqueue(MessageType.PING, { n: 1 });
      queue.enqueue(MessageType.PING, { n: 2 });

      const msg = queue.peek();
      queue.markAttempt(msg!.id);

      const stats = queue.getStats();

      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(5);
      expect(stats.oldestMessageAge).toBeGreaterThanOrEqual(0);
      expect(stats.totalAttempts).toBe(1);
    });

    it('should return null for oldest message age when empty', () => {
      const stats = queue.getStats();
      expect(stats.oldestMessageAge).toBeNull();
    });
  });

  describe('iteration', () => {
    it('should support iteration over messages', () => {
      queue.enqueue(MessageType.PING, { n: 1 });
      queue.enqueue(MessageType.PING, { n: 2 });
      queue.enqueue(MessageType.PING, { n: 3 });

      const messages = [...queue];

      expect(messages.length).toBe(3);
      expect(messages.map((m) => m.data)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    });
  });

  describe('isEmpty and isFull', () => {
    it('should correctly report empty state', () => {
      expect(queue.isEmpty).toBe(true);

      queue.enqueue(MessageType.PING, {});

      expect(queue.isEmpty).toBe(false);
    });

    it('should correctly report full state', () => {
      expect(queue.isFull).toBe(false);

      for (let i = 0; i < 5; i++) {
        queue.enqueue(MessageType.PING, { n: i });
      }

      expect(queue.isFull).toBe(true);
    });
  });
});
