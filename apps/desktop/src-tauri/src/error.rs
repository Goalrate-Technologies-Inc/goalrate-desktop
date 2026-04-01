//! Application error types for Tauri IPC
//!
//! This module provides error types that serialize properly for Tauri commands
//! and map to the TypeScript `StorageErrorCode` type.

use serde::Serialize;
use vault_core::VaultError;

/// Error codes that map to TypeScript `StorageErrorCode`
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[allow(dead_code)]
pub enum ErrorCode {
    VaultNotFound,
    VaultNotOpen,
    VaultAlreadyExists,
    VaultLocked,
    ItemNotFound,
    ItemAlreadyExists,
    PermissionDenied,
    ValidationError,
    NetworkError,
    SyncConflict,
    StorageFull,
    EncryptionError,
    AuthError,
    NotImplemented,
    UnknownError,
}

impl std::fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::VaultNotFound => write!(f, "VAULT_NOT_FOUND"),
            Self::VaultNotOpen => write!(f, "VAULT_NOT_OPEN"),
            Self::VaultAlreadyExists => write!(f, "VAULT_ALREADY_EXISTS"),
            Self::VaultLocked => write!(f, "VAULT_LOCKED"),
            Self::ItemNotFound => write!(f, "ITEM_NOT_FOUND"),
            Self::ItemAlreadyExists => write!(f, "ITEM_ALREADY_EXISTS"),
            Self::PermissionDenied => write!(f, "PERMISSION_DENIED"),
            Self::ValidationError => write!(f, "VALIDATION_ERROR"),
            Self::NetworkError => write!(f, "NETWORK_ERROR"),
            Self::SyncConflict => write!(f, "SYNC_CONFLICT"),
            Self::StorageFull => write!(f, "STORAGE_FULL"),
            Self::EncryptionError => write!(f, "ENCRYPTION_ERROR"),
            Self::AuthError => write!(f, "AUTH_ERROR"),
            Self::NotImplemented => write!(f, "NOT_IMPLEMENTED"),
            Self::UnknownError => write!(f, "UNKNOWN_ERROR"),
        }
    }
}

/// Application error that serializes to JSON for Tauri IPC
#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    /// Error code matching TypeScript `StorageErrorCode`
    pub code: String,
    /// Human-readable error message
    pub message: String,
    /// Optional additional details
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl AppError {
    /// Create a new error with the given code and message
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            details: None,
        }
    }

    /// Create a new error with additional details
    #[allow(dead_code)]
    pub fn with_details(
        code: ErrorCode,
        message: impl Into<String>,
        details: serde_json::Value,
    ) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            details: Some(details),
        }
    }

    /// Create a "vault not found" error
    pub fn vault_not_found(path: &str) -> Self {
        Self::new(
            ErrorCode::VaultNotFound,
            format!("Vault not found: {}", path),
        )
    }

    /// Create a "vault not open" error
    pub fn vault_not_open(vault_id: &str) -> Self {
        Self::new(
            ErrorCode::VaultNotOpen,
            format!("Vault is not open: {}", vault_id),
        )
    }

    /// Create a "vault already exists" error
    pub fn vault_already_exists(path: &str) -> Self {
        Self::new(
            ErrorCode::VaultAlreadyExists,
            format!("Vault already exists at: {}", path),
        )
    }

    /// Create an "item not found" error
    pub fn item_not_found(item_type: &str, id: &str) -> Self {
        Self::new(
            ErrorCode::ItemNotFound,
            format!("{} not found: {}", item_type, id),
        )
    }

    /// Create a "validation error"
    pub fn validation_error(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::ValidationError, message)
    }

    /// Create a "not implemented" error
    #[allow(dead_code)]
    pub fn not_implemented(feature: &str) -> Self {
        Self::new(
            ErrorCode::NotImplemented,
            format!("{} is not yet implemented", feature),
        )
    }

    /// Create an "auth error"
    pub fn auth_error(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::AuthError, message)
    }

    /// Create an "unknown error"
    #[allow(dead_code)]
    pub fn unknown(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::UnknownError, message)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<VaultError> for AppError {
    fn from(err: VaultError) -> Self {
        match err {
            VaultError::NotFound(path) => Self::vault_not_found(&path),
            VaultError::AlreadyExists(path) => Self::vault_already_exists(&path),
            VaultError::InvalidStructure(msg) => Self::new(
                ErrorCode::VaultNotFound,
                format!("Invalid vault structure: {}", msg),
            ),
            VaultError::InvalidVaultType(t) => {
                Self::validation_error(format!("Invalid vault type: {}", t))
            }
            VaultError::ItemNotFound(id) => Self::item_not_found("Item", &id),
            VaultError::Io(err) => Self::new(ErrorCode::UnknownError, format!("IO error: {}", err)),
            VaultError::Json(err) => {
                Self::validation_error(format!("JSON serialization error: {}", err))
            }
            VaultError::Markdown(err) => {
                Self::validation_error(format!("Markdown parse error: {}", err))
            }
            VaultError::Watcher(err) => Self::new(
                ErrorCode::UnknownError,
                format!("File watcher error: {}", err),
            ),
            VaultError::Locked => {
                Self::new(ErrorCode::VaultLocked, "Vault is locked by another process")
            }
            VaultError::PermissionDenied(msg) => Self::new(ErrorCode::PermissionDenied, msg),
            VaultError::InvalidPath(path) => {
                Self::validation_error(format!("Invalid path: {}", path))
            }
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        match err.kind() {
            std::io::ErrorKind::NotFound => {
                Self::new(ErrorCode::ItemNotFound, format!("File not found: {}", err))
            }
            std::io::ErrorKind::PermissionDenied => Self::new(
                ErrorCode::PermissionDenied,
                format!("Permission denied: {}", err),
            ),
            std::io::ErrorKind::AlreadyExists => Self::new(
                ErrorCode::ItemAlreadyExists,
                format!("Already exists: {}", err),
            ),
            _ => Self::new(ErrorCode::UnknownError, format!("IO error: {}", err)),
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        Self::validation_error(format!("JSON error: {}", err))
    }
}

impl From<serde_yaml::Error> for AppError {
    fn from(err: serde_yaml::Error) -> Self {
        Self::validation_error(format!("YAML error: {}", err))
    }
}

impl From<markdown_parser::ParseError> for AppError {
    fn from(err: markdown_parser::ParseError) -> Self {
        Self::validation_error(format!("Markdown parse error: {}", err))
    }
}

impl From<tauri::Error> for AppError {
    fn from(err: tauri::Error) -> Self {
        Self::new(ErrorCode::UnknownError, format!("Tauri error: {}", err))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_serialization() {
        let err = AppError::vault_not_found("/path/to/vault");
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("VAULT_NOT_FOUND"));
        assert!(json.contains("/path/to/vault"));
    }

    #[test]
    fn test_error_with_details() {
        let details = serde_json::json!({
            "field": "title",
            "reason": "too long"
        });
        let err = AppError::with_details(ErrorCode::ValidationError, "Invalid input", details);
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("VALIDATION_ERROR"));
        assert!(json.contains("title"));
    }

    #[test]
    fn test_error_code_display() {
        assert_eq!(ErrorCode::VaultNotFound.to_string(), "VAULT_NOT_FOUND");
        assert_eq!(ErrorCode::ItemNotFound.to_string(), "ITEM_NOT_FOUND");
        assert_eq!(ErrorCode::NotImplemented.to_string(), "NOT_IMPLEMENTED");
    }
}
