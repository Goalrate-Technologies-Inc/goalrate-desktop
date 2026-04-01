/**
 * Heartbeat Manager for WebSocket
 * Handles ping/pong to keep connection alive and detect stale connections
 */

import { MessageType } from '@goalrate-app/shared';

// ============================================================================
// HEARTBEAT MANAGER
// ============================================================================

/**
 * Heartbeat configuration
 */
export interface HeartbeatConfig {
  /** Ping interval in milliseconds */
  interval: number;
  /** Pong timeout in milliseconds */
  timeout: number;
}

/**
 * Default heartbeat configuration
 */
const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  interval: 30000, // 30 seconds
  timeout: 10000, // 10 seconds
};

/**
 * Heartbeat state
 */
export interface HeartbeatState {
  /** Is heartbeat active */
  active: boolean;
  /** Last ping sent timestamp */
  lastPingSent?: Date;
  /** Last pong received timestamp */
  lastPongReceived?: Date;
  /** Number of missed pongs */
  missedPongs: number;
}

/**
 * Callback for sending ping
 */
export type SendPingCallback = () => void;

/**
 * Callback for heartbeat timeout
 */
export type TimeoutCallback = () => void;

/**
 * Manages heartbeat ping/pong for WebSocket connections
 */
export class HeartbeatManager {
  private config: HeartbeatConfig;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private state: HeartbeatState = {
    active: false,
    missedPongs: 0,
  };
  private sendPing: SendPingCallback;
  private onTimeout: TimeoutCallback;

  constructor(
    sendPing: SendPingCallback,
    onTimeout: TimeoutCallback,
    config: Partial<HeartbeatConfig> = {}
  ) {
    this.config = { ...DEFAULT_HEARTBEAT_CONFIG, ...config };
    this.sendPing = sendPing;
    this.onTimeout = onTimeout;
  }

  /**
   * Get current heartbeat state
   */
  getState(): HeartbeatState {
    return { ...this.state };
  }

  /**
   * Start the heartbeat
   */
  start(): void {
    if (this.state.active) {
      return;
    }

    this.state.active = true;
    this.state.missedPongs = 0;

    // Start ping interval
    this.pingInterval = setInterval(() => {
      this.ping();
    }, this.config.interval);

    // Send initial ping
    this.ping();
  }

  /**
   * Stop the heartbeat
   */
  stop(): void {
    this.state.active = false;

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  /**
   * Reset heartbeat (e.g., after reconnection)
   */
  reset(): void {
    this.stop();
    this.state = {
      active: false,
      missedPongs: 0,
    };
  }

  /**
   * Handle received pong
   */
  receivedPong(): void {
    this.state.lastPongReceived = new Date();
    this.state.missedPongs = 0;

    // Clear timeout since we received pong
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  /**
   * Handle any received message (resets timeout as activity indicator)
   */
  receivedMessage(): void {
    // Any message from server can be considered as activity
    // This helps detect stale connections even without explicit pong
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  /**
   * Send ping and start pong timeout
   */
  private ping(): void {
    if (!this.state.active) {
      return;
    }

    this.state.lastPingSent = new Date();
    this.sendPing();

    // Start pong timeout
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
    }

    this.pongTimeout = setTimeout(() => {
      this.handleTimeout();
    }, this.config.timeout);
  }

  /**
   * Handle pong timeout
   */
  private handleTimeout(): void {
    this.state.missedPongs++;

    // Allow a few missed pongs before triggering timeout
    if (this.state.missedPongs >= 2) {
      this.onTimeout();
    }
  }

  /**
   * Get latency (time between last ping and pong)
   */
  getLatency(): number | null {
    if (!this.state.lastPingSent || !this.state.lastPongReceived) {
      return null;
    }

    return this.state.lastPongReceived.getTime() - this.state.lastPingSent.getTime();
  }

  /**
   * Check if heartbeat is healthy
   */
  isHealthy(): boolean {
    if (!this.state.active) {
      return false;
    }

    return this.state.missedPongs < 2;
  }

  /**
   * Create ping message
   */
  static createPingMessage(): { type: MessageType; data: { timestamp: string } } {
    return {
      type: MessageType.PING,
      data: { timestamp: new Date().toISOString() },
    };
  }

  /**
   * Check if message is a pong
   */
  static isPongMessage(type: string): boolean {
    return type === MessageType.PONG || type === 'pong';
  }
}
