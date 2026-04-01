# @goalrate-app/crypto

Encryption utilities for Goalrate vault data. Provides client-side encryption using Web Crypto API and Noble libraries, with output format compatible with the Rust `goalrate-crypto` crate for cross-platform encryption/decryption.

## Features

- **AES-256-GCM**: Symmetric encryption for vault data
- **X25519**: Elliptic curve Diffie-Hellman key exchange
- **ChaCha20Poly1305**: Authenticated encryption for key wrapping
- **PBKDF2**: Password-based key derivation
- **IndexedDB Storage**: Secure private key storage with at-rest encryption

## Installation

This package is part of the Goalrate monorepo and is automatically available to other workspace packages.

```json
{
  "dependencies": {
    "@goalrate-app/crypto": "workspace:*"
  }
}
```

## Quick Start

```typescript
import {
  generateKey,
  deriveKey,
  generateSalt,
  encryptString,
  decryptString,
} from '@goalrate-app/crypto';

// Generate a random AES-256 key
const key = await generateKey();

// Or derive from password (for user-provided passwords)
const salt = generateSalt();
const derivedKey = await deriveKey('mypassword', salt);

// Encrypt and decrypt
const encrypted = await encryptString('secret data', key);
const decrypted = await decryptString(encrypted, key);
// decrypted === 'secret data'
```

## API Reference

### AES-256-GCM Encryption

The primary encryption scheme for vault data.

```typescript
import {
  generateKey,
  deriveKey,
  generateSalt,
  encrypt,
  decrypt,
  encryptString,
  decryptString,
  exportKey,
  importKey,
} from '@goalrate-app/crypto';

// Generate random key
const key: CryptoKey = await generateKey();

// Derive key from password
const salt = generateSalt(); // 16-byte random salt
const key = await deriveKey('password', salt, {
  iterations: 100_000, // PBKDF2 iterations (default)
});

// Encrypt binary data
const plaintext = new Uint8Array([1, 2, 3, 4]);
const encrypted: string = await encrypt(plaintext, key);
// Format: base64(nonce).base64(ciphertext_with_tag)

// Decrypt binary data
const decrypted: Uint8Array = await decrypt(encrypted, key);

// String convenience functions
const encrypted = await encryptString('hello world', key);
const decrypted = await decryptString(encrypted, key);
// decrypted === 'hello world'

// Export/import keys
const keyMaterial: Uint8Array = await exportKey(key);
const importedKey: CryptoKey = await importKey(keyMaterial);
```

### X25519 Key Exchange

Elliptic curve Diffie-Hellman for secure key sharing between users.

```typescript
import {
  generateX25519KeyPair,
  exportX25519PublicKey,
  importX25519PublicKey,
  deriveSharedSecret,
  X25519_KEY_LENGTH,
} from '@goalrate-app/crypto';

// Generate key pair
const { privateKey, publicKey } = generateX25519KeyPair();

// Export public key for sharing
const publicKeyBase64 = exportX25519PublicKey(publicKey);
// Send publicKeyBase64 to server

// Import recipient's public key
const recipientPublicKey = importX25519PublicKey(recipientPublicKeyBase64);

// Derive shared secret (ECDH)
const sharedSecret: Uint8Array = deriveSharedSecret(privateKey, recipientPublicKey);
// Use sharedSecret as encryption key
```

### ChaCha20Poly1305 Key Wrapping

Wrap vault keys for secure sharing between users.

```typescript
import {
  wrapVaultKey,
  unwrapVaultKey,
  encryptForRecipient,
  decryptFromSender,
  CHACHA_KEY_LENGTH,
  CHACHA_NONCE_LENGTH,
} from '@goalrate-app/crypto';

// Wrap vault key for recipient (combines ECDH + ChaCha20Poly1305)
const vaultKey: Uint8Array = /* 32-byte vault encryption key */;
const recipientPublicKey = importX25519PublicKey(recipientBase64);

const wrapped = await wrapVaultKey(vaultKey, recipientPublicKey);
// wrapped: { ephemeralPublicKey, encryptedKey, nonce }

// Unwrap vault key (recipient)
const unwrappedVaultKey = await unwrapVaultKey(wrapped, recipientPrivateKey);

// High-level encrypt/decrypt for recipient
const senderKeyPair = generateX25519KeyPair();
const ciphertext = encryptForRecipient(
  plaintext,
  recipientPublicKey,
  senderKeyPair.privateKey
);

const decrypted = decryptFromSender(
  ciphertext,
  senderKeyPair.publicKey,
  recipientPrivateKey
);
```

### Private Key Store

Securely store user's X25519 private key in IndexedDB with at-rest encryption.

```typescript
import {
  PrivateKeyStore,
  getPrivateKeyStore,
  storePrivateKey,
  retrievePrivateKey,
  deletePrivateKey,
  hasPrivateKey,
} from '@goalrate-app/crypto';

// Using class directly
const store = new PrivateKeyStore();
await store.init(); // Opens IndexedDB

// Store private key (encrypted with user's password)
await store.store(userId, privateKey, password);

// Retrieve private key
const privateKey = await store.retrieve(userId, password);

// Check if key exists
const exists = await store.exists(userId);

// Delete key
await store.delete(userId);

// Clean up
await store.close();

// Using convenience functions (uses global store)
await storePrivateKey(userId, privateKey, password);
const privateKey = await retrievePrivateKey(userId, password);
const exists = await hasPrivateKey(userId);
await deletePrivateKey(userId);
```

### Key Sharing Manager

High-level manager for sharing vault encryption keys between team members.

```typescript
import {
  KeySharingManager,
  initKeySharing,
  getKeySharing,
} from '@goalrate-app/crypto';

// Initialize manager
const manager = new KeySharingManager({
  apiBaseUrl: 'https://api.goalrate.app',
  getAuthToken: () => localStorage.getItem('token'),
});

// Or use global manager
initKeySharing({ apiBaseUrl: '/api' });
const manager = getKeySharing();

// Setup user keys (generates X25519 keypair, stores private key, registers public key)
const { publicKey, isNew } = await manager.setupUserKeys(userId, password);

// Share vault key with team member
await manager.shareVaultKey({
  vaultId,
  vaultKey,           // Raw 32-byte vault encryption key
  recipientUserId,
  accessLevel: 'member', // 'admin' | 'member' | 'viewer'
  password,           // User's password to decrypt their private key
});

// Receive shared vault key
const vaultKey = await manager.receiveVaultKey({
  vaultId,
  password,           // User's password to decrypt their private key
});

// Revoke access
await manager.revokeAccess(vaultId, userId);

// Get user's public key
const publicKey = await manager.getUserPublicKey(userId);

// List vault key shares
const shares = await manager.listVaultShares(vaultId);
```

### Error Handling

```typescript
import { CryptoError, isCryptoError } from '@goalrate-app/crypto';

try {
  await decryptString(ciphertext, wrongKey);
} catch (error) {
  if (isCryptoError(error)) {
    switch (error.code) {
      case 'ENCRYPTION_FAILED':
        console.log('Encryption operation failed');
        break;
      case 'DECRYPTION_FAILED':
        console.log('Decryption failed (wrong key or tampered data)');
        break;
      case 'INVALID_KEY':
        console.log('Invalid encryption key');
        break;
      case 'INVALID_KEY_LENGTH':
        console.log('Key must be 32 bytes (256 bits)');
        break;
      case 'INVALID_NONCE':
        console.log('Invalid nonce format');
        break;
      case 'KEY_DERIVATION_FAILED':
        console.log('Password-based key derivation failed');
        break;
      case 'TAMPERING_DETECTED':
        console.log('Data has been modified (GCM tag mismatch)');
        break;
      case 'UNSUPPORTED_ENVIRONMENT':
        console.log('Web Crypto API not available');
        break;
      case 'INDEXEDDB_ERROR':
        console.log('IndexedDB operation failed');
        break;
    }
  }
}

// Check Web Crypto availability
import { assertCryptoAvailable } from '@goalrate-app/crypto';
assertCryptoAvailable(); // Throws if Web Crypto not available
```

### Constants

```typescript
import {
  // AES-256-GCM
  KEY_LENGTH,              // 32 (256 bits)
  NONCE_LENGTH,            // 12 (96 bits for GCM)
  SALT_LENGTH,             // 16 (128 bits)
  DEFAULT_ITERATIONS,      // 100,000 (PBKDF2)
  ENCRYPTED_DATA_SEPARATOR, // '.'

  // X25519
  X25519_KEY_LENGTH,       // 32 (256 bits)

  // ChaCha20Poly1305
  CHACHA_KEY_LENGTH,       // 32 (256 bits)
  CHACHA_NONCE_LENGTH,     // 12 (96 bits)
  CHACHA_TAG_LENGTH,       // 16 (128 bits)
} from '@goalrate-app/crypto';
```

### Utility Functions

```typescript
import { bytesToBase64, base64ToBytes } from '@goalrate-app/crypto';

// Convert between bytes and base64
const bytes = new Uint8Array([1, 2, 3, 4]);
const base64 = bytesToBase64(bytes);
const decoded = base64ToBytes(base64);
```

## Package Structure

```
src/
├── index.ts              # Main exports
├── types.ts              # Type definitions and constants
├── errors.ts             # CryptoError class and error codes
├── keys.ts               # Key generation, derivation, export/import
├── aes.ts                # AES-256-GCM encrypt/decrypt
├── x25519.ts             # X25519 key exchange (ECDH)
├── chacha.ts             # ChaCha20Poly1305 key wrapping
├── privateKeyStore.ts    # IndexedDB private key storage
└── keySharing.ts         # High-level KeySharingManager
```

## Dependencies

- `@noble/curves` - X25519 elliptic curve operations
- `@noble/ciphers` - ChaCha20Poly1305 implementation

## Exports

| Path | Description |
|------|-------------|
| `@goalrate-app/crypto` | All exports combined |
| `@goalrate-app/crypto/aes` | AES-256-GCM encryption |
| `@goalrate-app/crypto/keys` | Key generation and derivation |
| `@goalrate-app/crypto/x25519` | X25519 key exchange |
| `@goalrate-app/crypto/chacha` | ChaCha20Poly1305 encryption |
| `@goalrate-app/crypto/privateKeyStore` | IndexedDB key storage |
| `@goalrate-app/crypto/keySharing` | KeySharingManager |

## Development

```bash
# Build
pnpm build

# Watch mode
pnpm dev

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Type check
pnpm typecheck
```

## Security Considerations

1. **Key Storage**: Private keys are encrypted at rest in IndexedDB using AES-256-GCM with a key derived from the user's password via PBKDF2 (100,000 iterations).

2. **Ephemeral Keys**: When sharing vault keys, ephemeral X25519 key pairs are generated for each share operation, providing forward secrecy.

3. **Nonce Generation**: All nonces are randomly generated using `crypto.getRandomValues()` - never reuse nonces with the same key.

4. **Memory**: Sensitive data (keys, plaintext) should be zeroed after use when possible. The Rust companion crate uses the `zeroize` crate for automatic memory zeroing.

5. **Web Crypto**: This package uses the Web Crypto API which is available in modern browsers and Node.js 20+. It falls back to subtle crypto where needed.

6. **Cross-Platform Compatibility**: The encrypted data format (`base64(nonce).base64(ciphertext_with_tag)`) is compatible with the Rust `goalrate-crypto` crate, enabling cross-platform encryption/decryption.

## Encrypted Data Format

### AES-256-GCM
```
base64(12-byte nonce).base64(ciphertext + 16-byte GCM tag)
```

### ChaCha20Poly1305 Wrapped Key
```json
{
  "ephemeralPublicKey": "base64(32-byte X25519 public key)",
  "encryptedKey": "base64(ciphertext + 16-byte Poly1305 tag)",
  "nonce": "base64(12-byte nonce)"
}
```

## Related Packages

- `@goalrate-app/shared` - Type definitions for encryption config
- `@goalrate-app/storage` - Uses crypto for team vault encryption
- Rust `goalrate-crypto` crate - Desktop companion with matching format
