//! Error types for vault operations

use thiserror::Error;

/// Result type for vault operations
pub type VaultResult<T> = Result<T, VaultError>;

/// Errors that can occur during vault operations
#[derive(Error, Debug)]
pub enum VaultError {
    #[error("Vault not found at path: {0}")]
    NotFound(String),

    #[error("Vault already exists at path: {0}")]
    AlreadyExists(String),

    #[error("Invalid vault structure: {0}")]
    InvalidStructure(String),

    #[error("Vault is locked by another process")]
    Locked,

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Markdown parse error: {0}")]
    Markdown(#[from] markdown_parser::ParseError),

    #[error("File watcher error: {0}")]
    Watcher(#[from] notify::Error),

    #[error("Invalid path: {0}")]
    InvalidPath(String),

    #[error("Invalid vault type: {0}")]
    InvalidVaultType(String),

    #[error("Item not found: {0}")]
    ItemNotFound(String),
}
