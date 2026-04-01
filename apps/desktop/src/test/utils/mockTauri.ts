/**
 * Tauri Mock Utilities
 * Centralized utilities for mocking Tauri APIs in tests
 */

import { vi, type Mock } from 'vitest';

// ============================================================================
// TYPES
// ============================================================================

export interface TauriInvokeMock {
  /** The mock function */
  invoke: Mock;
  /** Set a specific command response */
  mockCommand: (command: string, response: unknown) => void;
  /** Set a specific command to reject */
  mockCommandError: (command: string, error: Error | string) => void;
  /** Reset all command responses */
  reset: () => void;
}

export interface TauriEventMock {
  /** Mock listen function */
  listen: Mock;
  /** Mock emit function */
  emit: Mock;
  /** Simulate an event being triggered */
  simulateEvent: (event: string, payload?: unknown) => void;
}

// ============================================================================
// INVOKE MOCK
// ============================================================================

/**
 * Create a mock for @tauri-apps/api/core invoke function
 *
 * Usage:
 * ```typescript
 * vi.mock('@tauri-apps/api/core', () => ({
 *   invoke: vi.fn(),
 * }));
 *
 * import { invoke } from '@tauri-apps/api/core';
 * import { setupTauriInvokeMock } from './mockTauri';
 *
 * const tauriMock = setupTauriInvokeMock(invoke as Mock);
 * tauriMock.mockCommand('list_vaults', [{ id: 'vault_1', name: 'Test' }]);
 * ```
 */
export function setupTauriInvokeMock(invokeMock: Mock): TauriInvokeMock {
  const commandResponses = new Map<string, { type: 'resolve' | 'reject'; value: unknown }>();

  invokeMock.mockImplementation(async (command: string, args?: unknown) => {
    const response = commandResponses.get(command);

    if (response) {
      if (response.type === 'reject') {
        throw response.value;
      }
      // If response is a function, call it with args
      if (typeof response.value === 'function') {
        return response.value(args);
      }
      return response.value;
    }

    // Default: return undefined
    return undefined;
  });

  return {
    invoke: invokeMock,
    mockCommand: (command: string, response: unknown) => {
      commandResponses.set(command, { type: 'resolve', value: response });
    },
    mockCommandError: (command: string, error: Error | string) => {
      const errorValue = typeof error === 'string' ? new Error(error) : error;
      commandResponses.set(command, { type: 'reject', value: errorValue });
    },
    reset: () => {
      commandResponses.clear();
      invokeMock.mockClear();
    },
  };
}

// ============================================================================
// EVENT MOCK
// ============================================================================

/**
 * Create a mock for @tauri-apps/api/event functions
 *
 * Usage:
 * ```typescript
 * vi.mock('@tauri-apps/api/event', () => ({
 *   listen: vi.fn(),
 *   emit: vi.fn(),
 * }));
 *
 * import { listen, emit } from '@tauri-apps/api/event';
 * import { setupTauriEventMock } from './mockTauri';
 *
 * const eventMock = setupTauriEventMock(listen as Mock, emit as Mock);
 * eventMock.simulateEvent('menu-action', { action: 'view:focus' });
 * ```
 */
export function setupTauriEventMock(listenMock: Mock, emitMock: Mock): TauriEventMock {
  const listeners = new Map<string, Set<(event: unknown) => void>>();

  listenMock.mockImplementation(async (event: string, handler: (event: unknown) => void) => {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    listeners.get(event)!.add(handler);

    // Return unlisten function
    return () => {
      listeners.get(event)?.delete(handler);
    };
  });

  emitMock.mockImplementation(async (event: string, payload?: unknown) => {
    const eventListeners = listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach((listener) => {
        listener({ event, payload });
      });
    }
  });

  return {
    listen: listenMock,
    emit: emitMock,
    simulateEvent: (event: string, payload?: unknown) => {
      const eventListeners = listeners.get(event);
      if (eventListeners) {
        eventListeners.forEach((listener) => {
          listener({ event, payload });
        });
      }
    },
  };
}

// ============================================================================
// WINDOW MOCK
// ============================================================================

/**
 * Create a mock for @tauri-apps/api/window functions
 */
export function createWindowMock(): { getCurrentWindow: Mock } {
  const windowMock = {
    setTitle: vi.fn().mockResolvedValue(undefined),
    minimize: vi.fn().mockResolvedValue(undefined),
    maximize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    isMaximized: vi.fn().mockResolvedValue(false),
  };

  return {
    getCurrentWindow: vi.fn().mockReturnValue(windowMock),
  };
}

// ============================================================================
// PLUGIN MOCKS
// ============================================================================

/**
 * Create mock for @tauri-apps/plugin-updater
 */
export function createUpdaterMock(): { check: Mock } {
  return {
    check: vi.fn().mockResolvedValue(null),
  };
}

/**
 * Create mock for @tauri-apps/plugin-process
 */
export function createProcessMock(): { relaunch: Mock; exit: Mock } {
  return {
    relaunch: vi.fn().mockResolvedValue(undefined),
    exit: vi.fn().mockResolvedValue(undefined),
  };
}

// ============================================================================
// COMMAND RESPONSES
// ============================================================================

/**
 * Common Tauri command response factories
 */
export const commandResponses = {
  /** Create a successful vault list response */
  listVaults: (vaults: unknown[]) => vaults,

  /** Create a successful vault open response */
  openVault: (vault: unknown) => vault,

  /** Create a successful vault create response */
  createVault: (config: unknown) => config,

  /** Create an error response */
  error: (code: string, message: string) => ({
    code,
    message,
  }),

  /** Create a successful goal list response */
  listGoals: (goals: unknown[]) => goals,

  /** Create a successful focus day response */
  getFocusDay: (focusDay: unknown) => focusDay,

  /** Create a greeting response (for testing) */
  greet: (name: string) => `Hello, ${name}!`,
};
