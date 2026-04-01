//! Authentication commands for Tauri IPC
//!
//! These commands handle secure token storage and retrieval using the OS keychain.
//! - macOS: Keychain Services
//! - Windows: Credential Manager
//! - Linux: Secret Service (libsecret)

use keyring::Entry;
use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Service name for keychain entries
const KEYCHAIN_SERVICE: &str = "com.goalrate.desktop";
/// Account name for auth tokens entry
const KEYCHAIN_ACCOUNT: &str = "auth_tokens";

// =============================================================================
// Types
// =============================================================================

/// Stored authentication tokens
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub user_id: String,
    pub expires_at: i64, // Unix timestamp in milliseconds
}

/// User data stored alongside tokens
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredUser {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub username: Option<String>,
    pub avatar_url: Option<String>,
}

/// Combined auth data stored in keychain
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthData {
    tokens: StoredTokens,
    user: Option<StoredUser>,
}

// =============================================================================
// Keychain Helpers
// =============================================================================

/// Get the keyring entry for auth tokens
fn get_keyring_entry() -> Result<Entry, AppError> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| {
        log::error!("Failed to create keyring entry: {}", e);
        AppError::auth_error(format!("Failed to access keychain: {}", e))
    })
}

// =============================================================================
// Tauri Commands
// =============================================================================

/// Store authentication tokens securely in the OS keychain
#[tauri::command]
pub async fn store_tokens(
    access_token: String,
    refresh_token: String,
    user_id: String,
    expires_at: i64,
    user: Option<StoredUser>,
) -> Result<(), AppError> {
    log::info!("Storing auth tokens for user: {}", user_id);

    let auth_data = AuthData {
        tokens: StoredTokens {
            access_token,
            refresh_token,
            user_id,
            expires_at,
        },
        user,
    };

    let json = serde_json::to_string(&auth_data)?;
    let entry = get_keyring_entry()?;

    entry.set_password(&json).map_err(|e| {
        log::error!("Failed to store tokens in keychain: {}", e);
        AppError::auth_error(format!("Failed to store tokens: {}", e))
    })?;

    log::info!("Auth tokens stored successfully");
    Ok(())
}

/// Retrieve stored tokens from the OS keychain
#[tauri::command]
pub async fn get_tokens() -> Result<Option<StoredTokens>, AppError> {
    log::debug!("Retrieving auth tokens");

    let entry = get_keyring_entry()?;

    match entry.get_password() {
        Ok(json) => {
            let auth_data: AuthData = serde_json::from_str(&json)?;

            // Check if tokens are expired
            let now = chrono::Utc::now().timestamp_millis();
            if auth_data.tokens.expires_at <= now {
                log::info!("Stored tokens have expired");
                // Don't clear - let the frontend handle refresh
                return Ok(Some(auth_data.tokens));
            }

            log::debug!("Auth tokens retrieved successfully");
            Ok(Some(auth_data.tokens))
        }
        Err(keyring::Error::NoEntry) => {
            log::debug!("No auth tokens found in keychain");
            Ok(None)
        }
        Err(e) => {
            log::error!("Failed to retrieve tokens from keychain: {}", e);
            Err(AppError::auth_error(format!(
                "Failed to retrieve tokens: {}",
                e
            )))
        }
    }
}

/// Retrieve stored user data from the OS keychain
#[tauri::command]
pub async fn get_stored_user() -> Result<Option<StoredUser>, AppError> {
    log::debug!("Retrieving stored user");

    let entry = get_keyring_entry()?;

    match entry.get_password() {
        Ok(json) => {
            let auth_data: AuthData = serde_json::from_str(&json)?;
            Ok(auth_data.user)
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::auth_error(format!(
            "Failed to retrieve user: {}",
            e
        ))),
    }
}

/// Read the current user id from the OS keychain (if present).
pub fn read_user_id_from_keychain() -> Result<Option<String>, AppError> {
    let entry = get_keyring_entry()?;

    match entry.get_password() {
        Ok(json) => {
            let auth_data: AuthData = serde_json::from_str(&json)?;
            Ok(Some(auth_data.tokens.user_id))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::auth_error(format!(
            "Failed to retrieve user id: {}",
            e
        ))),
    }
}

/// Clear all authentication tokens from the OS keychain
#[tauri::command]
pub async fn clear_tokens() -> Result<(), AppError> {
    log::info!("Clearing auth tokens");

    let entry = get_keyring_entry()?;

    match entry.delete_credential() {
        Ok(()) => {
            log::info!("Auth tokens cleared successfully");
            Ok(())
        }
        Err(keyring::Error::NoEntry) => {
            log::debug!("No auth tokens to clear");
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to clear tokens from keychain: {}", e);
            Err(AppError::auth_error(format!(
                "Failed to clear tokens: {}",
                e
            )))
        }
    }
}

/// Check if valid (non-expired) tokens exist in the keychain
#[tauri::command]
pub async fn has_valid_tokens() -> Result<bool, AppError> {
    log::debug!("Checking for valid auth tokens");

    let entry = get_keyring_entry()?;

    match entry.get_password() {
        Ok(json) => {
            let auth_data: AuthData = serde_json::from_str(&json)?;
            let now = chrono::Utc::now().timestamp_millis();

            // Consider tokens valid if they have at least 5 minutes left
            let valid = auth_data.tokens.expires_at > now + (5 * 60 * 1000);
            log::debug!("Tokens valid: {}", valid);
            Ok(valid)
        }
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(AppError::auth_error(format!(
            "Failed to check tokens: {}",
            e
        ))),
    }
}

/// Get the current user ID from stored tokens (without full token retrieval)
#[tauri::command]
pub async fn get_current_user_id() -> Result<Option<String>, AppError> {
    log::debug!("Getting current user ID");

    let entry = get_keyring_entry()?;

    match entry.get_password() {
        Ok(json) => {
            let auth_data: AuthData = serde_json::from_str(&json)?;
            Ok(Some(auth_data.tokens.user_id))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::auth_error(format!(
            "Failed to get user ID: {}",
            e
        ))),
    }
}

/// Update stored tokens (for token refresh)
#[tauri::command]
pub async fn update_tokens(
    access_token: String,
    refresh_token: String,
    expires_at: i64,
) -> Result<(), AppError> {
    log::info!("Updating auth tokens");

    let entry = get_keyring_entry()?;

    // Get existing auth data to preserve user info
    let existing_json = entry.get_password().map_err(|e| {
        log::error!("Failed to get existing tokens for update: {}", e);
        AppError::auth_error("No existing tokens to update")
    })?;

    let mut auth_data: AuthData = serde_json::from_str(&existing_json)?;

    // Update tokens
    auth_data.tokens.access_token = access_token;
    auth_data.tokens.refresh_token = refresh_token;
    auth_data.tokens.expires_at = expires_at;

    // Save updated data
    let json = serde_json::to_string(&auth_data)?;
    entry.set_password(&json).map_err(|e| {
        log::error!("Failed to update tokens in keychain: {}", e);
        AppError::auth_error(format!("Failed to update tokens: {}", e))
    })?;

    log::info!("Auth tokens updated successfully");
    Ok(())
}

#[cfg(test)]
mod tests {
    // Note: Keychain tests require actual OS keychain access
    // They are skipped in CI environments

    #[test]
    fn test_auth_data_serialization() {
        use super::*;

        let auth_data = AuthData {
            tokens: StoredTokens {
                access_token: "test_access".to_string(),
                refresh_token: "test_refresh".to_string(),
                user_id: "user123".to_string(),
                expires_at: 1234567890000,
            },
            user: Some(StoredUser {
                id: "user123".to_string(),
                email: "test@example.com".to_string(),
                display_name: "Test User".to_string(),
                username: Some("testuser".to_string()),
                avatar_url: None,
            }),
        };

        let json = serde_json::to_string(&auth_data).unwrap();
        let parsed: AuthData = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.tokens.user_id, "user123");
        assert_eq!(parsed.user.unwrap().email, "test@example.com");
    }
}
