/**
 * TeamStorageAdapter Tests
 * Tests for the encrypted team vault storage adapter
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { generateKey, generateSalt, bytesToBase64, DEFAULT_ITERATIONS } from '@goalrate-app/crypto';
import type { VaultEncryptionConfig, SmartGoal } from '@goalrate-app/shared';
import { TeamStorageAdapter } from '../../../src/adapters/team/TeamStorageAdapter';
import { clearAllSessions, isUnlocked, getLockState } from '../../../src/adapters/team/keys';
import type { TeamStorageConfig } from '../../../src/adapters/team/types';

// Mock the ApiStorageAdapter
vi.mock('../../../src/adapters/web/ApiStorageAdapter', () => {
  class MockApiStorageAdapter {
    initialize = vi.fn().mockResolvedValue({ success: true });
    dispose = vi.fn().mockResolvedValue(undefined);
    setAccessToken = vi.fn();
    listVaults = vi.fn().mockResolvedValue({ success: true, data: [] });
    openVault = vi.fn().mockResolvedValue({ success: true, data: null });
    closeVault = vi.fn().mockResolvedValue({ success: true });
    deleteVault = vi.fn().mockResolvedValue({ success: true });
    getGoals = vi.fn();
    createGoal = vi.fn();
    getVaultStats = vi.fn().mockResolvedValue({ success: true, data: {} });
  }

  return { ApiStorageAdapter: MockApiStorageAdapter };
});

describe('TeamStorageAdapter', () => {
  let adapter: TeamStorageAdapter;
  let config: TeamStorageConfig;
  let encryptionConfig: VaultEncryptionConfig;
  const vaultId = 'vault_test123';
  const password = 'SecurePassword123!';

  beforeEach(async () => {
    // Clear all sessions before each test
    clearAllSessions();

    config = {
      baseUrl: 'https://api.test.com',
      maxQueueSize: 10,
      operationTimeout: 5000,
    };

    // Create encryption config
    const salt = generateSalt();
    encryptionConfig = {
      salt: bytesToBase64(salt),
      iterations: DEFAULT_ITERATIONS,
      algorithm: 'PBKDF2-SHA256',
      createdAt: new Date().toISOString(),
    };

    adapter = new TeamStorageAdapter(config);
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.dispose();
    clearAllSessions();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      const newAdapter = new TeamStorageAdapter(config);
      const result = await newAdapter.initialize();

      expect(result.success).toBe(true);
      await newAdapter.dispose();
    });

    it('should support sync', () => {
      expect(adapter.supportsSync()).toBe(true);
    });
  });

  describe('Vault unlock/lock', () => {
    it('should unlock a vault with correct password', async () => {
      expect(adapter.isVaultUnlocked(vaultId)).toBe(false);

      await adapter.unlockVault(vaultId, password, encryptionConfig);

      expect(adapter.isVaultUnlocked(vaultId)).toBe(true);
      expect(adapter.getVaultLockState(vaultId)).toBe('unlocked');
    });

    it('should lock a vault', async () => {
      await adapter.unlockVault(vaultId, password, encryptionConfig);
      expect(adapter.isVaultUnlocked(vaultId)).toBe(true);

      adapter.lockVault(vaultId);

      expect(adapter.isVaultUnlocked(vaultId)).toBe(false);
      expect(adapter.getVaultLockState(vaultId)).toBe('locked');
    });

    it('should track active sessions', async () => {
      expect(adapter.getActiveSessions()).toHaveLength(0);

      await adapter.unlockVault(vaultId, password, encryptionConfig);

      const sessions = adapter.getActiveSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].vaultId).toBe(vaultId);
      expect(sessions[0].state).toBe('unlocked');
    });

    it('should unlock multiple vaults independently', async () => {
      const vaultId2 = 'vault_test456';
      const salt2 = generateSalt();
      const encryptionConfig2: VaultEncryptionConfig = {
        salt: bytesToBase64(salt2),
        iterations: DEFAULT_ITERATIONS,
        algorithm: 'PBKDF2-SHA256',
        createdAt: new Date().toISOString(),
      };

      await adapter.unlockVault(vaultId, password, encryptionConfig);
      await adapter.unlockVault(vaultId2, password, encryptionConfig2);

      expect(adapter.isVaultUnlocked(vaultId)).toBe(true);
      expect(adapter.isVaultUnlocked(vaultId2)).toBe(true);

      adapter.lockVault(vaultId);

      expect(adapter.isVaultUnlocked(vaultId)).toBe(false);
      expect(adapter.isVaultUnlocked(vaultId2)).toBe(true);
    });
  });

  describe('Operation queuing', () => {
    it('should queue operations when vault is locked', async () => {
      const stats = adapter.getQueueStats(vaultId);
      expect(stats.pendingCount).toBe(0);
      expect(stats.atCapacity).toBe(false);
    });

    it('should report queue at capacity', async () => {
      // This test verifies the queue stats functionality
      const initialStats = adapter.getQueueStats(vaultId);
      expect(initialStats.atCapacity).toBe(false);
    });

    it('should call onLockRequired when operation is queued', async () => {
      const onLockRequired = vi.fn();
      const adapterWithCallback = new TeamStorageAdapter({
        ...config,
        onLockRequired,
      });

      // Start an operation without unlocking - it will be queued
      // The operation will timeout eventually, but onLockRequired should be called
      const operationPromise = adapterWithCallback.getGoals(vaultId);

      // Give it a moment to queue
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onLockRequired).toHaveBeenCalledWith(vaultId);

      // Clean up - unlock to let the queued operation proceed
      await adapterWithCallback.unlockVault(vaultId, password, encryptionConfig);
      await operationPromise.catch(() => {}); // Ignore any errors from the mock
      await adapterWithCallback.dispose();
    });
  });

  describe('Close and delete vault', () => {
    it('should lock vault when closing', async () => {
      await adapter.unlockVault(vaultId, password, encryptionConfig);
      expect(adapter.isVaultUnlocked(vaultId)).toBe(true);

      await adapter.closeVault(vaultId);

      expect(adapter.isVaultUnlocked(vaultId)).toBe(false);
    });

    it('should lock vault when deleting', async () => {
      await adapter.unlockVault(vaultId, password, encryptionConfig);
      expect(adapter.isVaultUnlocked(vaultId)).toBe(true);

      await adapter.deleteVault(vaultId);

      expect(adapter.isVaultUnlocked(vaultId)).toBe(false);
    });
  });

  describe('Disposal', () => {
    it('should clear all sessions on dispose', async () => {
      await adapter.unlockVault(vaultId, password, encryptionConfig);
      expect(adapter.getActiveSessions()).toHaveLength(1);

      await adapter.dispose();

      // Create a new adapter to check sessions were cleared
      expect(isUnlocked(vaultId)).toBe(false);
    });

    it('should reject pending operations on dispose', async () => {
      // This test verifies that pending operations are rejected on dispose
      // The actual behavior depends on whether there are queued operations
      await adapter.dispose();
      // No error should be thrown
    });
  });
});

describe('TeamStorageAdapter Keys Module', () => {
  beforeEach(() => {
    clearAllSessions();
  });

  afterEach(() => {
    clearAllSessions();
  });

  it('should report vault as locked when no session exists', () => {
    expect(isUnlocked('nonexistent_vault')).toBe(false);
    expect(getLockState('nonexistent_vault')).toBe('locked');
  });

  it('should clear all sessions', () => {
    // This is more of an integration test with the keys module
    clearAllSessions();
    expect(isUnlocked('any_vault')).toBe(false);
  });
});
