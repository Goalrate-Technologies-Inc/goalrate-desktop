/**
 * @goalrate-app/crypto - AES-256-GCM Encryption Tests
 *
 * Tests mirror the Rust goalrate-crypto crate tests for compatibility.
 */

import { describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  encryptString,
  decryptString,
} from '../src/aes';
import {
  generateKey,
  deriveKey,
  generateSalt,
  bytesToBase64,
  base64ToBytes,
} from '../src/keys';
import { ENCRYPTED_DATA_SEPARATOR, NONCE_LENGTH } from '../src/types';
import { CryptoError } from '../src/errors';

describe('encrypt / decrypt roundtrip', () => {
  it('should encrypt and decrypt bytes correctly', async () => {
    const key = await generateKey();
    const plaintext = new TextEncoder().encode('Hello, Goalrate!');

    const encrypted = await encrypt(plaintext, key);
    const decrypted = await decrypt(encrypted, key);

    expect(decrypted).toEqual(plaintext);
  });

  it('should encrypt and decrypt string correctly', async () => {
    const key = await generateKey();
    const plaintext = 'Hello, Goalrate!';

    const encrypted = await encryptString(plaintext, key);
    const decrypted = await decryptString(encrypted, key);

    expect(decrypted).toBe(plaintext);
  });

  it('should work with derived keys', async () => {
    const salt = generateSalt();
    const key = await deriveKey('mypassword', salt);
    const plaintext = 'Secret data';

    const encrypted = await encryptString(plaintext, key);
    const decrypted = await decryptString(encrypted, key);

    expect(decrypted).toBe(plaintext);
  });
});

describe('encrypt produces different ciphertexts', () => {
  it('should produce different ciphertexts for same plaintext due to random nonce', async () => {
    const key = await generateKey();
    const plaintext = 'Same data';

    const encrypted1 = await encryptString(plaintext, key);
    const encrypted2 = await encryptString(plaintext, key);

    // Ciphertexts should be different
    expect(encrypted1).not.toBe(encrypted2);

    // But both should decrypt to the same plaintext
    expect(await decryptString(encrypted1, key)).toBe(plaintext);
    expect(await decryptString(encrypted2, key)).toBe(plaintext);
  });
});

describe('decrypt with wrong key fails', () => {
  it('should fail to decrypt with different key', async () => {
    const key1 = await generateKey();
    const key2 = await generateKey();
    const plaintext = 'Secret data';

    const encrypted = await encryptString(plaintext, key1);

    await expect(decryptString(encrypted, key2)).rejects.toThrow(CryptoError);
    await expect(decryptString(encrypted, key2)).rejects.toMatchObject({
      code: 'TAMPERING_DETECTED',
    });
  });

  it('should fail with wrong password-derived key', async () => {
    const salt = generateSalt();
    const key1 = await deriveKey('password1', salt);
    const key2 = await deriveKey('password2', salt);

    const encrypted = await encryptString('Secret', key1);

    await expect(decryptString(encrypted, key2)).rejects.toThrow(CryptoError);
  });
});

describe('tampered ciphertext fails', () => {
  it('should detect tampered ciphertext', async () => {
    const key = await generateKey();
    const plaintext = 'Secret data';

    const encrypted = await encryptString(plaintext, key);

    // Tamper with the ciphertext portion
    const parts = encrypted.split(ENCRYPTED_DATA_SEPARATOR);
    const ciphertextBytes = base64ToBytes(parts[1]!);
    if (ciphertextBytes.length > 0) {
      ciphertextBytes[0] ^= 0xFF; // Flip bits
    }
    const tampered = `${parts[0]}${ENCRYPTED_DATA_SEPARATOR}${bytesToBase64(ciphertextBytes)}`;

    await expect(decryptString(tampered, key)).rejects.toThrow(CryptoError);
    await expect(decryptString(tampered, key)).rejects.toMatchObject({
      code: 'TAMPERING_DETECTED',
    });
  });

  it('should detect tampered nonce', async () => {
    const key = await generateKey();
    const encrypted = await encryptString('Secret', key);

    // Tamper with the nonce portion
    const parts = encrypted.split(ENCRYPTED_DATA_SEPARATOR);
    const nonceBytes = base64ToBytes(parts[0]!);
    if (nonceBytes.length > 0) {
      nonceBytes[0] ^= 0xFF; // Flip bits
    }
    const tampered = `${bytesToBase64(nonceBytes)}${ENCRYPTED_DATA_SEPARATOR}${parts[1]}`;

    await expect(decryptString(tampered, key)).rejects.toThrow(CryptoError);
  });
});

describe('invalid format handling', () => {
  it('should reject input without separator', async () => {
    const key = await generateKey();

    await expect(decrypt('invaliddata', key)).rejects.toThrow(CryptoError);
    await expect(decrypt('invaliddata', key)).rejects.toMatchObject({
      code: 'INVALID_FORMAT',
    });
  });

  it('should reject input with too many parts', async () => {
    const key = await generateKey();

    await expect(decrypt('a.b.c', key)).rejects.toThrow(CryptoError);
    await expect(decrypt('a.b.c', key)).rejects.toMatchObject({
      code: 'INVALID_FORMAT',
    });
  });

  it('should reject input with invalid Base64', async () => {
    const key = await generateKey();

    await expect(decrypt('not!valid!.also!invalid!', key)).rejects.toThrow(CryptoError);
  });

  it('should reject input with invalid nonce length', async () => {
    const key = await generateKey();
    // Create a valid Base64 string but with wrong nonce length
    const shortNonce = bytesToBase64(new Uint8Array(8)); // 8 bytes instead of 12
    const validCiphertext = bytesToBase64(new Uint8Array(32));

    await expect(decrypt(`${shortNonce}.${validCiphertext}`, key)).rejects.toThrow(CryptoError);
    await expect(decrypt(`${shortNonce}.${validCiphertext}`, key)).rejects.toMatchObject({
      code: 'INVALID_NONCE',
    });
  });
});

describe('string roundtrip with special characters', () => {
  it('should handle UTF-8 with emojis', async () => {
    const key = await generateKey();
    const plaintext = 'Hello, World! 🎉🔐💯';

    const encrypted = await encryptString(plaintext, key);
    const decrypted = await decryptString(encrypted, key);

    expect(decrypted).toBe(plaintext);
  });

  it('should handle various Unicode characters', async () => {
    const key = await generateKey();
    const plaintext = '日本語 中文 العربية עברית';

    const encrypted = await encryptString(plaintext, key);
    const decrypted = await decryptString(encrypted, key);

    expect(decrypted).toBe(plaintext);
  });

  it('should handle newlines and special whitespace', async () => {
    const key = await generateKey();
    const plaintext = 'Line 1\nLine 2\r\nLine 3\tTabbed';

    const encrypted = await encryptString(plaintext, key);
    const decrypted = await decryptString(encrypted, key);

    expect(decrypted).toBe(plaintext);
  });
});

describe('empty data handling', () => {
  it('should encrypt and decrypt empty string', async () => {
    const key = await generateKey();
    const plaintext = '';

    const encrypted = await encryptString(plaintext, key);
    const decrypted = await decryptString(encrypted, key);

    expect(decrypted).toBe(plaintext);
  });

  it('should encrypt and decrypt empty bytes', async () => {
    const key = await generateKey();
    const plaintext = new Uint8Array(0);

    const encrypted = await encrypt(plaintext, key);
    const decrypted = await decrypt(encrypted, key);

    expect(decrypted.length).toBe(0);
  });
});

describe('large data handling', () => {
  it('should encrypt and decrypt 10KB of data', async () => {
    const key = await generateKey();
    const plaintext = new Uint8Array(10000);
    for (let i = 0; i < plaintext.length; i++) {
      plaintext[i] = i % 256;
    }

    const encrypted = await encrypt(plaintext, key);
    const decrypted = await decrypt(encrypted, key);

    expect(decrypted).toEqual(plaintext);
  });

  it('should encrypt and decrypt large text', async () => {
    const key = await generateKey();
    const plaintext = 'A'.repeat(100000); // 100KB of text

    const encrypted = await encryptString(plaintext, key);
    const decrypted = await decryptString(encrypted, key);

    expect(decrypted).toBe(plaintext);
  });
});

describe('output format compatibility', () => {
  it('should produce format: nonce.ciphertext', async () => {
    const key = await generateKey();
    const encrypted = await encryptString('test', key);

    const parts = encrypted.split(ENCRYPTED_DATA_SEPARATOR);
    expect(parts.length).toBe(2);

    // Verify nonce is correct length when decoded
    const nonce = base64ToBytes(parts[0]!);
    expect(nonce.length).toBe(NONCE_LENGTH);

    // Ciphertext should include auth tag (16 bytes) + plaintext length
    const ciphertext = base64ToBytes(parts[1]!);
    expect(ciphertext.length).toBeGreaterThan(16); // At least auth tag
  });

  it('should use standard Base64 encoding (not URL-safe)', async () => {
    const key = await generateKey();

    // Encrypt enough data to likely produce + or / in Base64
    const encrypted = await encryptString('x'.repeat(1000), key);

    // Should not contain URL-safe characters
    expect(encrypted).not.toMatch(/[-_]/);

    // Should be valid standard Base64
    const parts = encrypted.split(ENCRYPTED_DATA_SEPARATOR);
    expect(() => base64ToBytes(parts[0]!)).not.toThrow();
    expect(() => base64ToBytes(parts[1]!)).not.toThrow();
  });
});

describe('cross-platform compatibility format', () => {
  it('should produce ciphertext parseable by documented format', async () => {
    const key = await generateKey();
    const plaintext = 'Test data for cross-platform compatibility';

    const encrypted = await encryptString(plaintext, key);

    // Format should be: base64(12-byte-nonce).base64(ciphertext-with-16-byte-tag)
    const [nonceB64, ciphertextB64] = encrypted.split(ENCRYPTED_DATA_SEPARATOR);

    // Decode and verify nonce
    const nonce = base64ToBytes(nonceB64!);
    expect(nonce.length).toBe(12); // 96-bit nonce for AES-GCM

    // Decode and verify ciphertext includes tag
    const ciphertext = base64ToBytes(ciphertextB64!);
    // Ciphertext should be plaintext.length + 16 bytes (auth tag)
    const plaintextBytes = new TextEncoder().encode(plaintext);
    expect(ciphertext.length).toBe(plaintextBytes.length + 16);
  });
});
