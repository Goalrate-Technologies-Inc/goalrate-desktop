/**
 * WebSocket Provider Component
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { WebSocketManager } from '../WebSocketManager';
import type { WebSocketManagerConfig, WebSocketManagerState } from '../types';
import { ConnectionState } from '../types';
import { WebSocketContext, type WebSocketContextValue } from './WebSocketContext';

// ============================================================================
// PROVIDER PROPS
// ============================================================================

/**
 * WebSocket provider props
 */
export interface WebSocketProviderProps {
  /** WebSocket configuration */
  config: WebSocketManagerConfig;

  /** Children to render */
  children: ReactNode;

  /** Auto-connect on mount (default: false) */
  autoConnect?: boolean;

  /** Callback when connected */
  onConnected?: (sessionId: string) => void;

  /** Callback when disconnected */
  onDisconnected?: (code: number, reason: string) => void;

  /** Callback when error occurs */
  onError?: (error: Error) => void;

  /** Callback when reconnecting */
  onReconnecting?: (attempt: number, maxAttempts: number) => void;
}

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

/**
 * WebSocket Provider
 * Manages WebSocket connection and provides context to children
 */
export function WebSocketProvider({
  config,
  children,
  autoConnect = false,
  onConnected,
  onDisconnected,
  onError,
  onReconnecting,
}: WebSocketProviderProps): React.ReactElement {
  // Manager ref to persist across renders
  const managerRef = useRef<WebSocketManager | null>(null);

  // State
  const [state, setState] = useState<WebSocketManagerState>({
    connectionState: ConnectionState.DISCONNECTED,
    reconnectAttempts: 0,
    subscribedTopics: [],
    queuedMessageCount: 0,
  });
  const [manager, setManager] = useState<WebSocketManager | null>(null);

  // Initialize manager
  useEffect(() => {
    const manager = new WebSocketManager(config);
    managerRef.current = manager;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setManager(manager);

    // Set up event listeners
    manager.on('stateChange', (newState: WebSocketManagerState) => {
      setState(newState);
    });

    manager.on('connected', (sessionId: string) => {
      onConnected?.(sessionId);
    });

    manager.on('disconnected', (code: number, reason: string) => {
      onDisconnected?.(code, reason);
    });

    manager.on('error', (error: Error) => {
      onError?.(error);
    });

    manager.on('reconnecting', (attempt: number, maxAttempts: number) => {
      onReconnecting?.(attempt, maxAttempts);
    });

    // Auto-connect if enabled
    if (autoConnect) {
      manager.connect().catch((error) => {
        console.error('Auto-connect failed:', error);
        onError?.(error);
      });
    }

    // Cleanup on unmount
    return () => {
      manager.dispose();
      managerRef.current = null;
      setManager(null);
    };
  }, [autoConnect, config, onConnected, onDisconnected, onError, onReconnecting]);

  // Connect function
  const connect = useCallback(async () => {
    if (!managerRef.current) {
      throw new Error('WebSocket manager not initialized');
    }
    await managerRef.current.connect();
  }, []);

  // Disconnect function
  const disconnect = useCallback(() => {
    if (managerRef.current) {
      managerRef.current.disconnect();
    }
  }, []);

  // Check if connected
  const isConnected = state.connectionState === ConnectionState.CONNECTED;

  // Context value
  const contextValue = useMemo<WebSocketContextValue>(
    () => ({
      manager,
      state,
      connect,
      disconnect,
      isConnected,
    }),
    [manager, state, connect, disconnect, isConnected]
  );

  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}
