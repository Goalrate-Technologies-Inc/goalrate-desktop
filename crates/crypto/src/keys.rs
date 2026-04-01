//! Key management
//!
//! Provides secure key generation and derivation for vault encryption.

use ring::rand::{SecureRandom, SystemRandom};
use zeroize::Zeroize;

use crate::error::{CryptoError, CryptoResult};

/// AES-256-GCM key (32 bytes)
///
/// The key is automatically zeroed from memory when dropped.
#[derive(Clone, Zeroize)]
#[zeroize(drop)]
pub struct VaultKey([u8; 32]);

impl VaultKey {
    /// Key length in bytes
    pub const LEN: usize = 32;

    /// Create a key from raw bytes
    ///
    /// # Arguments
    /// * `bytes` - Exactly 32 bytes of key material
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// Create a key from a slice
    ///
    /// # Errors
    /// Returns `CryptoError::InvalidKeyLength` if the slice is not exactly 32 bytes.
    pub fn from_slice(bytes: &[u8]) -> CryptoResult<Self> {
        if bytes.len() != Self::LEN {
            return Err(CryptoError::InvalidKeyLength);
        }

        let mut key = [0u8; 32];
        key.copy_from_slice(bytes);
        Ok(Self(key))
    }

    /// Get the raw key bytes
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl std::fmt::Debug for VaultKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never expose key material in debug output
        f.debug_struct("VaultKey").field("len", &32).finish()
    }
}

/// Generate a random encryption key
///
/// Uses the system's secure random number generator.
///
/// # Example
/// ```
/// use goalrate_crypto::generate_key;
///
/// let key = generate_key().unwrap();
/// assert_eq!(key.as_bytes().len(), 32);
/// ```
pub fn generate_key() -> CryptoResult<VaultKey> {
    let rng = SystemRandom::new();
    let mut key = [0u8; 32];

    rng.fill(&mut key)
        .map_err(|_| CryptoError::KeyDerivation("Random generation failed".into()))?;

    Ok(VaultKey(key))
}

/// Derive a key from a password using PBKDF2
///
/// Uses PBKDF2-HMAC-SHA256 with 100,000 iterations for key stretching.
///
/// # Arguments
/// * `password` - The password to derive from
/// * `salt` - A unique salt (should be at least 16 bytes, stored with the ciphertext)
///
/// # Example
/// ```
/// use goalrate_crypto::derive_key;
///
/// let salt = b"unique-vault-salt-here";
/// let key = derive_key("my-password", salt).unwrap();
/// ```
pub fn derive_key(password: &str, salt: &[u8]) -> CryptoResult<VaultKey> {
    use ring::pbkdf2;

    const ITERATIONS: u32 = 100_000;

    let mut key = [0u8; 32];

    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        std::num::NonZeroU32::new(ITERATIONS).unwrap(),
        salt,
        password.as_bytes(),
        &mut key,
    );

    Ok(VaultKey(key))
}

/// Generate a random salt for key derivation
///
/// # Arguments
/// * `len` - Length of the salt in bytes (recommended: 16 or 32)
pub fn generate_salt(len: usize) -> CryptoResult<Vec<u8>> {
    let rng = SystemRandom::new();
    let mut salt = vec![0u8; len];

    rng.fill(&mut salt)
        .map_err(|_| CryptoError::KeyDerivation("Salt generation failed".into()))?;

    Ok(salt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_key() {
        let key = generate_key().unwrap();
        assert_eq!(key.as_bytes().len(), 32);

        // Keys should be different each time
        let key2 = generate_key().unwrap();
        assert_ne!(key.as_bytes(), key2.as_bytes());
    }

    #[test]
    fn test_derive_key_deterministic() {
        let salt = b"goalrate-vault-salt";
        let key1 = derive_key("password123", salt).unwrap();
        let key2 = derive_key("password123", salt).unwrap();

        // Same password + salt = same key
        assert_eq!(key1.as_bytes(), key2.as_bytes());
    }

    #[test]
    fn test_derive_key_different_passwords() {
        let salt = b"goalrate-vault-salt";
        let key1 = derive_key("password1", salt).unwrap();
        let key2 = derive_key("password2", salt).unwrap();

        // Different passwords = different keys
        assert_ne!(key1.as_bytes(), key2.as_bytes());
    }

    #[test]
    fn test_derive_key_different_salts() {
        let key1 = derive_key("password", b"salt1").unwrap();
        let key2 = derive_key("password", b"salt2").unwrap();

        // Different salts = different keys
        assert_ne!(key1.as_bytes(), key2.as_bytes());
    }

    #[test]
    fn test_from_slice_valid() {
        let bytes = [42u8; 32];
        let key = VaultKey::from_slice(&bytes).unwrap();
        assert_eq!(key.as_bytes(), &bytes);
    }

    #[test]
    fn test_from_slice_invalid_length() {
        let bytes = [42u8; 16]; // Wrong length
        assert!(matches!(
            VaultKey::from_slice(&bytes),
            Err(CryptoError::InvalidKeyLength)
        ));
    }

    #[test]
    fn test_generate_salt() {
        let salt1 = generate_salt(16).unwrap();
        let salt2 = generate_salt(16).unwrap();

        assert_eq!(salt1.len(), 16);
        assert_ne!(salt1, salt2);
    }

    #[test]
    fn test_debug_does_not_leak_key() {
        let key = generate_key().unwrap();
        let debug_str = format!("{:?}", key);

        // Debug output should not contain key bytes
        assert!(!debug_str.contains("42"));
        assert!(debug_str.contains("VaultKey"));
    }
}
