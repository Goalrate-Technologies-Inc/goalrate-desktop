/**
 * Message Queue for WebSocket
 * Queues messages when disconnected, sends them on reconnection
 */

import type { MessageType } from '@goalrate-app/shared';
import type { QueuedMessage } from './types';
import { queueFull } from './errors';

// ============================================================================
// MESSAGE QUEUE
// ============================================================================

/**
 * Queue configuration
 */
export interface MessageQueueConfig {
  /** Maximum number of messages to queue */
  maxSize: number;
  /** Message TTL in milliseconds */
  messageTtl: number;
}

/**
 * Default queue configuration
 */
const DEFAULT_QUEUE_CONFIG: MessageQueueConfig = {
  maxSize: 100,
  messageTtl: 60000, // 1 minute
};

/**
 * Message queue for buffering messages during disconnection
 */
export class MessageQueue {
  private queue: QueuedMessage[] = [];
  private config: MessageQueueConfig;
  private idCounter = 0;

  constructor(config: Partial<MessageQueueConfig> = {}) {
    this.config = { ...DEFAULT_QUEUE_CONFIG, ...config };
  }

  /**
   * Get current queue size
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is empty
   */
  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Check if queue is full
   */
  get isFull(): boolean {
    return this.queue.length >= this.config.maxSize;
  }

  /**
   * Enqueue a message
   * @throws WebSocketError if queue is full
   */
  enqueue<T>(type: MessageType | string, data: T): QueuedMessage<T> {
    // Remove expired messages first
    this.removeExpired();

    // Check capacity
    if (this.isFull) {
      throw queueFull(this.config.maxSize);
    }

    const message: QueuedMessage<T> = {
      id: `msg_${++this.idCounter}_${Date.now()}`,
      type,
      data,
      queuedAt: new Date(),
      attempts: 0,
    };

    this.queue.push(message as QueuedMessage);
    return message;
  }

  /**
   * Dequeue the oldest message
   */
  dequeue(): QueuedMessage | undefined {
    this.removeExpired();
    return this.queue.shift();
  }

  /**
   * Peek at the oldest message without removing
   */
  peek(): QueuedMessage | undefined {
    this.removeExpired();
    return this.queue[0];
  }

  /**
   * Get all messages and clear the queue
   */
  drain(): QueuedMessage[] {
    this.removeExpired();
    const messages = [...this.queue];
    this.queue = [];
    return messages;
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Remove expired messages
   */
  private removeExpired(): void {
    const now = Date.now();
    this.queue = this.queue.filter((msg) => {
      const age = now - msg.queuedAt.getTime();
      return age < this.config.messageTtl;
    });
  }

  /**
   * Mark a message as having a failed send attempt
   */
  markAttempt(messageId: string): void {
    const message = this.queue.find((m) => m.id === messageId);
    if (message) {
      message.attempts++;
    }
  }

  /**
   * Remove a specific message by ID
   */
  remove(messageId: string): boolean {
    const index = this.queue.findIndex((m) => m.id === messageId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    oldestMessageAge: number | null;
    totalAttempts: number;
  } {
    this.removeExpired();

    const oldestMessage = this.queue[0];
    const oldestMessageAge = oldestMessage
      ? Date.now() - oldestMessage.queuedAt.getTime()
      : null;

    const totalAttempts = this.queue.reduce((sum, msg) => sum + msg.attempts, 0);

    return {
      size: this.queue.length,
      maxSize: this.config.maxSize,
      oldestMessageAge,
      totalAttempts,
    };
  }

  /**
   * Iterate over messages (for inspection)
   */
  *[Symbol.iterator](): Iterator<QueuedMessage> {
    this.removeExpired();
    for (const message of this.queue) {
      yield message;
    }
  }
}
