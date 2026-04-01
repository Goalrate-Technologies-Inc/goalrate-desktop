//! Vault management commands for Tauri IPC
//!
//! These commands handle vault lifecycle operations: create, open, close, list, delete.

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::State;
use tauri::{AppHandle, Emitter};

use vault_core::{VaultManager, VaultType};

use crate::error::AppError;
use crate::types::{VaultConfig, VaultCreate, VaultListItem, VaultStats};

// =============================================================================
// Application State
// =============================================================================

/// Vault registry entry stored in vaults.json
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultRegistryEntry {
    id: String,
    name: String,
    path: String,
    vault_type: String,
    created: String,
    last_opened: Option<String>,
    /// User ID if vault is linked to an account (None for local-only vaults)
    #[serde(default)]
    user_id: Option<String>,
    /// Whether this vault syncs with the cloud
    #[serde(default)]
    sync_enabled: bool,
}

/// Cached AI response entry
struct AiCacheEntry {
    response: String,
    created_at: Instant,
}

/// In-memory AI response cache to avoid duplicate API calls during development.
pub struct AiCache {
    entries: HashMap<u64, AiCacheEntry>,
    ttl: Duration,
}

impl AiCache {
    pub fn new() -> Self {
        let ttl_secs: u64 = std::env::var("GOALRATE_AI_CACHE_TTL")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1800); // 30 minutes default
        Self {
            entries: HashMap::new(),
            ttl: Duration::from_secs(ttl_secs),
        }
    }

    /// Look up a cached response by prompt hash. Returns None on miss or expiry.
    pub fn get(&mut self, key: u64) -> Option<String> {
        if self.ttl.is_zero() {
            return None;
        }
        if let Some(entry) = self.entries.get(&key) {
            if entry.created_at.elapsed() < self.ttl {
                return Some(entry.response.clone());
            }
            // Expired — remove it
            self.entries.remove(&key);
        }
        None
    }

    /// Store a response in the cache (capped at 100 entries; evicts expired first, then oldest).
    pub fn put(&mut self, key: u64, response: String) {
        if self.ttl.is_zero() {
            return;
        }

        const MAX_ENTRIES: usize = 100;

        // Evict expired entries first
        if self.entries.len() >= MAX_ENTRIES {
            self.entries
                .retain(|_, entry| entry.created_at.elapsed() < self.ttl);
        }

        // If still at capacity, evict oldest entry
        if self.entries.len() >= MAX_ENTRIES {
            if let Some(&oldest_key) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.created_at)
                .map(|(k, _)| k)
            {
                self.entries.remove(&oldest_key);
            }
        }

        self.entries.insert(
            key,
            AiCacheEntry {
                response,
                created_at: Instant::now(),
            },
        );
    }
}

/// Application state shared across Tauri commands
pub struct AppState {
    /// Map of vault_id -> VaultManager for open vaults
    pub vaults: Mutex<HashMap<String, VaultManager>>,
    /// Map of vault_id -> active filesystem watcher handles
    library_watchers: Mutex<HashMap<String, LibraryWatcherHandle>>,
    /// AI response cache to reduce API token usage during development
    pub ai_cache: Mutex<AiCache>,
}

struct LibraryWatcherHandle {
    stop_tx: Sender<()>,
    thread: Option<JoinHandle<()>>,
}

impl LibraryWatcherHandle {
    fn stop(mut self) {
        let _ = self.stop_tx.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            vaults: Mutex::new(HashMap::new()),
            library_watchers: Mutex::new(HashMap::new()),
            ai_cache: Mutex::new(AiCache::new()),
        }
    }
}

fn should_emit_library_update(event: &Event) -> bool {
    matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    )
}

fn stop_library_watcher(vault_id: &str, state: &AppState) {
    let watcher = {
        let mut watchers = state.library_watchers.lock().unwrap();
        watchers.remove(vault_id)
    };
    if let Some(active) = watcher {
        active.stop();
    }
}

fn start_library_watcher(
    vault_id: &str,
    vault_path: &str,
    app_handle: &AppHandle,
    state: &AppState,
) -> Result<(), AppError> {
    stop_library_watcher(vault_id, state);

    let path = PathBuf::from(vault_path);
    let (event_tx, event_rx) = channel();
    let mut watcher = RecommendedWatcher::new(
        move |result| {
            let _ = event_tx.send(result);
        },
        Config::default(),
    )
    .map_err(|err| {
        AppError::new(
            crate::error::ErrorCode::UnknownError,
            format!("Failed to initialize library watcher: {}", err),
        )
    })?;

    watcher
        .watch(&path, RecursiveMode::Recursive)
        .map_err(|err| {
            AppError::new(
                crate::error::ErrorCode::UnknownError,
                format!(
                    "Failed to watch vault path '{}': {}",
                    path.to_string_lossy(),
                    err
                ),
            )
        })?;

    let (stop_tx, stop_rx) = channel();
    let app = app_handle.clone();
    let watcher_vault_id = vault_id.to_string();
    let thread = std::thread::spawn(move || {
        let _watcher = watcher;
        let mut last_emit: Option<Instant> = None;
        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }

            match event_rx.recv_timeout(Duration::from_millis(300)) {
                Ok(Ok(event)) => {
                    if !should_emit_library_update(&event) {
                        continue;
                    }
                    if let Some(last) = last_emit {
                        if last.elapsed() < Duration::from_millis(150) {
                            continue;
                        }
                    }
                    last_emit = Some(Instant::now());
                    let _ = app.emit(
                        "vault-library-updated",
                        serde_json::json!({ "vaultId": watcher_vault_id }),
                    );
                }
                Ok(Err(err)) => {
                    log::warn!(
                        "Library watcher emitted an error for vault '{}': {}",
                        watcher_vault_id,
                        err
                    );
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    let mut watchers = state.library_watchers.lock().unwrap();
    watchers.insert(
        vault_id.to_string(),
        LibraryWatcherHandle {
            stop_tx,
            thread: Some(thread),
        },
    );
    Ok(())
}

// =============================================================================
// Registry Persistence
// =============================================================================

/// Get the path to the vault registry file
fn get_registry_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("goalrate")
        .join("vaults.json")
}

/// Load vault registry from disk
fn load_registry() -> Vec<VaultRegistryEntry> {
    let path = get_registry_path();
    if !path.exists() {
        return vec![];
    }

    std::fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

/// Save vault registry to disk
fn save_registry(entries: &[VaultRegistryEntry]) -> Result<(), AppError> {
    let path = get_registry_path();

    // Ensure directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let content = serde_json::to_string_pretty(entries)?;
    std::fs::write(&path, content)?;
    Ok(())
}

/// Add or update a vault in the registry
fn upsert_registry_entry(entry: VaultRegistryEntry) -> Result<(), AppError> {
    let mut entries = load_registry();

    if let Some(existing) = entries.iter_mut().find(|e| e.id == entry.id) {
        *existing = entry;
    } else {
        entries.push(entry);
    }

    save_registry(&entries)
}

/// Remove a vault from the registry
fn remove_registry_entry(vault_id: &str) -> Result<(), AppError> {
    let mut entries = load_registry();
    entries.retain(|e| e.id != vault_id);
    save_registry(&entries)
}

fn resolve_vault_name(path: &PathBuf) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Vault")
        .to_string()
}

fn relocate_vault(
    vault_id: &str,
    new_path: &str,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<VaultConfig, AppError> {
    if new_path.trim().is_empty() {
        return Err(AppError::validation_error("New vault path is required"));
    }

    let mut entries = load_registry();
    let current_path = {
        let entry = entries
            .iter()
            .find(|e| e.id == vault_id)
            .ok_or_else(|| AppError::item_not_found("Vault", vault_id))?;
        PathBuf::from(&entry.path)
    };
    let next_path = PathBuf::from(new_path);

    if current_path == next_path {
        let manager = VaultManager::open(&current_path)?;
        return Ok(VaultConfig::from(manager.config()));
    }

    if !current_path.exists() {
        return Err(AppError::vault_not_found(&current_path.to_string_lossy()));
    }

    std::fs::rename(&current_path, &next_path)?;

    let mut manager = VaultManager::open(&next_path)?;
    let new_name = resolve_vault_name(&next_path);
    {
        let config = manager.config_mut();
        config.name = new_name.clone();
        config.path = next_path.to_string_lossy().to_string();
    }
    manager.save_config()?;

    let updated_path = {
        let entry = entries
            .iter_mut()
            .find(|e| e.id == vault_id)
            .ok_or_else(|| AppError::item_not_found("Vault", vault_id))?;
        entry.name = new_name;
        entry.path = next_path.to_string_lossy().to_string();
        entry.last_opened = manager.config().last_opened.map(|dt| dt.to_rfc3339());
        entry.path.clone()
    };

    save_registry(&entries)?;

    {
        let mut vaults = state.vaults.lock().unwrap();
        vaults.insert(vault_id.to_string(), manager);
    }
    start_library_watcher(vault_id, &updated_path, &app, state.inner())?;

    Ok(VaultConfig::from(
        state
            .vaults
            .lock()
            .unwrap()
            .get(vault_id)
            .ok_or_else(|| AppError::vault_not_open(vault_id))?
            .config(),
    ))
}

// =============================================================================
// Tauri Commands
// =============================================================================

/// Simple greeting command to test Tauri IPC
#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Welcome, {}.", name)
}

/// List all known vaults from the registry
#[tauri::command]
pub async fn list_vaults() -> Result<Vec<VaultListItem>, AppError> {
    log::info!("Listing vaults");

    let entries = load_registry();
    let items: Vec<VaultListItem> = entries
        .into_iter()
        .map(|e| VaultListItem {
            id: e.id,
            name: e.name,
            path: e.path,
            vault_type: e.vault_type,
            last_opened: e.last_opened,
        })
        .collect();

    Ok(items)
}

/// Create a new vault at the specified path
#[tauri::command]
pub async fn create_vault(
    data: VaultCreate,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<VaultConfig, AppError> {
    let resolved_path = data.resolve_path();
    log::info!("Creating vault '{}' at '{}'", data.name, resolved_path);

    // Parse vault type
    let vault_type: VaultType = data.vault_type.parse().unwrap_or(VaultType::Private);

    // Create the vault using vault-core
    let manager = VaultManager::create(&data.name, &resolved_path, vault_type)?;
    let (vault_config, entry, vault_id, watch_path) = {
        let config = manager.config();
        (
            VaultConfig::from(config),
            VaultRegistryEntry {
                id: config.id.clone(),
                name: config.name.clone(),
                path: config.path.clone(),
                vault_type: config.vault_type.to_string(),
                created: config.created.to_rfc3339(),
                last_opened: config.last_opened.map(|dt| dt.to_rfc3339()),
                user_id: None,
                sync_enabled: false,
            },
            config.id.clone(),
            config.path.clone(),
        )
    };
    upsert_registry_entry(entry)?;

    // Store the open vault
    {
        let mut vaults = state.vaults.lock().unwrap();
        vaults.insert(vault_id.clone(), manager);
    }
    start_library_watcher(&vault_id, &watch_path, &app, state.inner())?;

    Ok(vault_config)
}

/// Open an existing vault at the specified path
#[tauri::command]
pub async fn open_vault(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<VaultConfig, AppError> {
    log::info!("Opening vault at '{}'", path);

    let vault_path = PathBuf::from(&path);
    let config_path = vault_path.join(".vault.json");
    let manager = if config_path.exists() {
        VaultManager::open(&path)?
    } else {
        let name = vault_path
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("Vault")
            .to_string();
        VaultManager::create(name, &path, VaultType::Private)?
    };
    let existing_entries = load_registry();
    let (vault_config, entry, vault_id, watch_path) = {
        let config = manager.config();
        let existing = existing_entries.iter().find(|e| e.id == config.id);
        (
            VaultConfig::from(config),
            VaultRegistryEntry {
                id: config.id.clone(),
                name: config.name.clone(),
                path: config.path.clone(),
                vault_type: config.vault_type.to_string(),
                created: config.created.to_rfc3339(),
                last_opened: config.last_opened.map(|dt| dt.to_rfc3339()),
                user_id: existing.and_then(|e| e.user_id.clone()),
                sync_enabled: existing.map(|e| e.sync_enabled).unwrap_or(false),
            },
            config.id.clone(),
            config.path.clone(),
        )
    };
    upsert_registry_entry(entry)?;

    // Store the open vault
    {
        let mut vaults = state.vaults.lock().unwrap();
        vaults.insert(vault_id.clone(), manager);
    }
    start_library_watcher(&vault_id, &watch_path, &app, state.inner())?;

    Ok(vault_config)
}

/// Close an open vault
#[tauri::command]
pub async fn close_vault(vault_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    log::info!("Closing vault '{}'", vault_id);

    let mut vaults = state.vaults.lock().unwrap();
    let removed = vaults.remove(&vault_id);
    drop(vaults);

    if removed.is_none() {
        return Err(AppError::vault_not_open(&vault_id));
    }

    stop_library_watcher(&vault_id, state.inner());

    Ok(())
}

/// Delete a vault from the registry (does not delete files)
#[tauri::command]
pub async fn delete_vault(vault_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    log::info!("Deleting vault '{}' from registry", vault_id);

    // Close if open
    let mut vaults = state.vaults.lock().unwrap();
    vaults.remove(&vault_id);
    drop(vaults);
    stop_library_watcher(&vault_id, state.inner());

    // Remove from registry
    remove_registry_entry(&vault_id)?;

    Ok(())
}

/// Reveal the vault root in the OS file manager
#[tauri::command]
pub async fn reveal_vault(vault_id: String) -> Result<(), AppError> {
    let entries = load_registry();
    let entry = entries
        .iter()
        .find(|e| e.id == vault_id)
        .ok_or_else(|| AppError::item_not_found("Vault", &vault_id))?;

    open::that(&entry.path).map_err(|err| {
        AppError::new(
            crate::error::ErrorCode::UnknownError,
            format!("Failed to reveal vault: {}", err),
        )
    })?;

    Ok(())
}

/// Rename a vault and update its path
#[tauri::command]
pub async fn rename_vault(
    vault_id: String,
    new_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<VaultConfig, AppError> {
    relocate_vault(&vault_id, &new_path, app, state)
}

/// Move a vault to a new location
#[tauri::command]
pub async fn move_vault(
    vault_id: String,
    new_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<VaultConfig, AppError> {
    relocate_vault(&vault_id, &new_path, app, state)
}

/// Get statistics for an open vault
#[tauri::command]
pub async fn get_vault_stats(
    vault_id: String,
    state: State<'_, AppState>,
) -> Result<VaultStats, AppError> {
    log::info!("Getting stats for vault '{}'", vault_id);

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    // Count objectives (OKRs)
    let okr_ids = manager.list_goals().unwrap_or_default();
    let okr_count = okr_ids.len();

    // Count projects
    let project_ids = manager.list_projects().unwrap_or_default();
    let project_count = project_ids.len();

    // Count tasks (would need to iterate through OKRs)
    // For now, return 0 - can be enhanced later
    let total_tasks = 0;
    let completed_tasks = 0;

    Ok(VaultStats {
        okr_count,
        goal_count: okr_count, // backward compatibility
        project_count,
        total_tasks,
        completed_tasks,
    })
}

/// Link a vault to a user account
#[tauri::command]
pub async fn link_vault_to_user(vault_id: String, user_id: String) -> Result<(), AppError> {
    log::info!("Linking vault '{}' to user '{}'", vault_id, user_id);

    let mut entries = load_registry();
    let entry = entries
        .iter_mut()
        .find(|e| e.id == vault_id)
        .ok_or_else(|| AppError::item_not_found("Vault", &vault_id))?;

    entry.user_id = Some(user_id);
    save_registry(&entries)?;

    Ok(())
}

/// Unlink a vault from a user account (keeps data local)
#[tauri::command]
pub async fn unlink_vault_from_user(vault_id: String) -> Result<(), AppError> {
    log::info!("Unlinking vault '{}' from user", vault_id);

    let mut entries = load_registry();
    let entry = entries
        .iter_mut()
        .find(|e| e.id == vault_id)
        .ok_or_else(|| AppError::item_not_found("Vault", &vault_id))?;

    entry.user_id = None;
    entry.sync_enabled = false;
    save_registry(&entries)?;

    Ok(())
}

/// Get vaults linked to a specific user
#[tauri::command]
pub async fn get_user_vaults(user_id: String) -> Result<Vec<VaultListItem>, AppError> {
    log::info!("Getting vaults for user '{}'", user_id);

    let entries = load_registry();
    let items: Vec<VaultListItem> = entries
        .into_iter()
        .filter(|e| e.user_id.as_ref() == Some(&user_id))
        .map(|e| VaultListItem {
            id: e.id,
            name: e.name,
            path: e.path,
            vault_type: e.vault_type,
            last_opened: e.last_opened,
        })
        .collect();

    Ok(items)
}

/// Enable or disable sync for a vault
#[tauri::command]
pub async fn set_vault_sync(vault_id: String, enabled: bool) -> Result<(), AppError> {
    log::info!("Setting sync for vault '{}' to {}", vault_id, enabled);

    let mut entries = load_registry();
    let entry = entries
        .iter_mut()
        .find(|e| e.id == vault_id)
        .ok_or_else(|| AppError::item_not_found("Vault", &vault_id))?;

    // Can only enable sync if vault is linked to a user
    if enabled && entry.user_id.is_none() {
        return Err(AppError::validation_error(
            "Cannot enable sync for a vault not linked to a user account",
        ));
    }

    entry.sync_enabled = enabled;
    save_registry(&entries)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_and_open_vault_payload() {
        let vault_path = std::env::temp_dir().join("goalrate-test-vault");

        // Create vault
        let create_data = VaultCreate {
            name: "Test Vault".to_string(),
            path: Some(vault_path.to_string_lossy().to_string()),
            vault_type: "private".to_string(),
        };

        assert_eq!(create_data.name, "Test Vault");
        assert_eq!(create_data.vault_type, "private");
        assert!(create_data
            .path
            .as_deref()
            .unwrap()
            .contains("goalrate-test-vault"));
    }
}
