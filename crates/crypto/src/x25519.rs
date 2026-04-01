//! X25519 key exchange
//!
//! Provides X25519 (Curve25519) Elliptic Curve Diffie-Hellman key exchange
//! for secure key sharing between team members.
//!
//! # Example
//!
//! ```
//! use goalrate_crypto::x25519::{generate_keypair, derive_shared_secret};
//!
//! // Generate key pairs for Alice and Bob
//! let alice = generate_keypair();
//! let bob = generate_keypair();
//!
//! // Both derive the same shared secret
//! let alice_shared = derive_shared_secret(&alice.private_key, &bob.public_key).unwrap();
//! let bob_shared = derive_shared_secret(&bob.private_key, &alice.public_key).unwrap();
//!
//! assert_eq!(alice_shared, bob_shared);
//! ```

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroize;

use crate::error::{CryptoError, CryptoResult};

/// X25519 key length (32 bytes / 256 bits)
pub const X25519_KEY_LENGTH: usize = 32;

/// X25519 private key with automatic zeroing on drop
#[derive(Clone, Zeroize)]
#[zeroize(drop)]
pub struct X25519PrivateKey([u8; X25519_KEY_LENGTH]);

impl X25519PrivateKey {
    /// Create from raw bytes
    pub fn from_bytes(bytes: [u8; X25519_KEY_LENGTH]) -> Self {
        Self(bytes)
    }

    /// Create from a slice
    pub fn from_slice(bytes: &[u8]) -> CryptoResult<Self> {
        if bytes.len() != X25519_KEY_LENGTH {
            return Err(CryptoError::InvalidKeyLength);
        }
        let mut key = [0u8; X25519_KEY_LENGTH];
        key.copy_from_slice(bytes);
        Ok(Self(key))
    }

    /// Create from base64-encoded string
    pub fn from_base64(b64: &str) -> CryptoResult<Self> {
        let bytes = BASE64.decode(b64)?;
        Self::from_slice(&bytes)
    }

    /// Get the raw bytes
    pub fn as_bytes(&self) -> &[u8; X25519_KEY_LENGTH] {
        &self.0
    }

    /// Export as base64 string
    pub fn to_base64(&self) -> String {
        BASE64.encode(self.0)
    }

    /// Derive the public key from this private key
    pub fn public_key(&self) -> X25519PublicKey {
        let secret = StaticSecret::from(self.0);
        let public = PublicKey::from(&secret);
        X25519PublicKey(*public.as_bytes())
    }
}

impl std::fmt::Debug for X25519PrivateKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never expose key material in debug output
        f.debug_struct("X25519PrivateKey")
            .field("len", &X25519_KEY_LENGTH)
            .finish()
    }
}

/// X25519 public key
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct X25519PublicKey([u8; X25519_KEY_LENGTH]);

impl X25519PublicKey {
    /// Create from raw bytes
    pub fn from_bytes(bytes: [u8; X25519_KEY_LENGTH]) -> Self {
        Self(bytes)
    }

    /// Create from a slice
    pub fn from_slice(bytes: &[u8]) -> CryptoResult<Self> {
        if bytes.len() != X25519_KEY_LENGTH {
            return Err(CryptoError::InvalidKeyLength);
        }
        let mut key = [0u8; X25519_KEY_LENGTH];
        key.copy_from_slice(bytes);
        Ok(Self(key))
    }

    /// Create from base64-encoded string
    pub fn from_base64(b64: &str) -> CryptoResult<Self> {
        let bytes = BASE64.decode(b64)?;
        Self::from_slice(&bytes)
    }

    /// Get the raw bytes
    pub fn as_bytes(&self) -> &[u8; X25519_KEY_LENGTH] {
        &self.0
    }

    /// Export as base64 string
    pub fn to_base64(&self) -> String {
        BASE64.encode(self.0)
    }
}

impl std::fmt::Debug for X25519PublicKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("X25519PublicKey")
            .field("base64", &self.to_base64())
            .finish()
    }
}

/// X25519 key pair
pub struct X25519KeyPair {
    pub private_key: X25519PrivateKey,
    pub public_key: X25519PublicKey,
}

impl X25519KeyPair {
    /// Create a key pair from a private key
    pub fn from_private_key(private_key: X25519PrivateKey) -> Self {
        let public_key = private_key.public_key();
        Self {
            private_key,
            public_key,
        }
    }
}

/// Generate a new random X25519 key pair
///
/// Uses the system's secure random number generator.
///
/// # Example
///
/// ```
/// use goalrate_crypto::x25519::generate_keypair;
///
/// let keypair = generate_keypair();
/// assert_eq!(keypair.public_key.as_bytes().len(), 32);
/// ```
pub fn generate_keypair() -> X25519KeyPair {
    use rand::RngCore;

    let mut rng = rand::thread_rng();
    let mut private_bytes = [0u8; X25519_KEY_LENGTH];
    rng.fill_bytes(&mut private_bytes);

    let secret = StaticSecret::from(private_bytes);
    let public = PublicKey::from(&secret);

    X25519KeyPair {
        private_key: X25519PrivateKey(private_bytes),
        public_key: X25519PublicKey(*public.as_bytes()),
    }
}

/// Derive a shared secret using X25519 key exchange
///
/// Both parties can derive the same shared secret using their private key
/// and the other party's public key.
///
/// # Arguments
///
/// * `private_key` - Your private key
/// * `public_key` - Other party's public key
///
/// # Returns
///
/// 32-byte shared secret that can be used as a symmetric encryption key.
///
/// # Example
///
/// ```
/// use goalrate_crypto::x25519::{generate_keypair, derive_shared_secret};
///
/// let alice = generate_keypair();
/// let bob = generate_keypair();
///
/// let alice_shared = derive_shared_secret(&alice.private_key, &bob.public_key).unwrap();
/// let bob_shared = derive_shared_secret(&bob.private_key, &alice.public_key).unwrap();
///
/// assert_eq!(alice_shared, bob_shared);
/// ```
pub fn derive_shared_secret(
    private_key: &X25519PrivateKey,
    public_key: &X25519PublicKey,
) -> CryptoResult<[u8; X25519_KEY_LENGTH]> {
    let secret = StaticSecret::from(private_key.0);
    let their_public = PublicKey::from(public_key.0);

    let shared = secret.diffie_hellman(&their_public);
    Ok(*shared.as_bytes())
}

/// Derive a shared secret from base64-encoded keys
pub fn derive_shared_secret_from_base64(
    private_key_b64: &str,
    public_key_b64: &str,
) -> CryptoResult<[u8; X25519_KEY_LENGTH]> {
    let private_key = X25519PrivateKey::from_base64(private_key_b64)?;
    let public_key = X25519PublicKey::from_base64(public_key_b64)?;
    derive_shared_secret(&private_key, &public_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_keypair() {
        let keypair = generate_keypair();

        assert_eq!(keypair.private_key.as_bytes().len(), X25519_KEY_LENGTH);
        assert_eq!(keypair.public_key.as_bytes().len(), X25519_KEY_LENGTH);
    }

    #[test]
    fn test_keypairs_are_unique() {
        let keypair1 = generate_keypair();
        let keypair2 = generate_keypair();

        assert_ne!(
            keypair1.private_key.as_bytes(),
            keypair2.private_key.as_bytes()
        );
        assert_ne!(
            keypair1.public_key.as_bytes(),
            keypair2.public_key.as_bytes()
        );
    }

    #[test]
    fn test_shared_secret_agreement() {
        let alice = generate_keypair();
        let bob = generate_keypair();

        let alice_shared = derive_shared_secret(&alice.private_key, &bob.public_key).unwrap();
        let bob_shared = derive_shared_secret(&bob.private_key, &alice.public_key).unwrap();

        assert_eq!(alice_shared, bob_shared);
    }

    #[test]
    fn test_different_keypairs_different_secrets() {
        let alice = generate_keypair();
        let bob = generate_keypair();
        let charlie = generate_keypair();

        let alice_bob = derive_shared_secret(&alice.private_key, &bob.public_key).unwrap();
        let alice_charlie = derive_shared_secret(&alice.private_key, &charlie.public_key).unwrap();

        assert_ne!(alice_bob, alice_charlie);
    }

    #[test]
    fn test_public_key_from_private() {
        let keypair = generate_keypair();
        let derived_public = keypair.private_key.public_key();

        assert_eq!(derived_public.as_bytes(), keypair.public_key.as_bytes());
    }

    #[test]
    fn test_base64_roundtrip_private_key() {
        let keypair = generate_keypair();
        let b64 = keypair.private_key.to_base64();
        let restored = X25519PrivateKey::from_base64(&b64).unwrap();

        assert_eq!(restored.as_bytes(), keypair.private_key.as_bytes());
    }

    #[test]
    fn test_base64_roundtrip_public_key() {
        let keypair = generate_keypair();
        let b64 = keypair.public_key.to_base64();
        let restored = X25519PublicKey::from_base64(&b64).unwrap();

        assert_eq!(restored.as_bytes(), keypair.public_key.as_bytes());
    }

    #[test]
    fn test_from_slice_invalid_length() {
        let short = [0u8; 16];
        assert!(matches!(
            X25519PrivateKey::from_slice(&short),
            Err(CryptoError::InvalidKeyLength)
        ));
        assert!(matches!(
            X25519PublicKey::from_slice(&short),
            Err(CryptoError::InvalidKeyLength)
        ));
    }

    #[test]
    fn test_derive_shared_secret_from_base64() {
        let alice = generate_keypair();
        let bob = generate_keypair();

        let alice_shared = derive_shared_secret_from_base64(
            &alice.private_key.to_base64(),
            &bob.public_key.to_base64(),
        )
        .unwrap();

        let bob_shared = derive_shared_secret_from_base64(
            &bob.private_key.to_base64(),
            &alice.public_key.to_base64(),
        )
        .unwrap();

        assert_eq!(alice_shared, bob_shared);
    }

    #[test]
    fn test_debug_does_not_leak_private_key() {
        let keypair = generate_keypair();
        let debug_str = format!("{:?}", keypair.private_key);

        // Debug output should not contain key bytes
        assert!(debug_str.contains("X25519PrivateKey"));
        assert!(debug_str.contains("len"));
        // Should not contain base64 of the key
        assert!(!debug_str.contains(&keypair.private_key.to_base64()));
    }

    #[test]
    fn test_keypair_from_private_key() {
        let original = generate_keypair();
        let restored = X25519KeyPair::from_private_key(X25519PrivateKey::from_bytes(
            *original.private_key.as_bytes(),
        ));

        assert_eq!(
            restored.public_key.as_bytes(),
            original.public_key.as_bytes()
        );
    }
}
