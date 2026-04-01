/**
 * @goalrate-app/crypto - Key Management Tests
 */

import { describe, it, expect } from 'vitest';
import {
  generateKey,
  deriveKey,
  generateSalt,
  exportKey,
  importKey,
  bytesToBase64,
  base64ToBytes,
} from '../src/keys';
import { KEY_LENGTH, SALT_LENGTH, DEFAULT_ITERATIONS } from '../src/types';
import { CryptoError } from '../src/errors';

describe('generateKey', () => {
  it('should generate a valid AES-256 key', async () => {
    const key = await generateKey();

    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
    expect(key.algorithm.name).toBe('AES-GCM');
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
    expect(key.extractable).toBe(true);
  });

  it('should generate unique keys each time', async () => {
    const key1 = await generateKey();
    const key2 = await generateKey();

    const exported1 = await exportKey(key1);
    const exported2 = await exportKey(key2);

    expect(exported1).not.toEqual(exported2);
  });
});

describe('deriveKey', () => {
  it('should derive a key from password and salt', async () => {
    const salt = generateSalt();
    const key = await deriveKey('testpassword', salt);

    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
    expect(key.algorithm.name).toBe('AES-GCM');
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
  });

  it('should produce deterministic keys from same password and salt', async () => {
    const salt = generateSalt();
    const password = 'samepassword';

    const key1 = await deriveKey(password, salt);
    const key2 = await deriveKey(password, salt);

    const exported1 = await exportKey(key1);
    const exported2 = await exportKey(key2);

    expect(exported1).toEqual(exported2);
  });

  it('should produce different keys from different passwords', async () => {
    const salt = generateSalt();

    const key1 = await deriveKey('password1', salt);
    const key2 = await deriveKey('password2', salt);

    const exported1 = await exportKey(key1);
    const exported2 = await exportKey(key2);

    expect(exported1).not.toEqual(exported2);
  });

  it('should produce different keys from different salts', async () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    const password = 'samepassword';

    const key1 = await deriveKey(password, salt1);
    const key2 = await deriveKey(password, salt2);

    const exported1 = await exportKey(key1);
    const exported2 = await exportKey(key2);

    expect(exported1).not.toEqual(exported2);
  });

  it('should respect custom iteration count', async () => {
    const salt = generateSalt();
    const password = 'testpassword';

    // Different iteration counts should produce different keys
    const key1 = await deriveKey(password, salt, { iterations: 1000 });
    const key2 = await deriveKey(password, salt, { iterations: 2000 });

    const exported1 = await exportKey(key1);
    const exported2 = await exportKey(key2);

    expect(exported1).not.toEqual(exported2);
  });

  it('should handle empty password', async () => {
    const salt = generateSalt();
    const key = await deriveKey('', salt);

    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
  });

  it('should handle Unicode passwords', async () => {
    const salt = generateSalt();
    const key = await deriveKey('p@$$w0rd🔐', salt);

    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
  });
});

describe('generateSalt', () => {
  it('should generate salt of default length', () => {
    const salt = generateSalt();

    expect(salt).toBeInstanceOf(Uint8Array);
    expect(salt.length).toBe(SALT_LENGTH);
  });

  it('should generate salt of custom length', () => {
    const salt = generateSalt({ length: 32 });

    expect(salt.length).toBe(32);
  });

  it('should generate unique salts each time', () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();

    expect(salt1).not.toEqual(salt2);
  });

  it('should generate salts with proper randomness', () => {
    // Generate many salts and check they're all unique
    const salts = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const salt = generateSalt();
      const b64 = bytesToBase64(salt);
      expect(salts.has(b64)).toBe(false);
      salts.add(b64);
    }
  });
});

describe('exportKey / importKey', () => {
  it('should roundtrip a generated key', async () => {
    const originalKey = await generateKey();
    const exported = await exportKey(originalKey);
    const importedKey = await importKey(exported);

    expect(exported.length).toBe(KEY_LENGTH);

    // Verify the imported key works by exporting again
    const reExported = await exportKey(importedKey);
    expect(reExported).toEqual(exported);
  });

  it('should roundtrip a derived key', async () => {
    const salt = generateSalt();
    const originalKey = await deriveKey('password', salt);

    const exported = await exportKey(originalKey);
    const importedKey = await importKey(exported);

    const reExported = await exportKey(importedKey);
    expect(reExported).toEqual(exported);
  });

  it('should reject invalid key length', async () => {
    const invalidKey = new Uint8Array(16); // 16 bytes instead of 32

    await expect(importKey(invalidKey)).rejects.toThrow(CryptoError);
    await expect(importKey(invalidKey)).rejects.toMatchObject({
      code: 'INVALID_KEY_LENGTH',
    });
  });

  it('should reject empty key material', async () => {
    const emptyKey = new Uint8Array(0);

    await expect(importKey(emptyKey)).rejects.toThrow(CryptoError);
    await expect(importKey(emptyKey)).rejects.toMatchObject({
      code: 'INVALID_KEY_LENGTH',
    });
  });
});

describe('bytesToBase64 / base64ToBytes', () => {
  it('should roundtrip arbitrary bytes', () => {
    const original = new Uint8Array([0, 1, 2, 255, 128, 64]);
    const base64 = bytesToBase64(original);
    const decoded = base64ToBytes(base64);

    expect(decoded).toEqual(original);
  });

  it('should handle empty input', () => {
    const original = new Uint8Array(0);
    const base64 = bytesToBase64(original);
    const decoded = base64ToBytes(base64);

    expect(base64).toBe('');
    expect(decoded).toEqual(original);
  });

  it('should handle large data', () => {
    const original = new Uint8Array(10000);
    for (let i = 0; i < original.length; i++) {
      original[i] = i % 256;
    }

    const base64 = bytesToBase64(original);
    const decoded = base64ToBytes(base64);

    expect(decoded).toEqual(original);
  });

  it('should throw on invalid Base64', () => {
    expect(() => base64ToBytes('not!valid!base64!')).toThrow(CryptoError);
    expect(() => base64ToBytes('not!valid!base64!')).toThrow();
  });

  it('should produce standard Base64 (not URL-safe)', () => {
    // Standard Base64 uses + and /
    const testData = new Uint8Array([251, 239, 190]); // Will produce + and / in Base64
    const base64 = bytesToBase64(testData);

    // Should not contain - or _ (URL-safe variants)
    expect(base64).not.toMatch(/[-_]/);
  });
});

describe('DEFAULT_ITERATIONS', () => {
  it('should match the Rust crate value', () => {
    // The Rust goalrate-crypto crate uses 100,000 iterations
    expect(DEFAULT_ITERATIONS).toBe(100_000);
  });
});
