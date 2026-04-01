/**
 * useWebSocket Hook
 * Main hook for accessing WebSocket functionality
 */

import { useCallback } from 'react';
import type { WebSocketManager } from '../../WebSocketManager';
import type { WebSocketManagerState } from '../../types';
import { MessageType } from '../../types';
import { useWebSocketContext } from '../WebSocketContext';

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook return type
 */
export interface UseWebSocketReturn {
  /** WebSocket manager instance */
  manager: WebSocketManager | null;

  /** Current connection state */
  state: WebSocketManagerState;

  /** Connect to WebSocket server */
  connect: () => Promise<void>;

  /** Disconnect from WebSocket server */
  disconnect: () => void;

  /** Check if connected */
  isConnected: boolean;

  /** Send a message */
  send: <T>(type: MessageType | string, data: T) => void;

  /** Subscribe to a topic */
  subscribe: (topic: string) => void;

  /** Unsubscribe from a topic */
  unsubscribe: (topic: string) => void;

  /** Get subscribed topics */
  getSubscribedTopics: () => string[];
}

/**
 * Main WebSocket hook
 * Provides access to WebSocket manager and connection state
 */
export function useWebSocket(): UseWebSocketReturn {
  const { manager, state, connect, disconnect, isConnected } = useWebSocketContext();

  // Send message
  const send = useCallback(
    <T>(type: MessageType | string, data: T) => {
      if (!manager) {
        throw new Error('WebSocket manager not available');
      }
      manager.send(type, data);
    },
    [manager]
  );

  // Subscribe to topic
  const subscribe = useCallback(
    (topic: string) => {
      if (!manager) {
        throw new Error('WebSocket manager not available');
      }
      manager.subscribe(topic);
    },
    [manager]
  );

  // Unsubscribe from topic
  const unsubscribe = useCallback(
    (topic: string) => {
      if (!manager) {
        throw new Error('WebSocket manager not available');
      }
      manager.unsubscribe(topic);
    },
    [manager]
  );

  // Get subscribed topics
  const getSubscribedTopics = useCallback(() => {
    if (!manager) {
      return [];
    }
    return manager.getSubscribedTopics();
  }, [manager]);

  return {
    manager,
    state,
    connect,
    disconnect,
    isConnected,
    send,
    subscribe,
    unsubscribe,
    getSubscribedTopics,
  };
}
