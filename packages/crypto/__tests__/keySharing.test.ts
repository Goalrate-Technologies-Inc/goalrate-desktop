/**
 * @goalrate-app/crypto - Key Sharing Manager Tests
 *
 * Tests for the vault key sharing functionality.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  KeySharingManager,
  initKeySharing,
  getKeySharing,
  resetKeySharing,
} from '../src/keySharing';
import { PrivateKeyStore, resetGlobalPrivateKeyStore } from '../src/privateKeyStore';
import { generateX25519KeyPair, exportX25519PublicKey } from '../src/x25519';
import { wrapVaultKey } from '../src/chacha';
import { CryptoError } from '../src/errors';

// =============================================================================
// MOCK INDEXEDDB (same as privateKeyStore tests)
// =============================================================================

class MockIDBDatabase {
  private stores: Map<string, Map<string, unknown>> = new Map();
  onclose?: () => void;

  constructor() {
    this.stores.set('private-keys', new Map());
  }

  transaction(storeName: string, mode: IDBTransactionMode) {
    const storeData = this.stores.get(storeName) || new Map();
    return new MockIDBTransaction(storeData);
  }

  close() {
    if (this.onclose) {
      this.onclose();
    }
  }

  get objectStoreNames() {
    return {
      contains: (name: string) => this.stores.has(name),
    };
  }
}

class MockIDBTransaction {
  constructor(private storeData: Map<string, unknown>) {}

  objectStore(_name: string) {
    return new MockIDBObjectStore(this.storeData);
  }
}

class MockIDBObjectStore {
  constructor(private data: Map<string, unknown>) {}

  put(record: { userId: string }) {
    return new MockIDBRequest(() => {
      this.data.set(record.userId, record);
      return undefined;
    });
  }

  get(key: string) {
    return new MockIDBRequest(() => {
      return this.data.get(key);
    });
  }

  delete(key: string) {
    return new MockIDBRequest(() => {
      this.data.delete(key);
      return undefined;
    });
  }

  createIndex() {
    return {};
  }
}

class MockIDBRequest {
  result: unknown;
  error: DOMException | null = null;
  onsuccess?: () => void;
  onerror?: () => void;

  constructor(private action: () => unknown) {
    setTimeout(() => {
      try {
        this.result = this.action();
        if (this.onsuccess) {
          this.onsuccess();
        }
      } catch (e) {
        this.error = new DOMException(String(e));
        if (this.onerror) {
          this.onerror();
        }
      }
    }, 0);
  }
}

class MockIDBOpenRequest extends MockIDBRequest {
  onupgradeneeded?: (event: { target: MockIDBOpenRequest }) => void;

  constructor(private db: MockIDBDatabase) {
    super(() => db);
    setTimeout(() => {
      if (this.onupgradeneeded) {
        this.onupgradeneeded({ target: this });
      }
    }, 0);
  }
}

const mockDatabases = new Map<string, MockIDBDatabase>();

const mockIndexedDB = {
  open: (name: string, _version?: number) => {
    let db = mockDatabases.get(name);
    if (!db) {
      db = new MockIDBDatabase();
      mockDatabases.set(name, db);
    }
    return new MockIDBOpenRequest(db);
  },
  deleteDatabase: (name: string) => {
    return new MockIDBRequest(() => {
      mockDatabases.delete(name);
      return undefined;
    });
  },
};

// =============================================================================
// MOCK FETCH
// =============================================================================

type MockResponse = {
  status?: number;
  ok?: boolean;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};

function createMockFetch(responses: Map<string, MockResponse | (() => MockResponse)>) {
  return async (url: string, options?: RequestInit): Promise<Response> => {
    // Build key from method and URL
    const method = options?.method || 'GET';
    const key = `${method} ${url}`;

    // Check for exact match
    let mockResponse = responses.get(key);

    // Check for pattern match (replace IDs with placeholders)
    if (!mockResponse) {
      for (const [pattern, response] of responses.entries()) {
        // Simple pattern matching - replace {id} with any value
        const regex = new RegExp('^' + pattern.replace(/\{[^}]+\}/g, '[^/]+') + '$');
        if (regex.test(key)) {
          mockResponse = response;
          break;
        }
      }
    }

    if (!mockResponse) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' }),
        text: async () => 'Not found',
      } as unknown as Response;
    }

    const response = typeof mockResponse === 'function' ? mockResponse() : mockResponse;

    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: response.json ?? (async () => ({})),
      text: response.text ?? (async () => ''),
    } as unknown as Response;
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('KeySharingManager', () => {
  let manager: KeySharingManager;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let fetchResponses: Map<string, MockResponse | (() => MockResponse)>;
  const testUserId = 'test-user-123';
  const testPassword = 'test-password';

  beforeEach(() => {
    // Reset mocks
    mockDatabases.clear();
    resetGlobalPrivateKeyStore();
    resetKeySharing();
    vi.stubGlobal('indexedDB', mockIndexedDB);

    // Setup fetch responses
    fetchResponses = new Map();
    mockFetch = createMockFetch(fetchResponses);

    // Create manager with mock fetch
    manager = new KeySharingManager({
      apiBaseUrl: '/api',
      fetch: mockFetch,
    });
  });

  afterEach(() => {
    resetGlobalPrivateKeyStore();
    resetKeySharing();
    vi.unstubAllGlobals();
  });

  describe('setupUserKeys', () => {
    it('should generate new keys when user has none', async () => {
      let capturedPublicKey = '';

      // Mock: no existing public key
      fetchResponses.set('GET /api/keys/me', { status: 404, ok: false });

      // Mock: register new public key
      fetchResponses.set('POST /api/keys/me', () => ({
        json: async () => ({
          id: 'key-1',
          userId: testUserId,
          publicKey: capturedPublicKey,
          algorithm: 'X25519',
          createdAt: new Date().toISOString(),
          isCurrent: true,
        }),
      }));

      // Create a custom fetch that captures the public key
      const capturingFetch = async (url: string, options?: RequestInit) => {
        if (url === '/api/keys/me' && options?.method === 'POST') {
          const body = JSON.parse(options.body as string);
          capturedPublicKey = body.publicKey;
        }
        return mockFetch(url, options);
      };

      manager = new KeySharingManager({
        apiBaseUrl: '/api',
        fetch: capturingFetch,
      });

      const result = await manager.setupUserKeys(testUserId, testPassword);

      expect(result.isNew).toBe(true);
      expect(result.publicKey).toBeDefined();
      expect(result.publicKey.length).toBeGreaterThan(0);
    });

    it('should return existing keys when user already has them', async () => {
      // First, set up user keys
      const keyPair = generateX25519KeyPair();
      const publicKeyBase64 = exportX25519PublicKey(keyPair.publicKey);

      // Store private key manually
      const privateKeyStore = new PrivateKeyStore();
      await privateKeyStore.init();
      await privateKeyStore.store(testUserId, keyPair.privateKey, testPassword);

      // Mock: existing public key
      fetchResponses.set('GET /api/keys/me', {
        json: async () => ({
          id: 'key-1',
          userId: testUserId,
          publicKey: publicKeyBase64,
          algorithm: 'X25519',
          createdAt: new Date().toISOString(),
          isCurrent: true,
        }),
      });

      const result = await manager.setupUserKeys(testUserId, testPassword);

      expect(result.isNew).toBe(false);
      expect(result.publicKey).toBe(publicKeyBase64);
    });

    it('should throw for wrong password on existing key', async () => {
      // Store a key first
      const keyPair = generateX25519KeyPair();
      const privateKeyStore = new PrivateKeyStore();
      await privateKeyStore.init();
      await privateKeyStore.store(testUserId, keyPair.privateKey, testPassword);

      await expect(
        manager.setupUserKeys(testUserId, 'wrong-password')
      ).rejects.toThrow();
    });
  });

  describe('shareVaultKey', () => {
    const vaultId = 'vault-123';
    const recipientUserId = 'recipient-456';
    const vaultKey = new Uint8Array(32).fill(42);

    it('should share vault key with recipient', async () => {
      // Setup: user has private key
      const senderKeyPair = generateX25519KeyPair();
      const privateKeyStore = new PrivateKeyStore();
      await privateKeyStore.init();
      await privateKeyStore.store(testUserId, senderKeyPair.privateKey, testPassword);

      // Recipient has public key
      const recipientKeyPair = generateX25519KeyPair();
      const recipientPublicKey = exportX25519PublicKey(recipientKeyPair.publicKey);

      fetchResponses.set('GET /api/keys/users/{userId}/public-key', {
        json: async () => ({
          id: 'key-2',
          userId: recipientUserId,
          publicKey: recipientPublicKey,
          algorithm: 'X25519',
          createdAt: new Date().toISOString(),
          isCurrent: true,
        }),
      });

      fetchResponses.set('POST /api/workspaces/{vaultId}/shares', {
        json: async () => ({
          id: 'share-1',
          vaultId,
          recipientUserId,
          wrappedKey: {},
          grantedBy: testUserId,
          grantedAt: new Date().toISOString(),
          accessLevel: 'member',
        }),
      });

      const result = await manager.shareVaultKey({
        vaultId,
        vaultKey,
        recipientUserId,
        accessLevel: 'member',
        password: testPassword,
      });

      expect(result.vaultId).toBe(vaultId);
      expect(result.recipientUserId).toBe(recipientUserId);
      expect(result.accessLevel).toBe('member');
    });

    it('should throw if recipient has no public key', async () => {
      fetchResponses.set('GET /api/keys/users/{userId}/public-key', {
        status: 404,
        ok: false,
      });

      await expect(
        manager.shareVaultKey({
          vaultId,
          vaultKey,
          recipientUserId,
          accessLevel: 'member',
          password: testPassword,
        })
      ).rejects.toThrow('No public key found');
    });

    it('should throw for invalid vault key length', async () => {
      const invalidVaultKey = new Uint8Array(16);

      await expect(
        manager.shareVaultKey({
          vaultId,
          vaultKey: invalidVaultKey,
          recipientUserId,
          accessLevel: 'member',
          password: testPassword,
        })
      ).rejects.toThrow('Invalid vault key length');
    });
  });

  describe('receiveVaultKey', () => {
    const vaultId = 'vault-123';

    it('should receive and unwrap vault key', async () => {
      // Setup: recipient has private key
      const recipientKeyPair = generateX25519KeyPair();
      const privateKeyStore = new PrivateKeyStore();
      await privateKeyStore.init();
      await privateKeyStore.store(testUserId, recipientKeyPair.privateKey, testPassword);

      // Create wrapped key
      const originalVaultKey = new Uint8Array(32).fill(42);
      const wrappedKey = wrapVaultKey(originalVaultKey, recipientKeyPair.publicKey);

      fetchResponses.set('GET /api/workspaces/{vaultId}/shares/me', {
        json: async () => ({
          id: 'share-1',
          vaultId,
          recipientUserId: testUserId,
          wrappedKey,
          grantedBy: 'admin-123',
          grantedAt: new Date().toISOString(),
          accessLevel: 'member',
        }),
      });

      const result = await manager.receiveVaultKey({
        vaultId,
        password: testPassword,
      });

      expect(result).toEqual(originalVaultKey);
    });

    it('should throw if no key share exists', async () => {
      fetchResponses.set('GET /api/workspaces/{vaultId}/shares/me', {
        status: 404,
        ok: false,
      });

      await expect(
        manager.receiveVaultKey({
          vaultId,
          password: testPassword,
        })
      ).rejects.toThrow('No vault key share found');
    });
  });

  describe('revokeAccess', () => {
    it('should revoke user access', async () => {
      fetchResponses.set('DELETE /api/workspaces/{vaultId}/shares/{userId}', {
        ok: true,
      });

      await expect(
        manager.revokeAccess('vault-123', 'user-456')
      ).resolves.not.toThrow();
    });
  });

  describe('listVaultKeyShares', () => {
    it('should list all shares for a vault', async () => {
      fetchResponses.set('GET /api/workspaces/{vaultId}/shares', {
        json: async () => [
          {
            id: 'share-1',
            vaultId: 'vault-123',
            recipientUserId: 'user-1',
            accessLevel: 'admin',
          },
          {
            id: 'share-2',
            vaultId: 'vault-123',
            recipientUserId: 'user-2',
            accessLevel: 'member',
          },
        ],
      });

      const shares = await manager.listVaultKeyShares('vault-123');

      expect(shares).toHaveLength(2);
      expect(shares[0].accessLevel).toBe('admin');
      expect(shares[1].accessLevel).toBe('member');
    });
  });

  describe('hasLocalPrivateKey', () => {
    it('should return true if user has local key', async () => {
      const keyPair = generateX25519KeyPair();
      const privateKeyStore = new PrivateKeyStore();
      await privateKeyStore.init();
      await privateKeyStore.store(testUserId, keyPair.privateKey, testPassword);

      expect(await manager.hasLocalPrivateKey(testUserId)).toBe(true);
    });

    it('should return false if user has no local key', async () => {
      expect(await manager.hasLocalPrivateKey(testUserId)).toBe(false);
    });
  });

  describe('deleteLocalPrivateKey', () => {
    it('should delete local private key', async () => {
      const keyPair = generateX25519KeyPair();
      const privateKeyStore = new PrivateKeyStore();
      await privateKeyStore.init();
      await privateKeyStore.store(testUserId, keyPair.privateKey, testPassword);

      expect(await manager.hasLocalPrivateKey(testUserId)).toBe(true);

      await manager.deleteLocalPrivateKey(testUserId);

      expect(await manager.hasLocalPrivateKey(testUserId)).toBe(false);
    });
  });
});

describe('Global manager functions', () => {
  beforeEach(() => {
    resetKeySharing();
    resetGlobalPrivateKeyStore();
    mockDatabases.clear();
    vi.stubGlobal('indexedDB', mockIndexedDB);
  });

  afterEach(() => {
    resetKeySharing();
    resetGlobalPrivateKeyStore();
    vi.unstubAllGlobals();
  });

  it('should initialize global manager', () => {
    const manager = initKeySharing({ apiBaseUrl: '/api' });
    expect(manager).toBeInstanceOf(KeySharingManager);
  });

  it('should get initialized manager', () => {
    initKeySharing({ apiBaseUrl: '/api' });
    const manager = getKeySharing();
    expect(manager).toBeInstanceOf(KeySharingManager);
  });

  it('should throw if manager not initialized', () => {
    expect(() => getKeySharing()).toThrow('not initialized');
  });

  it('should reset global manager', () => {
    initKeySharing({ apiBaseUrl: '/api' });
    resetKeySharing();
    expect(() => getKeySharing()).toThrow('not initialized');
  });
});
