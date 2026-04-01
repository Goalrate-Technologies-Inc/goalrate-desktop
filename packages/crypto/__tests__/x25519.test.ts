/**
 * @goalrate-app/crypto - X25519 Key Exchange Tests
 */

import { describe, it, expect } from 'vitest';
import {
  generateX25519KeyPair,
  generateX25519KeyPairExported,
  exportX25519PublicKey,
  exportX25519PrivateKey,
  importX25519PublicKey,
  importX25519PrivateKey,
  deriveSharedSecret,
  deriveSharedSecretFromBase64,
  getPublicKeyFromPrivate,
  X25519_KEY_LENGTH,
} from '../src/x25519';
import { CryptoError } from '../src/errors';

describe('generateX25519KeyPair', () => {
  it('should generate a valid key pair', () => {
    const keyPair = generateX25519KeyPair();

    expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.publicKey.length).toBe(X25519_KEY_LENGTH);
    expect(keyPair.privateKey.length).toBe(X25519_KEY_LENGTH);
  });

  it('should generate unique key pairs each time', () => {
    const keyPair1 = generateX25519KeyPair();
    const keyPair2 = generateX25519KeyPair();

    expect(keyPair1.publicKey).not.toEqual(keyPair2.publicKey);
    expect(keyPair1.privateKey).not.toEqual(keyPair2.privateKey);
  });

  it('should generate many unique key pairs', () => {
    const publicKeys = new Set<string>();
    const privateKeys = new Set<string>();

    for (let i = 0; i < 100; i++) {
      const keyPair = generateX25519KeyPair();
      const publicKeyStr = exportX25519PublicKey(keyPair.publicKey);
      const privateKeyStr = exportX25519PrivateKey(keyPair.privateKey);

      expect(publicKeys.has(publicKeyStr)).toBe(false);
      expect(privateKeys.has(privateKeyStr)).toBe(false);

      publicKeys.add(publicKeyStr);
      privateKeys.add(privateKeyStr);
    }
  });
});

describe('generateX25519KeyPairExported', () => {
  it('should generate key pair as base64 strings', () => {
    const exported = generateX25519KeyPairExported();

    expect(typeof exported.publicKeyBase64).toBe('string');
    expect(typeof exported.privateKeyBase64).toBe('string');

    // Should be valid base64
    const publicKey = importX25519PublicKey(exported.publicKeyBase64);
    const privateKey = importX25519PrivateKey(exported.privateKeyBase64);

    expect(publicKey.length).toBe(X25519_KEY_LENGTH);
    expect(privateKey.length).toBe(X25519_KEY_LENGTH);
  });
});

describe('exportX25519PublicKey / importX25519PublicKey', () => {
  it('should roundtrip a public key', () => {
    const keyPair = generateX25519KeyPair();
    const exported = exportX25519PublicKey(keyPair.publicKey);
    const imported = importX25519PublicKey(exported);

    expect(imported).toEqual(keyPair.publicKey);
  });

  it('should reject invalid key length on export', () => {
    const invalidKey = new Uint8Array(16); // 16 bytes instead of 32

    expect(() => exportX25519PublicKey(invalidKey)).toThrow(CryptoError);
    expect(() => exportX25519PublicKey(invalidKey)).toThrow(/must be 32 bytes/);
  });

  it('should reject invalid key length on import', () => {
    // Base64 of 16-byte array
    const invalidBase64 = btoa(String.fromCharCode(...new Uint8Array(16)));

    expect(() => importX25519PublicKey(invalidBase64)).toThrow(CryptoError);
    expect(() => importX25519PublicKey(invalidBase64)).toThrow(/must be 32 bytes/);
  });

  it('should reject invalid base64 on import', () => {
    expect(() => importX25519PublicKey('not!valid!base64!')).toThrow(CryptoError);
    expect(() => importX25519PublicKey('not!valid!base64!')).toThrow(/Invalid base64/);
  });
});

describe('exportX25519PrivateKey / importX25519PrivateKey', () => {
  it('should roundtrip a private key', () => {
    const keyPair = generateX25519KeyPair();
    const exported = exportX25519PrivateKey(keyPair.privateKey);
    const imported = importX25519PrivateKey(exported);

    expect(imported).toEqual(keyPair.privateKey);
  });

  it('should reject invalid key length on export', () => {
    const invalidKey = new Uint8Array(16);

    expect(() => exportX25519PrivateKey(invalidKey)).toThrow(CryptoError);
  });

  it('should reject invalid key length on import', () => {
    const invalidBase64 = btoa(String.fromCharCode(...new Uint8Array(16)));

    expect(() => importX25519PrivateKey(invalidBase64)).toThrow(CryptoError);
  });

  it('should reject invalid base64 on import', () => {
    expect(() => importX25519PrivateKey('###invalid###')).toThrow(CryptoError);
  });
});

describe('deriveSharedSecret', () => {
  it('should derive the same shared secret from both sides', () => {
    const aliceKeyPair = generateX25519KeyPair();
    const bobKeyPair = generateX25519KeyPair();

    // Alice computes shared secret using her private key and Bob's public key
    const aliceShared = deriveSharedSecret(
      aliceKeyPair.privateKey,
      bobKeyPair.publicKey
    );

    // Bob computes shared secret using his private key and Alice's public key
    const bobShared = deriveSharedSecret(
      bobKeyPair.privateKey,
      aliceKeyPair.publicKey
    );

    // Both should get the same shared secret
    expect(aliceShared).toEqual(bobShared);
    expect(aliceShared.length).toBe(X25519_KEY_LENGTH);
  });

  it('should produce different shared secrets with different key pairs', () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();
    const charlie = generateX25519KeyPair();

    const aliceBobShared = deriveSharedSecret(alice.privateKey, bob.publicKey);
    const aliceCharlieShared = deriveSharedSecret(alice.privateKey, charlie.publicKey);

    expect(aliceBobShared).not.toEqual(aliceCharlieShared);
  });

  it('should reject invalid private key length', () => {
    const validPublicKey = generateX25519KeyPair().publicKey;
    const invalidPrivateKey = new Uint8Array(16);

    expect(() => deriveSharedSecret(invalidPrivateKey, validPublicKey)).toThrow(
      CryptoError
    );
    expect(() => deriveSharedSecret(invalidPrivateKey, validPublicKey)).toThrow(
      /must be 32 bytes/
    );
  });

  it('should reject invalid public key length', () => {
    const validPrivateKey = generateX25519KeyPair().privateKey;
    const invalidPublicKey = new Uint8Array(16);

    expect(() => deriveSharedSecret(validPrivateKey, invalidPublicKey)).toThrow(
      CryptoError
    );
    expect(() => deriveSharedSecret(validPrivateKey, invalidPublicKey)).toThrow(
      /must be 32 bytes/
    );
  });
});

describe('deriveSharedSecretFromBase64', () => {
  it('should work with base64-encoded keys', () => {
    const alice = generateX25519KeyPairExported();
    const bob = generateX25519KeyPairExported();

    const aliceShared = deriveSharedSecretFromBase64(
      alice.privateKeyBase64,
      bob.publicKeyBase64
    );

    const bobShared = deriveSharedSecretFromBase64(
      bob.privateKeyBase64,
      alice.publicKeyBase64
    );

    expect(aliceShared).toEqual(bobShared);
  });

  it('should match raw key derivation', () => {
    const aliceKeyPair = generateX25519KeyPair();
    const bobKeyPair = generateX25519KeyPair();

    const rawShared = deriveSharedSecret(
      aliceKeyPair.privateKey,
      bobKeyPair.publicKey
    );

    const base64Shared = deriveSharedSecretFromBase64(
      exportX25519PrivateKey(aliceKeyPair.privateKey),
      exportX25519PublicKey(bobKeyPair.publicKey)
    );

    expect(base64Shared).toEqual(rawShared);
  });
});

describe('getPublicKeyFromPrivate', () => {
  it('should derive correct public key from private key', () => {
    const keyPair = generateX25519KeyPair();
    const derivedPublic = getPublicKeyFromPrivate(keyPair.privateKey);

    expect(derivedPublic).toEqual(keyPair.publicKey);
  });

  it('should produce consistent public keys', () => {
    const keyPair = generateX25519KeyPair();

    const public1 = getPublicKeyFromPrivate(keyPair.privateKey);
    const public2 = getPublicKeyFromPrivate(keyPair.privateKey);

    expect(public1).toEqual(public2);
  });

  it('should reject invalid private key length', () => {
    const invalidPrivateKey = new Uint8Array(16);

    expect(() => getPublicKeyFromPrivate(invalidPrivateKey)).toThrow(CryptoError);
    expect(() => getPublicKeyFromPrivate(invalidPrivateKey)).toThrow(
      /must be 32 bytes/
    );
  });
});

describe('X25519_KEY_LENGTH', () => {
  it('should be 32 bytes (256 bits)', () => {
    expect(X25519_KEY_LENGTH).toBe(32);
  });
});
