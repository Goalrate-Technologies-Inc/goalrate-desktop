/**
 * useMessage Hook
 * Listen for specific message types
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import type { WebSocketMessage } from '@goalrate-app/shared';
import { MessageType } from '../../types';
import { useWebSocketContext } from '../WebSocketContext';

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Message handler callback type
 */
export type MessageHandler<T> = (data: T, message: WebSocketMessage<T>) => void;

/**
 * Hook options
 */
export interface UseMessageOptions {
  /** Only listen when connected (default: true) */
  onlyWhenConnected?: boolean;
}

/**
 * Listen for a specific message type
 *
 * @param type Message type to listen for
 * @param handler Handler function called when message received
 * @param options Hook options
 */
export function useMessage<T = unknown>(
  type: MessageType | string,
  handler: MessageHandler<T>,
  options: UseMessageOptions = {}
): void {
  const { onlyWhenConnected = true } = options;
  const { manager, isConnected } = useWebSocketContext();
  const handlerRef = useRef(handler);

  // Keep handler ref up to date
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!manager) {
      return;
    }

    // Skip if only listening when connected and not connected
    if (onlyWhenConnected && !isConnected) {
      return;
    }

    // Subscribe to message type
    const unsubscribe = manager.onMessage<T>(type, (data) => {
      handlerRef.current(data, { type, data } as WebSocketMessage<T>);
    });

    return unsubscribe;
  }, [type, manager, isConnected, onlyWhenConnected]);
}

/**
 * Listen for multiple message types with a single handler
 *
 * @param types Message types to listen for
 * @param handler Handler function called when any message received
 * @param options Hook options
 */
export function useMessages<T = unknown>(
  types: (MessageType | string)[],
  handler: MessageHandler<T>,
  options: UseMessageOptions = {}
): void {
  const { onlyWhenConnected = true } = options;
  const { manager, isConnected } = useWebSocketContext();
  const handlerRef = useRef(handler);

  // Keep handler ref up to date
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!manager) {
      return;
    }

    // Skip if only listening when connected and not connected
    if (onlyWhenConnected && !isConnected) {
      return;
    }

    // Subscribe to all message types
    const unsubscribes = types.map((type) =>
      manager.onMessage<T>(type, (data) => {
        handlerRef.current(data, { type, data } as WebSocketMessage<T>);
      })
    );

    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [types, manager, isConnected, onlyWhenConnected]);
}

/**
 * Listen for a message type and return the last received message
 *
 * @param type Message type to listen for
 * @param initialValue Initial value before any message received
 * @returns Last received message data
 */
export function useMessageState<T>(
  type: MessageType | string,
  initialValue?: T
): T | undefined {
  const [data, setData] = useState<T | undefined>(initialValue);

  useMessage<T>(type, useCallback((newData) => {
    setData(newData);
  }, []));

  return data;
}

/**
 * Listen for a message type and collect all received messages
 *
 * @param type Message type to listen for
 * @param maxMessages Maximum number of messages to keep (default: 100)
 * @returns Array of received messages and clear function
 */
export function useMessageHistory<T>(
  type: MessageType | string,
  maxMessages = 100
): [T[], () => void] {
  const [messages, setMessages] = useState<T[]>([]);

  useMessage<T>(
    type,
    useCallback(
      (data) => {
        setMessages((prev) => {
          const next = [...prev, data];
          if (next.length > maxMessages) {
            return next.slice(-maxMessages);
          }
          return next;
        });
      },
      [maxMessages]
    )
  );

  const clear = useCallback(() => {
    setMessages([]);
  }, []);

  return [messages, clear];
}
