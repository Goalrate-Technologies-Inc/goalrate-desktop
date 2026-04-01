/**
 * useConnectionState Hook
 * Reactive hook for connection state
 */

import { useMemo } from 'react';
import { ConnectionState } from '../../types';
import { useWebSocketContext } from '../WebSocketContext';

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook return type
 */
export interface UseConnectionStateReturn {
  /** Current connection state */
  connectionState: ConnectionState;

  /** Is currently connected */
  isConnected: boolean;

  /** Is currently connecting */
  isConnecting: boolean;

  /** Is currently reconnecting */
  isReconnecting: boolean;

  /** Is disconnected */
  isDisconnected: boolean;

  /** Is in error state */
  isError: boolean;

  /** Number of reconnect attempts */
  reconnectAttempts: number;

  /** Session ID (when connected) */
  sessionId?: string;

  /** Last error message */
  lastError?: string;

  /** Time of last connection */
  connectedAt?: Date;

  /** Time of last disconnection */
  disconnectedAt?: Date;

  /** Number of queued messages */
  queuedMessageCount: number;
}

/**
 * Connection state hook
 * Provides reactive access to connection state
 */
export function useConnectionState(): UseConnectionStateReturn {
  const { state } = useWebSocketContext();

  return useMemo(
    () => ({
      connectionState: state.connectionState,
      isConnected: state.connectionState === ConnectionState.CONNECTED,
      isConnecting: state.connectionState === ConnectionState.CONNECTING,
      isReconnecting: state.connectionState === ConnectionState.RECONNECTING,
      isDisconnected: state.connectionState === ConnectionState.DISCONNECTED,
      isError: state.connectionState === ConnectionState.ERROR,
      reconnectAttempts: state.reconnectAttempts,
      sessionId: state.sessionId,
      lastError: state.lastError,
      connectedAt: state.connectedAt,
      disconnectedAt: state.disconnectedAt,
      queuedMessageCount: state.queuedMessageCount,
    }),
    [state]
  );
}
