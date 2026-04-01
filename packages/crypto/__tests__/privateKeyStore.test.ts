/**
 * @goalrate-app/crypto - Private Key Store Tests
 *
 * Tests for the IndexedDB private key storage module.
 * Uses fake-indexeddb for testing in Node.js environment.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PrivateKeyStore,
  storePrivateKey,
  retrievePrivateKey,
  deletePrivateKey,
  hasPrivateKey,
  getPrivateKeyStore,
  resetGlobalPrivateKeyStore,
} from '../src/privateKeyStore';
import { CryptoError } from '../src/errors';
import { generateX25519KeyPair } from '../src/x25519';

// =============================================================================
// MOCK INDEXEDDB
// =============================================================================

/**
 * Simple in-memory IndexedDB mock for testing
 */
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
    // Simulate async behavior
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

    // Call upgrade needed immediately for first-time setup
    setTimeout(() => {
      if (this.onupgradeneeded) {
        this.onupgradeneeded({ target: this });
      }
    }, 0);
  }
}

// Setup global IndexedDB mock
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
// TESTS
// =============================================================================

describe('PrivateKeyStore', () => {
  let store: PrivateKeyStore;
  const testUserId = 'test-user-123';
  const testPassword = 'secure-password-456';

  beforeEach(async () => {
    // Reset mocks
    mockDatabases.clear();

    // Set up IndexedDB mock
    vi.stubGlobal('indexedDB', mockIndexedDB);

    store = new PrivateKeyStore();
    await store.init();
  });

  afterEach(() => {
    store.close();
    vi.unstubAllGlobals();
  });

  describe('init', () => {
    it('should initialize the database', async () => {
      const newStore = new PrivateKeyStore();
      await newStore.init();
      // Should not throw
      newStore.close();
    });

    it('should handle multiple init calls', async () => {
      await store.init();
      await store.init();
      // Should not throw
    });

    it('should throw if IndexedDB is not available', async () => {
      vi.stubGlobal('indexedDB', undefined);

      const newStore = new PrivateKeyStore();
      await expect(newStore.init()).rejects.toThrow('IndexedDB is not available');
    });
  });

  describe('store', () => {
    it('should store a private key', async () => {
      const keyPair = generateX25519KeyPair();

      await store.store(testUserId, keyPair.privateKey, testPassword);

      const exists = await store.exists(testUserId);
      expect(exists).toBe(true);
    });

    it('should encrypt the private key', async () => {
      const keyPair = generateX25519KeyPair();

      await store.store(testUserId, keyPair.privateKey, testPassword);

      const record = await store.getRecord(testUserId);
      expect(record).not.toBeNull();
      expect(record?.encryptedPrivateKey).not.toBe(keyPair.privateKey);
      expect(record?.algorithm).toBe('X25519');
    });

    it('should throw for empty user ID', async () => {
      const keyPair = generateX25519KeyPair();

      await expect(store.store('', keyPair.privateKey, testPassword)).rejects.toThrow(
        'User ID must be a non-empty string'
      );
    });

    it('should throw for invalid key length', async () => {
      const invalidKey = new Uint8Array(16);

      await expect(store.store(testUserId, invalidKey, testPassword)).rejects.toThrow(
        'Invalid private key length'
      );
    });

    it('should throw for empty password', async () => {
      const keyPair = generateX25519KeyPair();

      await expect(store.store(testUserId, keyPair.privateKey, '')).rejects.toThrow(
        'Password must be a non-empty string'
      );
    });

    it('should overwrite existing key', async () => {
      const keyPair1 = generateX25519KeyPair();
      const keyPair2 = generateX25519KeyPair();

      await store.store(testUserId, keyPair1.privateKey, testPassword);
      await store.store(testUserId, keyPair2.privateKey, testPassword);

      const retrieved = await store.retrieve(testUserId, testPassword);
      expect(retrieved).toEqual(keyPair2.privateKey);
    });
  });

  describe('retrieve', () => {
    it('should retrieve and decrypt a stored key', async () => {
      const keyPair = generateX25519KeyPair();

      await store.store(testUserId, keyPair.privateKey, testPassword);
      const retrieved = await store.retrieve(testUserId, testPassword);

      expect(retrieved).toEqual(keyPair.privateKey);
    });

    it('should throw for non-existent user', async () => {
      await expect(store.retrieve('non-existent', testPassword)).rejects.toThrow(
        'No private key found for user'
      );
    });

    it('should throw for wrong password', async () => {
      const keyPair = generateX25519KeyPair();

      await store.store(testUserId, keyPair.privateKey, testPassword);

      await expect(store.retrieve(testUserId, 'wrong-password')).rejects.toThrow(
        'password may be incorrect'
      );
    });

    it('should throw for empty user ID', async () => {
      await expect(store.retrieve('', testPassword)).rejects.toThrow(
        'User ID must be a non-empty string'
      );
    });

    it('should throw for empty password', async () => {
      const keyPair = generateX25519KeyPair();
      await store.store(testUserId, keyPair.privateKey, testPassword);

      await expect(store.retrieve(testUserId, '')).rejects.toThrow(
        'Password must be a non-empty string'
      );
    });
  });

  describe('delete', () => {
    it('should delete a stored key', async () => {
      const keyPair = generateX25519KeyPair();

      await store.store(testUserId, keyPair.privateKey, testPassword);
      expect(await store.exists(testUserId)).toBe(true);

      await store.delete(testUserId);
      expect(await store.exists(testUserId)).toBe(false);
    });

    it('should not throw for non-existent user', async () => {
      await store.delete('non-existent');
      // Should not throw
    });

    it('should throw for empty user ID', async () => {
      await expect(store.delete('')).rejects.toThrow(
        'User ID must be a non-empty string'
      );
    });
  });

  describe('exists', () => {
    it('should return true for existing key', async () => {
      const keyPair = generateX25519KeyPair();

      await store.store(testUserId, keyPair.privateKey, testPassword);

      expect(await store.exists(testUserId)).toBe(true);
    });

    it('should return false for non-existent key', async () => {
      expect(await store.exists('non-existent')).toBe(false);
    });

    it('should return false for empty user ID', async () => {
      expect(await store.exists('')).toBe(false);
    });
  });

  describe('getRecord', () => {
    it('should return the stored record without decrypting', async () => {
      const keyPair = generateX25519KeyPair();

      await store.store(testUserId, keyPair.privateKey, testPassword);

      const record = await store.getRecord(testUserId);

      expect(record).not.toBeNull();
      expect(record?.userId).toBe(testUserId);
      expect(record?.algorithm).toBe('X25519');
      expect(record?.salt).toBeDefined();
      expect(record?.encryptedPrivateKey).toBeDefined();
      expect(record?.createdAt).toBeDefined();
    });

    it('should return null for non-existent user', async () => {
      const record = await store.getRecord('non-existent');
      expect(record).toBeNull();
    });

    it('should return null for empty user ID', async () => {
      const record = await store.getRecord('');
      expect(record).toBeNull();
    });
  });

  describe('close', () => {
    it('should close the database connection', () => {
      store.close();
      // Should not throw when closing again
      store.close();
    });
  });
});

describe('Convenience functions', () => {
  const testUserId = 'test-user-convenience';
  const testPassword = 'convenience-password';

  beforeEach(() => {
    // Reset global store and mock databases
    resetGlobalPrivateKeyStore();
    mockDatabases.clear();
    vi.stubGlobal('indexedDB', mockIndexedDB);
  });

  afterEach(() => {
    resetGlobalPrivateKeyStore();
    vi.unstubAllGlobals();
  });

  it('should store and retrieve using convenience functions', async () => {
    const keyPair = generateX25519KeyPair();

    await storePrivateKey(testUserId, keyPair.privateKey, testPassword);
    const retrieved = await retrievePrivateKey(testUserId, testPassword);

    expect(retrieved).toEqual(keyPair.privateKey);
  });

  it('should check existence using convenience function', async () => {
    const keyPair = generateX25519KeyPair();

    expect(await hasPrivateKey(testUserId)).toBe(false);

    await storePrivateKey(testUserId, keyPair.privateKey, testPassword);

    expect(await hasPrivateKey(testUserId)).toBe(true);
  });

  it('should delete using convenience function', async () => {
    const keyPair = generateX25519KeyPair();

    await storePrivateKey(testUserId, keyPair.privateKey, testPassword);
    expect(await hasPrivateKey(testUserId)).toBe(true);

    await deletePrivateKey(testUserId);
    expect(await hasPrivateKey(testUserId)).toBe(false);
  });

  it('should reuse global store instance', async () => {
    const store1 = await getPrivateKeyStore();
    const store2 = await getPrivateKeyStore();

    expect(store1).toBe(store2);
  });
});

describe('PrivateKeyStore.deleteDatabase', () => {
  beforeEach(() => {
    resetGlobalPrivateKeyStore();
    mockDatabases.clear();
    vi.stubGlobal('indexedDB', mockIndexedDB);
  });

  afterEach(() => {
    resetGlobalPrivateKeyStore();
    vi.unstubAllGlobals();
  });

  it('should delete the entire database', async () => {
    const store = new PrivateKeyStore();
    await store.init();
    store.close();

    await PrivateKeyStore.deleteDatabase();

    // Database should be gone
    expect(mockDatabases.has('goalrate-private-keys')).toBe(false);
  });

  it('should throw if IndexedDB is not available', async () => {
    vi.stubGlobal('indexedDB', undefined);

    await expect(PrivateKeyStore.deleteDatabase()).rejects.toThrow(
      'IndexedDB is not available'
    );
  });
});

describe('Key round-trip with X25519', () => {
  const testUserId = 'roundtrip-user';
  const testPassword = 'roundtrip-password';

  beforeEach(() => {
    resetGlobalPrivateKeyStore();
    mockDatabases.clear();
    vi.stubGlobal('indexedDB', mockIndexedDB);
  });

  afterEach(() => {
    resetGlobalPrivateKeyStore();
    vi.unstubAllGlobals();
  });

  it('should preserve key functionality after round-trip', async () => {
    const keyPair = generateX25519KeyPair();

    // Store and retrieve the private key
    await storePrivateKey(testUserId, keyPair.privateKey, testPassword);
    const retrievedPrivateKey = await retrievePrivateKey(testUserId, testPassword);

    // The retrieved key should be byte-for-byte identical
    expect(retrievedPrivateKey).toEqual(keyPair.privateKey);
    expect(retrievedPrivateKey.length).toBe(32);
  });

  it('should handle multiple users', async () => {
    const user1 = 'user-1';
    const user2 = 'user-2';
    const keyPair1 = generateX25519KeyPair();
    const keyPair2 = generateX25519KeyPair();

    await storePrivateKey(user1, keyPair1.privateKey, 'password1');
    await storePrivateKey(user2, keyPair2.privateKey, 'password2');

    const retrieved1 = await retrievePrivateKey(user1, 'password1');
    const retrieved2 = await retrievePrivateKey(user2, 'password2');

    expect(retrieved1).toEqual(keyPair1.privateKey);
    expect(retrieved2).toEqual(keyPair2.privateKey);
    expect(retrieved1).not.toEqual(retrieved2);
  });
});
