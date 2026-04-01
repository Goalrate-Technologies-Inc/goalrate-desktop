//! ChaCha20Poly1305 authenticated encryption
//!
//! Provides ChaCha20Poly1305 AEAD encryption for vault key wrapping.
//! Used with X25519 key exchange to securely share vault keys.
//!
//! # Example
//!
//! ```
//! use goalrate_crypto::chacha::{wrap_vault_key, unwrap_vault_key};
//! use goalrate_crypto::x25519::generate_keypair;
//! use goalrate_crypto::generate_key;
//!
//! let vault_key = generate_key().unwrap();
//! let recipient = generate_keypair();
//!
//! let wrapped = wrap_vault_key(vault_key.as_bytes(), &recipient.public_key).unwrap();
//! let unwrapped = unwrap_vault_key(&wrapped, &recipient.private_key).unwrap();
//!
//! assert_eq!(vault_key.as_bytes(), &unwrapped);
//! ```

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Nonce,
};
use serde::{Deserialize, Serialize};

use crate::error::{CryptoError, CryptoResult};
use crate::x25519::{
    derive_shared_secret, generate_keypair, X25519PrivateKey, X25519PublicKey, X25519_KEY_LENGTH,
};

/// ChaCha20Poly1305 nonce length (96 bits / 12 bytes)
pub const CHACHA_NONCE_LENGTH: usize = 12;

/// ChaCha20Poly1305 key length (256 bits / 32 bytes)
pub const CHACHA_KEY_LENGTH: usize = 32;

/// ChaCha20Poly1305 authentication tag length (128 bits / 16 bytes)
pub const CHACHA_TAG_LENGTH: usize = 16;

/// Wrapped vault key containing all data needed for unwrapping
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrappedVaultKey {
    /// Ephemeral public key used for this wrapping (base64)
    pub ephemeral_public_key: String,
    /// Encrypted vault key with authentication tag (base64)
    pub encrypted_key: String,
    /// Nonce used for encryption (base64)
    pub nonce: String,
}

/// Encrypt data using ChaCha20Poly1305
///
/// # Arguments
///
/// * `plaintext` - Data to encrypt
/// * `key` - 32-byte encryption key
/// * `nonce` - Optional 12-byte nonce (random if None)
///
/// # Returns
///
/// Tuple of (ciphertext with tag, nonce used)
pub fn chacha_encrypt(
    plaintext: &[u8],
    key: &[u8; CHACHA_KEY_LENGTH],
    nonce: Option<&[u8; CHACHA_NONCE_LENGTH]>,
) -> CryptoResult<(Vec<u8>, [u8; CHACHA_NONCE_LENGTH])> {
    // Generate random nonce if not provided
    let actual_nonce = match nonce {
        Some(n) => *n,
        None => {
            use rand::RngCore;
            let mut rng = rand::thread_rng();
            let mut n = [0u8; CHACHA_NONCE_LENGTH];
            rng.fill_bytes(&mut n);
            n
        }
    };

    let cipher = ChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| CryptoError::ChaChaError(e.to_string()))?;

    let nonce_obj = Nonce::from_slice(&actual_nonce);

    let ciphertext = cipher
        .encrypt(nonce_obj, plaintext)
        .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;

    Ok((ciphertext, actual_nonce))
}

/// Decrypt data using ChaCha20Poly1305
///
/// # Arguments
///
/// * `ciphertext` - Encrypted data with authentication tag
/// * `key` - 32-byte decryption key
/// * `nonce` - 12-byte nonce used during encryption
///
/// # Returns
///
/// Decrypted plaintext
pub fn chacha_decrypt(
    ciphertext: &[u8],
    key: &[u8; CHACHA_KEY_LENGTH],
    nonce: &[u8; CHACHA_NONCE_LENGTH],
) -> CryptoResult<Vec<u8>> {
    let cipher = ChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| CryptoError::ChaChaError(e.to_string()))?;

    let nonce_obj = Nonce::from_slice(nonce);

    cipher
        .decrypt(nonce_obj, ciphertext)
        .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))
}

/// Wrap a vault key for secure sharing with a recipient
///
/// This function:
/// 1. Generates an ephemeral X25519 key pair
/// 2. Derives a shared secret using ephemeral private key + recipient's public key
/// 3. Encrypts the vault key using ChaCha20Poly1305 with the shared secret
/// 4. Returns the wrapped key with ephemeral public key
///
/// The ephemeral key provides forward secrecy.
///
/// # Arguments
///
/// * `vault_key` - 32-byte vault encryption key
/// * `recipient_public_key` - Recipient's X25519 public key
///
/// # Returns
///
/// Wrapped key data for storage/transmission
pub fn wrap_vault_key(
    vault_key: &[u8; X25519_KEY_LENGTH],
    recipient_public_key: &X25519PublicKey,
) -> CryptoResult<WrappedVaultKey> {
    // Generate ephemeral key pair
    let ephemeral = generate_keypair();

    // Derive shared secret
    let shared_secret = derive_shared_secret(&ephemeral.private_key, recipient_public_key)?;

    // Encrypt vault key
    let (ciphertext, nonce) = chacha_encrypt(vault_key, &shared_secret, None)?;

    Ok(WrappedVaultKey {
        ephemeral_public_key: ephemeral.public_key.to_base64(),
        encrypted_key: BASE64.encode(&ciphertext),
        nonce: BASE64.encode(nonce),
    })
}

/// Wrap a vault key using a base64-encoded recipient public key
pub fn wrap_vault_key_with_base64(
    vault_key: &[u8; X25519_KEY_LENGTH],
    recipient_public_key_b64: &str,
) -> CryptoResult<WrappedVaultKey> {
    let recipient_public_key = X25519PublicKey::from_base64(recipient_public_key_b64)?;
    wrap_vault_key(vault_key, &recipient_public_key)
}

/// Unwrap a vault key using recipient's private key
///
/// This function:
/// 1. Extracts the ephemeral public key from wrapped data
/// 2. Derives the same shared secret using recipient's private key + ephemeral public
/// 3. Decrypts the vault key using ChaCha20Poly1305
///
/// # Arguments
///
/// * `wrapped` - Wrapped key data from wrap_vault_key
/// * `recipient_private_key` - Recipient's X25519 private key
///
/// # Returns
///
/// 32-byte vault encryption key
pub fn unwrap_vault_key(
    wrapped: &WrappedVaultKey,
    recipient_private_key: &X25519PrivateKey,
) -> CryptoResult<[u8; X25519_KEY_LENGTH]> {
    // Import ephemeral public key
    let ephemeral_public = X25519PublicKey::from_base64(&wrapped.ephemeral_public_key)?;

    // Derive shared secret
    let shared_secret = derive_shared_secret(recipient_private_key, &ephemeral_public)?;

    // Decode encrypted data
    let encrypted_key = BASE64
        .decode(&wrapped.encrypted_key)
        .map_err(|_| CryptoError::UnwrapFailed)?;

    let nonce_bytes = BASE64
        .decode(&wrapped.nonce)
        .map_err(|_| CryptoError::UnwrapFailed)?;

    if nonce_bytes.len() != CHACHA_NONCE_LENGTH {
        return Err(CryptoError::InvalidNonce);
    }

    let mut nonce = [0u8; CHACHA_NONCE_LENGTH];
    nonce.copy_from_slice(&nonce_bytes);

    // Decrypt vault key
    let decrypted = chacha_decrypt(&encrypted_key, &shared_secret, &nonce)?;

    if decrypted.len() != X25519_KEY_LENGTH {
        return Err(CryptoError::UnwrapFailed);
    }

    let mut vault_key = [0u8; X25519_KEY_LENGTH];
    vault_key.copy_from_slice(&decrypted);

    Ok(vault_key)
}

/// Unwrap a vault key using a base64-encoded recipient private key
pub fn unwrap_vault_key_with_base64(
    wrapped: &WrappedVaultKey,
    recipient_private_key_b64: &str,
) -> CryptoResult<[u8; X25519_KEY_LENGTH]> {
    let recipient_private_key = X25519PrivateKey::from_base64(recipient_private_key_b64)?;
    unwrap_vault_key(wrapped, &recipient_private_key)
}

/// Generate a random ChaCha20Poly1305 nonce
pub fn generate_nonce() -> [u8; CHACHA_NONCE_LENGTH] {
    use rand::RngCore;
    let mut rng = rand::thread_rng();
    let mut nonce = [0u8; CHACHA_NONCE_LENGTH];
    rng.fill_bytes(&mut nonce);
    nonce
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::generate_salt;

    #[test]
    fn test_chacha_encrypt_decrypt() {
        let key = generate_salt(CHACHA_KEY_LENGTH).unwrap();
        let mut key_arr = [0u8; CHACHA_KEY_LENGTH];
        key_arr.copy_from_slice(&key);

        let plaintext = b"Hello, World!";

        let (ciphertext, nonce) = chacha_encrypt(plaintext, &key_arr, None).unwrap();
        let decrypted = chacha_decrypt(&ciphertext, &key_arr, &nonce).unwrap();

        assert_eq!(plaintext.to_vec(), decrypted);
    }

    #[test]
    fn test_chacha_different_nonces_different_ciphertext() {
        let key = generate_salt(CHACHA_KEY_LENGTH).unwrap();
        let mut key_arr = [0u8; CHACHA_KEY_LENGTH];
        key_arr.copy_from_slice(&key);

        let plaintext = b"Test data";

        let (ct1, nonce1) = chacha_encrypt(plaintext, &key_arr, None).unwrap();
        let (ct2, nonce2) = chacha_encrypt(plaintext, &key_arr, None).unwrap();

        assert_ne!(nonce1, nonce2);
        assert_ne!(ct1, ct2);
    }

    #[test]
    fn test_chacha_wrong_key_fails() {
        let key1 = generate_salt(CHACHA_KEY_LENGTH).unwrap();
        let key2 = generate_salt(CHACHA_KEY_LENGTH).unwrap();
        let mut key1_arr = [0u8; CHACHA_KEY_LENGTH];
        let mut key2_arr = [0u8; CHACHA_KEY_LENGTH];
        key1_arr.copy_from_slice(&key1);
        key2_arr.copy_from_slice(&key2);

        let plaintext = b"Secret data";

        let (ciphertext, nonce) = chacha_encrypt(plaintext, &key1_arr, None).unwrap();
        let result = chacha_decrypt(&ciphertext, &key2_arr, &nonce);

        assert!(result.is_err());
    }

    #[test]
    fn test_chacha_tampered_ciphertext_fails() {
        let key = generate_salt(CHACHA_KEY_LENGTH).unwrap();
        let mut key_arr = [0u8; CHACHA_KEY_LENGTH];
        key_arr.copy_from_slice(&key);

        let plaintext = b"Secret data";

        let (mut ciphertext, nonce) = chacha_encrypt(plaintext, &key_arr, None).unwrap();

        // Tamper with ciphertext
        ciphertext[0] ^= 0xff;

        let result = chacha_decrypt(&ciphertext, &key_arr, &nonce);
        assert!(result.is_err());
    }

    #[test]
    fn test_wrap_unwrap_vault_key() {
        let vault_key = generate_salt(X25519_KEY_LENGTH).unwrap();
        let mut vault_key_arr = [0u8; X25519_KEY_LENGTH];
        vault_key_arr.copy_from_slice(&vault_key);

        let recipient = generate_keypair();

        let wrapped = wrap_vault_key(&vault_key_arr, &recipient.public_key).unwrap();
        let unwrapped = unwrap_vault_key(&wrapped, &recipient.private_key).unwrap();

        assert_eq!(vault_key_arr, unwrapped);
    }

    #[test]
    fn test_wrap_produces_unique_wrapped_data() {
        let vault_key = generate_salt(X25519_KEY_LENGTH).unwrap();
        let mut vault_key_arr = [0u8; X25519_KEY_LENGTH];
        vault_key_arr.copy_from_slice(&vault_key);

        let recipient = generate_keypair();

        let wrapped1 = wrap_vault_key(&vault_key_arr, &recipient.public_key).unwrap();
        let wrapped2 = wrap_vault_key(&vault_key_arr, &recipient.public_key).unwrap();

        // Each wrap uses a new ephemeral key and nonce
        assert_ne!(wrapped1.ephemeral_public_key, wrapped2.ephemeral_public_key);
        assert_ne!(wrapped1.nonce, wrapped2.nonce);
        assert_ne!(wrapped1.encrypted_key, wrapped2.encrypted_key);
    }

    #[test]
    fn test_wrong_recipient_cannot_unwrap() {
        let vault_key = generate_salt(X25519_KEY_LENGTH).unwrap();
        let mut vault_key_arr = [0u8; X25519_KEY_LENGTH];
        vault_key_arr.copy_from_slice(&vault_key);

        let recipient = generate_keypair();
        let attacker = generate_keypair();

        let wrapped = wrap_vault_key(&vault_key_arr, &recipient.public_key).unwrap();
        let result = unwrap_vault_key(&wrapped, &attacker.private_key);

        assert!(result.is_err());
    }

    #[test]
    fn test_multiple_recipients() {
        let vault_key = generate_salt(X25519_KEY_LENGTH).unwrap();
        let mut vault_key_arr = [0u8; X25519_KEY_LENGTH];
        vault_key_arr.copy_from_slice(&vault_key);

        let member1 = generate_keypair();
        let member2 = generate_keypair();
        let member3 = generate_keypair();

        let wrapped1 = wrap_vault_key(&vault_key_arr, &member1.public_key).unwrap();
        let wrapped2 = wrap_vault_key(&vault_key_arr, &member2.public_key).unwrap();
        let wrapped3 = wrap_vault_key(&vault_key_arr, &member3.public_key).unwrap();

        // Each member can unwrap their own
        assert_eq!(
            vault_key_arr,
            unwrap_vault_key(&wrapped1, &member1.private_key).unwrap()
        );
        assert_eq!(
            vault_key_arr,
            unwrap_vault_key(&wrapped2, &member2.private_key).unwrap()
        );
        assert_eq!(
            vault_key_arr,
            unwrap_vault_key(&wrapped3, &member3.private_key).unwrap()
        );

        // Members cannot unwrap each other's
        assert!(unwrap_vault_key(&wrapped1, &member2.private_key).is_err());
        assert!(unwrap_vault_key(&wrapped2, &member3.private_key).is_err());
        assert!(unwrap_vault_key(&wrapped3, &member1.private_key).is_err());
    }

    #[test]
    fn test_wrap_unwrap_with_base64() {
        let vault_key = generate_salt(X25519_KEY_LENGTH).unwrap();
        let mut vault_key_arr = [0u8; X25519_KEY_LENGTH];
        vault_key_arr.copy_from_slice(&vault_key);

        let recipient = generate_keypair();
        let public_b64 = recipient.public_key.to_base64();
        let private_b64 = recipient.private_key.to_base64();

        let wrapped = wrap_vault_key_with_base64(&vault_key_arr, &public_b64).unwrap();
        let unwrapped = unwrap_vault_key_with_base64(&wrapped, &private_b64).unwrap();

        assert_eq!(vault_key_arr, unwrapped);
    }

    #[test]
    fn test_generate_nonce() {
        let nonce1 = generate_nonce();
        let nonce2 = generate_nonce();

        assert_eq!(nonce1.len(), CHACHA_NONCE_LENGTH);
        assert_eq!(nonce2.len(), CHACHA_NONCE_LENGTH);
        assert_ne!(nonce1, nonce2);
    }

    #[test]
    fn test_wrapped_key_serialization() {
        let vault_key = generate_salt(X25519_KEY_LENGTH).unwrap();
        let mut vault_key_arr = [0u8; X25519_KEY_LENGTH];
        vault_key_arr.copy_from_slice(&vault_key);

        let recipient = generate_keypair();
        let wrapped = wrap_vault_key(&vault_key_arr, &recipient.public_key).unwrap();

        // Serialize to JSON
        let json = serde_json::to_string(&wrapped).unwrap();

        // Verify camelCase field names
        assert!(json.contains("ephemeralPublicKey"));
        assert!(json.contains("encryptedKey"));
        assert!(json.contains("nonce"));

        // Deserialize back
        let restored: WrappedVaultKey = serde_json::from_str(&json).unwrap();

        // Should still unwrap correctly
        let unwrapped = unwrap_vault_key(&restored, &recipient.private_key).unwrap();
        assert_eq!(vault_key_arr, unwrapped);
    }

    #[test]
    fn test_chacha_empty_plaintext() {
        let key = generate_salt(CHACHA_KEY_LENGTH).unwrap();
        let mut key_arr = [0u8; CHACHA_KEY_LENGTH];
        key_arr.copy_from_slice(&key);

        let plaintext = b"";

        let (ciphertext, nonce) = chacha_encrypt(plaintext, &key_arr, None).unwrap();
        let decrypted = chacha_decrypt(&ciphertext, &key_arr, &nonce).unwrap();

        assert!(decrypted.is_empty());
    }

    #[test]
    fn test_chacha_large_data() {
        let key = generate_salt(CHACHA_KEY_LENGTH).unwrap();
        let mut key_arr = [0u8; CHACHA_KEY_LENGTH];
        key_arr.copy_from_slice(&key);

        let mut plaintext = vec![0u8; 100_000];
        for (i, byte) in plaintext.iter_mut().enumerate() {
            *byte = (i % 256) as u8;
        }

        let (ciphertext, nonce) = chacha_encrypt(&plaintext, &key_arr, None).unwrap();
        let decrypted = chacha_decrypt(&ciphertext, &key_arr, &nonce).unwrap();

        assert_eq!(plaintext, decrypted);
    }
}
