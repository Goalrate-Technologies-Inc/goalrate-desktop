/**
 * useSubscription Hook
 * Subscribe to a topic with automatic cleanup
 */

import { useEffect, useRef } from 'react';
import { useWebSocketContext } from '../WebSocketContext';

// ============================================================================
// HOOK
// ============================================================================

/**
 * Subscription options
 */
export interface UseSubscriptionOptions {
  /** Only subscribe when connected (default: true) */
  waitForConnection?: boolean;

  /** Enable subscription (default: true) */
  enabled?: boolean;
}

/**
 * Subscription hook
 * Automatically subscribes to a topic and cleans up on unmount
 *
 * @param topic Topic to subscribe to
 * @param options Subscription options
 */
export function useSubscription(
  topic: string | undefined | null,
  options: UseSubscriptionOptions = {}
): void {
  const { waitForConnection = true, enabled = true } = options;
  const { manager, isConnected } = useWebSocketContext();
  const subscribedRef = useRef<string | null>(null);

  useEffect(() => {
    // Skip if not enabled or no topic
    if (!enabled || !topic || !manager) {
      return;
    }

    // Skip if waiting for connection and not connected
    if (waitForConnection && !isConnected) {
      return;
    }

    // Subscribe
    manager.subscribe(topic);
    subscribedRef.current = topic;

    // Cleanup on unmount or topic change
    return () => {
      const currentTopic = subscribedRef.current;
      if (currentTopic && manager) {
        manager.unsubscribe(currentTopic);
        subscribedRef.current = null;
      }
    };
  }, [topic, enabled, waitForConnection, isConnected, manager]);
}

/**
 * Subscribe to multiple topics
 *
 * @param topics Array of topics to subscribe to
 * @param options Subscription options
 */
export function useSubscriptions(
  topics: (string | undefined | null)[],
  options: UseSubscriptionOptions = {}
): void {
  const { waitForConnection = true, enabled = true } = options;
  const { manager, isConnected } = useWebSocketContext();
  const subscribedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Skip if not enabled or no manager
    if (!enabled || !manager) {
      return;
    }

    // Skip if waiting for connection and not connected
    if (waitForConnection && !isConnected) {
      return;
    }

    // Filter valid topics
    const validTopics = topics.filter((t): t is string => typeof t === 'string' && t.length > 0);

    // Unsubscribe from removed topics
    for (const topic of subscribedRef.current) {
      if (!validTopics.includes(topic)) {
        manager.unsubscribe(topic);
        subscribedRef.current.delete(topic);
      }
    }

    // Subscribe to new topics
    for (const topic of validTopics) {
      if (!subscribedRef.current.has(topic)) {
        manager.subscribe(topic);
        subscribedRef.current.add(topic);
      }
    }

    const subscribed = subscribedRef.current;

    // Cleanup on unmount
    return () => {
      const currentTopics = new Set(subscribed);
      for (const topic of currentTopics) {
        manager.unsubscribe(topic);
      }
      subscribed.clear();
    };
  }, [topics, enabled, waitForConnection, isConnected, manager]);
}
