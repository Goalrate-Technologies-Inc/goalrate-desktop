/**
 * WebSocket Manager
 * Core connection manager with auto-reconnect, heartbeat, and message queuing
 */

import { ConnectionState, MessageType } from '@goalrate-app/shared';
import type { WebSocketMessage } from '@goalrate-app/shared';
import type {
  WebSocketManagerConfig,
  WebSocketManagerState,
  WebSocketEventType,
  WebSocketEventHandler,
} from './types';
import { DEFAULT_CONFIG } from './types';
import { MessageQueue } from './MessageQueue';
import { HeartbeatManager } from './HeartbeatManager';
import {
  WebSocketError,
  connectionFailed,
  connectionClosed,
  authenticationFailed,
  heartbeatTimeout,
  maxReconnectAttempts,
  sendFailed,
  isAuthError,
  CLOSE_CODES,
} from './errors';

// ============================================================================
// TYPES
// ============================================================================

type EventHandler = (...args: unknown[]) => void;

interface ConnectMessage {
  type: 'connect';
  data: {
    session_id: string;
    user_id: string;
    message: string;
    server_time: string;
  };
}

// ============================================================================
// WEBSOCKET MANAGER
// ============================================================================

/**
 * WebSocket connection manager with auto-reconnect, heartbeat, and message queuing
 */
export class WebSocketManager {
  private config: WebSocketManagerConfig;
  private ws: WebSocket | null = null;
  private state: WebSocketManagerState;
  private eventHandlers: Map<WebSocketEventType, Set<EventHandler>> = new Map();
  private messageHandlers: Map<string, Set<(data: unknown) => void>> = new Map();
  private messageQueue: MessageQueue;
  private heartbeat: HeartbeatManager;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private connectPromise: {
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(config: WebSocketManagerConfig) {
    this.config = this.mergeConfig(config);
    this.state = this.createInitialState();
    this.messageQueue = new MessageQueue(config.queue);
    this.heartbeat = new HeartbeatManager(
      () => this.sendPing(),
      () => this.handleHeartbeatTimeout(),
      config.heartbeat
    );
  }

  // =========================================================================
  // CONFIGURATION
  // =========================================================================

  /**
   * Merge user config with defaults
   */
  private mergeConfig(config: WebSocketManagerConfig): WebSocketManagerConfig {
    return {
      ...config,
      reconnect: { ...DEFAULT_CONFIG.reconnect, ...config.reconnect },
      heartbeat: { ...DEFAULT_CONFIG.heartbeat, ...config.heartbeat },
      queue: { ...DEFAULT_CONFIG.queue, ...config.queue },
    };
  }

  /**
   * Create initial state
   */
  private createInitialState(): WebSocketManagerState {
    return {
      connectionState: ConnectionState.DISCONNECTED,
      reconnectAttempts: 0,
      subscribedTopics: [],
      queuedMessageCount: 0,
    };
  }

  // =========================================================================
  // CONNECTION LIFECYCLE
  // =========================================================================

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    if (
      this.state.connectionState === ConnectionState.CONNECTED ||
      this.state.connectionState === ConnectionState.CONNECTING
    ) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.connectPromise = { resolve, reject };
      this.doConnect();
    });
  }

  /**
   * Internal connect implementation
   */
  private doConnect(): void {
    this.updateState({ connectionState: ConnectionState.CONNECTING });
    this.emit('connecting');

    try {
      // Build URL with user ID
      const url = this.buildUrl();
      this.ws = new WebSocket(url);

      // Set up event handlers
      this.ws.onopen = () => this.handleOpen();
      this.ws.onclose = (event) => this.handleClose(event);
      this.ws.onmessage = (event) => this.handleMessage(event);
      this.ws.onerror = () => this.handleError();
    } catch (error) {
      const wsError = connectionFailed('Failed to create WebSocket', error as Error);
      this.handleConnectionError(wsError);
    }
  }

  /**
   * Build WebSocket URL
   */
  private buildUrl(): string {
    let url = this.config.url;

    // Append user ID
    if (!url.endsWith('/')) {
      url += '/';
    }
    url += this.config.userId;

    // Append auth token as query param if provided
    if (this.config.authToken) {
      const separator = url.includes('?') ? '&' : '?';
      url += `${separator}token=${encodeURIComponent(this.config.authToken)}`;
    }

    return url;
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.cancelReconnect();
    this.heartbeat.stop();

    if (this.ws) {
      // Remove handlers before closing to prevent reconnect
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;

      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close(CLOSE_CODES.NORMAL, 'Client disconnected');
      }
      this.ws = null;
    }

    this.updateState({
      connectionState: ConnectionState.DISCONNECTED,
      disconnectedAt: new Date(),
      sessionId: undefined,
    });

    this.emit('disconnected', CLOSE_CODES.NORMAL, 'Client disconnected', true);
  }

  // =========================================================================
  // EVENT HANDLERS
  // =========================================================================

  /**
   * Handle WebSocket open
   */
  private handleOpen(): void {
    // Wait for connect message from server to confirm connection
    // The actual connected state is set in handleConnectMessage
  }

  /**
   * Handle WebSocket close
   */
  private handleClose(event: CloseEvent): void {
    const wasConnected = this.state.connectionState === ConnectionState.CONNECTED;

    this.heartbeat.stop();
    this.ws = null;

    this.updateState({
      connectionState: ConnectionState.DISCONNECTED,
      disconnectedAt: new Date(),
    });

    this.emit('disconnected', event.code, event.reason, event.wasClean);

    // Reject connect promise if pending
    if (this.connectPromise) {
      this.connectPromise.reject(connectionClosed(event.code, event.reason, event.wasClean));
      this.connectPromise = null;
    }

    // Don't reconnect on auth errors
    if (isAuthError(event.code)) {
      const error = authenticationFailed(event.reason || 'Authentication failed');
      this.emit('error', error);
      return;
    }

    // Attempt reconnect if was connected and reconnect is enabled
    if (wasConnected && this.config.reconnect?.enabled) {
      this.scheduleReconnect();
    }
  }

  /**
   * Handle WebSocket message
   */
  private handleMessage(event: MessageEvent): void {
    this.heartbeat.receivedMessage();

    try {
      const message = JSON.parse(event.data as string) as WebSocketMessage;

      // Handle pong
      if (HeartbeatManager.isPongMessage(message.type)) {
        this.heartbeat.receivedPong();
        return;
      }

      // Handle connect message
      if (message.type === MessageType.CONNECT || message.type === 'connect') {
        this.handleConnectMessage(message as unknown as ConnectMessage);
        return;
      }

      // Handle error message
      if (message.type === MessageType.ERROR || message.type === 'error') {
        this.handleErrorMessage(message);
        return;
      }

      // Emit to general message handlers
      this.emit('message', message);

      // Emit to type-specific handlers
      const typeHandlers = this.messageHandlers.get(message.type);
      if (typeHandlers) {
        for (const handler of typeHandlers) {
          try {
            handler(message.data);
          } catch (error) {
            console.error('Error in message handler:', error);
          }
        }
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  /**
   * Handle connect message from server
   */
  private handleConnectMessage(message: ConnectMessage): void {
    const sessionId = message.data.session_id;

    this.updateState({
      connectionState: ConnectionState.CONNECTED,
      sessionId,
      connectedAt: new Date(),
      reconnectAttempts: 0,
      lastError: undefined,
    });

    // Start heartbeat
    if (this.config.heartbeat?.enabled) {
      this.heartbeat.start();
    }

    // Resolve connect promise
    if (this.connectPromise) {
      this.connectPromise.resolve();
      this.connectPromise = null;
    }

    // Flush message queue
    this.flushQueue();

    // Resubscribe to topics
    this.resubscribe();

    this.emit('connected', sessionId);
  }

  /**
   * Handle error message from server
   */
  private handleErrorMessage(message: WebSocketMessage): void {
    const error = new WebSocketError(
      'UNKNOWN_ERROR',
      (message.data as { message?: string })?.message || 'Server error',
      { recoverable: true }
    );
    this.emit('error', error);
  }

  /**
   * Handle WebSocket error
   */
  private handleError(): void {
    // WebSocket errors don't provide details, close event will follow
    // Just log for debugging
    console.warn('WebSocket error occurred');
  }

  /**
   * Handle connection error
   */
  private handleConnectionError(error: WebSocketError): void {
    this.updateState({
      connectionState: ConnectionState.ERROR,
      lastError: error.message,
    });

    this.emit('error', error);

    if (this.connectPromise) {
      this.connectPromise.reject(error);
      this.connectPromise = null;
    }

    // Attempt reconnect if recoverable
    if (error.recoverable && this.config.reconnect?.enabled) {
      this.scheduleReconnect();
    }
  }

  /**
   * Handle heartbeat timeout
   */
  private handleHeartbeatTimeout(): void {
    const error = heartbeatTimeout();
    this.emit('error', error);

    // Close connection to trigger reconnect
    if (this.ws) {
      this.ws.close(CLOSE_CODES.ABNORMAL_CLOSURE, 'Heartbeat timeout');
    }
  }

  // =========================================================================
  // RECONNECTION
  // =========================================================================

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (!this.config.reconnect?.enabled) {
      return;
    }

    const maxAttempts = this.config.reconnect.maxAttempts ?? DEFAULT_CONFIG.reconnect.maxAttempts;

    if (this.state.reconnectAttempts >= maxAttempts) {
      const error = maxReconnectAttempts(maxAttempts);
      this.emit('error', error);
      return;
    }

    this.updateState({
      connectionState: ConnectionState.RECONNECTING,
      reconnectAttempts: this.state.reconnectAttempts + 1,
    });

    const delay = this.calculateReconnectDelay();

    this.emit('reconnecting', this.state.reconnectAttempts, maxAttempts);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.doConnect();
    }, delay);
  }

  /**
   * Calculate reconnect delay with exponential backoff and jitter
   */
  private calculateReconnectDelay(): number {
    const { initialDelay, maxDelay, multiplier, jitter } = {
      ...DEFAULT_CONFIG.reconnect,
      ...this.config.reconnect,
    };

    // Exponential backoff
    let delay = initialDelay * Math.pow(multiplier, this.state.reconnectAttempts - 1);

    // Cap at max delay
    delay = Math.min(delay, maxDelay);

    // Add jitter (0-25% random variation)
    if (jitter) {
      const jitterAmount = delay * 0.25 * Math.random();
      delay += jitterAmount;
    }

    return Math.round(delay);
  }

  /**
   * Cancel pending reconnect
   */
  private cancelReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  // =========================================================================
  // MESSAGING
  // =========================================================================

  /**
   * Send a message
   */
  send<T>(type: MessageType | string, data: T): void {
    const message: WebSocketMessage<T> = {
      type,
      data,
      timestamp: new Date().toISOString(),
      userId: this.config.userId,
    };

    if (this.isConnected()) {
      this.doSend(message);
    } else if (this.config.queue?.enabled) {
      // Queue message for later
      this.messageQueue.enqueue(type, data);
      this.updateState({ queuedMessageCount: this.messageQueue.size });
    } else {
      throw sendFailed('Not connected and queuing is disabled');
    }
  }

  /**
   * Internal send implementation
   */
  private doSend(message: WebSocketMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw sendFailed('WebSocket is not open');
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      throw sendFailed('Failed to send message', error as Error);
    }
  }

  /**
   * Send ping
   */
  private sendPing(): void {
    if (!this.isConnected()) {
      return;
    }

    try {
      const pingMessage = HeartbeatManager.createPingMessage();
      this.doSend(pingMessage);
    } catch {
      // Ping failure will trigger heartbeat timeout
    }
  }

  /**
   * Flush queued messages
   */
  private flushQueue(): void {
    const messages = this.messageQueue.drain();

    for (const queuedMessage of messages) {
      try {
        const message: WebSocketMessage = {
          type: queuedMessage.type,
          data: queuedMessage.data,
          timestamp: new Date().toISOString(),
          userId: this.config.userId,
        };
        this.doSend(message);
      } catch (error) {
        console.error('Failed to send queued message:', error);
        // Re-queue failed message
        this.messageQueue.enqueue(queuedMessage.type, queuedMessage.data);
      }
    }

    this.updateState({ queuedMessageCount: this.messageQueue.size });
  }

  // =========================================================================
  // SUBSCRIPTIONS
  // =========================================================================

  /**
   * Subscribe to a topic
   */
  subscribe(topic: string): void {
    if (this.state.subscribedTopics.includes(topic)) {
      return;
    }

    this.state.subscribedTopics.push(topic);
    this.updateState({ subscribedTopics: [...this.state.subscribedTopics] });

    if (this.isConnected()) {
      this.send(MessageType.SUBSCRIBE, { topic });
    }
  }

  /**
   * Unsubscribe from a topic
   */
  unsubscribe(topic: string): void {
    const index = this.state.subscribedTopics.indexOf(topic);
    if (index === -1) {
      return;
    }

    this.state.subscribedTopics.splice(index, 1);
    this.updateState({ subscribedTopics: [...this.state.subscribedTopics] });

    if (this.isConnected()) {
      this.send(MessageType.UNSUBSCRIBE, { topic });
    }
  }

  /**
   * Get subscribed topics
   */
  getSubscribedTopics(): string[] {
    return [...this.state.subscribedTopics];
  }

  /**
   * Resubscribe to all topics after reconnect
   */
  private resubscribe(): void {
    for (const topic of this.state.subscribedTopics) {
      this.send(MessageType.SUBSCRIBE, { topic });
    }
  }

  // =========================================================================
  // STATE
  // =========================================================================

  /**
   * Get current state
   */
  getState(): WebSocketManagerState {
    return { ...this.state };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return (
      this.state.connectionState === ConnectionState.CONNECTED &&
      this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN
    );
  }

  /**
   * Update state and emit change
   */
  private updateState(updates: Partial<WebSocketManagerState>): void {
    this.state = { ...this.state, ...updates };
    this.emit('stateChange', this.state);
  }

  // =========================================================================
  // EVENTS
  // =========================================================================

  /**
   * Add event listener
   */
  on<E extends WebSocketEventType>(event: E, handler: WebSocketEventHandler<E>): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler as EventHandler);
  }

  /**
   * Remove event listener
   */
  off<E extends WebSocketEventType>(event: E, handler: WebSocketEventHandler<E>): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler as EventHandler);
    }
  }

  /**
   * Add message type handler
   */
  onMessage<T>(type: MessageType | string, handler: (data: T) => void): () => void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(handler as (data: unknown) => void);

    // Return unsubscribe function
    return () => {
      const handlers = this.messageHandlers.get(type);
      if (handlers) {
        handlers.delete(handler as (data: unknown) => void);
      }
    };
  }

  /**
   * Emit event
   */
  private emit<E extends WebSocketEventType>(
    event: E,
    ...args: Parameters<WebSocketEventHandler<E>>
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          (handler as (...args: unknown[]) => void)(...args);
        } catch (error) {
          console.error(`Error in ${event} handler:`, error);
        }
      }
    }
  }

  // =========================================================================
  // CLEANUP
  // =========================================================================

  /**
   * Dispose of the manager
   */
  dispose(): void {
    this.disconnect();
    this.messageQueue.clear();
    this.eventHandlers.clear();
    this.messageHandlers.clear();
    // Clear subscribed topics
    this.state.subscribedTopics = [];
  }
}
