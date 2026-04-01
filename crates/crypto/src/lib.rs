//! goalrate-crypto - E2E encryption for Goalrate
//!
//! Provides AES-256-GCM encryption for vault data, enabling secure
//! storage and transmission of sensitive information.
//!
//! # Security Features
//!
//! - AES-256-GCM authenticated encryption
//! - PBKDF2-HMAC-SHA256 key derivation (100,000 iterations)
//! - X25519 key exchange for secure key sharing
//! - ChaCha20Poly1305 for vault key wrapping
//! - Secure random number generation via `ring`
//! - Automatic memory zeroing for sensitive data
//!
//! # Example - Symmetric Encryption
//!
//! ```
//! use goalrate_crypto::{encrypt, decrypt, generate_key};
//!
//! let key = generate_key().unwrap();
//! let plaintext = b"Hello, Goalrate!";
//!
//! let encrypted = encrypt(plaintext, &key).unwrap();
//! let decrypted = decrypt(&encrypted, &key).unwrap();
//!
//! assert_eq!(plaintext.to_vec(), decrypted);
//! ```
//!
//! # Example - Key Sharing
//!
//! ```
//! use goalrate_crypto::{generate_key, x25519, chacha};
//!
//! // Admin has a vault key
//! let vault_key = generate_key().unwrap();
//!
//! // Team member generates their key pair
//! let member = x25519::generate_keypair();
//!
//! // Admin wraps vault key for team member
//! let wrapped = chacha::wrap_vault_key(vault_key.as_bytes(), &member.public_key).unwrap();
//!
//! // Team member unwraps to get the vault key
//! let unwrapped = chacha::unwrap_vault_key(&wrapped, &member.private_key).unwrap();
//!
//! assert_eq!(vault_key.as_bytes(), &unwrapped);
//! ```

pub mod aes;
pub mod chacha;
pub mod error;
pub mod keys;
pub mod x25519;

pub use aes::{decrypt, encrypt};
pub use error::{CryptoError, CryptoResult};
pub use keys::{derive_key, generate_key, VaultKey};
