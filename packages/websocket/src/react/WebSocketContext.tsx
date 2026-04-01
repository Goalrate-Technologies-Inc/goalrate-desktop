/**
 * WebSocket React Context
 */

import { createContext, useContext } from 'react';
import type { WebSocketManager } from '../WebSocketManager';
import type { WebSocketManagerState } from '../types';
import { ConnectionState } from '../types';

// ============================================================================
// CONTEXT VALUE
// ============================================================================

/**
 * WebSocket context value
 */
export interface WebSocketContextValue {
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
}

/**
 * Default context value
 */
const defaultContextValue: WebSocketContextValue = {
  manager: null,
  state: {
    connectionState: ConnectionState.DISCONNECTED,
    reconnectAttempts: 0,
    subscribedTopics: [],
    queuedMessageCount: 0,
  },
  connect: async () => {
    throw new Error('WebSocketProvider not found');
  },
  disconnect: () => {
    throw new Error('WebSocketProvider not found');
  },
  isConnected: false,
};

// ============================================================================
// CONTEXT
// ============================================================================

/**
 * WebSocket context
 */
export const WebSocketContext = createContext<WebSocketContextValue>(defaultContextValue);

/**
 * Use WebSocket context
 * @throws Error if used outside of WebSocketProvider
 */
export function useWebSocketContext(): WebSocketContextValue {
  const context = useContext(WebSocketContext);

  if (!context.manager && context === defaultContextValue) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }

  return context;
}
