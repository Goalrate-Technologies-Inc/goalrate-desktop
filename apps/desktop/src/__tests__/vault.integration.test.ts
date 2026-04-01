/**
 * Vault Integration Tests
 * Tests vault operations against the real Tauri backend
 *
 * Prerequisites:
 * - The desktop app must be running: pnpm run dev:desktop
 *
 * Run with: pnpm run test:integration
 */

import { describe, it, expect, afterEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { VaultListItem, VaultConfig } from '@goalrate-app/shared';

// Test vault configuration
const TEST_VAULT_PATH = '/tmp/goalrate-integration-test-vault';
const TEST_VAULT_NAME = 'Integration Test Vault';

describe('Vault Operations (Integration)', () => {
  let createdVaultId: string | null = null;

  afterEach(async () => {
    // Clean up created vault after each test
    if (createdVaultId) {
      try {
        await invoke('delete_vault', { vaultId: createdVaultId });
        console.log(`  Cleaned up vault: ${createdVaultId}`);
      } catch {
        // Ignore cleanup errors
      }
      createdVaultId = null;
    }
  });

  describe('listVaults', () => {
    it('should list vaults from real backend', async () => {
      const vaults = await invoke<VaultListItem[]>('list_vaults');

      expect(Array.isArray(vaults)).toBe(true);
      // Each vault should have required properties
      vaults.forEach((vault) => {
        expect(vault).toHaveProperty('id');
        expect(vault).toHaveProperty('name');
        expect(vault).toHaveProperty('path');
        expect(vault).toHaveProperty('type');
      });
    });
  });

  describe('createVault', () => {
    it('should create a new vault', async () => {
      const config = await invoke<VaultConfig>('create_vault', {
        data: {
          name: TEST_VAULT_NAME,
          path: TEST_VAULT_PATH,
          type: 'private',
        },
      });

      createdVaultId = config.id;

      expect(config.name).toBe(TEST_VAULT_NAME);
      expect(config.path).toBe(TEST_VAULT_PATH);
      expect(config.type).toBe('private');
      expect(config.id).toMatch(/^vault_/);
      expect(config.created).toBeDefined();
    });

    it('should fail to create vault at existing path', async () => {
      // First create a vault
      const config = await invoke<VaultConfig>('create_vault', {
        data: {
          name: TEST_VAULT_NAME,
          path: TEST_VAULT_PATH,
          type: 'private',
        },
      });
      createdVaultId = config.id;

      // Try to create another at the same path
      await expect(
        invoke('create_vault', {
          data: {
            name: 'Another Vault',
            path: TEST_VAULT_PATH,
            type: 'private',
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('openVault', () => {
    it('should open a created vault', async () => {
      // Create vault first
      const createConfig = await invoke<VaultConfig>('create_vault', {
        data: {
          name: TEST_VAULT_NAME,
          path: TEST_VAULT_PATH,
          type: 'private',
        },
      });
      createdVaultId = createConfig.id;

      // Open it
      const vault = await invoke<VaultConfig>('open_vault', {
        path: TEST_VAULT_PATH,
      });

      expect(vault.id).toBe(createConfig.id);
      expect(vault.name).toBe(TEST_VAULT_NAME);
    });

    it('should fail to open non-existent vault', async () => {
      await expect(
        invoke('open_vault', { path: '/nonexistent/path/to/vault' })
      ).rejects.toThrow();
    });
  });

  describe('closeVault', () => {
    it('should close an opened vault', async () => {
      // Create and open vault
      const config = await invoke<VaultConfig>('create_vault', {
        data: {
          name: TEST_VAULT_NAME,
          path: TEST_VAULT_PATH,
          type: 'private',
        },
      });
      createdVaultId = config.id;

      await invoke('open_vault', { path: TEST_VAULT_PATH });

      // Close it
      await expect(
        invoke('close_vault', { vaultId: config.id })
      ).resolves.not.toThrow();
    });
  });

  describe('deleteVault', () => {
    it('should delete a vault', async () => {
      // Create vault
      const config = await invoke<VaultConfig>('create_vault', {
        data: {
          name: TEST_VAULT_NAME,
          path: TEST_VAULT_PATH,
          type: 'private',
        },
      });

      // Delete it (don't set createdVaultId since we're testing delete)
      await invoke('delete_vault', { vaultId: config.id });

      // Verify it's gone from the list
      const vaults = await invoke<VaultListItem[]>('list_vaults');
      const found = vaults.find((v) => v.id === config.id);
      expect(found).toBeUndefined();
    });
  });

  describe('vault appears in list after creation', () => {
    it('should show newly created vault in list', async () => {
      // Get initial vault count
      const initialVaults = await invoke<VaultListItem[]>('list_vaults');
      const initialCount = initialVaults.length;

      // Create vault
      const config = await invoke<VaultConfig>('create_vault', {
        data: {
          name: TEST_VAULT_NAME,
          path: TEST_VAULT_PATH,
          type: 'private',
        },
      });
      createdVaultId = config.id;

      // Check list
      const vaults = await invoke<VaultListItem[]>('list_vaults');
      expect(vaults.length).toBe(initialCount + 1);

      const newVault = vaults.find((v) => v.id === config.id);
      expect(newVault).toBeDefined();
      expect(newVault?.name).toBe(TEST_VAULT_NAME);
    });
  });
});
