//! Integration commands for AI model providers (OpenAI + Anthropic only).

use keyring::Entry;

use crate::commands::auth::read_user_id_from_keychain;
use crate::error::AppError;

const INTEGRATION_KEYCHAIN_SERVICE: &str = "com.goalrate.desktop.integrations";
const OPENAI_KEYCHAIN_ACCOUNT: &str = "openai_api_key";
const ANTHROPIC_KEYCHAIN_ACCOUNT: &str = "anthropic_api_key";
const INTEGRATION_DEVICE_SCOPE: &str = "device";

/// Resilient wrapper around `read_user_id_from_keychain` that never errors.
/// If the auth keychain is missing, corrupt, or inaccessible, returns `None`
/// so that API key operations still work using device-scoped entries.
fn try_read_user_id() -> Option<String> {
    match read_user_id_from_keychain() {
        Ok(id) => id,
        Err(e) => {
            log::debug!(
                "No user id available for key scoping (this is normal if not logged in): {}",
                e
            );
            None
        }
    }
}

fn openai_keychain_account(user_id: Option<&str>) -> String {
    let scope = user_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(INTEGRATION_DEVICE_SCOPE);
    format!("{OPENAI_KEYCHAIN_ACCOUNT}::{scope}")
}

fn anthropic_keychain_account(user_id: Option<&str>) -> String {
    let scope = user_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(INTEGRATION_DEVICE_SCOPE);
    format!("{ANTHROPIC_KEYCHAIN_ACCOUNT}::{scope}")
}

fn openai_keyring_entry(user_id: Option<&str>) -> Result<Entry, AppError> {
    let account = openai_keychain_account(user_id);
    Entry::new(INTEGRATION_KEYCHAIN_SERVICE, &account).map_err(|err| {
        AppError::auth_error(format!(
            "Failed to access secure storage for OpenAI key: {}",
            err
        ))
    })
}

fn anthropic_keyring_entry(user_id: Option<&str>) -> Result<Entry, AppError> {
    let account = anthropic_keychain_account(user_id);
    Entry::new(INTEGRATION_KEYCHAIN_SERVICE, &account).map_err(|err| {
        AppError::auth_error(format!(
            "Failed to access secure storage for Anthropic key: {}",
            err
        ))
    })
}

fn read_trimmed_secret(entry: &Entry) -> Result<Option<String>, AppError> {
    match entry.get_password() {
        Ok(secret) => {
            let trimmed = secret.trim();
            if trimmed.is_empty() {
                log::debug!("[API-KEY] read_trimmed_secret: got empty secret");
                Ok(None)
            } else {
                log::debug!(
                    "[API-KEY] read_trimmed_secret: got secret, len={}",
                    trimmed.len()
                );
                Ok(Some(trimmed.to_string()))
            }
        }
        Err(keyring::Error::NoEntry) => {
            log::debug!("[API-KEY] read_trimmed_secret: NoEntry");
            Ok(None)
        }
        Err(keyring::Error::NoStorageAccess(_)) => {
            log::warn!(
                "[API-KEY] read_trimmed_secret: NoStorageAccess (keychain locked or unsigned app?)"
            );
            Ok(None)
        }
        Err(err) => {
            log::warn!("[API-KEY] read_trimmed_secret: error: {} ({:?})", err, err);
            // In dev mode, keychain errors are common (unsigned binary).
            // Treat as "not found" instead of hard error so the app stays functional.
            Ok(None)
        }
    }
}

// Previous versions stored keys in ~/.goalrate/api-keys/<provider> as plaintext
// fallback. These helpers clean up those files during store/delete operations.

fn api_key_file_path(provider: &str) -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|home| home.join(".goalrate").join("api-keys").join(provider))
}

fn delete_api_key_file(provider: &str) {
    if let Some(path) = api_key_file_path(provider) {
        if path.exists() {
            let _ = std::fs::remove_file(&path);
            log::info!(
                "[API-KEY] Cleaned up legacy plaintext key file for {}",
                provider
            );
        }
    }
}

pub(crate) fn read_openai_api_key_from_keychain() -> Result<Option<String>, AppError> {
    let user_id = try_read_user_id();

    if let Some(user_id) = user_id.as_deref() {
        let user_entry = openai_keyring_entry(Some(user_id))?;
        if let Some(secret) = read_trimmed_secret(&user_entry)? {
            return Ok(Some(secret));
        }
    }

    let device_entry = openai_keyring_entry(None)?;
    read_trimmed_secret(&device_entry)
}

pub(crate) fn read_anthropic_api_key_from_keychain() -> Result<Option<String>, AppError> {
    let user_id = try_read_user_id();

    if let Some(user_id) = user_id.as_deref() {
        let user_entry = anthropic_keyring_entry(Some(user_id))?;
        if let Some(secret) = read_trimmed_secret(&user_entry)? {
            return Ok(Some(secret));
        }
    }

    let device_entry = anthropic_keyring_entry(None)?;
    read_trimmed_secret(&device_entry)
}

fn store_openai_api_key_in_keychain(api_key: &str) -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![openai_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(openai_keyring_entry(Some(user_id))?);
    }
    for entry in &entries {
        entry.set_password(api_key).map_err(|err| {
            AppError::auth_error(format!(
                "Failed to store OpenAI key in secure storage: {}",
                err
            ))
        })?;
    }
    delete_api_key_file("openai");
    Ok(())
}

fn store_anthropic_api_key_in_keychain(api_key: &str) -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![anthropic_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(anthropic_keyring_entry(Some(user_id))?);
    }
    for entry in &entries {
        entry.set_password(api_key).map_err(|err| {
            AppError::auth_error(format!(
                "Failed to store Anthropic key in secure storage: {}",
                err
            ))
        })?;
    }
    delete_api_key_file("anthropic");
    Ok(())
}

fn delete_openai_api_key_from_keychain() -> Result<(), AppError> {
    delete_api_key_file("openai");

    // Also remove legacy keychain entries so reads do not fall back to old entries.
    let user_id = try_read_user_id();
    if let Ok(entry) = openai_keyring_entry(None) {
        if let Err(e) = entry.delete_credential() {
            log::warn!("Failed to delete legacy keychain entry (anonymous): {e}");
        }
    }
    if let Some(uid) = user_id.as_deref() {
        if let Ok(entry) = openai_keyring_entry(Some(uid)) {
            if let Err(e) = entry.delete_credential() {
                log::warn!("Failed to delete legacy keychain entry (user {uid}): {e}");
            }
        }
    }

    Ok(())
}

fn delete_anthropic_api_key_from_keychain() -> Result<(), AppError> {
    delete_api_key_file("anthropic");

    // Also remove legacy keychain entries so reads do not fall back to old entries.
    let user_id = try_read_user_id();
    if let Ok(entry) = anthropic_keyring_entry(None) {
        let _ = entry.delete_credential();
    }
    if let Some(uid) = user_id.as_deref() {
        if let Ok(entry) = anthropic_keyring_entry(Some(uid)) {
            let _ = entry.delete_credential();
        }
    }

    Ok(())
}

/// Check which API keys are stored in the keychain.
/// Returns a JSON object with provider names mapped to booleans.
/// Individual provider errors are logged and treated as "not configured".
#[tauri::command]
pub async fn check_api_keys() -> Result<std::collections::HashMap<String, bool>, AppError> {
    let mut keys = std::collections::HashMap::new();
    keys.insert(
        "anthropic".to_string(),
        read_anthropic_api_key_from_keychain()
            .ok()
            .flatten()
            .is_some(),
    );
    keys.insert(
        "openai".to_string(),
        read_openai_api_key_from_keychain().ok().flatten().is_some(),
    );
    Ok(keys)
}

#[tauri::command]
pub async fn set_openai_api_key(api_key: String) -> Result<(), AppError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation_error(
            "Please enter your OpenAI API key",
        ));
    }
    store_openai_api_key_in_keychain(trimmed)
}

#[tauri::command]
pub async fn clear_openai_api_key() -> Result<(), AppError> {
    delete_openai_api_key_from_keychain()
}

#[tauri::command]
pub async fn set_anthropic_api_key(api_key: String) -> Result<(), AppError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation_error(
            "Please enter your Anthropic API key",
        ));
    }
    store_anthropic_api_key_in_keychain(trimmed)
}

#[tauri::command]
pub async fn clear_anthropic_api_key() -> Result<(), AppError> {
    delete_anthropic_api_key_from_keychain()
}
