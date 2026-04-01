//! AES-GCM encryption
//!
//! Provides authenticated encryption using AES-256-GCM.

use base64::{engine::general_purpose::STANDARD, Engine};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::rand::{SecureRandom, SystemRandom};

use crate::error::{CryptoError, CryptoResult};
use crate::keys::VaultKey;

/// Nonce length for AES-GCM (96 bits / 12 bytes)
const NONCE_LEN: usize = 12;

/// Encrypt data using AES-256-GCM
///
/// Returns base64-encoded ciphertext in format: `nonce.ciphertext_with_tag`
///
/// # Arguments
/// * `data` - The plaintext data to encrypt
/// * `key` - The encryption key (32 bytes)
///
/// # Example
/// ```
/// use goalrate_crypto::{encrypt, generate_key};
///
/// let key = generate_key().unwrap();
/// let encrypted = encrypt(b"secret data", &key).unwrap();
/// assert!(encrypted.contains('.')); // Format: nonce.ciphertext
/// ```
pub fn encrypt(data: &[u8], key: &VaultKey) -> CryptoResult<String> {
    let rng = SystemRandom::new();

    // Generate random nonce
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rng.fill(&mut nonce_bytes)
        .map_err(|_| CryptoError::EncryptionFailed("Nonce generation failed".into()))?;

    // Create AES-GCM key
    let unbound_key =
        UnboundKey::new(&AES_256_GCM, key.as_bytes()).map_err(|_| CryptoError::InvalidKeyLength)?;
    let sealing_key = LessSafeKey::new(unbound_key);

    let nonce = Nonce::assume_unique_for_key(nonce_bytes);

    // Encrypt in-place (appends authentication tag)
    let mut in_out = data.to_vec();
    sealing_key
        .seal_in_place_append_tag(nonce, Aad::empty(), &mut in_out)
        .map_err(|_| CryptoError::EncryptionFailed("Seal failed".into()))?;

    // Combine nonce + ciphertext and base64 encode
    let nonce_b64 = STANDARD.encode(nonce_bytes);
    let ciphertext_b64 = STANDARD.encode(&in_out);

    Ok(format!("{}.{}", nonce_b64, ciphertext_b64))
}

/// Decrypt data using AES-256-GCM
///
/// Expects base64-encoded ciphertext in format: `nonce.ciphertext_with_tag`
///
/// # Arguments
/// * `encrypted` - The encrypted data (base64 encoded)
/// * `key` - The decryption key (must match the encryption key)
///
/// # Example
/// ```
/// use goalrate_crypto::{encrypt, decrypt, generate_key};
///
/// let key = generate_key().unwrap();
/// let encrypted = encrypt(b"secret data", &key).unwrap();
/// let decrypted = decrypt(&encrypted, &key).unwrap();
/// assert_eq!(decrypted, b"secret data");
/// ```
pub fn decrypt(encrypted: &str, key: &VaultKey) -> CryptoResult<Vec<u8>> {
    let parts: Vec<&str> = encrypted.split('.').collect();
    if parts.len() != 2 {
        return Err(CryptoError::InvalidFormat);
    }

    // Decode nonce
    let nonce_bytes = STANDARD.decode(parts[0])?;
    if nonce_bytes.len() != NONCE_LEN {
        return Err(CryptoError::InvalidNonce);
    }

    // Decode ciphertext
    let mut ciphertext = STANDARD.decode(parts[1])?;

    // Create AES-GCM key
    let unbound_key =
        UnboundKey::new(&AES_256_GCM, key.as_bytes()).map_err(|_| CryptoError::InvalidKeyLength)?;
    let opening_key = LessSafeKey::new(unbound_key);

    let mut nonce_arr = [0u8; NONCE_LEN];
    nonce_arr.copy_from_slice(&nonce_bytes);
    let nonce = Nonce::assume_unique_for_key(nonce_arr);

    // Decrypt in-place (verifies authentication tag)
    let plaintext = opening_key
        .open_in_place(nonce, Aad::empty(), &mut ciphertext)
        .map_err(|_| CryptoError::DecryptionFailed("Authentication failed".into()))?;

    Ok(plaintext.to_vec())
}

/// Encrypt a string and return base64-encoded ciphertext
pub fn encrypt_string(data: &str, key: &VaultKey) -> CryptoResult<String> {
    encrypt(data.as_bytes(), key)
}

/// Decrypt to a UTF-8 string
pub fn decrypt_string(encrypted: &str, key: &VaultKey) -> CryptoResult<String> {
    let bytes = decrypt(encrypted, key)?;
    String::from_utf8(bytes).map_err(|_| CryptoError::DecryptionFailed("Invalid UTF-8".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::generate_key;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = generate_key().unwrap();
        let plaintext = b"Hello, Goalrate!";

        let encrypted = encrypt(plaintext, &key).unwrap();
        let decrypted = decrypt(&encrypted, &key).unwrap();

        assert_eq!(plaintext.to_vec(), decrypted);
    }

    #[test]
    fn test_encrypt_produces_different_ciphertexts() {
        let key = generate_key().unwrap();
        let plaintext = b"Same data";

        let encrypted1 = encrypt(plaintext, &key).unwrap();
        let encrypted2 = encrypt(plaintext, &key).unwrap();

        // Due to random nonces, ciphertexts should differ
        assert_ne!(encrypted1, encrypted2);

        // But both should decrypt to the same plaintext
        assert_eq!(decrypt(&encrypted1, &key).unwrap(), plaintext);
        assert_eq!(decrypt(&encrypted2, &key).unwrap(), plaintext);
    }

    #[test]
    fn test_decrypt_with_wrong_key_fails() {
        let key1 = generate_key().unwrap();
        let key2 = generate_key().unwrap();
        let plaintext = b"Secret data";

        let encrypted = encrypt(plaintext, &key1).unwrap();
        let result = decrypt(&encrypted, &key2);

        assert!(result.is_err());
    }

    #[test]
    fn test_tampered_ciphertext_fails() {
        let key = generate_key().unwrap();
        let plaintext = b"Secret data";

        let encrypted = encrypt(plaintext, &key).unwrap();

        // Tamper with the ciphertext
        let parts: Vec<&str> = encrypted.split('.').collect();
        let mut ciphertext_bytes = STANDARD.decode(parts[1]).unwrap();
        if !ciphertext_bytes.is_empty() {
            ciphertext_bytes[0] ^= 0xFF; // Flip bits
        }
        let tampered = format!("{}.{}", parts[0], STANDARD.encode(&ciphertext_bytes));

        let result = decrypt(&tampered, &key);
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_format() {
        let key = generate_key().unwrap();

        // No separator
        assert!(matches!(
            decrypt("invalid", &key),
            Err(CryptoError::InvalidFormat)
        ));

        // Too many parts
        assert!(matches!(
            decrypt("a.b.c", &key),
            Err(CryptoError::InvalidFormat)
        ));
    }

    #[test]
    fn test_string_roundtrip() {
        let key = generate_key().unwrap();
        let plaintext = "Hello, World! 🎉";

        let encrypted = encrypt_string(plaintext, &key).unwrap();
        let decrypted = decrypt_string(&encrypted, &key).unwrap();

        assert_eq!(plaintext, decrypted);
    }

    #[test]
    fn test_empty_data() {
        let key = generate_key().unwrap();
        let plaintext = b"";

        let encrypted = encrypt(plaintext, &key).unwrap();
        let decrypted = decrypt(&encrypted, &key).unwrap();

        assert!(decrypted.is_empty());
    }

    #[test]
    fn test_large_data() {
        let key = generate_key().unwrap();
        let plaintext: Vec<u8> = (0..10000).map(|i| (i % 256) as u8).collect();

        let encrypted = encrypt(&plaintext, &key).unwrap();
        let decrypted = decrypt(&encrypted, &key).unwrap();

        assert_eq!(plaintext, decrypted);
    }
}
