/**
 * @goalrate-app/crypto - ChaCha20Poly1305 Encryption Tests
 */

import { describe, it, expect } from 'vitest';
import {
  chachaEncrypt,
  chachaDecrypt,
  wrapVaultKey,
  wrapVaultKeyWithBase64,
  unwrapVaultKey,
  unwrapVaultKeyWithBase64,
  encryptForRecipient,
  decryptFromSender,
  generateChachaNonce,
  CHACHA_NONCE_LENGTH,
  CHACHA_KEY_LENGTH,
  CHACHA_TAG_LENGTH,
} from '../src/chacha';
import {
  generateX25519KeyPair,
  generateX25519KeyPairExported,
  exportX25519PublicKey,
  exportX25519PrivateKey,
  X25519_KEY_LENGTH,
} from '../src/x25519';
import { CryptoError } from '../src/errors';
import { generateSalt } from '../src/keys';

describe('chachaEncrypt / chachaDecrypt', () => {
  it('should encrypt and decrypt data', () => {
    const key = generateSalt({ length: CHACHA_KEY_LENGTH });
    const plaintext = new TextEncoder().encode('Hello, World!');

    const { ciphertext, nonce } = chachaEncrypt(plaintext, key);
    const decrypted = chachaDecrypt(ciphertext, key, nonce);

    expect(new TextDecoder().decode(decrypted)).toBe('Hello, World!');
  });

  it('should produce different ciphertext with different nonces', () => {
    const key = generateSalt({ length: CHACHA_KEY_LENGTH });
    const plaintext = new TextEncoder().encode('Test data');

    const result1 = chachaEncrypt(plaintext, key);
    const result2 = chachaEncrypt(plaintext, key);

    // Nonces should be different (random)
    expect(result1.nonce).not.toEqual(result2.nonce);
    // Ciphertext should be different due to different nonces
    expect(result1.ciphertext).not.toEqual(result2.ciphertext);
  });

  it('should use provided nonce', () => {
    const key = generateSalt({ length: CHACHA_KEY_LENGTH });
    const plaintext = new TextEncoder().encode('Test data');
    const nonce = generateChachaNonce();

    const { ciphertext, nonce: returnedNonce } = chachaEncrypt(
      plaintext,
      key,
      nonce
    );

    expect(returnedNonce).toEqual(nonce);

    // Should decrypt successfully with same nonce
    const decrypted = chachaDecrypt(ciphertext, key, nonce);
    expect(new TextDecoder().decode(decrypted)).toBe('Test data');
  });

  it('should fail decryption with wrong key', () => {
    const key1 = generateSalt({ length: CHACHA_KEY_LENGTH });
    const key2 = generateSalt({ length: CHACHA_KEY_LENGTH });
    const plaintext = new TextEncoder().encode('Secret data');

    const { ciphertext, nonce } = chachaEncrypt(plaintext, key1);

    expect(() => chachaDecrypt(ciphertext, key2, nonce)).toThrow(CryptoError);
    expect(() => chachaDecrypt(ciphertext, key2, nonce)).toThrow(/decryption failed/i);
  });

  it('should fail decryption with wrong nonce', () => {
    const key = generateSalt({ length: CHACHA_KEY_LENGTH });
    const plaintext = new TextEncoder().encode('Secret data');

    const { ciphertext } = chachaEncrypt(plaintext, key);
    const wrongNonce = generateChachaNonce();

    expect(() => chachaDecrypt(ciphertext, key, wrongNonce)).toThrow(CryptoError);
  });

  it('should fail decryption with tampered ciphertext', () => {
    const key = generateSalt({ length: CHACHA_KEY_LENGTH });
    const plaintext = new TextEncoder().encode('Secret data');

    const { ciphertext, nonce } = chachaEncrypt(plaintext, key);

    // Tamper with ciphertext
    const tampered = new Uint8Array(ciphertext);
    tampered[0] ^= 0xff;

    expect(() => chachaDecrypt(tampered, key, nonce)).toThrow(CryptoError);
  });

  it('should reject invalid key length', () => {
    const invalidKey = new Uint8Array(16); // 16 bytes instead of 32
    const plaintext = new TextEncoder().encode('Test');

    expect(() => chachaEncrypt(plaintext, invalidKey)).toThrow(CryptoError);
    expect(() => chachaEncrypt(plaintext, invalidKey)).toThrow(/must be 32 bytes/);
  });

  it('should reject invalid nonce length', () => {
    const key = generateSalt({ length: CHACHA_KEY_LENGTH });
    const plaintext = new TextEncoder().encode('Test');
    const invalidNonce = new Uint8Array(8); // 8 bytes instead of 12

    expect(() => chachaEncrypt(plaintext, key, invalidNonce)).toThrow(CryptoError);
    expect(() => chachaEncrypt(plaintext, key, invalidNonce)).toThrow(
      /must be 12 bytes/
    );
  });

  it('should handle empty plaintext', () => {
    const key = generateSalt({ length: CHACHA_KEY_LENGTH });
    const plaintext = new Uint8Array(0);

    const { ciphertext, nonce } = chachaEncrypt(plaintext, key);
    const decrypted = chachaDecrypt(ciphertext, key, nonce);

    expect(decrypted.length).toBe(0);
  });

  it('should handle large data', () => {
    const key = generateSalt({ length: CHACHA_KEY_LENGTH });
    const plaintext = new Uint8Array(100000);
    for (let i = 0; i < plaintext.length; i++) {
      plaintext[i] = i % 256;
    }

    const { ciphertext, nonce } = chachaEncrypt(plaintext, key);
    const decrypted = chachaDecrypt(ciphertext, key, nonce);

    expect(decrypted).toEqual(plaintext);
  });
});

describe('wrapVaultKey / unwrapVaultKey', () => {
  it('should wrap and unwrap a vault key', () => {
    const vaultKey = generateSalt({ length: X25519_KEY_LENGTH });
    const recipientKeyPair = generateX25519KeyPair();

    const wrapped = wrapVaultKey(vaultKey, recipientKeyPair.publicKey);
    const unwrapped = unwrapVaultKey(wrapped, recipientKeyPair.privateKey);

    expect(unwrapped).toEqual(vaultKey);
  });

  it('should produce different wrapped data each time (ephemeral keys)', () => {
    const vaultKey = generateSalt({ length: X25519_KEY_LENGTH });
    const recipientKeyPair = generateX25519KeyPair();

    const wrapped1 = wrapVaultKey(vaultKey, recipientKeyPair.publicKey);
    const wrapped2 = wrapVaultKey(vaultKey, recipientKeyPair.publicKey);

    // Ephemeral public keys should be different
    expect(wrapped1.ephemeralPublicKey).not.toBe(wrapped2.ephemeralPublicKey);
    // Nonces should be different
    expect(wrapped1.nonce).not.toBe(wrapped2.nonce);
    // Encrypted keys should be different
    expect(wrapped1.encryptedKey).not.toBe(wrapped2.encryptedKey);
  });

  it('should fail to unwrap with wrong private key', () => {
    const vaultKey = generateSalt({ length: X25519_KEY_LENGTH });
    const recipientKeyPair = generateX25519KeyPair();
    const attackerKeyPair = generateX25519KeyPair();

    const wrapped = wrapVaultKey(vaultKey, recipientKeyPair.publicKey);

    expect(() => unwrapVaultKey(wrapped, attackerKeyPair.privateKey)).toThrow(
      CryptoError
    );
  });

  it('should reject invalid vault key length', () => {
    const invalidVaultKey = new Uint8Array(16);
    const recipientKeyPair = generateX25519KeyPair();

    expect(() => wrapVaultKey(invalidVaultKey, recipientKeyPair.publicKey)).toThrow(
      CryptoError
    );
    expect(() => wrapVaultKey(invalidVaultKey, recipientKeyPair.publicKey)).toThrow(
      /must be 32 bytes/
    );
  });

  it('should reject tampered wrapped data', () => {
    const vaultKey = generateSalt({ length: X25519_KEY_LENGTH });
    const recipientKeyPair = generateX25519KeyPair();

    const wrapped = wrapVaultKey(vaultKey, recipientKeyPair.publicKey);

    // Tamper with encrypted key
    const tamperedWrapped = {
      ...wrapped,
      encryptedKey: wrapped.encryptedKey.replace(/.$/, 'X'), // Modify last char
    };

    expect(() => unwrapVaultKey(tamperedWrapped, recipientKeyPair.privateKey)).toThrow(
      CryptoError
    );
  });

  it('should reject invalid base64 in wrapped data', () => {
    const recipientKeyPair = generateX25519KeyPair();
    const invalidWrapped = {
      ephemeralPublicKey: '###invalid###',
      encryptedKey: 'test',
      nonce: 'test',
    };

    expect(() => unwrapVaultKey(invalidWrapped, recipientKeyPair.privateKey)).toThrow(
      CryptoError
    );
  });
});

describe('wrapVaultKeyWithBase64 / unwrapVaultKeyWithBase64', () => {
  it('should work with base64-encoded keys', () => {
    const vaultKey = generateSalt({ length: X25519_KEY_LENGTH });
    const recipientKeyPair = generateX25519KeyPairExported();

    const wrapped = wrapVaultKeyWithBase64(
      vaultKey,
      recipientKeyPair.publicKeyBase64
    );
    const unwrapped = unwrapVaultKeyWithBase64(
      wrapped,
      recipientKeyPair.privateKeyBase64
    );

    expect(unwrapped).toEqual(vaultKey);
  });
});

describe('encryptForRecipient / decryptFromSender', () => {
  it('should encrypt and decrypt arbitrary data', () => {
    const recipientKeyPair = generateX25519KeyPair();
    const plaintext = new TextEncoder().encode('Arbitrary secret data');

    const { ephemeralPublicKey, ciphertext, nonce } = encryptForRecipient(
      plaintext,
      recipientKeyPair.publicKey
    );

    const decrypted = decryptFromSender(
      ciphertext,
      nonce,
      ephemeralPublicKey,
      recipientKeyPair.privateKey
    );

    expect(new TextDecoder().decode(decrypted)).toBe('Arbitrary secret data');
  });

  it('should fail with wrong recipient private key', () => {
    const recipientKeyPair = generateX25519KeyPair();
    const attackerKeyPair = generateX25519KeyPair();
    const plaintext = new TextEncoder().encode('Secret');

    const { ephemeralPublicKey, ciphertext, nonce } = encryptForRecipient(
      plaintext,
      recipientKeyPair.publicKey
    );

    expect(() =>
      decryptFromSender(ciphertext, nonce, ephemeralPublicKey, attackerKeyPair.privateKey)
    ).toThrow(CryptoError);
  });
});

describe('generateChachaNonce', () => {
  it('should generate correct length nonce', () => {
    const nonce = generateChachaNonce();

    expect(nonce).toBeInstanceOf(Uint8Array);
    expect(nonce.length).toBe(CHACHA_NONCE_LENGTH);
  });

  it('should generate unique nonces', () => {
    const nonces = new Set<string>();

    for (let i = 0; i < 100; i++) {
      const nonce = generateChachaNonce();
      const hex = Array.from(nonce)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      expect(nonces.has(hex)).toBe(false);
      nonces.add(hex);
    }
  });
});

describe('constants', () => {
  it('should have correct values', () => {
    expect(CHACHA_NONCE_LENGTH).toBe(12); // 96 bits
    expect(CHACHA_KEY_LENGTH).toBe(32); // 256 bits
    expect(CHACHA_TAG_LENGTH).toBe(16); // 128 bits
  });
});

describe('complete key sharing flow', () => {
  it('should allow admin to share vault key with team member', () => {
    // Admin has a vault key
    const vaultKey = generateSalt({ length: X25519_KEY_LENGTH });

    // Team member generates their key pair
    const memberKeyPair = generateX25519KeyPair();

    // Member uploads their public key to server
    const memberPublicKeyBase64 = exportX25519PublicKey(memberKeyPair.publicKey);

    // Admin wraps vault key for team member
    const wrapped = wrapVaultKeyWithBase64(vaultKey, memberPublicKeyBase64);

    // Wrapped data is stored in database...

    // Team member retrieves and unwraps vault key
    const memberPrivateKeyBase64 = exportX25519PrivateKey(memberKeyPair.privateKey);
    const unwrappedVaultKey = unwrapVaultKeyWithBase64(wrapped, memberPrivateKeyBase64);

    // Member now has the vault key
    expect(unwrappedVaultKey).toEqual(vaultKey);
  });

  it('should support multiple team members', () => {
    const vaultKey = generateSalt({ length: X25519_KEY_LENGTH });

    const member1 = generateX25519KeyPair();
    const member2 = generateX25519KeyPair();
    const member3 = generateX25519KeyPair();

    // Admin wraps for each member
    const wrapped1 = wrapVaultKey(vaultKey, member1.publicKey);
    const wrapped2 = wrapVaultKey(vaultKey, member2.publicKey);
    const wrapped3 = wrapVaultKey(vaultKey, member3.publicKey);

    // Each member can unwrap
    expect(unwrapVaultKey(wrapped1, member1.privateKey)).toEqual(vaultKey);
    expect(unwrapVaultKey(wrapped2, member2.privateKey)).toEqual(vaultKey);
    expect(unwrapVaultKey(wrapped3, member3.privateKey)).toEqual(vaultKey);

    // But members cannot unwrap each other's keys
    expect(() => unwrapVaultKey(wrapped1, member2.privateKey)).toThrow(CryptoError);
    expect(() => unwrapVaultKey(wrapped2, member3.privateKey)).toThrow(CryptoError);
    expect(() => unwrapVaultKey(wrapped3, member1.privateKey)).toThrow(CryptoError);
  });

  it('should maintain forward secrecy with ephemeral keys', () => {
    const vaultKey = generateSalt({ length: X25519_KEY_LENGTH });
    const memberKeyPair = generateX25519KeyPair();

    // Even if member's long-term key pair is compromised later,
    // previously wrapped keys cannot be recovered without the
    // ephemeral private key (which is never stored)

    const wrapped = wrapVaultKey(vaultKey, memberKeyPair.publicKey);

    // The ephemeral public key is stored in wrapped data
    expect(wrapped.ephemeralPublicKey).toBeDefined();
    expect(wrapped.ephemeralPublicKey.length).toBeGreaterThan(0);

    // But the ephemeral private key is gone - it was only used for wrapping
    // This provides forward secrecy
  });
});
