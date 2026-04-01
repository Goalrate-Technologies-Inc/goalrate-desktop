//! Focus management commands for Tauri IPC
//!
//! These commands handle daily focus list operations: get, save, complete, defer.

use chrono::{DateTime, Local, NaiveDate, Utc};
use once_cell::sync::Lazy;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

use crate::commands::vault::AppState;
use crate::error::AppError;
use crate::types::{
    FocusCandidate, FocusDay, FocusListCloseDayInput, FocusListCloseDayResult, FocusListDay,
    FocusListDayStats, FocusListEntry, FocusListGenerateInput, FocusListGetCurrentInput,
    FocusListNavigationClickInput, FocusListNavigationResult, FocusVelocity, GoalTask, ProjectTask,
};

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultRegistryEntry {
    id: String,
    name: String,
    path: String,
}

fn get_registry_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("goalrate")
        .join("vaults.json")
}

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

const FOCUS_STORE_SCHEMA_VERSION: u32 = 1;
const FOCUS_BASELINE_SP: f64 = 13.0;
const FOCUS_MIN_SP: f64 = 3.0;
const FOCUS_MAX_SP: f64 = 40.0;
const FOCUS_STEP_UP_PCT: f64 = 0.1;
const FOCUS_STEP_DOWN_PCT: f64 = 0.1;
const FOCUS_ROUNDING_SP: f64 = 0.5;
const FOCUS_ANONYMOUS_USER_ID: &str = "anonymous";
static FOCUS_STORE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct FocusStoreCapacityProfile {
    user_id: String,
    baseline_sp: f64,
    min_sp: f64,
    max_sp: f64,
    step_up_pct: f64,
    step_down_pct: f64,
    rounding: f64,
    current_capacity_sp: f64,
    #[serde(default)]
    last_computed_for_date: Option<String>,
}

impl FocusStoreCapacityProfile {
    fn new(user_id: &str) -> Self {
        Self {
            user_id: user_id.to_string(),
            baseline_sp: FOCUS_BASELINE_SP,
            min_sp: FOCUS_MIN_SP,
            max_sp: FOCUS_MAX_SP,
            step_up_pct: FOCUS_STEP_UP_PCT,
            step_down_pct: FOCUS_STEP_DOWN_PCT,
            rounding: FOCUS_ROUNDING_SP,
            current_capacity_sp: FOCUS_BASELINE_SP,
            last_computed_for_date: None,
        }
    }

    fn normalize(&mut self) {
        self.min_sp = normalize_positive(self.min_sp, FOCUS_MIN_SP);
        self.max_sp = normalize_positive(self.max_sp, FOCUS_MAX_SP).max(self.min_sp);
        self.baseline_sp = clamp_capacity(
            normalize_positive(self.baseline_sp, FOCUS_BASELINE_SP),
            self.min_sp,
            self.max_sp,
        );
        self.current_capacity_sp = clamp_capacity(
            normalize_positive(self.current_capacity_sp, self.baseline_sp),
            self.min_sp,
            self.max_sp,
        );
        self.step_up_pct = normalize_non_negative(self.step_up_pct, FOCUS_STEP_UP_PCT);
        self.step_down_pct = normalize_non_negative(self.step_down_pct, FOCUS_STEP_DOWN_PCT);
        self.rounding = normalize_positive(self.rounding, FOCUS_ROUNDING_SP);
    }
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct FocusStore {
    #[serde(default)]
    schema_version: u32,
    #[serde(default)]
    migrated_at: Option<String>,
    #[serde(default)]
    capacity_profiles: HashMap<String, FocusStoreCapacityProfile>,
    #[serde(default)]
    focus_days: HashMap<String, FocusListDay>,
    #[serde(default)]
    focus_day_stats: HashMap<String, FocusListDayStats>,
    #[serde(default)]
    capacity_decisions: HashMap<String, f64>,
    #[serde(default)]
    last_closed_day_by_user: HashMap<String, String>,
}

#[derive(Debug, Clone)]
struct FocusTaskCandidate {
    id: String,
    vault_id: String,
    title: String,
    due_at: Option<String>,
    deadline_at: Option<String>,
    priority: u8,
    story_points: f64,
    status: String,
    created_at: Option<String>,
}

fn get_focus_store_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("goalrate")
        .join("data")
        .join("focusStore.json")
}

fn load_focus_store() -> Result<FocusStore, AppError> {
    let path = get_focus_store_path();
    if !path.exists() {
        return Ok(FocusStore::default());
    }

    let content = std::fs::read_to_string(&path)?;
    let mut store: FocusStore = serde_json::from_str(&content)?;
    let migrated = migrate_focus_store(&mut store);
    if migrated {
        save_focus_store(&store)?;
    }
    Ok(store)
}

fn save_focus_store(store: &FocusStore) -> Result<(), AppError> {
    let path = get_focus_store_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let content = serde_json::to_string_pretty(store)?;
    let tmp_path = path.with_extension("json.tmp");
    {
        let mut file = std::fs::File::create(&tmp_path)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
    }

    #[cfg(windows)]
    if path.exists() {
        std::fs::remove_file(&path)?;
    }

    std::fs::rename(&tmp_path, &path).map_err(|err| {
        let _ = std::fs::remove_file(&tmp_path);
        AppError::from(err)
    })?;

    if let Some(parent) = path.parent() {
        if let Ok(directory) = std::fs::File::open(parent) {
            let _ = directory.sync_all();
        }
    }

    Ok(())
}

fn lock_focus_store() -> Result<std::sync::MutexGuard<'static, ()>, AppError> {
    FOCUS_STORE_LOCK
        .lock()
        .map_err(|_| AppError::unknown("Failed to lock focus store"))
}

fn migrate_focus_store(store: &mut FocusStore) -> bool {
    let mut migrated = false;
    if store.schema_version < FOCUS_STORE_SCHEMA_VERSION {
        store.schema_version = FOCUS_STORE_SCHEMA_VERSION;
        store.migrated_at = Some(Utc::now().to_rfc3339());
        migrated = true;
    }

    for profile in store.capacity_profiles.values_mut() {
        profile.normalize();
    }

    migrated
}

fn normalize_user_key(user_id: &str) -> String {
    let trimmed = user_id.trim();
    if trimmed.is_empty() {
        return FOCUS_ANONYMOUS_USER_ID.to_string();
    }
    trimmed.to_lowercase()
}

fn normalize_positive(value: f64, fallback: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        fallback
    }
}

fn normalize_non_negative(value: f64, fallback: f64) -> f64 {
    if value.is_finite() && value >= 0.0 {
        value
    } else {
        fallback
    }
}

fn normalize_story_points(value: f64) -> f64 {
    if !value.is_finite() {
        return 0.0;
    }
    let rounded = (value * 2.0).round() / 2.0;
    if rounded.is_sign_negative() {
        0.0
    } else {
        rounded
    }
}

fn round_to_increment(value: f64, increment: f64) -> f64 {
    let normalized_increment = normalize_positive(increment, 1.0);
    let rounded = (value / normalized_increment).round() * normalized_increment;
    (rounded * 1000.0).round() / 1000.0
}

fn clamp_capacity(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

fn focus_store_day_key(user_id: &str, date: &str) -> String {
    format!("{}::{}", user_id, date)
}

fn get_or_create_capacity_profile<'a>(
    store: &'a mut FocusStore,
    user_id: &str,
) -> &'a mut FocusStoreCapacityProfile {
    store
        .capacity_profiles
        .entry(user_id.to_string())
        .or_insert_with(|| FocusStoreCapacityProfile::new(user_id))
}

fn parse_timestamp(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .map(|date_time| date_time.timestamp())
        .ok()
        .or_else(|| {
            NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .ok()
                .and_then(|date| date.and_hms_opt(0, 0, 0))
                .map(|date_time| date_time.and_utc().timestamp())
        })
}

fn sort_key_due_timestamp(task: &FocusTaskCandidate) -> i64 {
    if let Some(deadline_at) = task.deadline_at.as_deref() {
        if let Some(timestamp) = parse_timestamp(deadline_at) {
            return timestamp;
        }
    }
    if let Some(due_at) = task.due_at.as_deref() {
        if let Some(timestamp) = parse_timestamp(due_at) {
            return timestamp;
        }
    }
    i64::MAX
}

fn sort_key_created_at(task: &FocusTaskCandidate) -> i64 {
    task.created_at
        .as_deref()
        .and_then(parse_timestamp)
        .unwrap_or(i64::MAX)
}

fn sort_focus_task_candidates(tasks: &mut [FocusTaskCandidate]) {
    tasks.sort_by(|a, b| {
        let due_cmp = sort_key_due_timestamp(a).cmp(&sort_key_due_timestamp(b));
        if due_cmp != Ordering::Equal {
            return due_cmp;
        }

        let priority_cmp = b.priority.cmp(&a.priority);
        if priority_cmp != Ordering::Equal {
            return priority_cmp;
        }

        let created_cmp = sort_key_created_at(a).cmp(&sort_key_created_at(b));
        if created_cmp != Ordering::Equal {
            return created_cmp;
        }

        a.id.cmp(&b.id)
    });
}

fn normalize_status(raw_status: Option<String>, relative_path: &str) -> String {
    let inferred_from_path = infer_status_from_relative_path(relative_path);
    let normalized = raw_status
        .or(inferred_from_path)
        .unwrap_or_else(|| "todo".to_string())
        .trim()
        .to_lowercase()
        .replace('-', "_")
        .replace(' ', "_");

    match normalized.as_str() {
        "done" | "completed" | "complete" | "closed" => "done".to_string(),
        "blocked" | "on_hold" | "onhold" => "blocked".to_string(),
        "in_progress" | "inreview" | "in_review" | "doing" | "active" => "in_progress".to_string(),
        _ => "todo".to_string(),
    }
}

fn infer_status_from_relative_path(relative_path: &str) -> Option<String> {
    let normalized = relative_path.to_lowercase().replace('\\', "/");
    if normalized.contains("/board/done/") {
        return Some("done".to_string());
    }
    if normalized.contains("/board/in_review/") || normalized.contains("/board/in-review/") {
        return Some("in_progress".to_string());
    }
    if normalized.contains("/board/in_progress/") || normalized.contains("/board/in-progress/") {
        return Some("in_progress".to_string());
    }
    if normalized.contains("/board/blocked/") {
        return Some("blocked".to_string());
    }
    None
}

fn parse_priority(frontmatter: &markdown_parser::Frontmatter) -> u8 {
    let from_numeric = get_frontmatter_f64(frontmatter, &["priority"]).and_then(|priority| {
        let rounded = priority.round() as i64;
        if (1..=5).contains(&rounded) {
            Some(rounded as u8)
        } else {
            None
        }
    });

    if let Some(priority) = from_numeric {
        return priority;
    }

    let from_label = get_frontmatter_string(frontmatter, &["priority"])
        .map(|priority| priority.trim().to_lowercase())
        .map(|priority| match priority.as_str() {
            "critical" | "urgent" => 5,
            "high" => 4,
            "medium" | "normal" => 3,
            "low" => 2,
            "lowest" | "backlog" => 1,
            _ => 3,
        });

    from_label.unwrap_or(3)
}

fn get_frontmatter_value<'a>(
    frontmatter: &'a markdown_parser::Frontmatter,
    keys: &[&str],
) -> Option<&'a serde_yaml::Value> {
    for key in keys {
        if let Some(value) = frontmatter.get(*key) {
            return Some(value);
        }
    }
    None
}

fn get_frontmatter_string(
    frontmatter: &markdown_parser::Frontmatter,
    keys: &[&str],
) -> Option<String> {
    get_frontmatter_value(frontmatter, keys).and_then(|value| match value {
        serde_yaml::Value::String(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        serde_yaml::Value::Number(raw) => Some(raw.to_string()),
        _ => None,
    })
}

fn get_frontmatter_f64(frontmatter: &markdown_parser::Frontmatter, keys: &[&str]) -> Option<f64> {
    get_frontmatter_value(frontmatter, keys).and_then(|value| match value {
        serde_yaml::Value::Number(number) => number.as_f64(),
        serde_yaml::Value::String(raw) => raw.trim().parse::<f64>().ok(),
        _ => None,
    })
}

fn should_include_for_user(user_id: &str, assignee: Option<String>) -> bool {
    if user_id == FOCUS_ANONYMOUS_USER_ID {
        return true;
    }

    let Some(assignee) = assignee else {
        return false;
    };

    assignee.trim().to_lowercase() == user_id
}

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            let normalized = extension.to_lowercase();
            normalized == "md" || normalized == "markdown" || normalized == "mdx"
        })
        .unwrap_or(false)
}

fn to_relative_unix_path(path: &Path, base: &Path) -> Result<String, AppError> {
    let relative = path
        .strip_prefix(base)
        .map_err(|_| AppError::validation_error("Failed to compute relative task path"))?;
    Ok(relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/"))
}

fn collect_markdown_files(
    dir: &Path,
    base: &Path,
    seen: &mut HashSet<String>,
    output: &mut Vec<String>,
) -> Result<(), AppError> {
    if !dir.exists() {
        return Ok(());
    }

    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_markdown_files(&path, base, seen, output)?;
            continue;
        }

        if !is_markdown_file(&path) {
            continue;
        }

        let relative = to_relative_unix_path(&path, base)?;
        if seen.insert(relative.clone()) {
            output.push(relative);
        }
    }

    Ok(())
}

fn read_focus_task_candidates_from_vault(
    vault_id: &str,
    vault_path: &str,
    user_id: &str,
) -> Result<Vec<FocusTaskCandidate>, AppError> {
    let mut relative_paths = Vec::new();
    let mut seen = HashSet::new();
    let vault_root = PathBuf::from(vault_path);
    collect_markdown_files(
        &vault_root.join("tasks"),
        &vault_root,
        &mut seen,
        &mut relative_paths,
    )?;
    collect_markdown_files(
        &vault_root.join("board"),
        &vault_root,
        &mut seen,
        &mut relative_paths,
    )?;

    let mut candidates = Vec::new();
    for relative_path in relative_paths {
        let file_path = vault_root.join(&relative_path);
        let content = match std::fs::read_to_string(&file_path) {
            Ok(content) => content,
            Err(err) => {
                log::warn!(
                    "Failed to read focus candidate file '{}' for vault '{}': {}",
                    relative_path,
                    vault_id,
                    err
                );
                continue;
            }
        };

        let (frontmatter, _) = match markdown_parser::parse_frontmatter(&content) {
            Ok(parsed) => parsed,
            Err(_) => continue,
        };

        let assignee = get_frontmatter_string(
            &frontmatter,
            &[
                "assignee",
                "assigned_to",
                "assignedTo",
                "assigned_to_user_id",
                "assignedToUserId",
                "owner",
            ],
        );
        if !should_include_for_user(user_id, assignee) {
            continue;
        }

        let story_points = get_frontmatter_f64(
            &frontmatter,
            &["story_points", "storyPoints", "points", "sp"],
        )
        .map(normalize_story_points)
        .unwrap_or(0.0);
        if story_points <= 0.0 {
            continue;
        }

        let status = normalize_status(
            get_frontmatter_string(&frontmatter, &["status", "column"]),
            &relative_path,
        );
        if status == "blocked" || status == "done" {
            continue;
        }

        let title = get_frontmatter_string(&frontmatter, &["title"]).unwrap_or_else(|| {
            file_path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("Untitled Task")
                .to_string()
        });
        let due_at =
            get_frontmatter_string(&frontmatter, &["due_at", "dueAt", "due_date", "dueDate"]);
        let deadline_at = get_frontmatter_string(
            &frontmatter,
            &[
                "deadline_at",
                "deadlineAt",
                "deadline",
                "deadline_date",
                "deadlineDate",
            ],
        );
        let created_at =
            get_frontmatter_string(&frontmatter, &["created_at", "createdAt", "created"]);
        let task_id = format!("vault:{}", relative_path);

        candidates.push(FocusTaskCandidate {
            id: task_id,
            vault_id: vault_id.to_string(),
            title,
            due_at,
            deadline_at,
            priority: parse_priority(&frontmatter),
            story_points,
            status,
            created_at,
        });
    }

    Ok(candidates)
}

fn build_focus_list_entries(
    date: &str,
    capacity_sp: f64,
    tasks: &[FocusTaskCandidate],
) -> (Vec<FocusListEntry>, f64) {
    let mut entries = Vec::new();
    let mut packed_sp = 0.0;

    for task in tasks {
        let candidate_story_points = normalize_story_points(task.story_points);
        if candidate_story_points <= 0.0 {
            continue;
        }
        if packed_sp + candidate_story_points > capacity_sp {
            continue;
        }

        packed_sp += candidate_story_points;
        entries.push(FocusListEntry {
            id: format!("focus_{}_{}", date, task.id),
            task_id: task.id.clone(),
            vault_id: task.vault_id.clone(),
            title: task.title.clone(),
            due_at: task.deadline_at.clone().or(task.due_at.clone()),
            priority: task.priority,
            story_points: candidate_story_points,
            status: task.status.clone(),
        });
    }

    (entries, normalize_story_points(packed_sp))
}

fn calculate_next_capacity(
    current_capacity_sp: f64,
    all_done: bool,
    profile: &FocusStoreCapacityProfile,
) -> f64 {
    let multiplier = if all_done {
        1.0 + profile.step_up_pct
    } else {
        1.0 - profile.step_down_pct
    };
    let adjusted = current_capacity_sp * multiplier;
    let rounded = round_to_increment(adjusted, profile.rounding);
    clamp_capacity(rounded, profile.min_sp, profile.max_sp)
}

/// Get the focus directory path for a vault
fn get_focus_dir(vault_path: &str) -> PathBuf {
    PathBuf::from(vault_path).join("focus")
}

/// Get the path for a specific focus day file
fn get_focus_path(vault_path: &str, date: &str) -> PathBuf {
    get_focus_dir(vault_path).join(format!("{}.json", date))
}

/// Get the focus day for a specific date
#[tauri::command]
pub async fn get_focus_day(
    vault_id: String,
    date: String,
    state: State<'_, AppState>,
) -> Result<Option<FocusDay>, AppError> {
    log::info!("Getting focus day '{}' for vault '{}'", date, vault_id);

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let focus_path = get_focus_path(&vault_path, &date);

    if !focus_path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&focus_path)?;
    let focus_day: FocusDay = serde_json::from_str(&content)?;

    Ok(Some(focus_day))
}

/// Save a focus day
#[tauri::command]
pub async fn save_focus_day(
    vault_id: String,
    focus_day: FocusDay,
    state: State<'_, AppState>,
) -> Result<FocusDay, AppError> {
    log::info!(
        "Saving focus day '{}' for vault '{}'",
        focus_day.date,
        vault_id
    );

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let focus_dir = get_focus_dir(&vault_path);
    let focus_path = get_focus_path(&vault_path, &focus_day.date);

    // Ensure focus directory exists
    std::fs::create_dir_all(&focus_dir)?;

    // Write focus day file
    let content = serde_json::to_string_pretty(&focus_day)?;
    std::fs::write(&focus_path, content)?;

    Ok(focus_day)
}

/// Complete a focus item
#[tauri::command]
pub async fn complete_focus_item(
    vault_id: String,
    date: String,
    item_source: String,
    state: State<'_, AppState>,
) -> Result<FocusDay, AppError> {
    log::info!(
        "Completing focus item '{}' for date '{}' in vault '{}'",
        item_source,
        date,
        vault_id
    );

    // Get current focus day
    let mut focus_day = get_focus_day(vault_id.clone(), date.clone(), state.clone())
        .await?
        .ok_or_else(|| AppError::item_not_found("FocusDay", &date))?;

    // Update the item status
    let mut found = false;
    for item in &mut focus_day.items {
        if item.source == item_source {
            item.status = "done".to_string();
            item.completed_at = Some(Utc::now().to_rfc3339());
            found = true;
            break;
        }
    }

    if !found {
        return Err(AppError::item_not_found("FocusItem", &item_source));
    }

    // Recalculate completed metrics
    focus_day.completed_items = focus_day
        .items
        .iter()
        .filter(|i| i.status == "done")
        .count() as u32;
    focus_day.completed_points = focus_day
        .items
        .iter()
        .filter(|i| i.status == "done")
        .map(|i| i.points)
        .sum();

    // Save and return
    save_focus_day(vault_id, focus_day, state).await
}

/// Defer a focus item to another date
#[tauri::command]
pub async fn defer_focus_item(
    vault_id: String,
    date: String,
    item_source: String,
    defer_to: String,
    state: State<'_, AppState>,
) -> Result<FocusDay, AppError> {
    log::info!(
        "Deferring focus item '{}' from '{}' to '{}' in vault '{}'",
        item_source,
        date,
        defer_to,
        vault_id
    );

    // Get current focus day
    let mut focus_day = get_focus_day(vault_id.clone(), date.clone(), state.clone())
        .await?
        .ok_or_else(|| AppError::item_not_found("FocusDay", &date))?;

    // Update the item status
    let mut found = false;
    for item in &mut focus_day.items {
        if item.source == item_source {
            item.status = "deferred".to_string();
            item.deferred_to = Some(defer_to.clone());
            found = true;
            break;
        }
    }

    if !found {
        return Err(AppError::item_not_found("FocusItem", &item_source));
    }

    // Recalculate planned points (excluding deferred)
    focus_day.planned_points = focus_day
        .items
        .iter()
        .filter(|i| i.status == "pending" || i.status == "in_progress")
        .map(|i| i.points)
        .sum();

    // Save and return
    save_focus_day(vault_id, focus_day, state).await
}

/// Gather focus candidates from goals and projects
#[tauri::command]
pub async fn gather_focus_candidates(
    vault_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<FocusCandidate>, AppError> {
    log::info!("Gathering focus candidates for vault '{}'", vault_id);

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let vault_name = manager.config().name.clone();
    let candidates = collect_candidates_from_vault(&vault_id, &vault_name, &vault_path)?;

    log::info!(
        "Found {} focus candidates ({} from goals, {} from projects)",
        candidates.len(),
        candidates
            .iter()
            .filter(|c| c.item_type == "goal_task")
            .count(),
        candidates
            .iter()
            .filter(|c| c.item_type == "project_task")
            .count()
    );
    Ok(candidates)
}

/// Gather focus candidates across all vaults in the registry
#[tauri::command]
pub async fn gather_focus_candidates_all_vaults() -> Result<Vec<FocusCandidate>, AppError> {
    let entries = load_registry();
    let mut candidates = Vec::new();

    for entry in entries {
        let mut vault_candidates =
            collect_candidates_from_vault(&entry.id, &entry.name, &entry.path)?;
        candidates.append(&mut vault_candidates);
    }

    Ok(candidates)
}

fn collect_candidates_from_vault(
    vault_id: &str,
    vault_name: &str,
    vault_path: &str,
) -> Result<Vec<FocusCandidate>, AppError> {
    let goals_dir = PathBuf::from(vault_path).join("goals");
    let projects_dir = PathBuf::from(vault_path).join("projects");

    let mut candidates = Vec::new();

    if goals_dir.exists() {
        for goal_entry in std::fs::read_dir(&goals_dir)? {
            let goal_entry = goal_entry?;
            let goal_path = goal_entry.path();

            if !goal_path.is_dir() {
                continue;
            }

            let goal_file = goal_path.join("goal.md");
            let (goal_id, goal_title) = if goal_file.exists() {
                let parsed = std::fs::read_to_string(&goal_file)
                    .ok()
                    .and_then(|content| markdown_parser::parse_frontmatter(&content).ok());
                let id = parsed
                    .as_ref()
                    .and_then(|(fm, _)| fm.get("id").and_then(|v| v.as_str()))
                    .map(|s| s.to_string());
                let title = parsed
                    .as_ref()
                    .and_then(|(fm, _)| fm.get("title").and_then(|v| v.as_str()))
                    .map(|s| s.to_string());
                let fallback_id = goal_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                (id.unwrap_or(fallback_id), title)
            } else {
                let fallback_id = goal_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                (fallback_id, None)
            };

            let milestones_dir = goal_path.join("milestones");
            let legacy_tasks_dir = goal_path.join("tasks");
            let is_legacy = goal_path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|name| name == goal_id)
                .unwrap_or(false);
            let tasks_dir = if is_legacy && legacy_tasks_dir.exists() {
                legacy_tasks_dir
            } else if milestones_dir.exists() {
                milestones_dir
            } else if legacy_tasks_dir.exists() {
                legacy_tasks_dir
            } else {
                continue;
            };

            for task_entry in std::fs::read_dir(&tasks_dir)? {
                let task_entry = task_entry?;
                let task_path = task_entry.path();

                if task_path.extension().map(|e| e == "md").unwrap_or(false) {
                    if let Ok(content) = std::fs::read_to_string(&task_path) {
                        if let Ok((fm, body)) = markdown_parser::parse_frontmatter(&content) {
                            if let Ok(task) = GoalTask::from_frontmatter(&fm, &body) {
                                if !task.is_task {
                                    continue;
                                }
                                if task.column == "done" || task.completed_at.is_some() {
                                    continue;
                                }

                                candidates.push(FocusCandidate {
                                    id: task.id.clone(),
                                    item_type: "goal_task".to_string(),
                                    title: task.title,
                                    points: task.points as u32,
                                    priority: task.priority,
                                    due_date: task.due_date,
                                    blocks: vec![],
                                    blocks_people: false,
                                    in_current_sprint: false,
                                    last_activity: None,
                                    goal_id: Some(goal_id.clone()),
                                    goal_title: goal_title.clone(),
                                    goal_objective: goal_title.clone(),
                                    project_id: None,
                                    project_title: None,
                                    epic_title: None,
                                    sprint_id: None,
                                    board_column: Some(task.column.clone()),
                                    vault_id: Some(vault_id.to_string()),
                                    vault_name: Some(vault_name.to_string()),
                                    workspace_id: task.workspace_id.clone(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    if projects_dir.exists() {
        for project_entry in std::fs::read_dir(&projects_dir)? {
            let project_entry = project_entry?;
            let project_path = project_entry.path();

            if !project_path.is_dir() {
                continue;
            }

            let project_id = project_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            let project_file = project_path.join("project.md");
            let project_title = if project_file.exists() {
                std::fs::read_to_string(&project_file)
                    .ok()
                    .and_then(|content| {
                        markdown_parser::parse_frontmatter(&content)
                            .ok()
                            .and_then(|(fm, _)| {
                                fm.get("name")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string())
                            })
                    })
            } else {
                None
            };

            let tasks_dir = project_path.join("tasks");
            if !tasks_dir.exists() {
                continue;
            }

            for task_entry in std::fs::read_dir(&tasks_dir)? {
                let task_entry = task_entry?;
                let task_path = task_entry.path();

                if task_path.extension().map(|e| e == "md").unwrap_or(false) {
                    if let Ok(content) = std::fs::read_to_string(&task_path) {
                        if let Ok((fm, body)) = markdown_parser::parse_frontmatter(&content) {
                            if let Ok(task) = ProjectTask::from_frontmatter(&fm, &body) {
                                if !task.is_task {
                                    continue;
                                }
                                if task.column == "done" || task.completed_at.is_some() {
                                    continue;
                                }

                                candidates.push(FocusCandidate {
                                    id: task.id.clone(),
                                    item_type: "project_task".to_string(),
                                    title: task.title,
                                    points: task.points as u32,
                                    priority: task.priority,
                                    due_date: task.due_date,
                                    blocks: vec![],
                                    blocks_people: false,
                                    in_current_sprint: false,
                                    last_activity: None,
                                    goal_id: None,
                                    goal_title: None,
                                    goal_objective: None,
                                    project_id: Some(project_id.clone()),
                                    project_title: project_title.clone(),
                                    epic_title: None,
                                    sprint_id: None,
                                    board_column: Some(task.column.clone()),
                                    vault_id: Some(vault_id.to_string()),
                                    vault_name: Some(vault_name.to_string()),
                                    workspace_id: task.workspace_id.clone(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(candidates)
}

/// Get focus velocity metrics
#[tauri::command]
pub async fn get_focus_velocity(
    vault_id: String,
    state: State<'_, AppState>,
) -> Result<FocusVelocity, AppError> {
    log::info!("Getting focus velocity for vault '{}'", vault_id);

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let focus_dir = get_focus_dir(&vault_path);

    let mut total_completed: u32 = 0;
    let mut total_planned: u32 = 0;
    let mut days_tracked: u32 = 0;
    let mut weekly_trend: Vec<u32> = vec![0; 7];

    if focus_dir.exists() {
        // Get today's date for calculating weekly trend
        let today = Local::now().date_naive();

        for entry in std::fs::read_dir(&focus_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.extension().map(|e| e == "json").unwrap_or(false) {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(focus_day) = serde_json::from_str::<FocusDay>(&content) {
                        days_tracked += 1;
                        total_completed += focus_day.completed_points;
                        total_planned += focus_day.planned_points;

                        // Calculate weekly trend
                        if let Ok(date) =
                            chrono::NaiveDate::parse_from_str(&focus_day.date, "%Y-%m-%d")
                        {
                            let days_ago = (today - date).num_days();
                            if days_ago >= 0 && days_ago < 7 {
                                weekly_trend[6 - days_ago as usize] = focus_day.completed_points;
                            }
                        }
                    }
                }
            }
        }
    }

    // Calculate averages
    let average_points_per_day = if days_tracked > 0 {
        total_completed as f64 / days_tracked as f64
    } else {
        0.0
    };

    let average_completion_rate = if total_planned > 0 {
        (total_completed as f64 / total_planned as f64) * 100.0
    } else {
        0.0
    };

    // Calculate streaks (simplified - just count consecutive days with any completion)
    let mut current_streak: u32 = 0;
    for &points in weekly_trend.iter().rev() {
        if points > 0 {
            current_streak += 1;
        } else {
            break;
        }
    }

    Ok(FocusVelocity {
        average_points_per_day,
        average_completion_rate,
        total_days_tracked: days_tracked,
        current_streak,
        longest_streak: current_streak, // Simplified
        weekly_trend,
    })
}

/// Generate (or regenerate) a focus list day for the given user and date.
#[tauri::command]
pub async fn focus_list_generate(
    input: FocusListGenerateInput,
    state: State<'_, AppState>,
) -> Result<FocusListDay, AppError> {
    if input.date.trim().is_empty() {
        return Err(AppError::validation_error(
            "Focus list date cannot be empty",
        ));
    }

    let user_id = normalize_user_key(&input.user_id);
    let requested_vault_ids = input
        .open_vault_ids
        .iter()
        .map(|vault_id| vault_id.trim())
        .filter(|vault_id| !vault_id.is_empty())
        .map(|vault_id| vault_id.to_string())
        .collect::<Vec<_>>();

    let open_vaults = {
        let vaults = state.vaults.lock().unwrap();
        if requested_vault_ids.is_empty() {
            vaults
                .iter()
                .map(|(vault_id, manager)| (vault_id.clone(), manager.config().path.clone()))
                .collect::<Vec<_>>()
        } else {
            requested_vault_ids
                .iter()
                .filter_map(|vault_id| {
                    vaults
                        .get(vault_id)
                        .map(|manager| (vault_id.clone(), manager.config().path.clone()))
                })
                .collect::<Vec<_>>()
        }
    };

    let mut candidates = Vec::new();
    for (vault_id, vault_path) in open_vaults {
        let mut vault_candidates =
            read_focus_task_candidates_from_vault(&vault_id, &vault_path, &user_id)?;
        candidates.append(&mut vault_candidates);
    }

    sort_focus_task_candidates(&mut candidates);

    let _store_lock = lock_focus_store()?;
    let mut store = load_focus_store()?;
    let day_key = focus_store_day_key(&user_id, &input.date);
    let profile = get_or_create_capacity_profile(&mut store, &user_id);
    profile.normalize();
    let capacity_sp = profile.current_capacity_sp;
    let (entries, packed_sp) = build_focus_list_entries(&input.date, capacity_sp, &candidates);
    let generated_at = Utc::now().to_rfc3339();

    let focus_day = FocusListDay {
        date: input.date,
        capacity_sp: normalize_story_points(capacity_sp),
        packed_sp,
        planned_count: entries.len() as u32,
        completed_count: 0,
        completed_sp: 0.0,
        entries,
        generated_at,
    };

    store.focus_days.insert(day_key, focus_day.clone());
    save_focus_store(&store)?;

    Ok(focus_day)
}

/// Get the current persisted focus list day for a user/date.
#[tauri::command]
pub async fn focus_list_get_current(
    input: FocusListGetCurrentInput,
) -> Result<Option<FocusListDay>, AppError> {
    if input.date.trim().is_empty() {
        return Err(AppError::validation_error(
            "Focus list date cannot be empty",
        ));
    }

    let _store_lock = lock_focus_store()?;
    let user_id = normalize_user_key(&input.user_id);
    let store = load_focus_store()?;
    let day_key = focus_store_day_key(&user_id, &input.date);
    Ok(store.focus_days.get(&day_key).cloned())
}

/// Close a day and persist day stats + adaptive capacity decision.
#[tauri::command]
pub async fn focus_list_close_day(
    input: FocusListCloseDayInput,
) -> Result<FocusListCloseDayResult, AppError> {
    let close_day_date = input.stats.date.clone();
    if close_day_date.trim().is_empty() {
        return Err(AppError::validation_error(
            "Focus list closeDay date cannot be empty",
        ));
    }

    let _store_lock = lock_focus_store()?;
    let mut store = load_focus_store()?;
    let user_id = normalize_user_key(&input.user_id);
    let day_key = focus_store_day_key(&user_id, &close_day_date);

    if let Some(existing_next_capacity_sp) = store.capacity_decisions.get(&day_key) {
        return Ok(FocusListCloseDayResult {
            next_capacity_sp: normalize_story_points(*existing_next_capacity_sp),
        });
    }

    let profile = get_or_create_capacity_profile(&mut store, &user_id);
    profile.normalize();
    let next_capacity_sp =
        calculate_next_capacity(profile.current_capacity_sp, input.stats.all_done, profile);

    profile.current_capacity_sp = next_capacity_sp;
    profile.last_computed_for_date = Some(close_day_date.clone());

    let normalized_stats = FocusListDayStats {
        date: close_day_date.clone(),
        planned_count: input.stats.planned_count,
        planned_sp: normalize_story_points(input.stats.planned_sp),
        completed_count: input.stats.completed_count,
        completed_sp: normalize_story_points(input.stats.completed_sp),
        all_done: input.stats.all_done,
    };

    if let Some(existing_day) = store.focus_days.get_mut(&day_key) {
        existing_day.completed_count = normalized_stats.completed_count;
        existing_day.completed_sp = normalized_stats.completed_sp;
    }

    store
        .focus_day_stats
        .insert(day_key.clone(), normalized_stats);
    store
        .capacity_decisions
        .insert(day_key, normalize_story_points(next_capacity_sp));
    store
        .last_closed_day_by_user
        .insert(user_id, close_day_date);
    save_focus_store(&store)?;

    Ok(FocusListCloseDayResult {
        next_capacity_sp: normalize_story_points(next_capacity_sp),
    })
}

/// Validate navigation payload for a focus list task click.
#[tauri::command]
pub async fn focus_list_navigate_to_task(
    input: FocusListNavigationClickInput,
    state: State<'_, AppState>,
) -> Result<FocusListNavigationResult, AppError> {
    if input.task_id.trim().is_empty() {
        return Err(AppError::validation_error(
            "Focus list navigation taskId cannot be empty",
        ));
    }

    if input.vault_id.trim().is_empty() {
        return Err(AppError::validation_error(
            "Focus list navigation vaultId cannot be empty",
        ));
    }

    let vaults = state.vaults.lock().unwrap();
    if !vaults.contains_key(&input.vault_id) {
        return Err(AppError::vault_not_open(&input.vault_id));
    }

    Ok(FocusListNavigationResult { ok: true })
}

#[cfg(test)]
mod tests {
    // Tests would require a Tauri runtime context
}
