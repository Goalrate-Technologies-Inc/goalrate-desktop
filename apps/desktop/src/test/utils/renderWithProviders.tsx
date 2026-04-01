/**
 * Render With Providers
 * Custom render function that wraps components with all necessary providers for testing
 */

import React, { type ReactElement } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import { StorageProvider } from '@goalrate-app/storage/react';
import { MockStorageAdapter, type MockStorageAdapterOptions } from '@goalrate-app/storage/testing';
import { TooltipProvider } from '@goalrate-app/ui';
import type { Vault, VaultListItem } from '@goalrate-app/shared';

// ============================================================================
// TYPES
// ============================================================================

export interface ProviderOptions {
  /**
   * Storage adapter options for MockStorageAdapter
   */
  storageOptions?: MockStorageAdapterOptions;

  /**
   * Initial vaults to populate the mock adapter
   */
  initialVaults?: VaultListItem[];

  /**
   * Current vault to set in the mock adapter
   */
  currentVault?: Vault;

  /**
   * Router options
   */
  routerOptions?: {
    /**
     * Initial route entries for MemoryRouter
     * @default ['/']
     */
    initialEntries?: MemoryRouterProps['initialEntries'];

    /**
     * Initial index in the history stack
     */
    initialIndex?: number;
  };

  /**
   * Whether to auto-initialize the storage adapter
   * @default true
   */
  autoInitialize?: boolean;
}

export interface CustomRenderResult extends RenderResult {
  /**
   * The MockStorageAdapter instance used in the test
   */
  adapter: MockStorageAdapter;
}

// ============================================================================
// ALL PROVIDERS WRAPPER
// ============================================================================

interface AllProvidersProps {
  children: React.ReactNode;
  adapter: MockStorageAdapter;
  routerOptions?: ProviderOptions['routerOptions'];
  autoInitialize?: boolean;
}

function AllProviders({
  children,
  adapter,
  routerOptions,
  autoInitialize = true,
}: AllProvidersProps): ReactElement {
  const initialEntries = routerOptions?.initialEntries ?? ['/'];
  const initialIndex = routerOptions?.initialIndex;

  return (
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
      <StorageProvider adapter={adapter} autoInitialize={autoInitialize}>
        <TooltipProvider>
          {children}
        </TooltipProvider>
      </StorageProvider>
    </MemoryRouter>
  );
}

// ============================================================================
// CUSTOM RENDER FUNCTION
// ============================================================================

/**
 * Custom render function that wraps components with all necessary providers
 *
 * @example
 * ```typescript
 * const { adapter } = renderWithProviders(<MyComponent />, {
 *   initialVaults: [createMockVaultListItem()],
 *   currentVault: createMockVault(),
 *   routerOptions: { initialEntries: ['/focus'] },
 * });
 *
 * // Access adapter to verify calls
 * expect(adapter.getCalls('listVaults')).toHaveLength(1);
 * ```
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: ProviderOptions & Omit<RenderOptions, 'wrapper'>
): CustomRenderResult {
  const {
    storageOptions,
    initialVaults,
    currentVault,
    routerOptions,
    autoInitialize = true,
    ...renderOptions
  } = options ?? {};

  // Create the mock adapter
  const adapter = new MockStorageAdapter({
    ...storageOptions,
    vaults: initialVaults ?? storageOptions?.vaults,
    currentVault: currentVault ?? storageOptions?.currentVault,
  });

  // Render with all providers
  const result = render(ui, {
    wrapper: ({ children }) => (
      <AllProviders
        adapter={adapter}
        routerOptions={routerOptions}
        autoInitialize={autoInitialize}
      >
        {children}
      </AllProviders>
    ),
    ...renderOptions,
  });

  return {
    ...result,
    adapter,
  };
}

// ============================================================================
// HOOK TESTING UTILITIES
// ============================================================================

/**
 * Create a wrapper component for testing hooks with providers
 *
 * @example
 * ```typescript
 * const { adapter, wrapper } = createHookWrapper({
 *   initialVaults: [createMockVaultListItem()],
 * });
 *
 * const { result } = renderHook(() => useVault(), { wrapper });
 * ```
 */
export function createHookWrapper(options?: ProviderOptions): {
  adapter: MockStorageAdapter;
  wrapper: React.FC<{ children: React.ReactNode }>;
} {
  const {
    storageOptions,
    initialVaults,
    currentVault,
    routerOptions,
    autoInitialize = true,
  } = options ?? {};

  const adapter = new MockStorageAdapter({
    ...storageOptions,
    vaults: initialVaults ?? storageOptions?.vaults,
    currentVault: currentVault ?? storageOptions?.currentVault,
  });

  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <AllProviders
      adapter={adapter}
      routerOptions={routerOptions}
      autoInitialize={autoInitialize}
    >
      {children}
    </AllProviders>
  );

  return { adapter, wrapper };
}

// ============================================================================
// STANDALONE PROVIDER WRAPPERS
// ============================================================================

/**
 * Create a router-only wrapper for testing components that just need routing
 */
export function createRouterWrapper(
  options?: ProviderOptions['routerOptions']
): React.FC<{ children: React.ReactNode }> {
  const initialEntries = options?.initialEntries ?? ['/'];
  const initialIndex = options?.initialIndex;

  return ({ children }) => (
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
      {children}
    </MemoryRouter>
  );
}

/**
 * Create a storage-only wrapper for testing components that just need storage
 */
export function createStorageWrapper(
  options?: Pick<ProviderOptions, 'storageOptions' | 'initialVaults' | 'currentVault' | 'autoInitialize'>
): {
  adapter: MockStorageAdapter;
  wrapper: React.FC<{ children: React.ReactNode }>;
} {
  const { storageOptions, initialVaults, currentVault, autoInitialize = true } = options ?? {};

  const adapter = new MockStorageAdapter({
    ...storageOptions,
    vaults: initialVaults ?? storageOptions?.vaults,
    currentVault: currentVault ?? storageOptions?.currentVault,
  });

  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <StorageProvider adapter={adapter} autoInitialize={autoInitialize}>
      {children}
    </StorageProvider>
  );

  return { adapter, wrapper };
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

export { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
