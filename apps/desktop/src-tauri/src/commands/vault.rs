//! Vault management commands for Tauri IPC
//!
//! These commands handle vault lifecycle operations: create, open, close, list, delete.

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::State;
use tauri::{AppHandle, Emitter};

use vault_core::{
    SnapshotHistoryEntry, SnapshotPreview, SnapshotRestoreResult, VaultErrorLogEntry, VaultManager,
    VaultType,
};

use crate::error::AppError;
use crate::types::{VaultConfig, VaultCreate, VaultListItem, VaultStats};

const MAX_PENDING_LIBRARY_UPDATE_PATHS: usize = 256;

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

/// Optional in-memory AI response cache for explicit development use.
///
/// Disabled by default so AI context remains file-backed/transient instead of
/// accumulating provider responses in app RAM.
pub struct AiCache {
    entries: HashMap<u64, AiCacheEntry>,
    ttl: Duration,
}

impl AiCache {
    pub fn new() -> Self {
        let ttl_secs: u64 = std::env::var("GOALRATE_AI_CACHE_TTL")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
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

    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

/// Application state shared across Tauri commands
pub struct AppState {
    /// Map of vault_id -> VaultManager for open vaults
    pub vaults: Mutex<HashMap<String, VaultManager>>,
    /// Map of vault_id -> active filesystem watcher handles
    library_watchers: Mutex<HashMap<String, LibraryWatcherHandle>>,
    /// Optional AI response cache, disabled unless GOALRATE_AI_CACHE_TTL is set
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

fn vault_relative_event_path(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    if relative.as_os_str().is_empty() {
        return None;
    }

    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().to_string()),
            _ => return None,
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

fn is_ignored_library_update_path(path: &str) -> bool {
    path == ".goalrate"
        || path.starts_with(".goalrate/")
        || path == ".git"
        || path.starts_with(".git/")
}

fn vault_relative_event_paths(root: &Path, event: &Event) -> Vec<String> {
    let mut paths = Vec::new();
    for path in &event.paths {
        if let Some(relative_path) = vault_relative_event_path(root, path) {
            if is_ignored_library_update_path(&relative_path) {
                continue;
            }
            if !paths.contains(&relative_path) {
                paths.push(relative_path);
            }
        }
    }
    paths
}

fn should_emit_library_update(root: &Path, event: &Event) -> bool {
    matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    ) && !vault_relative_event_paths(root, event).is_empty()
}

struct LibraryUpdateDebounce {
    debounce: Duration,
    pending_since: Option<Instant>,
    pending_paths: Vec<String>,
    broad_refresh_pending: bool,
}

impl LibraryUpdateDebounce {
    fn new(debounce: Duration) -> Self {
        Self {
            debounce,
            pending_since: None,
            pending_paths: Vec::new(),
            broad_refresh_pending: false,
        }
    }

    fn record_event(&mut self, paths: Vec<String>, now: Instant) {
        if self.pending_since.is_none() {
            self.pending_since = Some(now);
        }

        if paths.is_empty() {
            self.broad_refresh_pending = true;
            self.pending_paths.clear();
            return;
        }

        if self.broad_refresh_pending {
            return;
        }

        for path in paths {
            if !self.pending_paths.contains(&path) {
                if self.pending_paths.len() >= MAX_PENDING_LIBRARY_UPDATE_PATHS {
                    self.broad_refresh_pending = true;
                    self.pending_paths.clear();
                    return;
                }
                self.pending_paths.push(path);
            }
        }
    }

    fn timeout(&self, now: Instant) -> Duration {
        match self.pending_since {
            Some(since) => self.debounce.saturating_sub(now.duration_since(since)),
            None => Duration::from_millis(300),
        }
    }

    fn take_due_paths(&mut self, now: Instant) -> Option<Vec<String>> {
        let since = self.pending_since?;
        if now.duration_since(since) < self.debounce {
            return None;
        }

        self.pending_since = None;
        if self.broad_refresh_pending {
            self.broad_refresh_pending = false;
            self.pending_paths.clear();
            return Some(Vec::new());
        }

        Some(std::mem::take(&mut self.pending_paths))
    }
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
    let watcher_root = path.clone();
    let thread = std::thread::spawn(move || {
        let _watcher = watcher;
        let mut debounce = LibraryUpdateDebounce::new(Duration::from_millis(150));
        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }

            if let Some(paths) = debounce.take_due_paths(Instant::now()) {
                let _ = app.emit(
                    "vault-library-updated",
                    serde_json::json!({
                        "vaultId": watcher_vault_id,
                        "paths": paths,
                    }),
                );
                continue;
            }

            match event_rx.recv_timeout(debounce.timeout(Instant::now())) {
                Ok(Ok(event)) => {
                    if !should_emit_library_update(&watcher_root, &event) {
                        continue;
                    }
                    let paths = vault_relative_event_paths(&watcher_root, &event);
                    debounce.record_event(paths, Instant::now());
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

fn resolve_vault_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Vault")
        .to_string()
}

fn resolve_vault_issue_path(root: &Path, path: &str) -> Result<PathBuf, AppError> {
    let relative = Path::new(path);
    if relative.is_absolute() {
        return Err(AppError::validation_error(
            "Vault issue path must be vault-relative",
        ));
    }

    let mut clean = PathBuf::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                return Err(AppError::validation_error(
                    "Vault issue path must stay inside the vault",
                ));
            }
        }
    }

    if clean.as_os_str().is_empty() {
        return Err(AppError::validation_error(
            "Vault issue path cannot be empty",
        ));
    }
    if clean.extension().and_then(|value| value.to_str()) != Some("md") {
        return Err(AppError::validation_error(
            "Vault issue path must point to a markdown file",
        ));
    }

    let resolved = root.join(clean);
    if !resolved.starts_with(root) {
        return Err(AppError::validation_error(
            "Vault issue path must stay inside the vault",
        ));
    }
    Ok(resolved)
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
    crate::commands::daily_loop::release_daily_loop_state(vault_id, state.inner())?;
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
    crate::commands::daily_loop::release_daily_loop_state(&vault_id, state.inner())?;

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
    crate::commands::daily_loop::release_daily_loop_state(&vault_id, state.inner())?;

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

    // Desktop MVP does not expose standalone Projects; keep the legacy stats
    // field stable for callers while reporting the project surface as inert.
    let project_count = 0;

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

/// Restore the latest logged markdown snapshot for an open vault.
#[tauri::command]
pub async fn restore_latest_vault_snapshot(
    vault_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<SnapshotRestoreResult>, AppError> {
    log::info!("Restoring latest snapshot for vault '{}'", vault_id);

    let result = {
        let vaults = state.vaults.lock().unwrap();
        let manager = vaults
            .get(&vault_id)
            .ok_or_else(|| AppError::vault_not_open(&vault_id))?;
        manager.restore_latest_snapshot("user")?
    };

    if result.is_some() {
        let _ = app.emit(
            "vault-library-updated",
            serde_json::json!({ "vaultId": vault_id }),
        );
    }

    Ok(result)
}

/// List restorable markdown snapshots for an open vault.
#[tauri::command]
pub async fn list_vault_snapshots(
    vault_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<SnapshotHistoryEntry>, AppError> {
    log::info!("Listing snapshots for vault '{}'", vault_id);

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    Ok(manager.list_snapshot_history()?)
}

/// List recent parse and validation issues from `logs/errors.md` for an open vault.
#[tauri::command]
pub async fn list_vault_error_log_entries(
    vault_id: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<VaultErrorLogEntry>, AppError> {
    log::info!("Listing error log entries for vault '{}'", vault_id);

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    Ok(manager.list_error_log_entries(limit.unwrap_or(5))?)
}

/// Open the current vault's user-readable error log.
#[tauri::command]
pub async fn open_vault_error_log(
    vault_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    log::info!("Opening error log for vault '{}'", vault_id);

    let error_log_path = {
        let vaults = state.vaults.lock().unwrap();
        let manager = vaults
            .get(&vault_id)
            .ok_or_else(|| AppError::vault_not_open(&vault_id))?;
        manager.ensure_v1_markdown_structure()?;
        manager.structure().error_log.clone()
    };

    open::that(&error_log_path)
        .map_err(|err| AppError::unknown(format!("Failed to open logs/errors.md: {err}")))?;

    Ok(())
}

/// Open a markdown file referenced by `logs/errors.md`.
#[tauri::command]
pub async fn open_vault_issue_file(
    vault_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    log::info!("Opening issue file '{}' for vault '{}'", path, vault_id);

    let issue_path = {
        let vaults = state.vaults.lock().unwrap();
        let manager = vaults
            .get(&vault_id)
            .ok_or_else(|| AppError::vault_not_open(&vault_id))?;
        resolve_vault_issue_path(&manager.structure().root, &path)?
    };

    if !issue_path.is_file() {
        return Err(AppError::item_not_found("Vault issue file", &path));
    }

    open::that(&issue_path)
        .map_err(|err| AppError::unknown(format!("Failed to open {path}: {err}")))?;

    Ok(())
}

/// Preview a specific logged markdown snapshot for an open vault.
#[tauri::command]
pub async fn preview_vault_snapshot(
    vault_id: String,
    snapshot_path: String,
    state: State<'_, AppState>,
) -> Result<Option<SnapshotPreview>, AppError> {
    log::info!(
        "Previewing snapshot '{}' for vault '{}'",
        snapshot_path,
        vault_id
    );

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    Ok(manager.preview_snapshot(&snapshot_path)?)
}

/// Restore a specific logged markdown snapshot for an open vault.
#[tauri::command]
pub async fn restore_vault_snapshot(
    vault_id: String,
    snapshot_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<SnapshotRestoreResult>, AppError> {
    log::info!(
        "Restoring snapshot '{}' for vault '{}'",
        snapshot_path,
        vault_id
    );

    let result = {
        let vaults = state.vaults.lock().unwrap();
        let manager = vaults
            .get(&vault_id)
            .ok_or_else(|| AppError::vault_not_open(&vault_id))?;
        manager.restore_snapshot(&snapshot_path, "user")?
    };

    if result.is_some() {
        let _ = app.emit(
            "vault-library-updated",
            serde_json::json!({ "vaultId": vault_id }),
        );
    }

    Ok(result)
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
    use notify::event::ModifyKind;

    fn make_event(paths: Vec<PathBuf>) -> Event {
        Event {
            kind: EventKind::Modify(ModifyKind::Any),
            paths,
            attrs: Default::default(),
        }
    }

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

    #[test]
    fn resolves_vault_issue_markdown_paths_inside_root() {
        let root = PathBuf::from("/tmp/goalrate-vault");

        let resolved = resolve_vault_issue_path(&root, "goals/launch.md").unwrap();

        assert_eq!(resolved, root.join("goals/launch.md"));
    }

    #[test]
    fn rejects_vault_issue_paths_outside_root_or_non_markdown() {
        let root = PathBuf::from("/tmp/goalrate-vault");

        assert!(resolve_vault_issue_path(&root, "../secret.md").is_err());
        assert!(resolve_vault_issue_path(&root, "/tmp/secret.md").is_err());
        assert!(resolve_vault_issue_path(&root, "goals/launch.txt").is_err());
        assert!(resolve_vault_issue_path(&root, "").is_err());
    }

    #[test]
    fn library_update_paths_are_vault_relative() {
        let root = PathBuf::from("/tmp/goalrate-vault");
        let event = make_event(vec![
            root.join("agenda/2026-04-26.md"),
            root.join("logs/errors.md"),
        ]);

        assert_eq!(
            vault_relative_event_paths(&root, &event),
            vec![
                "agenda/2026-04-26.md".to_string(),
                "logs/errors.md".to_string(),
            ],
        );
    }

    #[test]
    fn library_update_paths_skip_paths_outside_vault() {
        let root = PathBuf::from("/tmp/goalrate-vault");
        let event = make_event(vec![
            root.join("goals/launch.md"),
            PathBuf::from("/tmp/other-vault/goals/other.md"),
        ]);

        assert_eq!(
            vault_relative_event_paths(&root, &event),
            vec!["goals/launch.md".to_string()],
        );
    }

    #[test]
    fn library_update_ignores_internal_cache_paths() {
        let root = PathBuf::from("/tmp/goalrate-vault");
        let event = make_event(vec![
            root.join(".goalrate/daily-loop.db-wal"),
            root.join(".goalrate/index.db"),
        ]);

        assert_eq!(
            vault_relative_event_paths(&root, &event),
            Vec::<String>::new()
        );
        assert!(!should_emit_library_update(&root, &event));
    }

    #[test]
    fn library_update_debounce_accumulates_paths_before_emit() {
        let start = Instant::now();
        let mut debounce = LibraryUpdateDebounce::new(Duration::from_millis(150));

        debounce.record_event(vec!["logs/errors.md".to_string()], start);
        debounce.record_event(
            vec!["agenda/2026-04-26.md".to_string()],
            start + Duration::from_millis(50),
        );

        assert_eq!(
            debounce.take_due_paths(start + Duration::from_millis(149)),
            None,
        );
        assert_eq!(
            debounce.take_due_paths(start + Duration::from_millis(150)),
            Some(vec![
                "logs/errors.md".to_string(),
                "agenda/2026-04-26.md".to_string(),
            ]),
        );
        assert_eq!(
            debounce.take_due_paths(start + Duration::from_millis(300)),
            None,
        );
    }

    #[test]
    fn library_update_debounce_keeps_unknown_path_event_as_broad_refresh() {
        let start = Instant::now();
        let mut debounce = LibraryUpdateDebounce::new(Duration::from_millis(150));

        debounce.record_event(vec!["logs/errors.md".to_string()], start);
        debounce.record_event(Vec::new(), start + Duration::from_millis(25));
        debounce.record_event(
            vec!["agenda/2026-04-26.md".to_string()],
            start + Duration::from_millis(50),
        );

        assert_eq!(
            debounce.take_due_paths(start + Duration::from_millis(150)),
            Some(Vec::new()),
        );
    }

    #[test]
    fn library_update_debounce_caps_path_accumulation() {
        let start = Instant::now();
        let mut debounce = LibraryUpdateDebounce::new(Duration::from_millis(150));

        for index in 0..=MAX_PENDING_LIBRARY_UPDATE_PATHS {
            debounce.record_event(vec![format!("goals/goal-{index}.md")], start);
        }

        assert_eq!(
            debounce.take_due_paths(start + Duration::from_millis(150)),
            Some(Vec::new()),
        );
    }
}
