//! Error types for crypto operations

use thiserror::Error;

pub type CryptoResult<T> = Result<T, CryptoError>;

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("Encryption failed: {0}")]
    EncryptionFailed(String),

    #[error("Decryption failed: {0}")]
    DecryptionFailed(String),

    #[error("Invalid key length: expected 32 bytes")]
    InvalidKeyLength,

    #[error("Invalid nonce: expected 12 bytes")]
    InvalidNonce,

    #[error("Key derivation failed: {0}")]
    KeyDerivation(String),

    #[error("Base64 decode error: {0}")]
    Base64(#[from] base64::DecodeError),

    #[error("Invalid ciphertext format")]
    InvalidFormat,

    #[error("X25519 key exchange failed: {0}")]
    X25519Error(String),

    #[error("ChaCha20Poly1305 error: {0}")]
    ChaChaError(String),

    #[error("Key unwrapping failed: invalid wrapped key data")]
    UnwrapFailed,
}
