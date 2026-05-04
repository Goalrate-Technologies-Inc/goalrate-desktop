/**
 * Integration Test Setup
 * Configures tests to run against the real Tauri backend
 *
 * Prerequisites:
 * - The desktop app must be running: pnpm run dev:desktop
 * - Tests will use a temporary test vault in /tmp/goalrate-integration-test/
 */

import '@testing-library/jest-dom/vitest';
import { beforeAll, afterAll } from 'vitest';
import { hasTauriIpc } from './tauriIntegration';

// Test vault configuration
export const TEST_VAULT_PATH = '/tmp/goalrate-integration-test';
export const TEST_VAULT_NAME = 'Integration Test Vault';

/**
 * Check if Tauri backend is available
 */
async function checkTauriBackend(): Promise<boolean> {
  try {
    // Dynamic import to avoid errors when Tauri is not available
    const { invoke } = await import('@tauri-apps/api/core');
    const greeting = await invoke<string>('greet', { name: 'Test' });
    console.log('✓ Tauri backend connected:', greeting);
    return true;
  } catch (error) {
    console.error('✗ Tauri backend not available');
    console.error('  Make sure the desktop app is running: pnpm run dev:desktop');
    console.error('  Error:', error);
    return false;
  }
}

/**
 * Clean up any existing test vault
 */
async function cleanupTestVault(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');

    // List vaults and find any test vaults
    const vaults = await invoke<Array<{ id: string; name: string; path: string }>>('list_vaults');
    const testVaults = vaults.filter(
      (v) => v.path.includes('goalrate-integration-test') || v.name === TEST_VAULT_NAME
    );

    // Delete test vaults
    for (const vault of testVaults) {
      try {
        await invoke('delete_vault', { vaultId: vault.id });
        console.log(`  Cleaned up test vault: ${vault.name}`);
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

// Global setup
beforeAll(async () => {
  console.log('\n🔧 Integration Test Setup');
  console.log('━'.repeat(50));

  if (!hasTauriIpc()) {
    console.log('\n⚠️  Skipping integration tests - Tauri IPC is not available in this test process');
    console.log('   Run these suites in a Tauri IPC-capable harness to exercise native commands.\n');
    return;
  }

  const isAvailable = await checkTauriBackend();

  if (!isAvailable) {
    throw new Error(
      'Tauri IPC is available, but the backend did not respond to the integration setup command'
    );
  }

  // Clean up any leftover test data
  await cleanupTestVault();

  console.log('━'.repeat(50));
  console.log('');
});

// Global teardown
afterAll(async () => {
  if (!hasTauriIpc()) {
    return;
  }

  console.log('\n🧹 Integration Test Cleanup');
  console.log('━'.repeat(50));

  await cleanupTestVault();

  console.log('━'.repeat(50));
  console.log('');
});
