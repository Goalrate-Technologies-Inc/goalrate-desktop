//! Agenda commands for Tauri IPC
//!
//! CRUD operations for the Assistant-backed daily Agenda.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{Datelike, Duration, Local, NaiveDate, NaiveTime, Timelike, Weekday};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::State;

use agenda::{
    AgendaDb, ChatMessage, ChatRole, CheckIn, DailyPlan, DailyStats, Deferral, Outcome,
    PlanRevision, ScheduledTask,
};

use crate::commands::goals::{
    build_goal_frontmatter_task_status_update, collect_valid_goal_frontmatter_tasks_for_write,
    list_goal_frontmatter_tasks_from_manager, validate_goal_frontmatter_tasks_for_write,
    GoalFrontmatterTask,
};
use crate::commands::vault::AppState;
use crate::error::{AppError, ErrorCode};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMetadata {
    pub goal_id: String,
    pub goal_title: String,
    pub priority: String,
    pub eisenhower_quadrant: String,
    pub deadline: String,
}

#[derive(Debug, Clone)]
struct MemoryBlockedWindow {
    label: String,
    start: NaiveTime,
    end: NaiveTime,
}

#[derive(Debug, Clone, Default)]
struct MemoryPlanningContext {
    capacity_minutes: Option<i32>,
    target_task_count: Option<usize>,
    blocked_windows: Vec<MemoryBlockedWindow>,
    remote_allowed: bool,
    prompt_lines: Vec<String>,
}

const MEMORY_SCHEDULE_ESTIMATE_SOURCE: &str = "memory";
const AGENDA_DB_FILE_NAME: &str = "agenda.db";
const LEGACY_AGENDA_DB_FILE_NAME: &str = "daily-loop.db";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct MemoryAgendaTargets {
    pub capacity_minutes: Option<i32>,
    pub task_count: Option<usize>,
}

impl MemoryAgendaTargets {
    pub(crate) fn has_any_target(self) -> bool {
        self.capacity_minutes.is_some() || self.task_count.is_some()
    }
}

impl MemoryPlanningContext {
    fn agenda_targets(&self) -> MemoryAgendaTargets {
        MemoryAgendaTargets {
            capacity_minutes: self.capacity_minutes,
            task_count: self.target_task_count,
        }
    }
}

/// Global map of vault_id -> AgendaDb instances
pub(crate) static AGENDA_DBS: Lazy<Mutex<HashMap<String, AgendaDb>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

static AGENDA_LOAD_WARNINGS: Lazy<Mutex<HashMap<String, Vec<String>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn agenda_warning_key(vault_id: &str, date: NaiveDate) -> String {
    format!("{vault_id}:{}", date)
}

pub(crate) fn release_agenda_state(vault_id: &str, app_state: &AppState) -> Result<(), AppError> {
    AGENDA_DBS
        .lock()
        .map_err(|e| {
            AppError::new(
                ErrorCode::UnknownError,
                format!("Failed to lock agenda DBs: {e}"),
            )
        })?
        .remove(vault_id);

    let warning_prefix = format!("{vault_id}:");
    AGENDA_LOAD_WARNINGS
        .lock()
        .map_err(|e| {
            AppError::new(
                ErrorCode::UnknownError,
                format!("Failed to lock Agenda warnings: {e}"),
            )
        })?
        .retain(|key, _| !key.starts_with(&warning_prefix));

    app_state
        .ai_cache
        .lock()
        .map_err(|e| {
            AppError::new(
                ErrorCode::UnknownError,
                format!("Failed to lock AI cache: {e}"),
            )
        })?
        .clear();

    Ok(())
}

fn replace_agenda_warnings(
    vault_id: &str,
    date: NaiveDate,
    warnings: Vec<String>,
) -> Result<(), AppError> {
    AGENDA_LOAD_WARNINGS
        .lock()
        .map_err(|e| {
            AppError::new(
                ErrorCode::UnknownError,
                format!("Failed to lock Agenda warnings: {e}"),
            )
        })?
        .insert(agenda_warning_key(vault_id, date), warnings);
    Ok(())
}

fn push_agenda_warning(vault_id: &str, date: NaiveDate, warning: String) -> Result<(), AppError> {
    AGENDA_LOAD_WARNINGS
        .lock()
        .map_err(|e| {
            AppError::new(
                ErrorCode::UnknownError,
                format!("Failed to lock Agenda warnings: {e}"),
            )
        })?
        .entry(agenda_warning_key(vault_id, date))
        .or_default()
        .push(warning);
    Ok(())
}

pub(crate) fn agenda_warnings_for_date(
    vault_id: &str,
    date: NaiveDate,
) -> Result<Vec<String>, AppError> {
    Ok(AGENDA_LOAD_WARNINGS
        .lock()
        .map_err(|e| {
            AppError::new(
                ErrorCode::UnknownError,
                format!("Failed to lock Agenda warnings: {e}"),
            )
        })?
        .get(&agenda_warning_key(vault_id, date))
        .cloned()
        .unwrap_or_default())
}

fn agenda_error_log_path_for_vault(
    vault_id: &str,
    app_state: &AppState,
) -> Result<PathBuf, AppError> {
    let vaults = app_state.vaults.lock().map_err(|e| {
        AppError::new(
            ErrorCode::UnknownError,
            format!("Failed to lock vaults: {e}"),
        )
    })?;
    let vault = vaults
        .get(vault_id)
        .ok_or_else(|| AppError::vault_not_open(vault_id))?;
    vault.ensure_v1_markdown_structure()?;
    Ok(vault.structure().error_log.clone())
}

fn migrate_legacy_agenda_db(goalrate_dir: &Path) -> Result<(), AppError> {
    for suffix in ["", "-wal", "-shm"] {
        let legacy_path = goalrate_dir.join(format!("{LEGACY_AGENDA_DB_FILE_NAME}{suffix}"));
        let agenda_path = goalrate_dir.join(format!("{AGENDA_DB_FILE_NAME}{suffix}"));
        if legacy_path.exists() && !agenda_path.exists() {
            fs::rename(&legacy_path, &agenda_path).map_err(|e| {
                AppError::new(
                    ErrorCode::UnknownError,
                    format!(
                        "Failed to migrate legacy Agenda database {} to {}: {e}",
                        legacy_path.display(),
                        agenda_path.display()
                    ),
                )
            })?;
        }
    }
    Ok(())
}

/// Ensure an AgendaDb is open for a vault, creating it if needed.
/// Acquires locks in a safe order: check AGENDA_DBS first (drop it),
/// then acquire vaults lock to get the path (drop it), create DB,
/// then re-acquire AGENDA_DBS to insert.
fn ensure_db(vault_id: &str, app_state: &AppState) -> Result<(), AppError> {
    // Check if DB already exists — acquire and immediately drop the lock
    {
        let dbs = AGENDA_DBS.lock().map_err(|e| {
            AppError::new(
                ErrorCode::UnknownError,
                format!("Failed to lock agenda DBs: {e}"),
            )
        })?;
        if dbs.contains_key(vault_id) {
            return Ok(());
        }
    } // Lock dropped here

    // Get vault path — separate lock scope to avoid nesting
    let goalrate_dir = {
        let vaults = app_state.vaults.lock().map_err(|e| {
            AppError::new(
                ErrorCode::UnknownError,
                format!("Failed to lock vaults: {e}"),
            )
        })?;
        let vault = vaults
            .get(vault_id)
            .ok_or_else(|| AppError::vault_not_open(vault_id))?;
        vault.structure().goalrate_dir.clone()
    }; // Vaults lock dropped here
    migrate_legacy_agenda_db(&goalrate_dir)?;
    let db_path = goalrate_dir.join(AGENDA_DB_FILE_NAME);

    // Open DB without any locks held
    let db = AgendaDb::open(&db_path).map_err(|e| {
        AppError::new(
            ErrorCode::UnknownError,
            format!("Failed to open agenda DB: {e}"),
        )
    })?;

    // Re-acquire to insert (another thread may have inserted in the meantime — that's fine)
    let mut dbs = AGENDA_DBS.lock().map_err(|e| {
        AppError::new(
            ErrorCode::UnknownError,
            format!("Failed to lock agenda DBs: {e}"),
        )
    })?;
    dbs.entry(vault_id.to_string()).or_insert(db);
    Ok(())
}

pub(crate) fn with_db<T>(
    vault_id: &str,
    app_state: &AppState,
    f: impl FnOnce(&AgendaDb) -> Result<T, agenda::AgendaError>,
) -> Result<T, AppError> {
    ensure_db(vault_id, app_state)?;

    let dbs = AGENDA_DBS.lock().map_err(|e| {
        AppError::new(
            ErrorCode::UnknownError,
            format!("Failed to lock agenda DBs: {e}"),
        )
    })?;

    let db = dbs.get(vault_id).ok_or_else(|| {
        AppError::new(
            ErrorCode::UnknownError,
            "Agenda DB disappeared unexpectedly",
        )
    })?;

    f(db).map_err(|e| match e {
        agenda::AgendaError::NotFound(msg) => AppError::item_not_found("Agenda", &msg),
        agenda::AgendaError::PlanAlreadyExists(date) => AppError::new(
            ErrorCode::ItemAlreadyExists,
            format!("Plan already exists for {date}"),
        ),
        agenda::AgendaError::PlanLocked => AppError::new(
            ErrorCode::VaultLocked,
            "Plan is locked and cannot be modified",
        ),
        other => AppError::new(ErrorCode::UnknownError, other.to_string()),
    })
}

fn parse_date(s: &str) -> Result<NaiveDate, AppError> {
    s.parse::<NaiveDate>()
        .map_err(|_| AppError::validation_error(format!("Invalid date format: {s}")))
}

const URGENT_DUE_WITHIN_DAYS: i64 = 7;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum GoalPriorityRank {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct EisenhowerThresholds {
    due_within_days: i64,
    min_goal_priority: GoalPriorityRank,
}

impl Default for EisenhowerThresholds {
    fn default() -> Self {
        Self {
            due_within_days: URGENT_DUE_WITHIN_DAYS,
            min_goal_priority: GoalPriorityRank::Medium,
        }
    }
}

fn goal_priority_rank(priority: Option<&str>) -> GoalPriorityRank {
    match priority.unwrap_or("medium").to_ascii_lowercase().as_str() {
        "critical" => GoalPriorityRank::Critical,
        "high" => GoalPriorityRank::High,
        "low" => GoalPriorityRank::Low,
        "medium" => GoalPriorityRank::Medium,
        _ => GoalPriorityRank::Medium,
    }
}

fn parse_task_date(value: Option<&str>) -> Option<NaiveDate> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
}

fn task_is_urgent_for_agenda_date_with_thresholds(
    due_date: Option<&str>,
    scheduled_date: Option<&str>,
    agenda_date: NaiveDate,
    thresholds: EisenhowerThresholds,
) -> bool {
    let Some(task_date) = parse_task_date(due_date).or_else(|| parse_task_date(scheduled_date))
    else {
        return false;
    };
    task_date.signed_duration_since(agenda_date).num_days() <= thresholds.due_within_days
}

fn normalized_task_title_for_matching(title: &str) -> String {
    title
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn task_title_suggests_delegation(title: &str) -> bool {
    let normalized = normalized_task_title_for_matching(title);
    if normalized.is_empty() {
        return false;
    }

    let padded = format!(" {normalized} ");
    let has_any = |terms: &[&str]| terms.iter().any(|term| padded.contains(term));
    let has_outside_helper = has_any(&[
        " plumber ",
        " electrician ",
        " handyman ",
        " contractor ",
        " technician ",
        " repair service ",
        " vendor ",
        " service provider ",
        " installer ",
        " mechanic ",
    ]);

    if normalized.starts_with("get ")
        && has_any(&[
            " fixed ",
            " repaired ",
            " serviced ",
            " replaced ",
            " installed ",
            " cleaned ",
        ])
    {
        return true;
    }

    if has_any(&[" delegate ", " delegated ", " outsource ", " outsourced "]) {
        return true;
    }

    if has_outside_helper
        && (has_any(&[
            " call ",
            " contact ",
            " email ",
            " text ",
            " message ",
            " hire ",
            " book ",
            " schedule ",
            " ask ",
            " find ",
        ]) || has_any(&[
            " fix ",
            " fixed ",
            " repair ",
            " repaired ",
            " service ",
            " serviced ",
            " install ",
            " installed ",
            " replace ",
            " replaced ",
        ]))
    {
        return true;
    }

    has_any(&[
        " send delegation request ",
        " ask someone to ",
        " ask somebody to ",
        " have someone ",
        " have somebody ",
    ])
}

pub(crate) fn title_inferred_eisenhower_quadrant(title: &str) -> Option<String> {
    task_title_suggests_delegation(title).then(|| "delegate".to_string())
}

pub(crate) fn derive_eisenhower_quadrant(
    goal_priority: Option<&str>,
    due_date: Option<&str>,
    scheduled_date: Option<&str>,
    agenda_date: NaiveDate,
) -> String {
    derive_eisenhower_quadrant_with_thresholds(
        goal_priority,
        due_date,
        scheduled_date,
        agenda_date,
        EisenhowerThresholds::default(),
    )
}

pub(crate) fn derive_eisenhower_quadrant_for_task_title(
    title: &str,
    goal_priority: Option<&str>,
    due_date: Option<&str>,
    scheduled_date: Option<&str>,
    agenda_date: NaiveDate,
) -> String {
    title_inferred_eisenhower_quadrant(title).unwrap_or_else(|| {
        derive_eisenhower_quadrant(goal_priority, due_date, scheduled_date, agenda_date)
    })
}

fn derive_eisenhower_quadrant_with_thresholds(
    goal_priority: Option<&str>,
    due_date: Option<&str>,
    scheduled_date: Option<&str>,
    agenda_date: NaiveDate,
    thresholds: EisenhowerThresholds,
) -> String {
    let is_urgent = task_is_urgent_for_agenda_date_with_thresholds(
        due_date,
        scheduled_date,
        agenda_date,
        thresholds,
    );
    let is_important = goal_priority_rank(goal_priority) >= thresholds.min_goal_priority;

    match (is_urgent, is_important) {
        (true, true) => "do",
        (false, true) => "schedule",
        (true, false) => "delegate",
        (false, false) => "delete",
    }
    .to_string()
}

fn quadrant_sort_rank(quadrant: &str) -> u8 {
    match quadrant {
        "do" => 0,
        "schedule" => 1,
        "delegate" => 2,
        "delete" => 3,
        _ => 1,
    }
}

fn infer_duration_minutes(title: &str) -> i32 {
    let lower = title.to_ascii_lowercase();
    if lower.contains("shower")
        || lower.contains("dress")
        || lower.contains("snack")
        || lower.contains("email")
        || lower.contains("send ")
        || lower.contains("ask ")
        || lower.contains("call ")
    {
        15
    } else if lower.contains("breakfast")
        || lower.contains("lunch")
        || lower.contains("dinner")
        || lower.contains("review")
        || lower.contains("plan")
        || lower.contains("outline")
    {
        30
    } else {
        45
    }
}

fn parse_generated_time(generated_at: &str) -> NaiveTime {
    chrono::DateTime::parse_from_rfc3339(generated_at)
        .map(|dt| dt.time())
        .unwrap_or_else(|_| Local::now().time())
        .with_second(0)
        .and_then(|t| t.with_nanosecond(0))
        .unwrap_or_else(|| Local::now().time())
}

fn parse_local_time(raw: &str) -> Option<NaiveTime> {
    let trimmed = raw.trim();
    if let Ok(time) = NaiveTime::parse_from_str(trimmed, "%H:%M") {
        return Some(time);
    }

    let normalized = trimmed.to_ascii_uppercase().replace('.', "");
    let (time_part, meridiem) = if let Some(time_part) = normalized.strip_suffix(" AM") {
        (time_part.trim(), "AM")
    } else if let Some(time_part) = normalized.strip_suffix(" PM") {
        (time_part.trim(), "PM")
    } else if let Some(time_part) = normalized.strip_suffix("AM") {
        (time_part.trim(), "AM")
    } else if let Some(time_part) = normalized.strip_suffix("PM") {
        (time_part.trim(), "PM")
    } else {
        return None;
    };

    let (hour_raw, minute_raw) = time_part.split_once(':').unwrap_or((time_part, "0"));
    let mut hour = hour_raw.trim().parse::<u32>().ok()?;
    let minute = minute_raw.trim().parse::<u32>().ok()?;
    if !(1..=12).contains(&hour) || minute > 59 {
        return None;
    }
    if meridiem == "AM" && hour == 12 {
        hour = 0;
    } else if meridiem == "PM" && hour != 12 {
        hour += 12;
    }
    NaiveTime::from_hms_opt(hour, minute, 0)
}

fn format_agenda_time(time: NaiveTime) -> String {
    time.format("%I:%M %p")
        .to_string()
        .trim_start_matches('0')
        .to_string()
}

pub(crate) fn normalize_agenda_time_label(raw: &str) -> String {
    parse_local_time(raw)
        .map(format_agenda_time)
        .unwrap_or_else(|| raw.trim().to_string())
}

fn late_agenda_time() -> NaiveTime {
    NaiveTime::from_hms_opt(23, 59, 59).expect("valid fallback time")
}

fn normalize_scheduled_tasks_chronologically(tasks: &mut Vec<ScheduledTask>) {
    tasks.sort_by_key(|task| parse_local_time(&task.start_time).unwrap_or_else(late_agenda_time));
    let mut seen_task_ids = HashSet::new();
    tasks.retain(|task| task.task_id.is_empty() || seen_task_ids.insert(task.task_id.clone()));
}

fn split_schedule_row_time(row_text: &str) -> Option<(NaiveTime, &str)> {
    let trimmed = row_text.trim();
    let mut first_split = trimmed.splitn(2, char::is_whitespace);
    let first = first_split.next()?;
    let after_first = first_split.next().unwrap_or("").trim_start();
    let mut second_split = after_first.splitn(2, char::is_whitespace);
    let second = second_split.next().unwrap_or("");
    let second_upper = second.trim_matches('.').to_ascii_uppercase();

    let (time_text, rest) = if second_upper == "AM" || second_upper == "PM" {
        (
            format!("{first} {second_upper}"),
            second_split.next().unwrap_or("").trim_start(),
        )
    } else {
        (first.to_string(), after_first)
    };

    parse_local_time(&time_text).map(|time| (time, rest))
}

fn mapping_value<'a>(map: &'a serde_yaml::Mapping, key: &str) -> Option<&'a serde_yaml::Value> {
    map.get(serde_yaml::Value::String(key.to_string()))
}

fn mapping_str(map: &serde_yaml::Mapping, key: &str) -> Option<String> {
    mapping_value(map, key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn yaml_value_i64(value: &serde_yaml::Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
        .or_else(|| value.as_f64().map(|value| value.round() as i64))
        .or_else(|| value.as_str().and_then(|value| value.trim().parse().ok()))
}

fn mapping_i64(map: &serde_yaml::Mapping, key: &str) -> Option<i64> {
    mapping_value(map, key).and_then(yaml_value_i64)
}

fn mapping_bool(map: &serde_yaml::Mapping, snake_key: &str, camel_key: &str) -> Option<bool> {
    mapping_value(map, snake_key)
        .or_else(|| mapping_value(map, camel_key))
        .and_then(|v| v.as_bool())
}

fn frontmatter_f64(fm: &markdown_parser::Frontmatter, key: &str) -> Option<f64> {
    fm.get(key).and_then(|v| {
        v.as_f64()
            .or_else(|| v.as_i64().map(|i| i as f64))
            .or_else(|| v.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
    })
}

fn positive_usize_from_value(value: &serde_yaml::Value) -> Option<usize> {
    value
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
        .or_else(|| {
            value
                .as_i64()
                .filter(|value| *value > 0)
                .and_then(|value| usize::try_from(value).ok())
        })
        .or_else(|| {
            value
                .as_f64()
                .filter(|value| *value > 0.0)
                .map(|value| value.round() as usize)
        })
        .or_else(|| value.as_str().and_then(first_positive_usize))
        .filter(|value| *value > 0)
}

fn frontmatter_usize_any(fm: &markdown_parser::Frontmatter, keys: &[&str]) -> Option<usize> {
    keys.iter()
        .find_map(|key| fm.get(*key).and_then(positive_usize_from_value))
}

fn first_positive_usize(text: &str) -> Option<usize> {
    let mut digits = String::new();
    for ch in text.chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
        } else if !digits.is_empty() {
            if let Ok(value) = digits.parse::<usize>() {
                if value > 0 {
                    return Some(value);
                }
            }
            digits.clear();
        }
    }
    if digits.is_empty() {
        None
    } else {
        digits.parse::<usize>().ok().filter(|value| *value > 0)
    }
}

fn first_positive_f64(text: &str) -> Option<f64> {
    let mut number = String::new();
    for ch in text.chars() {
        if ch.is_ascii_digit() || ch == '.' {
            number.push(ch);
        } else if !number.is_empty() {
            if let Ok(value) = number.parse::<f64>() {
                if value > 0.0 {
                    return Some(value);
                }
            }
            number.clear();
        }
    }
    if number.is_empty() {
        None
    } else {
        number.parse::<f64>().ok().filter(|value| *value > 0.0)
    }
}

fn frontmatter_string_list(fm: &markdown_parser::Frontmatter, key: &str) -> Vec<String> {
    fm.get(key)
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn normalized_domain_key(domain: &str) -> Option<String> {
    let normalized = domain.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn goal_domain_from_frontmatter(fm: &markdown_parser::Frontmatter) -> Option<String> {
    let type_value = fm.get("type").and_then(|v| v.as_str());
    fm.get("domain")
        .or_else(|| fm.get("goal_type"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .or_else(|| {
            type_value
                .filter(|value| !matches!(*value, "goal" | "objective" | "domain"))
                .map(str::to_string)
        })
        .or_else(|| {
            fm.get("tags")
                .and_then(|v| v.as_sequence())
                .and_then(|seq| seq.first())
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
}

fn domain_metadata_name(fm: &markdown_parser::Frontmatter, path: &Path) -> Option<String> {
    fm.get("name")
        .or_else(|| fm.get("domain"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .or_else(|| {
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .map(str::to_string)
        })
}

fn domain_thresholds_from_frontmatter(fm: &markdown_parser::Frontmatter) -> EisenhowerThresholds {
    let mut thresholds = EisenhowerThresholds::default();

    if let Some(urgency) = fm.get("urgency_threshold").and_then(|v| v.as_mapping()) {
        if let Some(days) = mapping_i64(urgency, "due_within_days").filter(|days| *days >= 0) {
            thresholds.due_within_days = days;
        }
    }

    if let Some(importance) = fm.get("importance_threshold").and_then(|v| v.as_mapping()) {
        if let Some(priority) = mapping_str(importance, "min_goal_priority") {
            thresholds.min_goal_priority = goal_priority_rank(Some(&priority));
        }
    }

    thresholds
}

fn domain_thresholds_from_vault(
    vault: &vault_core::VaultManager,
) -> HashMap<String, EisenhowerThresholds> {
    let mut thresholds_by_domain = HashMap::new();
    let Ok(entries) = std::fs::read_dir(&vault.structure().domains) else {
        return thresholds_by_domain;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }

        let content = match std::fs::read_to_string(&path) {
            Ok(content) => content,
            Err(error) => {
                let _ = vault
                    .log_vault_error(&path, &format!("Failed to read Domain metadata: {error}"));
                continue;
            }
        };
        let (fm, _) = match markdown_parser::parse_frontmatter(&content) {
            Ok(parsed) => parsed,
            Err(error) => {
                let _ = vault.log_vault_error(
                    &path,
                    &format!("Failed to parse Domain metadata frontmatter: {error}"),
                );
                continue;
            }
        };

        if let Some(domain_name) =
            domain_metadata_name(&fm, &path).and_then(|name| normalized_domain_key(&name))
        {
            thresholds_by_domain.insert(domain_name, domain_thresholds_from_frontmatter(&fm));
        }
    }

    thresholds_by_domain
}

fn weekday_name(weekday: Weekday) -> &'static str {
    match weekday {
        Weekday::Mon => "monday",
        Weekday::Tue => "tuesday",
        Weekday::Wed => "wednesday",
        Weekday::Thu => "thursday",
        Weekday::Fri => "friday",
        Weekday::Sat => "saturday",
        Weekday::Sun => "sunday",
    }
}

fn window_applies_to_date(days: &[String], date: NaiveDate) -> bool {
    if days.is_empty() {
        return true;
    }
    let weekday = weekday_name(date.weekday());
    let is_weekend = matches!(date.weekday(), Weekday::Sat | Weekday::Sun);
    days.iter().any(|day| {
        let normalized = day.trim().to_ascii_lowercase();
        normalized == weekday
            || (normalized == "weekdays" && !is_weekend)
            || (normalized == "weekday" && !is_weekend)
            || (normalized == "weekends" && is_weekend)
            || (normalized == "weekend" && is_weekend)
            || normalized == "daily"
            || normalized == "everyday"
            || normalized == "every day"
    })
}

fn parse_memory_window(item: &serde_yaml::Value, date: NaiveDate) -> Option<MemoryBlockedWindow> {
    let map = item.as_mapping()?;
    let label = mapping_str(map, "label").unwrap_or_else(|| "Blocked time".to_string());
    let start = mapping_str(map, "start_time").or_else(|| mapping_str(map, "startTime"))?;
    let end = mapping_str(map, "end_time").or_else(|| mapping_str(map, "endTime"))?;
    let days = mapping_value(map, "days")
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if !window_applies_to_date(&days, date) {
        return None;
    }
    Some(MemoryBlockedWindow {
        label,
        start: parse_local_time(&start)?,
        end: parse_local_time(&end)?,
    })
}

fn read_memory_windows(
    fm: &markdown_parser::Frontmatter,
    key: &str,
    date: NaiveDate,
) -> Vec<MemoryBlockedWindow> {
    fm.get(key)
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|item| parse_memory_window(item, date))
                .collect()
        })
        .unwrap_or_default()
}

fn window_duration_minutes(window: &MemoryBlockedWindow) -> i32 {
    let minutes = window.end.signed_duration_since(window.start).num_minutes();
    minutes.max(0) as i32
}

fn memory_window_task_id(window: &MemoryBlockedWindow) -> String {
    format!(
        "memory_{}_{}",
        slug_fragment(&window.label),
        window.start.format("%H%M")
    )
}

fn memory_window_scheduled_task(window: &MemoryBlockedWindow) -> Option<ScheduledTask> {
    let duration_minutes = window_duration_minutes(window);
    if duration_minutes <= 0 {
        return None;
    }

    let task_id = memory_window_task_id(window);
    Some(ScheduledTask {
        id: format!("scheduled_{task_id}"),
        task_id,
        title: window.label.trim().to_string(),
        start_time: format_agenda_time(window.start),
        duration_minutes,
        estimate_source: Some(MEMORY_SCHEDULE_ESTIMATE_SOURCE.to_string()),
        eisenhower_quadrant: None,
    })
}

fn memory_window_scheduled_tasks(
    windows: &[MemoryBlockedWindow],
    visible_not_before: Option<NaiveTime>,
) -> Vec<ScheduledTask> {
    let mut seen = HashSet::new();
    windows
        .iter()
        .filter(|window| visible_not_before.map_or(true, |cutoff| window.start >= cutoff))
        .filter_map(memory_window_scheduled_task)
        .filter(|task| seen.insert(task.task_id.clone()))
        .collect()
}

fn generated_schedule_visible_memory_start(
    date: NaiveDate,
    generated_at: &str,
) -> Option<NaiveTime> {
    (date == Local::now().date_naive()).then(|| parse_generated_time(generated_at))
}

fn is_memory_scheduled_task(task: &ScheduledTask) -> bool {
    task.estimate_source.as_deref() == Some(MEMORY_SCHEDULE_ESTIMATE_SOURCE)
        || task.task_id.starts_with("memory_")
}

fn normalized_memory_phrase(value: &str) -> String {
    let mut normalized = String::new();
    let mut previous_was_space = false;

    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            normalized.push(ch.to_ascii_lowercase());
            previous_was_space = false;
        } else if !previous_was_space && !normalized.is_empty() {
            normalized.push(' ');
            previous_was_space = true;
        }
    }

    normalized.trim().to_string()
}

fn task_title_matches_memory_label(title: &str, label: &str) -> bool {
    let title = normalized_memory_phrase(title);
    let label = normalized_memory_phrase(label);
    if title.is_empty() || label.is_empty() {
        return false;
    }

    title == label
        || ["eat", "have", "take", "grab"].iter().any(|verb| {
            title == format!("{verb} {label}")
                || title
                    .strip_prefix(&format!("{verb} "))
                    .is_some_and(|rest| phrase_contains_words(rest, &label))
        })
        || title == format!("{label} break")
}

fn phrase_contains_words(phrase: &str, words: &str) -> bool {
    let phrase_words = phrase.split_whitespace().collect::<Vec<_>>();
    let target_words = words.split_whitespace().collect::<Vec<_>>();
    !target_words.is_empty()
        && phrase_words
            .windows(target_words.len())
            .any(|window| window == target_words.as_slice())
}

fn scheduled_task_matches_memory_window(
    task: &ScheduledTask,
    window: &MemoryBlockedWindow,
) -> bool {
    task.task_id == memory_window_task_id(window)
        || is_memory_scheduled_task(task)
        || task_title_matches_memory_label(&task.title, &window.label)
}

fn scheduled_task_matches_any_memory_window(
    task: &ScheduledTask,
    windows: &[MemoryBlockedWindow],
) -> bool {
    windows
        .iter()
        .any(|window| scheduled_task_matches_memory_window(task, window))
}

fn scheduled_task_is_memory_window_row(task: &ScheduledTask, window: &MemoryBlockedWindow) -> bool {
    task.task_id == memory_window_task_id(window)
        || (is_memory_scheduled_task(task)
            && task_title_matches_memory_label(&task.title, &window.label))
}

fn scheduled_task_is_any_memory_window_row(
    task: &ScheduledTask,
    windows: &[MemoryBlockedWindow],
) -> bool {
    windows
        .iter()
        .any(|window| scheduled_task_is_memory_window_row(task, window))
}

fn frontmatter_hours_to_minutes(fm: &markdown_parser::Frontmatter, key: &str) -> i32 {
    frontmatter_f64(fm, key)
        .map(|hours| (hours.max(0.0) * 60.0).round() as i32)
        .unwrap_or(0)
}

fn frontmatter_minutes(fm: &markdown_parser::Frontmatter, key: &str) -> i32 {
    frontmatter_f64(fm, key)
        .map(|minutes| minutes.max(0.0).round() as i32)
        .unwrap_or(0)
}

fn memory_capacity_minutes(
    fm: &markdown_parser::Frontmatter,
    body: &str,
    blocked_windows: &[MemoryBlockedWindow],
) -> Option<i32> {
    if let Some(hours) =
        frontmatter_f64(fm, "task_capacity_hours_per_day").or_else(|| memory_hours_from_body(body))
    {
        return Some((hours * 60.0).round().max(0.0) as i32);
    }

    let has_capacity_inputs = [
        "sleep_hours_needed",
        "downtime_hours_needed",
        "exercise_minutes_needed",
        "socialization_minutes_needed",
        "self_care_minutes_needed",
    ]
    .iter()
    .any(|key| fm.get(*key).is_some())
        || !blocked_windows.is_empty();

    if !has_capacity_inputs {
        return None;
    }

    let blocked_minutes: i32 = blocked_windows.iter().map(window_duration_minutes).sum();
    let minutes = 24 * 60
        - frontmatter_hours_to_minutes(fm, "sleep_hours_needed")
        - frontmatter_hours_to_minutes(fm, "downtime_hours_needed")
        - frontmatter_minutes(fm, "exercise_minutes_needed")
        - frontmatter_minutes(fm, "socialization_minutes_needed")
        - frontmatter_minutes(fm, "self_care_minutes_needed")
        - blocked_minutes;
    Some(minutes.clamp(0, 8 * 60))
}

fn memory_hours_from_body(body: &str) -> Option<f64> {
    body.lines().find_map(|line| {
        let lower = line.to_ascii_lowercase();
        let mentions_capacity = lower.contains("task capacity") || lower.contains("work capacity");
        let mentions_hours =
            lower.contains("hour") || lower.contains("hours/day") || lower.contains("hrs");
        if mentions_capacity && mentions_hours {
            first_positive_f64(&lower)
        } else {
            None
        }
    })
}

fn memory_task_count_from_body(body: &str) -> Option<usize> {
    body.lines().find_map(|line| {
        let lower = line.to_ascii_lowercase();
        let mentions_task_count = lower.contains("task count")
            || lower.contains("tasks per day")
            || lower.contains("tasks/day")
            || lower.contains("daily tasks")
            || lower.contains("tasks each day")
            || lower.contains("tasks a day");
        if mentions_task_count {
            first_positive_usize(&lower)
        } else {
            None
        }
    })
}

fn memory_task_count_per_day(fm: &markdown_parser::Frontmatter, body: &str) -> Option<usize> {
    frontmatter_usize_any(
        fm,
        &[
            "task_capacity_tasks_per_day",
            "task_count_per_day",
            "tasks_per_day",
            "daily_task_count",
        ],
    )
    .or_else(|| memory_task_count_from_body(body))
    .map(|count| count.min(50))
}

fn append_memory_list_line(lines: &mut Vec<String>, label: &str, items: Vec<String>) {
    if !items.is_empty() {
        lines.push(format!("{label}: {}", items.join("; ")));
    }
}

fn memory_planning_context_for_date(
    vault_id: &str,
    app_state: &AppState,
    date: NaiveDate,
) -> Result<Option<MemoryPlanningContext>, AppError> {
    let memory_path = {
        let vaults = app_state
            .vaults
            .lock()
            .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
        let vault = vaults
            .get(vault_id)
            .ok_or_else(|| AppError::vault_not_open(vault_id))?;
        vault.structure().memory_file()
    };

    if !memory_path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(memory_path)?;
    let (fm, body) = markdown_parser::parse_frontmatter(&content)?;

    let consent = fm.get("consent").and_then(|v| v.as_mapping());
    let remote_allowed = consent
        .and_then(|map| mapping_bool(map, "allow_remote_ai_context", "allowRemoteAiContext"))
        .unwrap_or(false);

    let mut blocked_windows = read_memory_windows(&fm, "meal_windows", date);
    blocked_windows.extend(read_memory_windows(&fm, "snack_windows", date));
    blocked_windows.sort_by_key(|window| window.start);
    let capacity_minutes = memory_capacity_minutes(&fm, &body, &blocked_windows);
    let target_task_count = memory_task_count_per_day(&fm, &body);

    let mut lines = Vec::new();
    if let Some(count) = target_task_count {
        lines.push(format!("Target Agenda task count today: {count} tasks"));
    }
    if let Some(minutes) = capacity_minutes {
        lines.push(format!("Task capacity today: {minutes} minutes"));
    }
    if let Some(hours) = frontmatter_f64(&fm, "sleep_hours_needed") {
        lines.push(format!("Sleep needed: {hours} hours"));
    }
    if let Some(hours) = frontmatter_f64(&fm, "downtime_hours_needed") {
        lines.push(format!("Downtime needed: {hours} hours"));
    }
    for window in &blocked_windows {
        lines.push(format!(
            "Fixed Agenda row: {} {}-{}; do not schedule work during it",
            window.label,
            format_agenda_time(window.start),
            format_agenda_time(window.end)
        ));
    }
    for (key, label) in [
        ("exercise_minutes_needed", "Exercise needed"),
        ("socialization_minutes_needed", "Social time needed"),
        ("self_care_minutes_needed", "Self-care needed"),
    ] {
        if let Some(minutes) = frontmatter_f64(&fm, key) {
            lines.push(format!("{label}: {minutes} minutes"));
        }
    }
    append_memory_list_line(
        &mut lines,
        "Preferences",
        frontmatter_string_list(&fm, "likes"),
    );
    append_memory_list_line(
        &mut lines,
        "Poor-fit work",
        frontmatter_string_list(&fm, "dislikes"),
    );
    append_memory_list_line(
        &mut lines,
        "Limitations",
        frontmatter_string_list(&fm, "limitations"),
    );

    Ok(Some(MemoryPlanningContext {
        capacity_minutes,
        target_task_count,
        blocked_windows,
        remote_allowed,
        prompt_lines: lines,
    }))
}

pub(crate) fn memory_prompt_context(
    vault_id: &str,
    app_state: &AppState,
    date: NaiveDate,
) -> Result<Option<String>, AppError> {
    let Some(memory) = memory_planning_context_for_date(vault_id, app_state, date)? else {
        return Ok(None);
    };
    if !memory.remote_allowed || memory.prompt_lines.is_empty() {
        return Ok(None);
    }
    let mut context = String::from("## Memory Planning Context\n");
    context.push_str("Consent: Memory may be used for this remote AI Agenda request.\n");
    for line in memory.prompt_lines {
        context.push_str("- ");
        context.push_str(&line);
        context.push('\n');
    }
    Ok(Some(context))
}

pub(crate) fn memory_agenda_targets_for_date(
    vault_id: &str,
    app_state: &AppState,
    date: NaiveDate,
) -> Result<MemoryAgendaTargets, AppError> {
    Ok(memory_planning_context_for_date(vault_id, app_state, date)?
        .map(|memory| memory.agenda_targets())
        .unwrap_or_default())
}

fn next_available_start(
    mut cursor: NaiveTime,
    duration_minutes: i32,
    blocked_windows: &[MemoryBlockedWindow],
) -> NaiveTime {
    loop {
        let end = cursor + Duration::minutes(duration_minutes.into());
        let Some(block) = blocked_windows
            .iter()
            .find(|window| cursor < window.end && end > window.start)
        else {
            return cursor;
        };
        cursor = block.end;
    }
}

fn apply_memory_to_schedule(
    scheduled_tasks: Vec<ScheduledTask>,
    generated_at: &str,
    memory: &MemoryPlanningContext,
    visible_memory_start: Option<NaiveTime>,
) -> Vec<ScheduledTask> {
    let mut cursor = parse_generated_time(generated_at);
    let mut scheduled_minutes = 0;
    let mut scheduled_count = 0usize;
    let mut seen = HashSet::new();

    let mut adjusted: Vec<ScheduledTask> = scheduled_tasks
        .into_iter()
        .filter_map(|mut task| {
            if scheduled_task_matches_any_memory_window(&task, &memory.blocked_windows) {
                return None;
            }
            if !seen.insert(task.task_id.clone()) {
                return None;
            }
            let duration = task.duration_minutes.max(5);
            if let Some(target_count) = memory.target_task_count {
                if scheduled_count >= target_count {
                    return None;
                }
            }
            if let Some(capacity) = memory.capacity_minutes {
                if scheduled_minutes + duration > capacity {
                    return None;
                }
            }
            cursor = next_available_start(cursor, duration, &memory.blocked_windows);
            let start_time = format_agenda_time(cursor);
            cursor += Duration::minutes(duration.into());
            scheduled_minutes += duration;
            scheduled_count += 1;
            task.start_time = start_time;
            task.duration_minutes = duration;
            Some(task)
        })
        .collect();

    adjusted.extend(memory_window_scheduled_tasks(
        &memory.blocked_windows,
        visible_memory_start,
    ));
    normalize_scheduled_tasks_chronologically(&mut adjusted);
    adjusted
}

fn apply_memory_limits_to_explicit_schedule(
    scheduled_tasks: Vec<ScheduledTask>,
    memory: &MemoryPlanningContext,
    visible_memory_start: Option<NaiveTime>,
) -> Vec<ScheduledTask> {
    let mut scheduled_minutes = 0;
    let mut scheduled_count = 0usize;
    let mut seen = HashSet::new();

    let mut adjusted: Vec<ScheduledTask> = scheduled_tasks
        .into_iter()
        .filter_map(|mut task| {
            if scheduled_task_is_any_memory_window_row(&task, &memory.blocked_windows) {
                return None;
            }
            if !seen.insert(task.task_id.clone()) {
                return None;
            }
            let duration = task.duration_minutes.max(5);
            if let Some(target_count) = memory.target_task_count {
                if scheduled_count >= target_count {
                    return None;
                }
            }
            if let Some(capacity) = memory.capacity_minutes {
                if scheduled_minutes + duration > capacity {
                    return None;
                }
            }
            scheduled_minutes += duration;
            scheduled_count += 1;
            task.duration_minutes = duration;
            Some(task)
        })
        .collect();

    adjusted.extend(memory_window_scheduled_tasks(
        &memory.blocked_windows,
        visible_memory_start,
    ));
    normalize_scheduled_tasks_chronologically(&mut adjusted);
    adjusted
}

fn should_apply_memory_to_explicit_schedule(generated_by: &str) -> bool {
    matches!(generated_by, "ai" | "heuristic")
}

fn scheduled_task_from_plan_order(
    task_id: &str,
    plan: &DailyPlan,
    task_quadrants: &HashMap<String, String>,
) -> ScheduledTask {
    let title = plan
        .task_titles
        .get(task_id)
        .cloned()
        .unwrap_or_else(|| task_id.trim_start_matches("task_").replace('_', " "));
    ScheduledTask {
        id: format!("scheduled_{task_id}"),
        task_id: task_id.to_string(),
        title: title.clone(),
        start_time: "12:00 AM".to_string(),
        duration_minutes: infer_duration_minutes(&title),
        estimate_source: Some("inferred".to_string()),
        eisenhower_quadrant: task_quadrants.get(task_id).cloned(),
    }
}

fn append_missing_task_order_rows(
    scheduled_tasks: &mut Vec<ScheduledTask>,
    plan: &DailyPlan,
    task_quadrants: &HashMap<String, String>,
) {
    let mut seen: HashSet<String> = scheduled_tasks
        .iter()
        .map(|task| task.task_id.clone())
        .collect();

    for task_id in &plan.task_order {
        if seen.insert(task_id.clone()) {
            scheduled_tasks.push(scheduled_task_from_plan_order(
                task_id,
                plan,
                task_quadrants,
            ));
        }
    }
}

pub(crate) fn apply_memory_to_generated_schedule_for_date(
    vault_id: &str,
    app_state: &AppState,
    date: NaiveDate,
    plan: &DailyPlan,
    mut scheduled_tasks: Vec<ScheduledTask>,
    generated_at: &str,
    task_quadrants: &HashMap<String, String>,
) -> Result<Vec<ScheduledTask>, AppError> {
    let visible_memory_start = generated_schedule_visible_memory_start(date, generated_at);
    let Some(memory) = memory_planning_context_for_date(vault_id, app_state, date)? else {
        return Ok(apply_memory_to_schedule(
            scheduled_tasks,
            generated_at,
            &MemoryPlanningContext::default(),
            visible_memory_start,
        ));
    };
    if memory.agenda_targets().has_any_target() {
        append_missing_task_order_rows(&mut scheduled_tasks, plan, task_quadrants);
    }
    Ok(apply_memory_to_schedule(
        scheduled_tasks,
        generated_at,
        &memory,
        visible_memory_start,
    ))
}

pub(crate) fn apply_memory_limits_to_explicit_schedule_for_date(
    vault_id: &str,
    app_state: &AppState,
    date: NaiveDate,
    scheduled_tasks: Vec<ScheduledTask>,
) -> Result<Vec<ScheduledTask>, AppError> {
    let Some(memory) = memory_planning_context_for_date(vault_id, app_state, date)? else {
        return Ok(scheduled_tasks);
    };
    Ok(apply_memory_limits_to_explicit_schedule(
        scheduled_tasks,
        &memory,
        None,
    ))
}

pub(crate) fn task_quadrants_from_vault(
    vault_id: &str,
    app_state: &AppState,
    date: NaiveDate,
) -> Result<HashMap<String, String>, AppError> {
    let vaults = app_state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let vault = vaults
        .get(vault_id)
        .ok_or_else(|| AppError::vault_not_open(vault_id))?;

    let domain_thresholds = domain_thresholds_from_vault(vault);
    let mut quadrants = HashMap::new();
    for gid in vault.list_goals().unwrap_or_default() {
        let Ok((goal_fm, _)) = vault.read_goal(&gid) else {
            continue;
        };
        let goal_priority = goal_fm
            .get("priority")
            .and_then(|v| v.as_str())
            .unwrap_or("medium")
            .to_string();
        let thresholds = goal_domain_from_frontmatter(&goal_fm)
            .and_then(|domain| normalized_domain_key(&domain))
            .and_then(|domain| domain_thresholds.get(&domain).copied())
            .unwrap_or_default();

        let goal_tasks = match list_goal_frontmatter_tasks_from_manager(vault, &gid) {
            Ok(tasks) => tasks,
            Err(error) => {
                log::warn!("Failed to load goal task frontmatter for '{gid}': {error}");
                continue;
            }
        };

        let scheduled_dates_by_id: HashMap<String, String> = goal_tasks
            .iter()
            .filter_map(|task| {
                task_specific_agenda_date(task)
                    .map(|scheduled_date| (task.id.clone(), scheduled_date.to_string()))
            })
            .collect();

        for task in goal_tasks {
            let scheduled_date = task_specific_agenda_date(&task)
                .map(str::to_string)
                .or_else(|| {
                    task.parent_id
                        .as_deref()
                        .and_then(|parent_id| scheduled_dates_by_id.get(parent_id).cloned())
                });
            let quadrant = title_inferred_eisenhower_quadrant(&task.title).unwrap_or_else(|| {
                derive_eisenhower_quadrant_with_thresholds(
                    Some(&goal_priority),
                    task.due_date.as_deref(),
                    scheduled_date.as_deref(),
                    date,
                    thresholds,
                )
            });
            quadrants.insert(task.id, quadrant);
        }
    }
    Ok(quadrants)
}

#[derive(Debug, Clone)]
struct HeuristicAgendaCandidate {
    task_id: String,
    title: String,
    due_date: Option<String>,
    deferral_count: i32,
    eisenhower_quadrant: String,
    specific_to_date: bool,
}

pub(crate) fn task_specific_agenda_date(task: &GoalFrontmatterTask) -> Option<&str> {
    task.scheduled_date
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn scheduled_date_allows_agenda_date(scheduled_date: Option<&str>, date: NaiveDate) -> bool {
    let Some(scheduled_date) = scheduled_date
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return true;
    };
    scheduled_date == date.to_string()
}

pub(crate) fn is_pending_agenda_task_for_scheduled_date(
    task: &GoalFrontmatterTask,
    date: NaiveDate,
    scheduled_date: Option<&str>,
) -> bool {
    let is_recurring = task.recurring.as_deref().is_some_and(|s| !s.is_empty());

    if matches!(task.status.as_str(), "archived" | "blocked" | "cancelled") {
        return false;
    }
    if matches!(task.status.as_str(), "completed" | "done") && !is_recurring {
        return false;
    }
    if task.completed_at.is_some() && !is_recurring {
        return false;
    }

    scheduled_date_allows_agenda_date(scheduled_date, date)
}

fn sort_heuristic_agenda_candidates(candidates: &mut [HeuristicAgendaCandidate]) {
    candidates.sort_by(|a, b| {
        quadrant_sort_rank(&a.eisenhower_quadrant)
            .cmp(&quadrant_sort_rank(&b.eisenhower_quadrant))
            .then_with(|| {
                a.due_date
                    .as_deref()
                    .unwrap_or("9999-12-31")
                    .cmp(b.due_date.as_deref().unwrap_or("9999-12-31"))
            })
            .then_with(|| b.deferral_count.cmp(&a.deferral_count))
            .then_with(|| a.title.cmp(&b.title))
            .then_with(|| a.task_id.cmp(&b.task_id))
    });
}

fn heuristic_agenda_candidates_from_vault(
    vault_id: &str,
    app_state: &AppState,
    date: NaiveDate,
) -> Result<Vec<HeuristicAgendaCandidate>, AppError> {
    let mut candidates = {
        let vaults = app_state
            .vaults
            .lock()
            .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
        let vault = vaults
            .get(vault_id)
            .ok_or_else(|| AppError::vault_not_open(vault_id))?;

        let mut collected_tasks: Vec<(String, GoalFrontmatterTask)> = Vec::new();
        for gid in vault.list_goals().unwrap_or_default() {
            let Ok((fm, _body)) = vault.read_goal(&gid) else {
                continue;
            };
            let status = fm
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("active");
            if matches!(status, "archived" | "completed" | "abandoned") {
                continue;
            }

            let goal_priority = fm
                .get("priority")
                .and_then(|v| v.as_str())
                .unwrap_or("medium")
                .to_string();

            let goal_tasks = match list_goal_frontmatter_tasks_from_manager(vault, &gid) {
                Ok(tasks) => tasks,
                Err(error) => {
                    log::warn!("Failed to load goal task frontmatter for '{gid}': {error}");
                    continue;
                }
            };
            collected_tasks.extend(
                goal_tasks
                    .into_iter()
                    .map(|task| (goal_priority.clone(), task)),
            );
        }

        let scheduled_dates_by_id: HashMap<String, String> = collected_tasks
            .iter()
            .filter_map(|(_, task)| {
                task_specific_agenda_date(task)
                    .map(|scheduled_date| (task.id.clone(), scheduled_date.to_string()))
            })
            .collect();
        let effective_scheduled_date = |task: &GoalFrontmatterTask| {
            task_specific_agenda_date(task)
                .map(str::to_string)
                .or_else(|| {
                    task.parent_id
                        .as_deref()
                        .and_then(|parent_id| scheduled_dates_by_id.get(parent_id).cloned())
                })
        };
        let date_text = date.to_string();
        let parent_ids_with_children: HashSet<String> = collected_tasks
            .iter()
            .filter(|(_, task)| {
                let scheduled_date = effective_scheduled_date(task);
                is_pending_agenda_task_for_scheduled_date(task, date, scheduled_date.as_deref())
            })
            .filter_map(|(_, task)| task.parent_id.clone())
            .collect();

        collected_tasks
            .into_iter()
            .filter_map(|(goal_priority, task)| {
                let scheduled_date = effective_scheduled_date(&task);
                let is_pending = is_pending_agenda_task_for_scheduled_date(
                    &task,
                    date,
                    scheduled_date.as_deref(),
                );
                if !is_pending || parent_ids_with_children.contains(&task.id) {
                    return None;
                }
                let specific_to_date = scheduled_date.as_deref() == Some(date_text.as_str());
                let due_date = task.due_date.clone().or_else(|| scheduled_date.clone());
                let eisenhower_quadrant = derive_eisenhower_quadrant_for_task_title(
                    &task.title,
                    Some(&goal_priority),
                    task.due_date.as_deref(),
                    scheduled_date.as_deref(),
                    date,
                );

                Some(HeuristicAgendaCandidate {
                    task_id: task.id,
                    title: task.title,
                    due_date,
                    deferral_count: 0,
                    eisenhower_quadrant,
                    specific_to_date,
                })
            })
            .collect::<Vec<_>>()
    };

    for candidate in &mut candidates {
        candidate.deferral_count = with_db(vault_id, app_state, |db| {
            db.get_deferral_count(&candidate.task_id)
        })
        .unwrap_or(0);
    }

    let mut specific_to_date = Vec::new();
    let mut flexible = Vec::new();
    for candidate in candidates {
        if candidate.specific_to_date {
            specific_to_date.push(candidate);
        } else {
            flexible.push(candidate);
        }
    }
    sort_heuristic_agenda_candidates(&mut specific_to_date);
    sort_heuristic_agenda_candidates(&mut flexible);

    let flexible_limit = 8usize.saturating_sub(specific_to_date.len());
    specific_to_date.extend(flexible.into_iter().take(flexible_limit));
    Ok(specific_to_date)
}

pub(crate) fn build_scheduled_tasks(
    plan: &DailyPlan,
    generated_at: &str,
    task_quadrants: &HashMap<String, String>,
) -> Vec<ScheduledTask> {
    let mut cursor = parse_generated_time(generated_at);
    plan.task_order
        .iter()
        .map(|task_id| {
            let title = plan
                .task_titles
                .get(task_id)
                .cloned()
                .unwrap_or_else(|| task_id.trim_start_matches("task_").replace('_', " "));
            let duration = infer_duration_minutes(&title);
            let start_time = format_agenda_time(cursor);
            cursor += Duration::minutes(duration.into());
            let eisenhower_quadrant = title_inferred_eisenhower_quadrant(&title)
                .or_else(|| task_quadrants.get(task_id).cloned());
            ScheduledTask {
                id: format!("scheduled_{task_id}"),
                task_id: task_id.clone(),
                title,
                start_time,
                duration_minutes: duration,
                estimate_source: Some("inferred".to_string()),
                eisenhower_quadrant,
            }
        })
        .collect()
}

fn apply_task_quadrants_to_scheduled_tasks(
    scheduled_tasks: &mut [ScheduledTask],
    task_quadrants: &HashMap<String, String>,
) {
    for task in scheduled_tasks {
        if let Some(quadrant) = title_inferred_eisenhower_quadrant(&task.title)
            .or_else(|| task_quadrants.get(&task.task_id).cloned())
        {
            task.eisenhower_quadrant = Some(quadrant.clone());
        }
    }
}

fn agenda_completed_ids(fm: &markdown_parser::Frontmatter) -> Vec<String> {
    agenda_string_ids(fm, "completed_task_ids")
}

fn agenda_string_ids(fm: &markdown_parser::Frontmatter, key: &str) -> Vec<String> {
    fm.get(key)
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn scheduled_task_row_error(index: usize, field: &str, message: &str) -> AppError {
    AppError::validation_error(format!(
        "Invalid Agenda scheduled_tasks[{index}].{field}: {message}"
    ))
}

fn scheduled_task_row_string(
    item: &serde_yaml::Value,
    index: usize,
    snake: &str,
    camel: &str,
) -> Result<String, AppError> {
    item.get(snake)
        .or_else(|| item.get(camel))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| scheduled_task_row_error(index, snake, "field is required"))
}

fn agenda_scheduled_tasks(
    fm: &markdown_parser::Frontmatter,
) -> Result<Vec<ScheduledTask>, AppError> {
    let Some(value) = fm.get("scheduled_tasks") else {
        return Ok(Vec::new());
    };
    let Some(seq) = value.as_sequence() else {
        return Err(AppError::validation_error(
            "Invalid Agenda scheduled_tasks: expected a list",
        ));
    };

    let mut tasks = Vec::with_capacity(seq.len());
    for (index, item) in seq.iter().enumerate() {
        if !item.is_mapping() {
            return Err(AppError::validation_error(format!(
                "Invalid Agenda scheduled_tasks[{index}]: expected an object"
            )));
        }

        let duration_minutes = item
            .get("duration_minutes")
            .or_else(|| item.get("durationMinutes"))
            .and_then(|v| v.as_i64())
            .ok_or_else(|| {
                scheduled_task_row_error(index, "duration_minutes", "field is required")
            })?;

        tasks.push(ScheduledTask {
            id: scheduled_task_row_string(item, index, "id", "id")?,
            task_id: scheduled_task_row_string(item, index, "task_id", "taskId")?,
            title: scheduled_task_row_string(item, index, "title", "title")?,
            start_time: scheduled_task_row_string(item, index, "start_time", "startTime")?,
            duration_minutes: i32::try_from(duration_minutes).map_err(|_| {
                scheduled_task_row_error(index, "duration_minutes", "value is out of range")
            })?,
            estimate_source: item
                .get("estimate_source")
                .or_else(|| item.get("estimateSource"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            eisenhower_quadrant: item
                .get("eisenhower_quadrant")
                .or_else(|| item.get("eisenhowerQuadrant"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        });
    }

    validate_scheduled_tasks(tasks)
}

fn extract_body_task_id(line: &str) -> Option<String> {
    let marker = "task_id:";
    let start = line.find(marker)? + marker.len();
    let rest = &line[start..];
    let end = rest.find("-->").unwrap_or(rest.len());
    let task_id = rest[..end].trim();
    if task_id.is_empty() {
        None
    } else {
        Some(task_id.to_string())
    }
}

fn parse_body_duration_minutes(text: &str) -> Option<i32> {
    let (_, suffix) = text.rsplit_once('(')?;
    let raw = suffix.trim_end_matches(')').trim();
    let minutes = raw.strip_suffix("min")?.trim().parse::<i32>().ok()?;
    Some(minutes.max(5))
}

fn parse_agenda_body_schedule(
    body: &str,
    frontmatter_tasks: &[ScheduledTask],
) -> (Vec<ScheduledTask>, Vec<String>) {
    let frontmatter_by_id: HashMap<&str, &ScheduledTask> = frontmatter_tasks
        .iter()
        .map(|task| (task.task_id.as_str(), task))
        .collect();
    let mut scheduled = Vec::new();
    let mut completed = Vec::new();

    for line in body.lines() {
        let trimmed = line.trim();
        let checked = if trimmed.starts_with("- [x]") || trimmed.starts_with("- [X]") {
            true
        } else if trimmed.starts_with("- [ ]") {
            false
        } else {
            continue;
        };

        let Some(task_id) = extract_body_task_id(trimmed) else {
            continue;
        };
        if checked {
            completed.push(task_id.clone());
        }

        let visible = trimmed
            .find("<!--")
            .map(|idx| &trimmed[..idx])
            .unwrap_or(trimmed);
        let row_text = visible.get(5..).unwrap_or("").trim();
        let fallback = frontmatter_by_id.get(task_id.as_str()).copied();

        let (start_time, title_source) = split_schedule_row_time(row_text)
            .map(|(time, rest)| (format_agenda_time(time), rest))
            .or_else(|| {
                fallback.map(|task| {
                    (
                        task.start_time.clone(),
                        row_text
                            .strip_prefix(&task.start_time)
                            .unwrap_or(row_text)
                            .trim(),
                    )
                })
            })
            .unwrap_or_else(|| ("12:00 AM".to_string(), row_text));

        let duration = parse_body_duration_minutes(row_text)
            .or_else(|| fallback.map(|task| task.duration_minutes))
            .unwrap_or(30);

        let title = title_source
            .rsplit_once('(')
            .map(|(title, _)| title.trim())
            .filter(|title| !title.is_empty())
            .map(str::to_string)
            .or_else(|| fallback.map(|task| task.title.clone()))
            .unwrap_or_else(|| task_id.trim_start_matches("task_").replace('_', " "));

        scheduled.push(ScheduledTask {
            id: fallback
                .map(|task| task.id.clone())
                .unwrap_or_else(|| format!("scheduled_{task_id}")),
            task_id,
            title,
            start_time,
            duration_minutes: duration,
            estimate_source: fallback
                .and_then(|task| task.estimate_source.clone())
                .or_else(|| Some("manual".to_string())),
            eisenhower_quadrant: fallback.and_then(|task| task.eisenhower_quadrant.clone()),
        });
    }

    (scheduled, completed)
}

fn scheduled_tasks_frontmatter_value(tasks: &[ScheduledTask]) -> serde_yaml::Value {
    serde_yaml::Value::Sequence(
        tasks
            .iter()
            .map(|task| {
                let mut map = serde_yaml::Mapping::new();
                map.insert("id".into(), serde_yaml::Value::String(task.id.clone()));
                map.insert(
                    "task_id".into(),
                    serde_yaml::Value::String(task.task_id.clone()),
                );
                map.insert(
                    "title".into(),
                    serde_yaml::Value::String(task.title.clone()),
                );
                map.insert(
                    "start_time".into(),
                    serde_yaml::Value::String(task.start_time.clone()),
                );
                map.insert(
                    "duration_minutes".into(),
                    serde_yaml::Value::Number(serde_yaml::Number::from(task.duration_minutes)),
                );
                if let Some(estimate_source) = &task.estimate_source {
                    map.insert(
                        "estimate_source".into(),
                        serde_yaml::Value::String(estimate_source.clone()),
                    );
                }
                if let Some(quadrant) = &task.eisenhower_quadrant {
                    map.insert(
                        "eisenhower_quadrant".into(),
                        serde_yaml::Value::String(quadrant.clone()),
                    );
                }
                serde_yaml::Value::Mapping(map)
            })
            .collect(),
    )
}

fn log_agenda_read_error(
    vault_id: &str,
    app_state: &AppState,
    path: &Path,
    error: &AppError,
) -> Result<(), AppError> {
    let vaults = app_state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let vault = vaults
        .get(vault_id)
        .ok_or_else(|| AppError::vault_not_open(vault_id))?;
    vault.log_vault_error(path, &error.message)?;
    Ok(())
}

fn reconcile_completion_from_goal_status(
    vault_id: &str,
    app_state: &AppState,
    plan: &mut DailyPlan,
) -> Result<bool, AppError> {
    if plan.scheduled_tasks.is_empty() {
        return Ok(false);
    }

    let visible_task_ids: HashSet<&str> = plan
        .scheduled_tasks
        .iter()
        .map(|task| task.task_id.as_str())
        .collect();
    let mut completed_goal_task_ids = HashSet::new();
    {
        let vaults = app_state
            .vaults
            .lock()
            .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
        let vault = vaults
            .get(vault_id)
            .ok_or_else(|| AppError::vault_not_open(vault_id))?;
        for goal_id in vault.list_goals()? {
            let tasks = match list_goal_frontmatter_tasks_from_manager(vault, &goal_id) {
                Ok(tasks) => tasks,
                Err(error) => {
                    log::warn!("Failed to load goal task frontmatter for '{goal_id}': {error}");
                    continue;
                }
            };
            for task in tasks {
                if task.status == "completed" && visible_task_ids.contains(task.id.as_str()) {
                    completed_goal_task_ids.insert(task.id);
                }
            }
        }
    }

    if completed_goal_task_ids.is_empty() {
        return Ok(false);
    }

    let mut existing_completed: HashSet<String> = plan.completed_task_ids.iter().cloned().collect();
    let mut changed = false;
    for task in &plan.scheduled_tasks {
        if completed_goal_task_ids.contains(&task.task_id)
            && !existing_completed.contains(&task.task_id)
        {
            plan.completed_task_ids.push(task.task_id.clone());
            existing_completed.insert(task.task_id.clone());
            changed = true;
        }
    }
    if changed {
        plan.updated_at = Local::now().naive_local();
    }
    Ok(changed)
}

fn agenda_body_with_completion_markers(body: &str, completed_task_ids: &HashSet<&str>) -> String {
    let mut repaired = Vec::new();
    for line in body.lines() {
        let trimmed = line.trim_start();
        let checked_row = trimmed.starts_with("- [x]")
            || trimmed.starts_with("- [X]")
            || trimmed.starts_with("- [ ]");
        let Some(task_id) = extract_body_task_id(trimmed) else {
            repaired.push(line.to_string());
            continue;
        };
        if !checked_row {
            repaired.push(line.to_string());
            continue;
        }

        let leading_len = line.len() - trimmed.len();
        let check_index = leading_len + 3;
        let check = if completed_task_ids.contains(task_id.as_str()) {
            "x"
        } else {
            " "
        };
        repaired.push(format!(
            "{}{}{}",
            &line[..check_index],
            check,
            &line[check_index + 1..]
        ));
    }

    let mut body = repaired.join("\n");
    if !body.ends_with('\n') {
        body.push('\n');
    }
    body
}

fn write_repaired_agenda_completion(
    vault_id: &str,
    app_state: &AppState,
    path: &Path,
    fm: &markdown_parser::Frontmatter,
    body: &str,
    plan: &DailyPlan,
) -> Result<(), AppError> {
    let mut repaired_fm = fm.clone();
    repaired_fm.insert(
        "completed_task_ids".into(),
        serde_yaml::to_value(&plan.completed_task_ids).unwrap_or_default(),
    );
    repaired_fm.insert(
        "updated".into(),
        serde_yaml::Value::String(Local::now().to_rfc3339()),
    );
    let completed: HashSet<&str> = plan.completed_task_ids.iter().map(String::as_str).collect();
    let repaired_body = agenda_body_with_completion_markers(body, &completed);
    let content = markdown_parser::serialize_frontmatter(&repaired_fm, &repaired_body);

    let vaults = app_state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let vault = vaults
        .get(vault_id)
        .ok_or_else(|| AppError::vault_not_open(vault_id))?;
    vault.write_markdown_file(
        path,
        &content,
        "system",
        "repair_agenda_completion",
        Some(&plan.id),
    )?;
    Ok(())
}

fn repair_goal_completion_from_agenda(
    vault_id: &str,
    app_state: &AppState,
    plan: &DailyPlan,
) -> Result<bool, AppError> {
    if plan.scheduled_tasks.is_empty() || plan.completed_task_ids.is_empty() {
        return Ok(false);
    }

    let completed_ids: HashSet<&str> = plan.completed_task_ids.iter().map(String::as_str).collect();
    let visible_completed_task_ids: HashSet<&str> = plan
        .scheduled_tasks
        .iter()
        .filter_map(|task| {
            completed_ids
                .contains(task.task_id.as_str())
                .then_some(task.task_id.as_str())
        })
        .collect();
    if visible_completed_task_ids.is_empty() {
        return Ok(false);
    }

    let vaults = app_state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let vault = vaults
        .get(vault_id)
        .ok_or_else(|| AppError::vault_not_open(vault_id))?;
    let mut repaired = false;

    for goal_id in vault.list_goals()? {
        let tasks = match list_goal_frontmatter_tasks_from_manager(vault, &goal_id) {
            Ok(tasks) => tasks,
            Err(error) => {
                log::warn!("Failed to load goal task frontmatter for '{goal_id}': {error}");
                continue;
            }
        };
        let typed_task_ids: HashSet<String> = tasks.iter().map(|task| task.id.clone()).collect();
        let repair_task_ids: Vec<String> = tasks
            .into_iter()
            .filter(|task| {
                task.status != "completed" && visible_completed_task_ids.contains(task.id.as_str())
            })
            .map(|task| task.id)
            .collect();
        let fallback_task_ids: Vec<String> = visible_completed_task_ids
            .iter()
            .filter(|task_id| !typed_task_ids.contains(**task_id))
            .map(|task_id| (*task_id).to_string())
            .collect();

        for task_id in repair_task_ids.into_iter().chain(fallback_task_ids) {
            let (frontmatter, body) = match build_goal_frontmatter_task_status_update(
                vault,
                &goal_id,
                &task_id,
                "completed",
            ) {
                Ok(update) => update,
                Err(error) if error.code == "VALIDATION_ERROR" => {
                    log::warn!(
                        "Skipping Agenda-to-Goal completion repair for '{goal_id}' task '{task_id}': {error}"
                    );
                    push_agenda_warning(
                        vault_id,
                        plan.date,
                        format!(
                            "Agenda marked '{task_id}' complete, but GoalRate could not update Goal '{goal_id}' because its task frontmatter is invalid. Check logs/errors.md."
                        ),
                    )?;
                    continue;
                }
                Err(error) if error.code == "ITEM_NOT_FOUND" => {
                    continue;
                }
                Err(error) => return Err(error),
            };
            vault.write_goal_with_audit(
                &goal_id,
                &frontmatter,
                &body,
                "system",
                "repair_goal_completion_from_agenda",
            )?;
            repaired = true;
        }
    }

    Ok(repaired)
}

pub(crate) fn read_agenda_overlay(
    vault_id: &str,
    app_state: &AppState,
    mut plan: DailyPlan,
) -> Result<DailyPlan, AppError> {
    replace_agenda_warnings(vault_id, plan.date, Vec::new())?;
    let path = {
        let vaults = app_state
            .vaults
            .lock()
            .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
        let vault = vaults
            .get(vault_id)
            .ok_or_else(|| AppError::vault_not_open(vault_id))?;
        vault.structure().agenda_file(&plan.date.to_string())
    };

    if !path.exists() {
        return Ok(plan);
    }

    let content = std::fs::read_to_string(&path)?;
    let (fm, body) = match markdown_parser::parse_frontmatter(&content) {
        Ok(parsed) => parsed,
        Err(err) => {
            let error: AppError = err.into();
            log_agenda_read_error(vault_id, app_state, &path, &error)?;
            return Err(error);
        }
    };
    if let Some(generated_at) = fm.get("generated_at").and_then(|v| v.as_str()) {
        plan.generated_at = Some(generated_at.to_string());
    }
    let top_outcome_ids = agenda_string_ids(&fm, "top_outcome_ids");
    if !top_outcome_ids.is_empty() || fm.contains_key("top_outcome_ids") {
        plan.top_3_outcome_ids = top_outcome_ids;
    }
    let frontmatter_scheduled_tasks = match agenda_scheduled_tasks(&fm) {
        Ok(tasks) => tasks,
        Err(error) => {
            log_agenda_read_error(vault_id, app_state, &path, &error)?;
            return Err(error);
        }
    };
    let (body_scheduled_tasks, body_completed) =
        parse_agenda_body_schedule(&body, &frontmatter_scheduled_tasks);
    let body_had_schedule = !body_scheduled_tasks.is_empty();
    let mut scheduled_tasks = if body_had_schedule {
        body_scheduled_tasks
    } else {
        frontmatter_scheduled_tasks
    };
    normalize_scheduled_tasks_chronologically(&mut scheduled_tasks);
    if !scheduled_tasks.is_empty() {
        plan.task_order = scheduled_tasks
            .iter()
            .map(|task| task.task_id.clone())
            .collect();
        for task in &scheduled_tasks {
            plan.task_titles
                .insert(task.task_id.clone(), task.title.clone());
        }
        plan.scheduled_tasks = scheduled_tasks;
    }
    if body_had_schedule {
        plan.completed_task_ids = body_completed;
    } else {
        let completed = agenda_completed_ids(&fm);
        if !completed.is_empty() || fm.contains_key("completed_task_ids") {
            plan.completed_task_ids = completed;
        }
    }
    if reconcile_completion_from_goal_status(vault_id, app_state, &mut plan)? {
        write_repaired_agenda_completion(vault_id, app_state, &path, &fm, &body, &plan)?;
    }
    repair_goal_completion_from_agenda(vault_id, app_state, &plan)?;
    with_db(vault_id, app_state, |db| {
        db.sync_plan_index_from_markdown(&plan)
    })
}

fn agenda_file_exists(
    vault_id: &str,
    date: &NaiveDate,
    app_state: &AppState,
) -> Result<bool, AppError> {
    let vaults = app_state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let vault = vaults
        .get(vault_id)
        .ok_or_else(|| AppError::vault_not_open(vault_id))?;
    Ok(vault.structure().agenda_file(&date.to_string()).exists())
}

fn outcomes_for_plan(
    vault_id: &str,
    app_state: &AppState,
    plan_id: &str,
) -> Result<Vec<Outcome>, AppError> {
    with_db(vault_id, app_state, |db| db.get_outcomes_for_plan(plan_id))
}

pub(crate) fn write_agenda_markdown_for_plan(
    vault_id: &str,
    app_state: &AppState,
    mut plan: DailyPlan,
    outcomes: &[Outcome],
    generated_by: &str,
    model_id: Option<&str>,
) -> Result<DailyPlan, AppError> {
    let path = {
        let vaults = app_state
            .vaults
            .lock()
            .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
        let vault = vaults
            .get(vault_id)
            .ok_or_else(|| AppError::vault_not_open(vault_id))?;
        vault.ensure_v1_markdown_structure()?;
        vault.structure().agenda_file(&plan.date.to_string())
    };

    let existing_fm = if path.exists() {
        let content = std::fs::read_to_string(&path)?;
        match markdown_parser::parse_frontmatter(&content) {
            Ok((frontmatter, _body)) => frontmatter,
            Err(markdown_parser::ParseError::MissingDelimiter) => {
                markdown_parser::Frontmatter::new()
            }
            Err(err) => return Err(err.into()),
        }
    } else {
        markdown_parser::Frontmatter::new()
    };

    let task_quadrants = task_quadrants_from_vault(vault_id, app_state, plan.date)?;
    let generated_at = plan
        .generated_at
        .clone()
        .or_else(|| {
            existing_fm
                .get("generated_at")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| Local::now().to_rfc3339());

    let existing_scheduled_tasks = agenda_scheduled_tasks(&existing_fm)?;
    let existing_order: Vec<String> = existing_scheduled_tasks
        .iter()
        .map(|task| task.task_id.clone())
        .collect();
    let explicit_scheduled_tasks = !plan.scheduled_tasks.is_empty();
    let scheduled_tasks = if explicit_scheduled_tasks {
        plan.scheduled_tasks.clone()
    } else if !existing_scheduled_tasks.is_empty() && existing_order == plan.task_order {
        existing_scheduled_tasks
    } else {
        build_scheduled_tasks(&plan, &generated_at, &task_quadrants)
    };
    let memory_context = memory_planning_context_for_date(vault_id, app_state, plan.date)?;
    let scheduled_tasks = if let Some(memory) = memory_context.as_ref() {
        let visible_memory_start =
            generated_schedule_visible_memory_start(plan.date, &generated_at);
        if !explicit_scheduled_tasks {
            apply_memory_to_schedule(scheduled_tasks, &generated_at, memory, visible_memory_start)
        } else if should_apply_memory_to_explicit_schedule(generated_by) {
            apply_memory_limits_to_explicit_schedule(scheduled_tasks, memory, visible_memory_start)
        } else {
            scheduled_tasks
        }
    } else {
        scheduled_tasks
    };
    let mut scheduled_tasks = validate_scheduled_tasks(scheduled_tasks)?;
    apply_task_quadrants_to_scheduled_tasks(&mut scheduled_tasks, &task_quadrants);
    normalize_scheduled_tasks_chronologically(&mut scheduled_tasks);

    let mut fm = existing_fm;
    fm.insert("id".into(), serde_yaml::Value::String(plan.id.clone()));
    fm.insert(
        "type".into(),
        serde_yaml::Value::String("agenda".to_string()),
    );
    fm.insert(
        "date".into(),
        serde_yaml::Value::String(plan.date.to_string()),
    );
    fm.insert(
        "vault_id".into(),
        serde_yaml::Value::String(vault_id.to_string()),
    );
    fm.insert(
        "status".into(),
        serde_yaml::Value::String("active".to_string()),
    );
    fm.insert(
        "generated_by".into(),
        serde_yaml::Value::String(generated_by.to_string()),
    );
    if let Some(model_id) = model_id {
        fm.insert(
            "model_id".into(),
            serde_yaml::Value::String(model_id.to_string()),
        );
    }
    fm.insert(
        "generated_at".into(),
        serde_yaml::Value::String(generated_at.clone()),
    );
    fm.insert(
        "top_outcome_ids".into(),
        serde_yaml::to_value(&plan.top_3_outcome_ids).unwrap_or_default(),
    );
    fm.insert(
        "completed_task_ids".into(),
        serde_yaml::to_value(&plan.completed_task_ids).unwrap_or_default(),
    );
    fm.insert(
        "created".into(),
        serde_yaml::Value::String(plan.created_at.to_string()),
    );
    fm.insert(
        "updated".into(),
        serde_yaml::Value::String(Local::now().to_rfc3339()),
    );
    if let Some(locked_at) = plan.locked_at {
        fm.insert(
            "locked_at".into(),
            serde_yaml::Value::String(locked_at.to_string()),
        );
    } else {
        fm.insert("locked_at".into(), serde_yaml::Value::Null);
    }
    fm.insert(
        "scheduled_tasks".into(),
        scheduled_tasks_frontmatter_value(&scheduled_tasks),
    );

    let completed: std::collections::HashSet<&str> =
        plan.completed_task_ids.iter().map(String::as_str).collect();
    let mut body = String::new();
    body.push_str("## Top Outcomes\n\n");
    for outcome in outcomes {
        body.push_str(&format!("- {}\n", outcome.title));
    }
    body.push_str("\n## Schedule\n\n");
    for task in &scheduled_tasks {
        let check = if completed.contains(task.task_id.as_str()) {
            "x"
        } else {
            " "
        };
        body.push_str(&format!(
            "- [{check}] {} {} ({} min) <!-- task_id: {} -->\n",
            task.start_time, task.title, task.duration_minutes, task.task_id
        ));
    }

    let content = markdown_parser::serialize_frontmatter(&fm, &body);
    {
        let vaults = app_state
            .vaults
            .lock()
            .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
        let vault = vaults
            .get(vault_id)
            .ok_or_else(|| AppError::vault_not_open(vault_id))?;
        vault.write_markdown_file(
            &path,
            &content,
            generated_by,
            "write_agenda",
            Some(&plan.id),
        )?;
    }

    plan.generated_at = Some(generated_at);
    plan.scheduled_tasks = scheduled_tasks;
    plan.task_order = plan
        .scheduled_tasks
        .iter()
        .map(|task| task.task_id.clone())
        .collect();
    for task in &plan.scheduled_tasks {
        plan.task_titles
            .insert(task.task_id.clone(), task.title.clone());
    }
    Ok(plan)
}

// ── Plan Commands ──────────────────────────────────────────────

#[tauri::command]
pub fn agenda_get_plan(
    vault_id: String,
    date: String,
    app_state: State<'_, AppState>,
) -> Result<Option<DailyPlan>, AppError> {
    let date = parse_date(&date)?;
    replace_agenda_warnings(&vault_id, date, Vec::new())?;
    let has_agenda = agenda_file_exists(&vault_id, &date, &app_state)?;
    let mut plan = with_db(&vault_id, &app_state, |db| db.get_plan_by_date(date))?;

    if plan.is_none() && has_agenda {
        plan = Some(with_db(&vault_id, &app_state, |db| db.create_plan(date))?);
    }

    let Some(plan) = plan else {
        return Ok(None);
    };

    if has_agenda {
        return read_agenda_overlay(&vault_id, &app_state, plan).map(Some);
    }

    let outcomes = outcomes_for_plan(&vault_id, &app_state, &plan.id)?;
    write_agenda_markdown_for_plan(&vault_id, &app_state, plan, &outcomes, "indexed", None)
        .map(Some)
}

#[tauri::command]
pub fn agenda_get_agenda_warnings(vault_id: String, date: String) -> Result<Vec<String>, AppError> {
    let date = parse_date(&date)?;
    agenda_warnings_for_date(&vault_id, date)
}

#[tauri::command]
pub fn agenda_open_agenda_error_log(
    vault_id: String,
    app_state: State<'_, AppState>,
) -> Result<(), AppError> {
    let error_log_path = agenda_error_log_path_for_vault(&vault_id, &app_state)?;
    open::that(&error_log_path).map_err(|err| {
        AppError::new(
            ErrorCode::UnknownError,
            format!("Failed to open logs/errors.md: {err}"),
        )
    })?;
    Ok(())
}

#[tauri::command]
pub fn agenda_create_plan(
    vault_id: String,
    date: String,
    app_state: State<'_, AppState>,
) -> Result<DailyPlan, AppError> {
    let date = parse_date(&date)?;
    create_plan_for_date(&vault_id, &app_state, date)
}

fn create_plan_for_date(
    vault_id: &str,
    app_state: &AppState,
    date: NaiveDate,
) -> Result<DailyPlan, AppError> {
    let heuristic_candidates = heuristic_agenda_candidates_from_vault(vault_id, app_state, date)?;
    let mut plan = with_db(vault_id, app_state, |db| db.create_plan(date))?;
    if !heuristic_candidates.is_empty() {
        plan.task_order = heuristic_candidates
            .iter()
            .map(|candidate| candidate.task_id.clone())
            .collect();
        for candidate in &heuristic_candidates {
            plan.task_titles
                .insert(candidate.task_id.clone(), candidate.title.clone());
        }
    }
    let generated_by = if heuristic_candidates.is_empty() {
        "manual"
    } else {
        "heuristic"
    };
    let written =
        write_agenda_markdown_for_plan(vault_id, app_state, plan, &[], generated_by, None)?;
    with_db(vault_id, app_state, |db| {
        db.sync_plan_index_from_markdown(&written)
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlanInput {
    pub vault_id: String,
    pub plan_id: String,
    pub top_3_outcome_ids: Option<Vec<String>>,
    pub task_order: Option<Vec<String>>,
    pub scheduled_tasks: Option<Vec<ScheduledTask>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleTaskForDateInput {
    pub vault_id: String,
    pub task_id: String,
    pub title: String,
    pub date: String,
    pub start_time: Option<String>,
    pub duration_minutes: Option<i32>,
    pub estimate_source: Option<String>,
    pub eisenhower_quadrant: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAlternativeSubtaskInput {
    pub vault_id: String,
    pub missed_task_id: String,
    pub parent_task_id: Option<String>,
    pub missed_title: Option<String>,
    pub date: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleParentTaskForMissedSubtaskInput {
    pub vault_id: String,
    pub missed_task_id: String,
    pub parent_task_id: Option<String>,
    pub date: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAlternativeTaskInput {
    pub vault_id: String,
    pub missed_task_id: String,
    pub parent_task_id: Option<String>,
    pub date: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveParentTaskForMissedSubtaskInput {
    pub vault_id: String,
    pub missed_task_id: String,
    pub parent_task_id: Option<String>,
    pub date: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveGoalForMissedSubtaskInput {
    pub vault_id: String,
    pub missed_task_id: String,
    pub parent_task_id: Option<String>,
    pub date: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAlternativeSubtaskResult {
    pub task_id: String,
    pub title: String,
    pub plan: DailyPlan,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAlternativeTaskResult {
    pub task_id: String,
    pub title: String,
    pub plan: DailyPlan,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveParentTaskForMissedSubtaskResult {
    pub goal_id: String,
    pub archived_task_id: String,
    pub archived_task_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveGoalForMissedSubtaskResult {
    pub goal_id: String,
    pub status: String,
}

fn validate_scheduled_tasks(tasks: Vec<ScheduledTask>) -> Result<Vec<ScheduledTask>, AppError> {
    let mut seen_task_ids = HashSet::new();
    let mut validated = Vec::with_capacity(tasks.len());

    for (index, mut task) in tasks.into_iter().enumerate() {
        let task_id = task.task_id.trim().to_string();
        let title = task.title.trim().to_string();
        if task.id.trim().is_empty() {
            return Err(AppError::validation_error(format!(
                "Agenda scheduled_tasks[{index}].id is required"
            )));
        }
        if task_id.is_empty() {
            return Err(AppError::validation_error(format!(
                "Agenda scheduled_tasks[{index}].task_id is required"
            )));
        }
        if title.is_empty() {
            return Err(AppError::validation_error(format!(
                "Agenda scheduled_tasks[{index}].title is required"
            )));
        }
        if !seen_task_ids.insert(task_id.clone()) {
            return Err(AppError::validation_error(format!(
                "Duplicate Agenda scheduled_tasks[{index}].task_id: {task_id}"
            )));
        }
        let start_time = parse_local_time(&task.start_time)
            .map(format_agenda_time)
            .ok_or_else(|| {
                AppError::validation_error(format!(
                    "Invalid Agenda scheduled_tasks[{index}].start_time for {task_id}: {}",
                    task.start_time
                ))
            })?;
        if !(1..=1440).contains(&task.duration_minutes) {
            return Err(AppError::validation_error(format!(
                "Invalid Agenda scheduled_tasks[{index}].duration_minutes for {task_id}: {}",
                task.duration_minutes
            )));
        }

        task.id = task.id.trim().to_string();
        task.task_id = task_id;
        task.title = title;
        task.start_time = start_time;
        task.estimate_source = Some(
            task.estimate_source
                .as_deref()
                .filter(|source| !source.trim().is_empty())
                .unwrap_or("manual")
                .to_string(),
        );
        validated.push(task);
    }

    Ok(validated)
}

fn apply_scheduled_tasks_to_plan(plan: &mut DailyPlan, scheduled_tasks: Vec<ScheduledTask>) {
    let visible_task_ids: HashSet<String> = scheduled_tasks
        .iter()
        .map(|task| task.task_id.clone())
        .collect();
    plan.completed_task_ids
        .retain(|task_id| visible_task_ids.contains(task_id));
    plan.task_order = scheduled_tasks
        .iter()
        .map(|task| task.task_id.clone())
        .collect();
    for task in &scheduled_tasks {
        plan.task_titles
            .insert(task.task_id.clone(), task.title.clone());
    }
    plan.scheduled_tasks = scheduled_tasks;
}

fn next_schedule_start(tasks: &[ScheduledTask]) -> NaiveTime {
    let default_start = NaiveTime::from_hms_opt(9, 0, 0).expect("valid default Agenda time");
    tasks
        .iter()
        .filter_map(|task| {
            parse_local_time(&task.start_time)
                .map(|start| start + Duration::minutes(i64::from(task.duration_minutes.max(5))))
        })
        .max()
        .unwrap_or(default_start)
}

fn map_contains_string_key(map: &serde_yaml::Mapping, key: &str) -> bool {
    map.contains_key(serde_yaml::Value::String(key.to_string()))
}

fn set_task_agenda_seen_date(value: &mut serde_yaml::Value, task_id: &str, date: &str) -> bool {
    let is_match = value
        .get("id")
        .and_then(|v| v.as_str())
        .is_some_and(|id| id == task_id);

    if is_match {
        if let Some(map) = value.as_mapping_mut() {
            if !map_contains_string_key(map, "first_seen_on_agenda")
                && !map_contains_string_key(map, "firstSeenOnAgenda")
            {
                map.insert(
                    "first_seen_on_agenda".into(),
                    serde_yaml::Value::String(date.to_string()),
                );
            }
            map.insert(
                "last_seen_on_agenda".into(),
                serde_yaml::Value::String(date.to_string()),
            );
        }
        return true;
    }

    if let Some(subtasks) = value.get_mut("subtasks").and_then(|v| v.as_sequence_mut()) {
        for subtask in subtasks {
            if set_task_agenda_seen_date(subtask, task_id, date) {
                return true;
            }
        }
    }

    false
}

fn set_task_missed_decision_date(value: &mut serde_yaml::Value, task_id: &str, date: &str) -> bool {
    let is_match = value
        .get("id")
        .and_then(|v| v.as_str())
        .is_some_and(|id| id == task_id);

    if is_match {
        if let Some(map) = value.as_mapping_mut() {
            map.insert(
                "last_missed_decision_on".into(),
                serde_yaml::Value::String(date.to_string()),
            );
        }
        return true;
    }

    if let Some(subtasks) = value.get_mut("subtasks").and_then(|v| v.as_sequence_mut()) {
        for subtask in subtasks {
            if set_task_missed_decision_date(subtask, task_id, date) {
                return true;
            }
        }
    }

    false
}

fn collect_task_branch_ids_from_value(
    value: &serde_yaml::Value,
    branch_ids: &mut HashSet<String>,
    inherited_branch: bool,
) -> bool {
    let id = value.get("id").and_then(|v| v.as_str()).map(str::to_string);
    let parent_id = yaml_frontmatter_string(
        value,
        &[
            "parent_id",
            "parentId",
            "parentTaskId",
            "generated_from_task_id",
            "generatedFromTaskId",
        ],
    );
    let belongs_to_branch = inherited_branch
        || id.as_ref().is_some_and(|id| branch_ids.contains(id))
        || parent_id
            .as_deref()
            .is_some_and(|parent_id| branch_ids.contains(parent_id));
    let mut changed = false;

    if belongs_to_branch {
        if let Some(id) = id.as_ref() {
            changed = branch_ids.insert(id.clone()) || changed;
        }
    }

    let child_inherits_branch =
        belongs_to_branch || id.as_ref().is_some_and(|id| branch_ids.contains(id));
    if let Some(subtasks) = value.get("subtasks").and_then(|v| v.as_sequence()) {
        for subtask in subtasks {
            changed =
                collect_task_branch_ids_from_value(subtask, branch_ids, child_inherits_branch)
                    || changed;
        }
    }

    changed
}

fn collect_task_branch_ids(tasks: &[serde_yaml::Value], root_task_id: &str) -> HashSet<String> {
    let mut branch_ids = HashSet::from([root_task_id.to_string()]);

    loop {
        let mut changed = false;
        for task in tasks {
            changed = collect_task_branch_ids_from_value(task, &mut branch_ids, false) || changed;
        }
        if !changed {
            return branch_ids;
        }
    }
}

fn archive_task_branch(
    value: &mut serde_yaml::Value,
    branch_ids: &HashSet<String>,
    archived_ids: &mut Vec<String>,
) -> Result<(), AppError> {
    let id = value.get("id").and_then(|v| v.as_str()).map(str::to_string);

    if id.as_ref().is_some_and(|id| branch_ids.contains(id)) {
        let Some(map) = value.as_mapping_mut() else {
            return Err(AppError::validation_error(format!(
                "Task frontmatter must be an object: {}",
                id.unwrap_or_else(|| "<unknown>".to_string())
            )));
        };
        map.insert(
            serde_yaml::Value::String("status".to_string()),
            serde_yaml::Value::String("archived".to_string()),
        );
        if let Some(id) = id.as_ref() {
            archived_ids.push(id.clone());
        }
    }

    if let Some(subtasks) = value.get_mut("subtasks").and_then(|v| v.as_sequence_mut()) {
        for subtask in subtasks {
            archive_task_branch(subtask, branch_ids, archived_ids)?;
        }
    }

    Ok(())
}

fn update_task_agenda_seen_date(
    vault_id: &str,
    app_state: &AppState,
    task_id: &str,
    date: &str,
) -> Result<(), AppError> {
    let vaults = app_state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let vault = vaults
        .get(vault_id)
        .ok_or_else(|| AppError::vault_not_open(vault_id))?;

    for goal_id in vault.list_goals().unwrap_or_default() {
        let Ok((mut fm, body)) = vault.read_goal(&goal_id) else {
            continue;
        };
        let Some(task_list) = fm.get("tasks").and_then(|v| v.as_sequence()) else {
            continue;
        };
        if !task_id_exists_in_goal_tasks(task_list, task_id) {
            continue;
        }
        validate_goal_frontmatter_tasks_for_write(vault, &goal_id, &fm)?;

        let Some(tasks) = fm.get_mut("tasks").and_then(|v| v.as_sequence_mut()) else {
            return Err(AppError::validation_error(format!(
                "Goal tasks must be a list: {goal_id}"
            )));
        };
        let mut found = false;
        for task in tasks {
            if set_task_agenda_seen_date(task, task_id, date) {
                found = true;
                break;
            }
        }
        if found {
            vault.write_goal_with_audit(&goal_id, &fm, &body, "user", "schedule_task_for_date")?;
            return Ok(());
        }
    }

    Err(AppError::validation_error(format!(
        "Task not found in vault frontmatter: {task_id}"
    )))
}

fn yaml_frontmatter_string(value: &serde_yaml::Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(|v| v.as_str()).map(str::to_string))
}

fn task_id_exists_in_value(value: &serde_yaml::Value, task_id: &str) -> bool {
    value
        .get("id")
        .and_then(|v| v.as_str())
        .is_some_and(|id| id == task_id)
        || value
            .get("subtasks")
            .and_then(|v| v.as_sequence())
            .is_some_and(|subtasks| {
                subtasks
                    .iter()
                    .any(|subtask| task_id_exists_in_value(subtask, task_id))
            })
}

fn task_id_exists_in_goal_tasks(tasks: &[serde_yaml::Value], task_id: &str) -> bool {
    tasks
        .iter()
        .any(|task| task_id_exists_in_value(task, task_id))
}

#[derive(Debug, Clone)]
struct MissedWorkTaskContext {
    existing_ids: HashSet<String>,
    existing_titles: HashSet<String>,
    parent_task_id: String,
    parent_title: String,
    parent_quadrant: Option<String>,
}

fn missed_work_task_context(
    tasks: &[GoalFrontmatterTask],
    missed_task_id: &str,
    requested_parent_id: Option<&str>,
) -> Result<Option<MissedWorkTaskContext>, AppError> {
    let existing_ids = tasks.iter().map(|task| task.id.clone()).collect();
    let existing_titles = tasks
        .iter()
        .map(|task| task.title.trim().to_ascii_lowercase())
        .collect();
    let Some(missed_task) = tasks.iter().find(|task| task.id == missed_task_id) else {
        return Ok(None);
    };
    let detected_parent_id = missed_task.parent_id.clone();

    let Some(parent_task_id) = requested_parent_id
        .map(str::to_string)
        .or_else(|| detected_parent_id.clone())
    else {
        return Err(AppError::validation_error(format!(
            "Missed task is not a Subtask: {missed_task_id}"
        )));
    };
    if let Some(requested_parent_id) = requested_parent_id {
        if detected_parent_id
            .as_deref()
            .is_some_and(|id| id != requested_parent_id)
        {
            return Err(AppError::validation_error(format!(
                "Missed Subtask parent mismatch for {missed_task_id}"
            )));
        }
    }

    let Some(parent_task) = tasks.iter().find(|task| task.id == parent_task_id) else {
        return Err(AppError::validation_error(format!(
            "Parent task not found in vault frontmatter: {parent_task_id}"
        )));
    };

    Ok(Some(MissedWorkTaskContext {
        existing_ids,
        existing_titles,
        parent_task_id,
        parent_title: parent_task.title.clone(),
        parent_quadrant: parent_task.eisenhower_quadrant.clone(),
    }))
}

fn slug_fragment(value: &str) -> String {
    let mut slug = String::new();
    let mut previous_was_separator = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            previous_was_separator = false;
        } else if !previous_was_separator {
            slug.push('_');
            previous_was_separator = true;
        }
    }
    let slug = slug.trim_matches('_').to_string();
    if slug.is_empty() {
        "step".to_string()
    } else {
        slug
    }
}

fn unique_alternative_subtask_id(existing_ids: &HashSet<String>, parent_task_id: &str) -> String {
    let base = format!("subtask_{}_alternative", slug_fragment(parent_task_id));
    if !existing_ids.contains(&base) {
        return base;
    }

    for index in 2.. {
        let candidate = format!("{base}_{index}");
        if !existing_ids.contains(&candidate) {
            return candidate;
        }
    }

    unreachable!("unbounded alternative subtask id search should always return")
}

fn unique_alternative_task_id(existing_ids: &HashSet<String>, goal_id: &str) -> String {
    let base = format!("task_{}_alternative", slug_fragment(goal_id));
    if !existing_ids.contains(&base) {
        return base;
    }

    for index in 2.. {
        let candidate = format!("{base}_{index}");
        if !existing_ids.contains(&candidate) {
            return candidate;
        }
    }

    unreachable!("unbounded alternative task id search should always return")
}

fn alternative_subtask_title(
    parent_title: &str,
    missed_title: Option<&str>,
    existing_titles: &HashSet<String>,
) -> String {
    let parent_title = parent_title.trim();
    let candidates = [
        format!("Write one rough sentence for {parent_title}"),
        format!("List three concrete next actions for {parent_title}"),
        format!("Open the work and make one small edit for {parent_title}"),
    ];
    let missed_title = missed_title.map(|title| title.trim().to_ascii_lowercase());

    for candidate in candidates {
        let normalized = candidate.trim().to_ascii_lowercase();
        if missed_title.as_deref() != Some(normalized.as_str())
            && !existing_titles.contains(&normalized)
        {
            return candidate;
        }
    }

    format!("Choose the smallest next action for {parent_title}")
}

fn alternative_task_title(goal_title: &str, existing_titles: &HashSet<String>) -> String {
    let goal_title = goal_title.trim();
    let candidates = [
        format!("Write a simpler next step for {goal_title}"),
        format!("List a different path for {goal_title}"),
        format!("Start a smaller task for {goal_title}"),
    ];

    for candidate in candidates {
        let normalized = candidate.trim().to_ascii_lowercase();
        if !existing_titles.contains(&normalized) {
            return candidate;
        }
    }

    format!("Choose a different task for {goal_title}")
}

fn insert_subtask_under_parent(
    value: &mut serde_yaml::Value,
    parent_task_id: &str,
    subtask: &serde_yaml::Value,
) -> Result<bool, AppError> {
    let is_match = value
        .get("id")
        .and_then(|v| v.as_str())
        .is_some_and(|id| id == parent_task_id);

    if is_match {
        let Some(map) = value.as_mapping_mut() else {
            return Err(AppError::validation_error(format!(
                "Parent task frontmatter must be an object: {parent_task_id}"
            )));
        };
        let subtasks_key = serde_yaml::Value::String("subtasks".to_string());
        if !map.contains_key(&subtasks_key) {
            map.insert(
                subtasks_key.clone(),
                serde_yaml::Value::Sequence(Vec::new()),
            );
        }
        let Some(subtasks) = map
            .get_mut(&subtasks_key)
            .and_then(|value| value.as_sequence_mut())
        else {
            return Err(AppError::validation_error(format!(
                "Parent task subtasks must be a list: {parent_task_id}"
            )));
        };
        subtasks.push(subtask.clone());
        return Ok(true);
    }

    if let Some(subtasks) = value.get_mut("subtasks").and_then(|v| v.as_sequence_mut()) {
        for child in subtasks {
            if insert_subtask_under_parent(child, parent_task_id, subtask)? {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

struct CreatedAlternativeSubtask {
    task_id: String,
    title: String,
    eisenhower_quadrant: Option<String>,
}

struct ParentTaskForMissedSubtask {
    task_id: String,
    title: String,
    eisenhower_quadrant: Option<String>,
}

struct CreatedAlternativeTask {
    task_id: String,
    title: String,
    eisenhower_quadrant: Option<String>,
}

fn goal_title_from_frontmatter(goal_id: &str, fm: &markdown_parser::Frontmatter) -> String {
    fm.get("title")
        .and_then(|value| value.as_str())
        .filter(|title| !title.trim().is_empty())
        .unwrap_or(goal_id)
        .to_string()
}

fn goal_priority_from_frontmatter(fm: &markdown_parser::Frontmatter) -> String {
    fm.get("priority")
        .and_then(|value| value.as_str())
        .unwrap_or("medium")
        .to_string()
}

fn create_alternative_subtask_in_vault(
    input: &GenerateAlternativeSubtaskInput,
    app_state: &AppState,
    date: NaiveDate,
) -> Result<CreatedAlternativeSubtask, AppError> {
    let missed_task_id = input.missed_task_id.trim();
    if missed_task_id.is_empty() {
        return Err(AppError::validation_error("Missed task id is required"));
    }
    let requested_parent_id = input
        .parent_task_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let vaults = app_state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let vault = vaults
        .get(&input.vault_id)
        .ok_or_else(|| AppError::vault_not_open(&input.vault_id))?;

    for goal_id in vault.list_goals().unwrap_or_default() {
        let Ok((mut fm, body)) = vault.read_goal(&goal_id) else {
            continue;
        };
        let Some(task_list) = fm.get("tasks").and_then(|v| v.as_sequence()) else {
            continue;
        };

        if !task_id_exists_in_goal_tasks(task_list, missed_task_id) {
            continue;
        }
        let typed_tasks = collect_valid_goal_frontmatter_tasks_for_write(vault, &goal_id, &fm)?;
        let Some(context) =
            missed_work_task_context(&typed_tasks, missed_task_id, requested_parent_id)?
        else {
            continue;
        };
        let parent_task_id = context.parent_task_id.clone();
        let parent_quadrant = context.parent_quadrant.clone();
        let task_id = unique_alternative_subtask_id(&context.existing_ids, &parent_task_id);
        let title = alternative_subtask_title(
            &context.parent_title,
            input.missed_title.as_deref(),
            &context.existing_titles,
        );
        let date_string = date.format("%Y-%m-%d").to_string();

        let mut subtask = serde_yaml::Mapping::new();
        subtask.insert("id".into(), serde_yaml::Value::String(task_id.clone()));
        subtask.insert("title".into(), serde_yaml::Value::String(title.clone()));
        subtask.insert(
            "status".into(),
            serde_yaml::Value::String("todo".to_string()),
        );
        subtask.insert(
            "parent_id".into(),
            serde_yaml::Value::String(parent_task_id.clone()),
        );
        subtask.insert(
            "generated_from_task_id".into(),
            serde_yaml::Value::String(parent_task_id.clone()),
        );
        subtask.insert(
            "generated_after_missed_subtask_id".into(),
            serde_yaml::Value::String(missed_task_id.to_string()),
        );
        subtask.insert(
            "first_seen_on_agenda".into(),
            serde_yaml::Value::String(date_string.clone()),
        );
        subtask.insert(
            "last_seen_on_agenda".into(),
            serde_yaml::Value::String(date_string.clone()),
        );
        if let Some(quadrant) = parent_quadrant.as_ref() {
            subtask.insert(
                "eisenhower_quadrant".into(),
                serde_yaml::Value::String(quadrant.clone()),
            );
        }

        let Some(tasks) = fm.get_mut("tasks").and_then(|v| v.as_sequence_mut()) else {
            return Err(AppError::validation_error(format!(
                "Goal tasks must be a list: {goal_id}"
            )));
        };
        let mut decision_marked = false;
        for task in tasks.iter_mut() {
            if set_task_missed_decision_date(task, missed_task_id, &date_string) {
                decision_marked = true;
                break;
            }
        }
        if !decision_marked {
            return Err(AppError::validation_error(format!(
                "Missed task not found in vault frontmatter: {missed_task_id}"
            )));
        }
        let subtask = serde_yaml::Value::Mapping(subtask);
        let mut inserted = false;
        for task in tasks.iter_mut() {
            if insert_subtask_under_parent(task, &parent_task_id, &subtask)? {
                inserted = true;
                break;
            }
        }
        if !inserted {
            return Err(AppError::validation_error(format!(
                "Parent task not found in vault frontmatter: {parent_task_id}"
            )));
        }

        vault.write_goal_with_audit(
            &goal_id,
            &fm,
            &body,
            "assistant",
            "assistant_generate_alternative_subtask",
        )?;

        return Ok(CreatedAlternativeSubtask {
            task_id,
            title,
            eisenhower_quadrant: parent_quadrant,
        });
    }

    Err(AppError::validation_error(format!(
        "Missed task not found in vault frontmatter: {missed_task_id}"
    )))
}

fn resolve_parent_task_for_missed_subtask(
    input: &ScheduleParentTaskForMissedSubtaskInput,
    app_state: &AppState,
    date: NaiveDate,
) -> Result<ParentTaskForMissedSubtask, AppError> {
    let missed_task_id = input.missed_task_id.trim();
    if missed_task_id.is_empty() {
        return Err(AppError::validation_error("Missed task id is required"));
    }
    let requested_parent_id = input
        .parent_task_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let date_string = date.format("%Y-%m-%d").to_string();

    let vaults = app_state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let vault = vaults
        .get(&input.vault_id)
        .ok_or_else(|| AppError::vault_not_open(&input.vault_id))?;

    for goal_id in vault.list_goals().unwrap_or_default() {
        let Ok((mut fm, body)) = vault.read_goal(&goal_id) else {
            continue;
        };
        let Some(task_list) = fm.get("tasks").and_then(|v| v.as_sequence()) else {
            continue;
        };

        if !task_id_exists_in_goal_tasks(task_list, missed_task_id) {
            continue;
        }
        let typed_tasks = collect_valid_goal_frontmatter_tasks_for_write(vault, &goal_id, &fm)?;
        let Some(context) =
            missed_work_task_context(&typed_tasks, missed_task_id, requested_parent_id)?
        else {
            continue;
        };
        let parent_task_id = context.parent_task_id.clone();

        let Some(tasks) = fm.get_mut("tasks").and_then(|v| v.as_sequence_mut()) else {
            return Err(AppError::validation_error(format!(
                "Goal tasks must be a list: {goal_id}"
            )));
        };
        let mut decision_marked = false;
        for task in tasks {
            if set_task_missed_decision_date(task, missed_task_id, &date_string) {
                decision_marked = true;
                break;
            }
        }
        if !decision_marked {
            return Err(AppError::validation_error(format!(
                "Missed task not found in vault frontmatter: {missed_task_id}"
            )));
        }

        vault.write_goal_with_audit(
            &goal_id,
            &fm,
            &body,
            "user",
            "schedule_parent_task_for_missed_subtask",
        )?;

        return Ok(ParentTaskForMissedSubtask {
            task_id: parent_task_id,
            title: context.parent_title,
            eisenhower_quadrant: context.parent_quadrant,
        });
    }

    Err(AppError::validation_error(format!(
        "Missed task not found in vault frontmatter: {missed_task_id}"
    )))
}

fn create_alternative_task_in_vault(
    input: &GenerateAlternativeTaskInput,
    app_state: &AppState,
    date: NaiveDate,
) -> Result<CreatedAlternativeTask, AppError> {
    let missed_task_id = input.missed_task_id.trim();
    if missed_task_id.is_empty() {
        return Err(AppError::validation_error("Missed task id is required"));
    }
    let requested_parent_id = input
        .parent_task_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let date_string = date.format("%Y-%m-%d").to_string();

    let vaults = app_state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let vault = vaults
        .get(&input.vault_id)
        .ok_or_else(|| AppError::vault_not_open(&input.vault_id))?;

    for goal_id in vault.list_goals().unwrap_or_default() {
        let Ok((mut fm, body)) = vault.read_goal(&goal_id) else {
            continue;
        };
        let Some(task_list) = fm.get("tasks").and_then(|v| v.as_sequence()) else {
            continue;
        };

        if !task_id_exists_in_goal_tasks(task_list, missed_task_id) {
            continue;
        }
        let typed_tasks = collect_valid_goal_frontmatter_tasks_for_write(vault, &goal_id, &fm)?;
        let Some(context) =
            missed_work_task_context(&typed_tasks, missed_task_id, requested_parent_id)?
        else {
            continue;
        };
        let parent_task_id = context.parent_task_id.clone();

        let goal_title = goal_title_from_frontmatter(&goal_id, &fm);
        let goal_priority = goal_priority_from_frontmatter(&fm);
        let task_id = unique_alternative_task_id(&context.existing_ids, &goal_id);
        let title = alternative_task_title(&goal_title, &context.existing_titles);
        let task_quadrant = derive_eisenhower_quadrant_for_task_title(
            &title,
            Some(&goal_priority),
            None,
            None,
            date,
        );

        let mut task = serde_yaml::Mapping::new();
        task.insert("id".into(), serde_yaml::Value::String(task_id.clone()));
        task.insert("title".into(), serde_yaml::Value::String(title.clone()));
        task.insert(
            "status".into(),
            serde_yaml::Value::String("todo".to_string()),
        );
        task.insert(
            "parent_goal_id".into(),
            serde_yaml::Value::String(goal_id.clone()),
        );
        task.insert(
            "generated_after_missed_subtask_id".into(),
            serde_yaml::Value::String(missed_task_id.to_string()),
        );
        task.insert(
            "generated_after_parent_task_id".into(),
            serde_yaml::Value::String(parent_task_id),
        );
        task.insert(
            "first_seen_on_agenda".into(),
            serde_yaml::Value::String(date_string.clone()),
        );
        task.insert(
            "last_seen_on_agenda".into(),
            serde_yaml::Value::String(date_string.clone()),
        );
        task.insert(
            "eisenhower_quadrant".into(),
            serde_yaml::Value::String(task_quadrant.clone()),
        );

        let Some(tasks) = fm.get_mut("tasks").and_then(|v| v.as_sequence_mut()) else {
            return Err(AppError::validation_error(format!(
                "Goal tasks must be a list: {goal_id}"
            )));
        };
        let mut decision_marked = false;
        for existing_task in tasks.iter_mut() {
            if set_task_missed_decision_date(existing_task, missed_task_id, &date_string) {
                decision_marked = true;
                break;
            }
        }
        if !decision_marked {
            return Err(AppError::validation_error(format!(
                "Missed task not found in vault frontmatter: {missed_task_id}"
            )));
        }
        tasks.push(serde_yaml::Value::Mapping(task));

        vault.write_goal_with_audit(
            &goal_id,
            &fm,
            &body,
            "assistant",
            "assistant_generate_alternative_task",
        )?;

        return Ok(CreatedAlternativeTask {
            task_id,
            title,
            eisenhower_quadrant: Some(task_quadrant),
        });
    }

    Err(AppError::validation_error(format!(
        "Missed task not found in vault frontmatter: {missed_task_id}"
    )))
}

fn archive_parent_task_for_missed_subtask_from_input(
    input: ArchiveParentTaskForMissedSubtaskInput,
    app_state: &AppState,
) -> Result<ArchiveParentTaskForMissedSubtaskResult, AppError> {
    let date = parse_date(&input.date)?;
    let missed_task_id = input.missed_task_id.trim();
    if missed_task_id.is_empty() {
        return Err(AppError::validation_error("Missed task id is required"));
    }
    let requested_parent_id = input
        .parent_task_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let date_string = date.format("%Y-%m-%d").to_string();

    let vaults = app_state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let vault = vaults
        .get(&input.vault_id)
        .ok_or_else(|| AppError::vault_not_open(&input.vault_id))?;

    for goal_id in vault.list_goals().unwrap_or_default() {
        let Ok((mut fm, body)) = vault.read_goal(&goal_id) else {
            continue;
        };
        let Some(task_list) = fm.get("tasks").and_then(|v| v.as_sequence()) else {
            continue;
        };

        if !task_id_exists_in_goal_tasks(task_list, missed_task_id) {
            continue;
        }
        let typed_tasks = collect_valid_goal_frontmatter_tasks_for_write(vault, &goal_id, &fm)?;
        let Some(context) =
            missed_work_task_context(&typed_tasks, missed_task_id, requested_parent_id)?
        else {
            continue;
        };
        let parent_task_id = context.parent_task_id.clone();

        let Some(tasks) = fm.get_mut("tasks").and_then(|v| v.as_sequence_mut()) else {
            return Err(AppError::validation_error(format!(
                "Goal tasks must be a list: {goal_id}"
            )));
        };
        let branch_ids = collect_task_branch_ids(tasks.as_slice(), &parent_task_id);

        let mut decision_marked = false;
        for task in tasks.iter_mut() {
            if set_task_missed_decision_date(task, missed_task_id, &date_string) {
                decision_marked = true;
                break;
            }
        }
        if !decision_marked {
            return Err(AppError::validation_error(format!(
                "Missed task not found in vault frontmatter: {missed_task_id}"
            )));
        }

        let mut archived_task_ids = Vec::new();
        for task in tasks.iter_mut() {
            archive_task_branch(task, &branch_ids, &mut archived_task_ids)?;
        }
        if !archived_task_ids.iter().any(|id| id == &parent_task_id) {
            return Err(AppError::validation_error(format!(
                "Parent task not found in vault frontmatter: {parent_task_id}"
            )));
        }

        vault.write_goal_with_audit(
            &goal_id,
            &fm,
            &body,
            "assistant",
            "assistant_archive_parent_task_for_goal",
        )?;

        return Ok(ArchiveParentTaskForMissedSubtaskResult {
            goal_id,
            archived_task_id: parent_task_id,
            archived_task_ids,
        });
    }

    Err(AppError::validation_error(format!(
        "Missed task not found in vault frontmatter: {missed_task_id}"
    )))
}

fn archive_goal_for_missed_subtask_from_input(
    input: ArchiveGoalForMissedSubtaskInput,
    app_state: &AppState,
) -> Result<ArchiveGoalForMissedSubtaskResult, AppError> {
    let date = parse_date(&input.date)?;
    let missed_task_id = input.missed_task_id.trim();
    if missed_task_id.is_empty() {
        return Err(AppError::validation_error("Missed task id is required"));
    }
    let requested_parent_id = input
        .parent_task_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let date_string = date.format("%Y-%m-%d").to_string();

    let vaults = app_state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let vault = vaults
        .get(&input.vault_id)
        .ok_or_else(|| AppError::vault_not_open(&input.vault_id))?;

    for goal_id in vault.list_goals().unwrap_or_default() {
        let Ok((mut fm, body)) = vault.read_goal(&goal_id) else {
            continue;
        };
        let Some(task_list) = fm.get("tasks").and_then(|v| v.as_sequence()) else {
            continue;
        };

        if !task_id_exists_in_goal_tasks(task_list, missed_task_id) {
            continue;
        }
        let typed_tasks = collect_valid_goal_frontmatter_tasks_for_write(vault, &goal_id, &fm)?;
        let Some(_context) =
            missed_work_task_context(&typed_tasks, missed_task_id, requested_parent_id)?
        else {
            continue;
        };

        let Some(tasks) = fm.get_mut("tasks").and_then(|v| v.as_sequence_mut()) else {
            return Err(AppError::validation_error(format!(
                "Goal tasks must be a list: {goal_id}"
            )));
        };
        let mut decision_marked = false;
        for task in tasks.iter_mut() {
            if set_task_missed_decision_date(task, missed_task_id, &date_string) {
                decision_marked = true;
                break;
            }
        }
        if !decision_marked {
            return Err(AppError::validation_error(format!(
                "Missed task not found in vault frontmatter: {missed_task_id}"
            )));
        }

        fm.insert(
            "status".into(),
            serde_yaml::Value::String("archived".to_string()),
        );
        fm.insert(
            "lifecycle".into(),
            serde_yaml::Value::String("archived".to_string()),
        );
        fm.insert("updated".into(), serde_yaml::Value::String(date_string));

        vault.write_goal_with_audit(
            &goal_id,
            &fm,
            &body,
            "assistant",
            "assistant_archive_goal_for_missed_subtask",
        )?;

        return Ok(ArchiveGoalForMissedSubtaskResult {
            goal_id,
            status: "archived".to_string(),
        });
    }

    Err(AppError::validation_error(format!(
        "Missed task not found in vault frontmatter: {missed_task_id}"
    )))
}

fn generate_alternative_subtask_from_input(
    input: GenerateAlternativeSubtaskInput,
    app_state: &AppState,
) -> Result<GenerateAlternativeSubtaskResult, AppError> {
    let date = parse_date(&input.date)?;
    let created = create_alternative_subtask_in_vault(&input, app_state, date)?;
    let plan = schedule_task_for_date_with_seen_update(
        ScheduleTaskForDateInput {
            vault_id: input.vault_id,
            task_id: created.task_id.clone(),
            title: created.title.clone(),
            date: input.date,
            start_time: None,
            duration_minutes: None,
            estimate_source: Some("assistant".to_string()),
            eisenhower_quadrant: created.eisenhower_quadrant,
        },
        app_state,
        false,
    )?;

    Ok(GenerateAlternativeSubtaskResult {
        task_id: created.task_id,
        title: created.title,
        plan,
    })
}

fn generate_alternative_task_from_input(
    input: GenerateAlternativeTaskInput,
    app_state: &AppState,
) -> Result<GenerateAlternativeTaskResult, AppError> {
    let date = parse_date(&input.date)?;
    let created = create_alternative_task_in_vault(&input, app_state, date)?;
    let plan = schedule_task_for_date_with_seen_update(
        ScheduleTaskForDateInput {
            vault_id: input.vault_id,
            task_id: created.task_id.clone(),
            title: created.title.clone(),
            date: input.date,
            start_time: None,
            duration_minutes: None,
            estimate_source: Some("assistant".to_string()),
            eisenhower_quadrant: created.eisenhower_quadrant,
        },
        app_state,
        false,
    )?;

    Ok(GenerateAlternativeTaskResult {
        task_id: created.task_id,
        title: created.title,
        plan,
    })
}

fn schedule_parent_task_for_missed_subtask_from_input(
    input: ScheduleParentTaskForMissedSubtaskInput,
    app_state: &AppState,
) -> Result<DailyPlan, AppError> {
    let date = parse_date(&input.date)?;
    let parent = resolve_parent_task_for_missed_subtask(&input, app_state, date)?;
    schedule_task_for_date_with_seen_update(
        ScheduleTaskForDateInput {
            vault_id: input.vault_id,
            task_id: parent.task_id,
            title: parent.title,
            date: input.date,
            start_time: None,
            duration_minutes: None,
            estimate_source: Some("manual".to_string()),
            eisenhower_quadrant: parent.eisenhower_quadrant,
        },
        app_state,
        true,
    )
}

fn schedule_task_for_date_with_seen_update(
    input: ScheduleTaskForDateInput,
    app_state: &AppState,
    update_seen_metadata: bool,
) -> Result<DailyPlan, AppError> {
    let task_id = input.task_id.trim().to_string();
    let title = input.title.trim().to_string();
    if task_id.is_empty() {
        return Err(AppError::validation_error("Task id is required"));
    }
    if title.is_empty() {
        return Err(AppError::validation_error("Task title is required"));
    }

    let date = parse_date(&input.date)?;
    let duration_minutes = input
        .duration_minutes
        .unwrap_or_else(|| infer_duration_minutes(&title));
    if !(1..=1440).contains(&duration_minutes) {
        return Err(AppError::validation_error(format!(
            "Invalid Agenda duration for {task_id}: {duration_minutes}"
        )));
    }

    if update_seen_metadata {
        update_task_agenda_seen_date(&input.vault_id, app_state, &task_id, &input.date)?;
    }

    let mut plan = with_db(&input.vault_id, app_state, |db| {
        if let Some(plan) = db.get_plan_by_date(date)? {
            Ok(plan)
        } else {
            db.create_plan(date)
        }
    })?;

    if agenda_file_exists(&input.vault_id, &date, app_state)? {
        plan = read_agenda_overlay(&input.vault_id, app_state, plan)?;
    }

    let generated_at = plan
        .generated_at
        .clone()
        .unwrap_or_else(|| Local::now().to_rfc3339());
    let task_quadrants = task_quadrants_from_vault(&input.vault_id, app_state, date)?;
    let mut scheduled_tasks = if plan.scheduled_tasks.is_empty() && !plan.task_order.is_empty() {
        build_scheduled_tasks(&plan, &generated_at, &task_quadrants)
    } else {
        plan.scheduled_tasks.clone()
    };
    let start_time = match input
        .start_time
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        Some(raw) => parse_local_time(raw)
            .map(format_agenda_time)
            .ok_or_else(|| {
                AppError::validation_error(format!(
                    "Invalid Agenda start time for {task_id}: {raw}"
                ))
            })?,
        None => format_agenda_time(next_schedule_start(&scheduled_tasks)),
    };

    if let Some(existing) = scheduled_tasks
        .iter_mut()
        .find(|task| task.task_id == task_id)
    {
        existing.title = title;
        existing.start_time = start_time;
        existing.duration_minutes = duration_minutes;
        existing.estimate_source = Some(
            input
                .estimate_source
                .as_deref()
                .filter(|source| !source.trim().is_empty())
                .unwrap_or("manual")
                .to_string(),
        );
        existing.eisenhower_quadrant = input
            .eisenhower_quadrant
            .or_else(|| task_quadrants.get(&task_id).cloned());
    } else {
        scheduled_tasks.push(ScheduledTask {
            id: format!("scheduled_{task_id}"),
            task_id: task_id.clone(),
            title,
            start_time,
            duration_minutes,
            estimate_source: Some(
                input
                    .estimate_source
                    .as_deref()
                    .filter(|source| !source.trim().is_empty())
                    .unwrap_or("manual")
                    .to_string(),
            ),
            eisenhower_quadrant: input
                .eisenhower_quadrant
                .or_else(|| task_quadrants.get(&task_id).cloned()),
        });
    }

    let scheduled_tasks = validate_scheduled_tasks(scheduled_tasks)?;
    apply_scheduled_tasks_to_plan(&mut plan, scheduled_tasks);
    let outcomes = outcomes_for_plan(&input.vault_id, app_state, &plan.id)?;
    let written = write_agenda_markdown_for_plan(
        &input.vault_id,
        app_state,
        plan,
        &outcomes,
        "manual",
        None,
    )?;
    with_db(&input.vault_id, app_state, |db| {
        db.sync_plan_index_from_markdown(&written)
    })
}

fn schedule_task_for_date_from_input(
    input: ScheduleTaskForDateInput,
    app_state: &AppState,
) -> Result<DailyPlan, AppError> {
    schedule_task_for_date_with_seen_update(input, app_state, true)
}

fn update_plan_from_input(
    input: UpdatePlanInput,
    app_state: &AppState,
) -> Result<DailyPlan, AppError> {
    let has_explicit_task_order = input.task_order.is_some();
    let scheduled_tasks = input
        .scheduled_tasks
        .map(validate_scheduled_tasks)
        .transpose()?;
    let derived_task_order = scheduled_tasks
        .as_ref()
        .map(|tasks| tasks.iter().map(|task| task.task_id.clone()).collect());
    let task_order = derived_task_order.or(input.task_order.clone());

    let mut plan = with_db(&input.vault_id, app_state, |db| {
        db.update_plan(
            &input.plan_id,
            input.top_3_outcome_ids.clone(),
            task_order.clone(),
        )
    })?;
    if let Some(scheduled_tasks) = scheduled_tasks {
        apply_scheduled_tasks_to_plan(&mut plan, scheduled_tasks);
    } else if has_explicit_task_order {
        plan.scheduled_tasks.clear();
    }

    let outcomes = outcomes_for_plan(&input.vault_id, app_state, &plan.id)?;
    let written = write_agenda_markdown_for_plan(
        &input.vault_id,
        app_state,
        plan,
        &outcomes,
        "manual",
        None,
    )?;
    with_db(&input.vault_id, app_state, |db| {
        db.sync_plan_index_from_markdown(&written)
    })
}

#[tauri::command]
pub fn agenda_update_plan(
    input: UpdatePlanInput,
    app_state: State<'_, AppState>,
) -> Result<DailyPlan, AppError> {
    update_plan_from_input(input, &app_state)
}

#[tauri::command]
pub fn agenda_schedule_task_for_date(
    input: ScheduleTaskForDateInput,
    app_state: State<'_, AppState>,
) -> Result<DailyPlan, AppError> {
    schedule_task_for_date_from_input(input, &app_state)
}

#[tauri::command]
pub fn agenda_generate_alternative_subtask(
    input: GenerateAlternativeSubtaskInput,
    app_state: State<'_, AppState>,
) -> Result<GenerateAlternativeSubtaskResult, AppError> {
    generate_alternative_subtask_from_input(input, &app_state)
}

#[tauri::command]
pub fn agenda_schedule_parent_task_for_missed_subtask(
    input: ScheduleParentTaskForMissedSubtaskInput,
    app_state: State<'_, AppState>,
) -> Result<DailyPlan, AppError> {
    schedule_parent_task_for_missed_subtask_from_input(input, &app_state)
}

#[tauri::command]
pub fn agenda_generate_alternative_task(
    input: GenerateAlternativeTaskInput,
    app_state: State<'_, AppState>,
) -> Result<GenerateAlternativeTaskResult, AppError> {
    generate_alternative_task_from_input(input, &app_state)
}

#[tauri::command]
pub fn agenda_archive_parent_task_for_missed_subtask(
    input: ArchiveParentTaskForMissedSubtaskInput,
    app_state: State<'_, AppState>,
) -> Result<ArchiveParentTaskForMissedSubtaskResult, AppError> {
    archive_parent_task_for_missed_subtask_from_input(input, &app_state)
}

#[tauri::command]
pub fn agenda_archive_goal_for_missed_subtask(
    input: ArchiveGoalForMissedSubtaskInput,
    app_state: State<'_, AppState>,
) -> Result<ArchiveGoalForMissedSubtaskResult, AppError> {
    archive_goal_for_missed_subtask_from_input(input, &app_state)
}

#[tauri::command]
pub fn agenda_lock_plan(
    vault_id: String,
    plan_id: String,
    app_state: State<'_, AppState>,
) -> Result<DailyPlan, AppError> {
    let plan = with_db(&vault_id, &app_state, |db| db.lock_plan(&plan_id))?;
    let outcomes = outcomes_for_plan(&vault_id, &app_state, &plan.id)?;
    write_agenda_markdown_for_plan(&vault_id, &app_state, plan, &outcomes, "manual", None)
}

// ── Outcome Commands ───────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOutcomeInput {
    pub vault_id: String,
    pub daily_plan_id: String,
    pub title: String,
    pub linked_task_ids: Vec<String>,
    pub ai_generated: bool,
}

#[tauri::command]
pub fn agenda_create_outcome(
    input: CreateOutcomeInput,
    app_state: State<'_, AppState>,
) -> Result<Outcome, AppError> {
    let outcome = with_db(&input.vault_id, &app_state, |db| {
        db.create_outcome(
            &input.daily_plan_id,
            &input.title,
            input.linked_task_ids.clone(),
            input.ai_generated,
        )
    })?;
    let plan = with_db(&input.vault_id, &app_state, |db| {
        db.get_plan_by_id(&outcome.daily_plan_id)
    })?;
    let outcomes = outcomes_for_plan(&input.vault_id, &app_state, &plan.id)?;
    write_agenda_markdown_for_plan(&input.vault_id, &app_state, plan, &outcomes, "manual", None)?;
    Ok(outcome)
}

#[tauri::command]
pub fn agenda_get_outcomes(
    vault_id: String,
    daily_plan_id: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<Outcome>, AppError> {
    with_db(&vault_id, &app_state, |db| {
        db.get_outcomes_for_plan(&daily_plan_id)
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOutcomeInput {
    pub vault_id: String,
    pub outcome_id: String,
    pub title: Option<String>,
    pub linked_task_ids: Option<Vec<String>>,
}

#[tauri::command]
pub fn agenda_update_outcome(
    input: UpdateOutcomeInput,
    app_state: State<'_, AppState>,
) -> Result<Outcome, AppError> {
    let outcome = with_db(&input.vault_id, &app_state, |db| {
        db.update_outcome(
            &input.outcome_id,
            input.title.as_deref(),
            input.linked_task_ids.clone(),
        )
    })?;
    let plan = with_db(&input.vault_id, &app_state, |db| {
        db.get_plan_by_id(&outcome.daily_plan_id)
    })?;
    let outcomes = outcomes_for_plan(&input.vault_id, &app_state, &plan.id)?;
    write_agenda_markdown_for_plan(&input.vault_id, &app_state, plan, &outcomes, "manual", None)?;
    Ok(outcome)
}

#[tauri::command]
pub fn agenda_delete_outcome(
    vault_id: String,
    outcome_id: String,
    app_state: State<'_, AppState>,
) -> Result<(), AppError> {
    let plan_id = with_db(&vault_id, &app_state, |db| {
        let outcome = db.get_outcome_by_id(&outcome_id)?;
        let plan_id = outcome.daily_plan_id;
        db.delete_outcome(&outcome_id)?;
        Ok(plan_id)
    })?;
    let plan = with_db(&vault_id, &app_state, |db| db.get_plan_by_id(&plan_id))?;
    let outcomes = outcomes_for_plan(&vault_id, &app_state, &plan.id)?;
    write_agenda_markdown_for_plan(&vault_id, &app_state, plan, &outcomes, "manual", None)?;
    Ok(())
}

// ── Deferral Commands ──────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeferTaskInput {
    pub vault_id: String,
    pub task_id: String,
    pub date: String,
    pub reason: Option<String>,
}

#[tauri::command]
pub fn agenda_defer_task(
    input: DeferTaskInput,
    app_state: State<'_, AppState>,
) -> Result<Deferral, AppError> {
    defer_task_from_input(input, &app_state)
}

fn defer_task_from_input(
    input: DeferTaskInput,
    app_state: &AppState,
) -> Result<Deferral, AppError> {
    let date = parse_date(&input.date)?;
    let deferral = with_db(&input.vault_id, app_state, |db| {
        db.create_deferral(&input.task_id, date, input.reason.as_deref(), None)
    })?;

    if let Some(mut plan) = with_db(&input.vault_id, app_state, |db| db.get_plan_by_date(date))? {
        if agenda_file_exists(&input.vault_id, &date, app_state)? {
            plan = read_agenda_overlay(&input.vault_id, app_state, plan)?;
        }

        if plan.scheduled_tasks.is_empty() {
            let new_order: Vec<String> = plan
                .task_order
                .iter()
                .filter(|id| id.as_str() != input.task_id.as_str())
                .cloned()
                .collect();
            let plan_id = plan.id.clone();
            plan = with_db(&input.vault_id, app_state, |db| {
                db.update_plan(&plan_id, None, Some(new_order))
            })?;
        } else {
            let scheduled_tasks = plan
                .scheduled_tasks
                .iter()
                .filter(|task| task.task_id.as_str() != input.task_id.as_str())
                .cloned()
                .collect();
            apply_scheduled_tasks_to_plan(&mut plan, scheduled_tasks);
        }

        let outcomes = outcomes_for_plan(&input.vault_id, app_state, &plan.id)?;
        write_agenda_markdown_for_plan(&input.vault_id, app_state, plan, &outcomes, "manual", None)
            .and_then(|written| {
                with_db(&input.vault_id, app_state, |db| {
                    db.sync_plan_index_from_markdown(&written)
                })
            })?;
    }

    Ok(deferral)
}

#[tauri::command]
pub fn agenda_toggle_task_completion(
    vault_id: String,
    plan_id: String,
    task_id: String,
    app_state: State<'_, AppState>,
) -> Result<DailyPlan, AppError> {
    toggle_task_completion_in_state(&vault_id, &plan_id, &task_id, &app_state)
}

struct EmbeddedTaskCompletionUpdate {
    goal_id: String,
    frontmatter: markdown_parser::Frontmatter,
    body: String,
}

fn prepare_embedded_task_completion_update(
    vault_id: &str,
    task_id: &str,
    is_completed: bool,
    app_state: &AppState,
) -> Result<Option<EmbeddedTaskCompletionUpdate>, AppError> {
    let vaults = app_state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let Some(vault) = vaults.get(vault_id) else {
        return Ok(None);
    };
    let status = if is_completed { "completed" } else { "todo" };

    for goal_id in vault.list_goals()? {
        let tasks = list_goal_frontmatter_tasks_from_manager(vault, &goal_id)?;
        if tasks.iter().any(|task| task.id == task_id) {
            let (frontmatter, body) =
                build_goal_frontmatter_task_status_update(vault, &goal_id, task_id, status)?;
            return Ok(Some(EmbeddedTaskCompletionUpdate {
                goal_id,
                frontmatter,
                body,
            }));
        }
    }

    Ok(None)
}

fn write_prepared_embedded_task_completion_update(
    vault_id: &str,
    update: Option<EmbeddedTaskCompletionUpdate>,
    app_state: &AppState,
) -> Result<(), AppError> {
    let Some(update) = update else {
        return Ok(());
    };
    let vaults = app_state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let Some(vault) = vaults.get(vault_id) else {
        return Ok(());
    };

    vault.write_goal_with_audit(
        &update.goal_id,
        &update.frontmatter,
        &update.body,
        "user",
        "update_goal_frontmatter_task_status",
    )?;

    Ok(())
}

fn plan_with_toggled_completion(mut plan: DailyPlan, task_id: &str) -> DailyPlan {
    if let Some(pos) = plan.completed_task_ids.iter().position(|id| id == task_id) {
        plan.completed_task_ids.remove(pos);
    } else {
        plan.completed_task_ids.push(task_id.to_string());
    }
    plan.updated_at = Local::now().naive_local();
    plan
}

fn toggle_task_completion_in_state(
    vault_id: &str,
    plan_id: &str,
    task_id: &str,
    app_state: &AppState,
) -> Result<DailyPlan, AppError> {
    let plan_before = with_db(vault_id, app_state, |db| db.get_plan_by_id(plan_id))?;
    let will_be_completed = !plan_before
        .completed_task_ids
        .iter()
        .any(|id| id == task_id);
    let embedded_update =
        prepare_embedded_task_completion_update(vault_id, task_id, will_be_completed, app_state)?;

    write_prepared_embedded_task_completion_update(vault_id, embedded_update, app_state)?;

    let plan = plan_with_toggled_completion(plan_before, task_id);
    let outcomes = outcomes_for_plan(vault_id, app_state, &plan.id)?;
    let plan =
        write_agenda_markdown_for_plan(vault_id, app_state, plan, &outcomes, "manual", None)?;

    with_db(vault_id, app_state, |db| {
        db.sync_plan_index_from_markdown(&plan)
    })
}

/// Returns metadata for all tasks across goals in a vault.
/// Keyed by task_id. Used by the frontend for prioritization and parent Goal navigation.
#[tauri::command]
pub fn agenda_get_task_metadata(
    vault_id: String,
    date: Option<String>,
    app_state: State<'_, AppState>,
) -> Result<HashMap<String, TaskMetadata>, AppError> {
    let vaults = app_state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let vault = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let goal_ids = vault.list_goals().unwrap_or_default();
    let mut metadata = HashMap::new();
    let metadata_date = date
        .as_deref()
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
        .unwrap_or_else(|| Local::now().date_naive());

    for gid in &goal_ids {
        if let Ok((fm, _)) = vault.read_goal(gid) {
            let goal_title = fm
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or(gid)
                .to_string();
            let goal_priority = fm
                .get("priority")
                .and_then(|v| v.as_str())
                .unwrap_or("medium")
                .to_string();
            let goal_deadline = fm
                .get("deadline")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let goal_tasks = match list_goal_frontmatter_tasks_from_manager(vault, gid) {
                Ok(tasks) => tasks,
                Err(error) => {
                    log::warn!("Failed to load goal task metadata for '{gid}': {error}");
                    Vec::new()
                }
            };

            for task in goal_tasks {
                let task_deadline = task
                    .due_date
                    .clone()
                    .or_else(|| task.scheduled_date.clone())
                    .unwrap_or_default();
                let task_quadrant = derive_eisenhower_quadrant_for_task_title(
                    &task.title,
                    Some(&goal_priority),
                    task.due_date.as_deref(),
                    task.scheduled_date.as_deref(),
                    metadata_date,
                );
                metadata.insert(
                    task.id,
                    TaskMetadata {
                        goal_id: gid.clone(),
                        goal_title: goal_title.clone(),
                        priority: goal_priority.clone(),
                        eisenhower_quadrant: task_quadrant,
                        deadline: if task_deadline.is_empty() {
                            goal_deadline.clone()
                        } else {
                            task_deadline
                        },
                    },
                );
            }
        }
    }

    Ok(metadata)
}

#[tauri::command]
pub fn agenda_get_deferral_count(
    vault_id: String,
    task_id: String,
    app_state: State<'_, AppState>,
) -> Result<i32, AppError> {
    with_db(&vault_id, &app_state, |db| db.get_deferral_count(&task_id))
}

#[tauri::command]
pub fn agenda_get_deferrals(
    vault_id: String,
    task_id: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<Deferral>, AppError> {
    with_db(&vault_id, &app_state, |db| {
        db.get_deferrals_for_task(&task_id)
    })
}

// ── Check-In Commands ──────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCheckInInput {
    pub vault_id: String,
    pub date: String,
    pub completed_task_ids: Vec<String>,
    pub notes: Option<String>,
    pub ai_summary: Option<String>,
}

#[tauri::command]
pub fn agenda_create_check_in(
    input: CreateCheckInInput,
    app_state: State<'_, AppState>,
) -> Result<CheckIn, AppError> {
    let date = parse_date(&input.date)?;
    let check_in = with_db(&input.vault_id, &app_state, |db| {
        db.create_check_in(
            date,
            input.completed_task_ids.clone(),
            input.notes.as_deref(),
            input.ai_summary.as_deref(),
        )
    })?;

    if let Some(plan) = with_db(&input.vault_id, &app_state, |db| db.get_plan_by_date(date))? {
        let outcomes = outcomes_for_plan(&input.vault_id, &app_state, &plan.id)?;
        write_agenda_markdown_for_plan(
            &input.vault_id,
            &app_state,
            plan,
            &outcomes,
            "manual",
            None,
        )?;
    }

    Ok(check_in)
}

#[tauri::command]
pub fn agenda_get_check_in(
    vault_id: String,
    date: String,
    app_state: State<'_, AppState>,
) -> Result<Option<CheckIn>, AppError> {
    let date = parse_date(&date)?;
    with_db(&vault_id, &app_state, |db| db.get_check_in(date))
}

// ── Chat Commands ──────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendChatInput {
    pub vault_id: String,
    pub daily_plan_id: String,
    pub content: String,
}

#[tauri::command]
pub fn agenda_send_chat(
    input: SendChatInput,
    app_state: State<'_, AppState>,
) -> Result<ChatMessage, AppError> {
    with_db(&input.vault_id, &app_state, |db| {
        db.add_chat_message(&input.daily_plan_id, ChatRole::User, &input.content)
    })
}

#[tauri::command]
pub fn agenda_get_chat_history(
    vault_id: String,
    daily_plan_id: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<ChatMessage>, AppError> {
    with_db(&vault_id, &app_state, |db| {
        db.get_chat_history(&daily_plan_id)
    })
}

#[tauri::command]
pub fn agenda_get_chat_dates(
    vault_id: String,
    limit: Option<i32>,
    app_state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let limit = limit.unwrap_or(90);
    with_db(&vault_id, &app_state, |db| db.get_dates_with_chat(limit))
}

// ── Stats Commands ─────────────────────────────────────────────

#[tauri::command]
pub fn agenda_get_recent_stats(
    vault_id: String,
    days: Option<i32>,
    app_state: State<'_, AppState>,
) -> Result<Vec<DailyStats>, AppError> {
    let days = days.unwrap_or(14);
    with_db(&vault_id, &app_state, |db| db.get_recent_stats(days))
}

#[tauri::command]
pub fn agenda_count_check_ins(
    vault_id: String,
    app_state: State<'_, AppState>,
) -> Result<i32, AppError> {
    with_db(&vault_id, &app_state, |db| db.count_check_ins())
}

// ── Revision Commands ──────────────────────────────────────────

#[tauri::command]
pub fn agenda_get_revisions(
    vault_id: String,
    daily_plan_id: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<PlanRevision>, AppError> {
    with_db(&vault_id, &app_state, |db| db.get_revisions(&daily_plan_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn make_test_file_writable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = std::fs::metadata(path).unwrap().permissions();
        permissions.set_mode(permissions.mode() | 0o600);
        std::fs::set_permissions(path, permissions).unwrap();
    }

    #[cfg(windows)]
    fn make_test_file_writable(path: &Path) {
        let mut permissions = std::fs::metadata(path).unwrap().permissions();
        permissions.set_readonly(false);
        std::fs::set_permissions(path, permissions).unwrap();
    }

    #[test]
    fn release_agenda_state_drops_runtime_cache_for_vault() {
        let temp = tempfile::tempdir().unwrap();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        let db = AgendaDb::open(temp.path().join("agenda.db")).unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 4, 27).unwrap();
        let app_state = crate::commands::vault::AppState::default();

        AGENDA_DBS.lock().unwrap().insert(vault_id.clone(), db);
        replace_agenda_warnings(&vault_id, date, vec!["warning".to_string()]).unwrap();
        app_state
            .ai_cache
            .lock()
            .unwrap()
            .put(123, "cached AI response".to_string());

        release_agenda_state(&vault_id, &app_state).unwrap();

        assert!(!AGENDA_DBS.lock().unwrap().contains_key(&vault_id));
        assert!(agenda_warnings_for_date(&vault_id, date)
            .unwrap()
            .is_empty());
        assert!(app_state.ai_cache.lock().unwrap().get(123).is_none());
    }

    #[test]
    fn task_title_suggests_delegation_for_outsourced_repairs() {
        assert!(task_title_suggests_delegation("Get kitchen sink fixed"));
        assert!(task_title_suggests_delegation(
            "Get downstairs toilet repaired"
        ));
        assert!(task_title_suggests_delegation(
            "Call plumber about the leak"
        ));
        assert!(!task_title_suggests_delegation("Fix copy on landing page"));
        assert!(!task_title_suggests_delegation("Clean kitchen counters"));
    }

    #[test]
    fn scheduled_task_title_inference_overrides_existing_do_quadrant() {
        let mut scheduled_tasks = vec![ScheduledTask {
            id: "scheduled_task_kitchen_sink".into(),
            task_id: "task_kitchen_sink".into(),
            title: "Get kitchen sink fixed".into(),
            start_time: "10:40 PM".into(),
            duration_minutes: 45,
            estimate_source: Some("ai".into()),
            eisenhower_quadrant: Some("do".into()),
        }];

        apply_task_quadrants_to_scheduled_tasks(&mut scheduled_tasks, &HashMap::new());

        assert_eq!(
            scheduled_tasks[0].eisenhower_quadrant.as_deref(),
            Some("delegate")
        );
    }

    #[test]
    fn memory_prompt_context_reads_consented_memory_markdown() {
        let vault_root =
            std::env::temp_dir().join(format!("goalrate-memory-context-{}", uuid::Uuid::new_v4()));
        let manager = vault_core::VaultManager::create(
            "Memory Context Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();
        let mut consent = serde_yaml::Mapping::new();
        consent.insert("use_for_planning".into(), serde_yaml::Value::Bool(true));
        consent.insert(
            "allow_remote_ai_context".into(),
            serde_yaml::Value::Bool(true),
        );
        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert(
            "id".into(),
            serde_yaml::Value::String("memory_local_user".into()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("memory".into()));
        frontmatter.insert(
            "task_capacity_hours_per_day".into(),
            serde_yaml::to_value(3.5).unwrap(),
        );
        frontmatter.insert(
            "likes".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::String(
                "morning deep work".into(),
            )]),
        );
        frontmatter.insert("consent".into(), serde_yaml::Value::Mapping(consent));
        std::fs::write(
            manager.structure().memory_file(),
            markdown_parser::serialize_frontmatter(&frontmatter, "Private notes stay local."),
        )
        .unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let context = memory_prompt_context(
            &vault_id,
            &app_state,
            NaiveDate::from_ymd_opt(2026, 4, 27).unwrap(),
        )
        .unwrap()
        .unwrap();

        assert!(context.contains("## Memory Planning Context"));
        assert!(context.contains("Task capacity today: 210 minutes"));
        assert!(context.contains("Preferences: morning deep work"));
        assert!(!context.contains("Private notes stay local."));

        release_agenda_state(&vault_id, &app_state).unwrap();
        std::fs::remove_dir_all(vault_root).ok();
    }

    fn memory_schedule_test_state(
        frontmatter: markdown_parser::Frontmatter,
        body: &str,
    ) -> (tempfile::TempDir, String, crate::commands::vault::AppState) {
        let temp = tempfile::tempdir().unwrap();
        let vault_root = temp.path().join("vault");
        let manager = vault_core::VaultManager::create(
            "Memory Schedule Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();
        std::fs::write(
            manager.structure().memory_file(),
            markdown_parser::serialize_frontmatter(&frontmatter, body),
        )
        .unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);
        (temp, vault_id, app_state)
    }

    fn memory_frontmatter_with_consent() -> markdown_parser::Frontmatter {
        let mut consent = serde_yaml::Mapping::new();
        consent.insert("use_for_planning".into(), serde_yaml::Value::Bool(true));

        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert(
            "id".into(),
            serde_yaml::Value::String("memory_local_user".into()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("memory".into()));
        frontmatter.insert("consent".into(), serde_yaml::Value::Mapping(consent));
        frontmatter
    }

    #[test]
    fn memory_planning_uses_legacy_disabled_local_memory() {
        let mut frontmatter = memory_frontmatter_with_consent();
        let mut consent = serde_yaml::Mapping::new();
        consent.insert("use_for_planning".into(), serde_yaml::Value::Bool(false));
        consent.insert(
            "allow_remote_ai_context".into(),
            serde_yaml::Value::Bool(false),
        );
        frontmatter.insert("consent".into(), serde_yaml::Value::Mapping(consent));
        frontmatter.insert(
            "meal_windows".into(),
            serde_yaml::Value::Sequence(vec![memory_window_value(
                "Lunch",
                "12:00 PM",
                "1:00 PM",
                &["weekdays"],
            )]),
        );
        let (_temp, vault_id, app_state) =
            memory_schedule_test_state(frontmatter, "## Schedule and Capacity\n");

        let context = memory_planning_context_for_date(
            &vault_id,
            &app_state,
            NaiveDate::from_ymd_opt(2026, 4, 27).unwrap(),
        )
        .unwrap()
        .unwrap();

        assert_eq!(context.blocked_windows.len(), 1);
        assert_eq!(context.blocked_windows[0].label, "Lunch");
        assert!(!context.remote_allowed);

        release_agenda_state(&vault_id, &app_state).unwrap();
    }

    fn memory_window_value(
        label: &str,
        start_time: &str,
        end_time: &str,
        days: &[&str],
    ) -> serde_yaml::Value {
        let mut window = serde_yaml::Mapping::new();
        window.insert("label".into(), serde_yaml::Value::String(label.to_string()));
        window.insert(
            "start_time".into(),
            serde_yaml::Value::String(start_time.to_string()),
        );
        window.insert(
            "end_time".into(),
            serde_yaml::Value::String(end_time.to_string()),
        );
        window.insert(
            "days".into(),
            serde_yaml::Value::Sequence(
                days.iter()
                    .map(|day| serde_yaml::Value::String((*day).to_string()))
                    .collect(),
            ),
        );
        serde_yaml::Value::Mapping(window)
    }

    fn memory_schedule_plan() -> DailyPlan {
        let now = NaiveDate::from_ymd_opt(2026, 4, 27)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let task_titles = [
            ("task_one".to_string(), "First task".to_string()),
            ("task_two".to_string(), "Draft proposal".to_string()),
            ("task_three".to_string(), "Build prototype".to_string()),
            ("task_four".to_string(), "Write release notes".to_string()),
        ]
        .into_iter()
        .collect();

        DailyPlan {
            id: "plan_memory".into(),
            date: NaiveDate::from_ymd_opt(2026, 4, 27).unwrap(),
            top_3_outcome_ids: Vec::new(),
            task_order: vec![
                "task_one".into(),
                "task_two".into(),
                "task_three".into(),
                "task_four".into(),
            ],
            task_titles,
            completed_task_ids: Vec::new(),
            generated_at: Some("2026-04-27T09:00:00-07:00".into()),
            scheduled_tasks: Vec::new(),
            locked_at: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn scheduled_test_task(task_id: &str, title: &str, duration_minutes: i32) -> ScheduledTask {
        ScheduledTask {
            id: format!("scheduled_{task_id}"),
            task_id: task_id.to_string(),
            title: title.to_string(),
            start_time: "9:00 AM".to_string(),
            duration_minutes,
            estimate_source: Some("ai".to_string()),
            eisenhower_quadrant: Some("do".to_string()),
        }
    }

    #[test]
    fn memory_task_count_fills_generated_schedule_from_plan_order() {
        let mut frontmatter = memory_frontmatter_with_consent();
        frontmatter.insert(
            "task_capacity_tasks_per_day".into(),
            serde_yaml::to_value(2).unwrap(),
        );
        let (_temp, vault_id, app_state) =
            memory_schedule_test_state(frontmatter, "## Schedule and Capacity\n");
        let plan = memory_schedule_plan();

        let scheduled = apply_memory_to_generated_schedule_for_date(
            &vault_id,
            &app_state,
            plan.date,
            &plan,
            vec![scheduled_test_task("task_one", "First task", 30)],
            "2026-04-27T09:00:00-07:00",
            &std::collections::HashMap::new(),
        )
        .unwrap();

        assert_eq!(
            scheduled
                .iter()
                .map(|task| task.task_id.as_str())
                .collect::<Vec<_>>(),
            vec!["task_one", "task_two"]
        );
        assert_eq!(scheduled[0].start_time, "9:00 AM");
        assert_eq!(scheduled[1].start_time, "9:30 AM");

        release_agenda_state(&vault_id, &app_state).unwrap();
    }

    #[test]
    fn memory_hour_capacity_fills_generated_schedule_until_capacity() {
        let mut frontmatter = memory_frontmatter_with_consent();
        frontmatter.insert(
            "task_capacity_hours_per_day".into(),
            serde_yaml::to_value(2.0).unwrap(),
        );
        let (_temp, vault_id, app_state) =
            memory_schedule_test_state(frontmatter, "## Schedule and Capacity\n");
        let plan = memory_schedule_plan();

        let scheduled = apply_memory_to_generated_schedule_for_date(
            &vault_id,
            &app_state,
            plan.date,
            &plan,
            vec![scheduled_test_task("task_one", "First task", 30)],
            "2026-04-27T09:00:00-07:00",
            &std::collections::HashMap::new(),
        )
        .unwrap();

        assert_eq!(
            scheduled
                .iter()
                .map(|task| task.task_id.as_str())
                .collect::<Vec<_>>(),
            vec!["task_one", "task_two", "task_three"]
        );
        assert_eq!(
            scheduled
                .iter()
                .map(|task| task.duration_minutes)
                .sum::<i32>(),
            120
        );

        release_agenda_state(&vault_id, &app_state).unwrap();
    }

    #[test]
    fn memory_recovery_capacity_uses_only_explicit_reserve_fields() {
        let mut frontmatter = memory_frontmatter_with_consent();
        frontmatter.insert(
            "downtime_hours_needed".into(),
            serde_yaml::to_value(20.0).unwrap(),
        );
        let (_temp, vault_id, app_state) =
            memory_schedule_test_state(frontmatter, "## Schedule and Capacity\n");

        let context = memory_planning_context_for_date(
            &vault_id,
            &app_state,
            NaiveDate::from_ymd_opt(2026, 4, 27).unwrap(),
        )
        .unwrap()
        .unwrap();

        assert_eq!(context.capacity_minutes, Some(240));
        assert!(context
            .prompt_lines
            .iter()
            .any(|line| line == "Downtime needed: 20 hours"));

        release_agenda_state(&vault_id, &app_state).unwrap();
    }

    #[test]
    fn memory_time_windows_are_visible_fixed_rows_in_generated_schedule() {
        let mut frontmatter = memory_frontmatter_with_consent();
        frontmatter.insert(
            "meal_windows".into(),
            serde_yaml::Value::Sequence(vec![memory_window_value(
                "Lunch",
                "12:00 PM",
                "1:00 PM",
                &["weekdays"],
            )]),
        );
        let (_temp, vault_id, app_state) =
            memory_schedule_test_state(frontmatter, "## Schedule and Capacity\n");
        let plan = memory_schedule_plan();

        let scheduled = apply_memory_to_generated_schedule_for_date(
            &vault_id,
            &app_state,
            plan.date,
            &plan,
            vec![
                scheduled_test_task("task_one", "First task", 180),
                scheduled_test_task("task_two", "Second task", 60),
            ],
            "2026-04-27T09:00:00-07:00",
            &std::collections::HashMap::new(),
        )
        .unwrap();

        let rows = scheduled
            .iter()
            .map(|task| {
                (
                    task.task_id.as_str(),
                    task.title.as_str(),
                    task.start_time.as_str(),
                    task.duration_minutes,
                    task.estimate_source.as_deref(),
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            &rows[..3],
            vec![
                ("task_one", "First task", "9:00 AM", 180, Some("ai")),
                ("memory_lunch_1200", "Lunch", "12:00 PM", 60, Some("memory"),),
                ("task_two", "Second task", "1:00 PM", 60, Some("ai")),
            ]
            .as_slice()
        );

        release_agenda_state(&vault_id, &app_state).unwrap();
    }

    #[test]
    fn memory_time_windows_replace_model_meal_duplicates_with_modifiers() {
        let mut frontmatter = memory_frontmatter_with_consent();
        frontmatter.insert(
            "meal_windows".into(),
            serde_yaml::Value::Sequence(vec![
                memory_window_value("Lunch", "12:00 PM", "1:00 PM", &["weekdays"]),
                memory_window_value("Dinner", "7:30 PM", "8:30 PM", &["daily"]),
            ]),
        );
        let (_temp, vault_id, app_state) =
            memory_schedule_test_state(frontmatter, "## Schedule and Capacity\n");
        let plan = memory_schedule_plan();

        let scheduled = apply_memory_to_generated_schedule_for_date(
            &vault_id,
            &app_state,
            plan.date,
            &plan,
            vec![
                scheduled_test_task("task_lunch", "Eat small lunch", 30),
                scheduled_test_task("task_dinner", "Eat small dinner", 30),
                scheduled_test_task("task_work", "Draft launch email", 30),
            ],
            "2026-04-27T11:45:00-07:00",
            &std::collections::HashMap::new(),
        )
        .unwrap();

        assert!(!scheduled
            .iter()
            .any(|task| task.task_id == "task_lunch" || task.task_id == "task_dinner"));
        assert_eq!(
            scheduled
                .iter()
                .filter(|task| task.estimate_source.as_deref() == Some("memory"))
                .map(|task| (
                    task.task_id.as_str(),
                    task.title.as_str(),
                    task.start_time.as_str()
                ))
                .collect::<Vec<_>>(),
            vec![
                ("memory_lunch_1200", "Lunch", "12:00 PM"),
                ("memory_dinner_1930", "Dinner", "7:30 PM"),
            ]
        );
        assert_eq!(
            scheduled
                .iter()
                .find(|task| task.task_id == "task_work")
                .map(|task| task.start_time.as_str()),
            Some("1:00 PM")
        );

        release_agenda_state(&vault_id, &app_state).unwrap();
    }

    #[test]
    fn memory_time_windows_do_not_count_against_task_capacity() {
        let mut frontmatter = memory_frontmatter_with_consent();
        frontmatter.insert(
            "task_capacity_hours_per_day".into(),
            serde_yaml::to_value(2.0).unwrap(),
        );
        frontmatter.insert(
            "meal_windows".into(),
            serde_yaml::Value::Sequence(vec![memory_window_value(
                "Lunch",
                "12:00 PM",
                "1:00 PM",
                &["weekdays"],
            )]),
        );
        let (_temp, vault_id, app_state) =
            memory_schedule_test_state(frontmatter, "## Schedule and Capacity\n");
        let plan = memory_schedule_plan();

        let scheduled = apply_memory_to_generated_schedule_for_date(
            &vault_id,
            &app_state,
            plan.date,
            &plan,
            vec![
                scheduled_test_task("task_one", "First task", 60),
                scheduled_test_task("task_two", "Second task", 60),
                scheduled_test_task("task_three", "Third task", 60),
            ],
            "2026-04-27T09:00:00-07:00",
            &std::collections::HashMap::new(),
        )
        .unwrap();

        let work_minutes: i32 = scheduled
            .iter()
            .filter(|task| task.estimate_source.as_deref() != Some("memory"))
            .map(|task| task.duration_minutes)
            .sum();
        assert_eq!(work_minutes, 120);
        assert_eq!(
            scheduled
                .iter()
                .map(|task| task.task_id.as_str())
                .collect::<Vec<_>>(),
            vec!["task_one", "task_two", "memory_lunch_1200"]
        );

        release_agenda_state(&vault_id, &app_state).unwrap();
    }

    #[test]
    fn generated_schedule_without_memory_reflows_from_generation_time() {
        let mut frontmatter = memory_frontmatter_with_consent();
        let mut consent = serde_yaml::Mapping::new();
        consent.insert("use_for_planning".into(), serde_yaml::Value::Bool(false));
        frontmatter.insert("consent".into(), serde_yaml::Value::Mapping(consent));
        let (_temp, vault_id, app_state) =
            memory_schedule_test_state(frontmatter, "## Schedule and Capacity\n");
        let plan = memory_schedule_plan();

        let scheduled = apply_memory_to_generated_schedule_for_date(
            &vault_id,
            &app_state,
            plan.date,
            &plan,
            vec![
                scheduled_test_task("task_lunch", "Eat small lunch", 30),
                scheduled_test_task("task_dinner", "Eat small dinner", 30),
                scheduled_test_task("task_exercise", "Daily exercise", 45),
            ],
            "2026-04-27T11:22:00-07:00",
            &std::collections::HashMap::new(),
        )
        .unwrap();

        assert_eq!(
            scheduled
                .iter()
                .map(|task| (task.task_id.as_str(), task.start_time.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("task_lunch", "11:22 AM"),
                ("task_dinner", "11:52 AM"),
                ("task_exercise", "12:22 PM"),
            ]
        );

        release_agenda_state(&vault_id, &app_state).unwrap();
    }

    #[test]
    fn write_agenda_markdown_for_ai_plan_caps_explicit_schedule_to_memory_hours() {
        let mut frontmatter = memory_frontmatter_with_consent();
        frontmatter.insert(
            "task_capacity_hours_per_day".into(),
            serde_yaml::to_value(2.0).unwrap(),
        );
        let (_temp, vault_id, app_state) =
            memory_schedule_test_state(frontmatter, "## Schedule and Capacity\n");
        let mut plan = memory_schedule_plan();
        plan.scheduled_tasks = vec![
            scheduled_test_task("task_one", "First task", 60),
            scheduled_test_task("task_two", "Second task", 60),
            scheduled_test_task("task_three", "Third task", 60),
        ];
        plan.scheduled_tasks[1].start_time = "10:00 AM".into();
        plan.scheduled_tasks[2].start_time = "11:00 AM".into();
        plan.task_order = plan
            .scheduled_tasks
            .iter()
            .map(|task| task.task_id.clone())
            .collect();

        let written =
            write_agenda_markdown_for_plan(&vault_id, &app_state, plan, &[], "ai", Some("test"))
                .unwrap();

        assert_eq!(
            written
                .scheduled_tasks
                .iter()
                .map(|task| task.task_id.as_str())
                .collect::<Vec<_>>(),
            vec!["task_one", "task_two"]
        );
        assert_eq!(
            written
                .scheduled_tasks
                .iter()
                .map(|task| task.duration_minutes)
                .sum::<i32>(),
            120
        );
        assert_eq!(written.scheduled_tasks[0].start_time, "9:00 AM");
        assert_eq!(written.scheduled_tasks[1].start_time, "10:00 AM");

        let agenda_path = {
            let vaults = app_state.vaults.lock().unwrap();
            vaults
                .get(&vault_id)
                .unwrap()
                .structure()
                .agenda_file("2026-04-27")
        };
        let markdown = std::fs::read_to_string(agenda_path).unwrap();
        assert!(markdown.contains("task_id: task_one"));
        assert!(markdown.contains("task_id: task_two"));
        assert!(!markdown.contains("task_id: task_three"));

        release_agenda_state(&vault_id, &app_state).unwrap();
    }

    #[test]
    fn write_agenda_markdown_for_ai_plan_includes_memory_time_windows() {
        let mut frontmatter = memory_frontmatter_with_consent();
        frontmatter.insert(
            "meal_windows".into(),
            serde_yaml::Value::Sequence(vec![memory_window_value(
                "Lunch",
                "12:00 PM",
                "1:00 PM",
                &["weekdays"],
            )]),
        );
        let (_temp, vault_id, app_state) =
            memory_schedule_test_state(frontmatter, "## Schedule and Capacity\n");
        let mut plan = memory_schedule_plan();
        plan.scheduled_tasks = vec![
            scheduled_test_task("task_one", "First task", 60),
            scheduled_test_task("task_two", "Second task", 60),
        ];
        plan.scheduled_tasks[0].start_time = "11:00 AM".into();
        plan.scheduled_tasks[1].start_time = "1:00 PM".into();
        plan.task_order = plan
            .scheduled_tasks
            .iter()
            .map(|task| task.task_id.clone())
            .collect();

        let written =
            write_agenda_markdown_for_plan(&vault_id, &app_state, plan, &[], "ai", Some("test"))
                .unwrap();

        assert_eq!(
            written
                .scheduled_tasks
                .iter()
                .map(|task| (task.task_id.as_str(), task.start_time.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("task_one", "11:00 AM"),
                ("memory_lunch_1200", "12:00 PM"),
                ("task_two", "1:00 PM"),
            ]
        );

        let agenda_path = {
            let vaults = app_state.vaults.lock().unwrap();
            vaults
                .get(&vault_id)
                .unwrap()
                .structure()
                .agenda_file("2026-04-27")
        };
        let markdown = std::fs::read_to_string(agenda_path).unwrap();
        assert!(markdown.contains("task_id: memory_lunch_1200"));
        assert!(markdown.contains("12:00 PM Lunch (60 min)"));

        release_agenda_state(&vault_id, &app_state).unwrap();
    }

    #[test]
    fn write_agenda_markdown_for_today_ai_plan_omits_already_started_memory_rows() {
        let mut frontmatter = memory_frontmatter_with_consent();
        frontmatter.insert(
            "meal_windows".into(),
            serde_yaml::Value::Sequence(vec![
                memory_window_value("Breakfast", "7:15 AM", "7:45 AM", &["daily"]),
                memory_window_value("Lunch", "12:00 PM", "1:00 PM", &["daily"]),
                memory_window_value("Afternoon snack", "3:00 PM", "3:15 PM", &["daily"]),
            ]),
        );
        let (_temp, vault_id, app_state) =
            memory_schedule_test_state(frontmatter, "## Schedule and Capacity\n");
        let generated_at = Local::now()
            .with_hour(12)
            .and_then(|time| time.with_minute(16))
            .and_then(|time| time.with_second(0))
            .and_then(|time| time.with_nanosecond(0))
            .unwrap()
            .to_rfc3339();
        let mut plan = memory_schedule_plan();
        plan.date = Local::now().date_naive();
        plan.generated_at = Some(generated_at);
        plan.scheduled_tasks = vec![scheduled_test_task("task_one", "First task", 45)];
        plan.scheduled_tasks[0].start_time = "12:17 PM".into();
        plan.task_order = plan
            .scheduled_tasks
            .iter()
            .map(|task| task.task_id.clone())
            .collect();

        let written =
            write_agenda_markdown_for_plan(&vault_id, &app_state, plan, &[], "ai", Some("test"))
                .unwrap();

        let visible_titles = written
            .scheduled_tasks
            .iter()
            .map(|task| task.title.as_str())
            .collect::<Vec<_>>();
        assert_eq!(visible_titles, vec!["First task", "Afternoon snack"]);
        assert!(!written
            .scheduled_tasks
            .iter()
            .any(|task| task.start_time == "7:15 AM" || task.start_time == "12:00 PM"));

        release_agenda_state(&vault_id, &app_state).unwrap();
    }

    #[test]
    fn write_agenda_markdown_preserves_explicit_assistant_meal_after_memory_window_started() {
        let mut frontmatter = memory_frontmatter_with_consent();
        frontmatter.insert(
            "meal_windows".into(),
            serde_yaml::Value::Sequence(vec![memory_window_value(
                "Breakfast",
                "8:45 AM",
                "9:15 AM",
                &["daily"],
            )]),
        );
        let (_temp, vault_id, app_state) =
            memory_schedule_test_state(frontmatter, "## Schedule and Capacity\n");
        let generated_at = Local::now()
            .with_hour(8)
            .and_then(|time| time.with_minute(53))
            .and_then(|time| time.with_second(0))
            .and_then(|time| time.with_nanosecond(0))
            .unwrap()
            .to_rfc3339();
        let mut plan = memory_schedule_plan();
        plan.date = Local::now().date_naive();
        plan.generated_at = Some(generated_at);
        plan.scheduled_tasks = vec![
            scheduled_test_task("task_breakfast", "Breakfast", 30),
            scheduled_test_task("task_one", "First task", 45),
        ];
        plan.scheduled_tasks[0].start_time = "9:00 AM".into();
        plan.scheduled_tasks[1].start_time = "9:30 AM".into();
        plan.task_order = plan
            .scheduled_tasks
            .iter()
            .map(|task| task.task_id.clone())
            .collect();

        let written =
            write_agenda_markdown_for_plan(&vault_id, &app_state, plan, &[], "ai", Some("test"))
                .unwrap();

        assert_eq!(
            written
                .scheduled_tasks
                .iter()
                .map(|task| (
                    task.task_id.as_str(),
                    task.title.as_str(),
                    task.start_time.as_str()
                ))
                .collect::<Vec<_>>(),
            vec![
                ("task_breakfast", "Breakfast", "9:00 AM"),
                ("task_one", "First task", "9:30 AM")
            ]
        );

        release_agenda_state(&vault_id, &app_state).unwrap();
    }

    #[test]
    fn write_agenda_markdown_preserves_manual_schedule_even_when_memory_hours_are_lower() {
        let mut frontmatter = memory_frontmatter_with_consent();
        frontmatter.insert(
            "task_capacity_hours_per_day".into(),
            serde_yaml::to_value(1.0).unwrap(),
        );
        let (_temp, vault_id, app_state) =
            memory_schedule_test_state(frontmatter, "## Schedule and Capacity\n");
        let mut plan = memory_schedule_plan();
        plan.scheduled_tasks = vec![
            scheduled_test_task("task_one", "First task", 60),
            scheduled_test_task("task_two", "Second task", 60),
        ];
        plan.scheduled_tasks[1].start_time = "10:00 AM".into();
        plan.task_order = plan
            .scheduled_tasks
            .iter()
            .map(|task| task.task_id.clone())
            .collect();

        let written =
            write_agenda_markdown_for_plan(&vault_id, &app_state, plan, &[], "manual", None)
                .unwrap();

        assert_eq!(
            written
                .scheduled_tasks
                .iter()
                .map(|task| task.task_id.as_str())
                .collect::<Vec<_>>(),
            vec!["task_one", "task_two"]
        );
        assert_eq!(
            written
                .scheduled_tasks
                .iter()
                .map(|task| task.duration_minutes)
                .sum::<i32>(),
            120
        );
        assert_eq!(written.scheduled_tasks[0].start_time, "9:00 AM");
        assert_eq!(written.scheduled_tasks[1].start_time, "10:00 AM");

        release_agenda_state(&vault_id, &app_state).unwrap();
    }

    #[test]
    fn agenda_error_log_path_for_vault_ensures_log_file() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-error-log-path-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Error Log Path Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();
        let error_log_path = manager.structure().error_log.clone();
        std::fs::remove_file(&error_log_path).unwrap();

        let app_state = crate::commands::vault::AppState::default();
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert("vault_test".to_string(), manager);

        let resolved = agenda_error_log_path_for_vault("vault_test", &app_state).unwrap();

        assert_eq!(resolved, error_log_path);
        assert!(resolved.exists());
        let error_log = std::fs::read_to_string(resolved).unwrap();
        assert!(error_log.contains("type: error_log"));
    }

    #[test]
    fn task_quadrants_logs_and_excludes_invalid_goal_task_rows() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-invalid-quadrant-task-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Invalid Quadrant Task Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();
        let goal_path = manager.structure().goal_file_flat("goal_priority");
        let error_log_path = manager.structure().error_log.clone();

        let mut valid_task = serde_yaml::Mapping::new();
        valid_task.insert(
            serde_yaml::Value::String("id".to_string()),
            serde_yaml::Value::String("task_valid".to_string()),
        );
        valid_task.insert(
            serde_yaml::Value::String("title".to_string()),
            serde_yaml::Value::String("Valid task".to_string()),
        );
        valid_task.insert(
            serde_yaml::Value::String("status".to_string()),
            serde_yaml::Value::String("todo".to_string()),
        );
        valid_task.insert(
            serde_yaml::Value::String("eisenhower_quadrant".to_string()),
            serde_yaml::Value::String("schedule".to_string()),
        );
        valid_task.insert(
            serde_yaml::Value::String("due_date".to_string()),
            serde_yaml::Value::String("2026-04-26".to_string()),
        );

        let mut invalid_task = serde_yaml::Mapping::new();
        invalid_task.insert(
            serde_yaml::Value::String("id".to_string()),
            serde_yaml::Value::String("task_invalid".to_string()),
        );
        invalid_task.insert(
            serde_yaml::Value::String("status".to_string()),
            serde_yaml::Value::String("todo".to_string()),
        );
        invalid_task.insert(
            serde_yaml::Value::String("eisenhower_quadrant".to_string()),
            serde_yaml::Value::String("do".to_string()),
        );

        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert(
            "id".into(),
            serde_yaml::Value::String("goal_priority".to_string()),
        );
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Priority Goal".to_string()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("goal".to_string()));
        frontmatter.insert(
            "status".into(),
            serde_yaml::Value::String("active".to_string()),
        );
        frontmatter.insert(
            "priority".into(),
            serde_yaml::Value::String("low".to_string()),
        );
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![
                serde_yaml::Value::Mapping(valid_task),
                serde_yaml::Value::Mapping(invalid_task),
            ]),
        );
        manager
            .write_goal("goal_priority", &frontmatter, "Priority notes")
            .unwrap();
        let original = std::fs::read_to_string(&goal_path).unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let quadrants = task_quadrants_from_vault(
            &vault_id,
            &app_state,
            NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
        )
        .unwrap();

        assert_eq!(
            quadrants.get("task_valid").map(String::as_str),
            Some("delegate")
        );
        assert!(!quadrants.contains_key("task_invalid"));
        let error_log = std::fs::read_to_string(error_log_path).unwrap();
        assert!(error_log.contains("goals/goal_priority.md"));
        assert!(error_log.contains("tasks[1].title"));
        assert_eq!(std::fs::read_to_string(goal_path).unwrap(), original);

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn task_quadrants_infer_delegate_from_outsourced_repair_titles() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-title-delegate-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Title Delegate Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let mut sink_task = serde_yaml::Mapping::new();
        sink_task.insert(
            "id".into(),
            serde_yaml::Value::String("task_kitchen_sink".into()),
        );
        sink_task.insert(
            "title".into(),
            serde_yaml::Value::String("Get kitchen sink fixed".into()),
        );
        sink_task.insert("status".into(), serde_yaml::Value::String("todo".into()));
        sink_task.insert(
            "due_date".into(),
            serde_yaml::Value::String("2026-04-30".into()),
        );

        let mut toilet_task = serde_yaml::Mapping::new();
        toilet_task.insert(
            "id".into(),
            serde_yaml::Value::String("task_downstairs_toilet".into()),
        );
        toilet_task.insert(
            "title".into(),
            serde_yaml::Value::String("Get downstairs toilet fixed".into()),
        );
        toilet_task.insert("status".into(), serde_yaml::Value::String("todo".into()));
        toilet_task.insert(
            "due_date".into(),
            serde_yaml::Value::String("2026-04-30".into()),
        );

        let mut direct_task = serde_yaml::Mapping::new();
        direct_task.insert(
            "id".into(),
            serde_yaml::Value::String("task_direct_work".into()),
        );
        direct_task.insert(
            "title".into(),
            serde_yaml::Value::String("Fix copy on landing page".into()),
        );
        direct_task.insert("status".into(), serde_yaml::Value::String("todo".into()));
        direct_task.insert(
            "due_date".into(),
            serde_yaml::Value::String("2026-04-30".into()),
        );

        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert(
            "id".into(),
            serde_yaml::Value::String("goal_home".to_string()),
        );
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Have a repaired and clean home".to_string()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("goal".to_string()));
        frontmatter.insert(
            "status".into(),
            serde_yaml::Value::String("active".to_string()),
        );
        frontmatter.insert(
            "priority".into(),
            serde_yaml::Value::String("high".to_string()),
        );
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![
                serde_yaml::Value::Mapping(sink_task),
                serde_yaml::Value::Mapping(toilet_task),
                serde_yaml::Value::Mapping(direct_task),
            ]),
        );
        manager.write_goal("goal_home", &frontmatter, "").unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let quadrants = task_quadrants_from_vault(
            &vault_id,
            &app_state,
            NaiveDate::from_ymd_opt(2026, 4, 30).unwrap(),
        )
        .unwrap();

        assert_eq!(
            quadrants.get("task_kitchen_sink").map(String::as_str),
            Some("delegate")
        );
        assert_eq!(
            quadrants.get("task_downstairs_toilet").map(String::as_str),
            Some("delegate")
        );
        assert_eq!(
            quadrants.get("task_direct_work").map(String::as_str),
            Some("do")
        );

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn task_quadrants_use_optional_domain_threshold_metadata() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-domain-thresholds-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Domain Threshold Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let mut urgency = serde_yaml::Mapping::new();
        urgency.insert(
            "due_within_days".into(),
            serde_yaml::Value::Number(serde_yaml::Number::from(3)),
        );
        let mut importance = serde_yaml::Mapping::new();
        importance.insert(
            "min_goal_priority".into(),
            serde_yaml::Value::String("high".to_string()),
        );
        let mut domain_fm = markdown_parser::Frontmatter::new();
        domain_fm.insert(
            "id".into(),
            serde_yaml::Value::String("domain_startup".to_string()),
        );
        domain_fm.insert(
            "type".into(),
            serde_yaml::Value::String("domain".to_string()),
        );
        domain_fm.insert(
            "name".into(),
            serde_yaml::Value::String("Startup".to_string()),
        );
        domain_fm.insert(
            "urgency_threshold".into(),
            serde_yaml::Value::Mapping(urgency),
        );
        domain_fm.insert(
            "importance_threshold".into(),
            serde_yaml::Value::Mapping(importance),
        );
        std::fs::write(
            manager.structure().domains.join("startup.md"),
            markdown_parser::serialize_frontmatter(&domain_fm, ""),
        )
        .unwrap();

        let mut task = serde_yaml::Mapping::new();
        task.insert("id".into(), serde_yaml::Value::String("task_launch".into()));
        task.insert(
            "title".into(),
            serde_yaml::Value::String("Prepare launch notes".into()),
        );
        task.insert("status".into(), serde_yaml::Value::String("todo".into()));
        task.insert(
            "due_date".into(),
            serde_yaml::Value::String("2026-04-28".into()),
        );

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert(
            "id".into(),
            serde_yaml::Value::String("goal_launch".to_string()),
        );
        goal_fm.insert(
            "title".into(),
            serde_yaml::Value::String("Launch MVP".to_string()),
        );
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".to_string()));
        goal_fm.insert(
            "domain".into(),
            serde_yaml::Value::String("Startup".to_string()),
        );
        goal_fm.insert(
            "priority".into(),
            serde_yaml::Value::String("medium".to_string()),
        );
        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(task)]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let quadrants = task_quadrants_from_vault(
            &vault_id,
            &app_state,
            NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
        )
        .unwrap();

        assert_eq!(
            quadrants.get("task_launch").map(String::as_str),
            Some("delegate")
        );

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn create_plan_for_date_builds_heuristic_agenda_from_goal_tasks() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-heuristic-agenda-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Heuristic Agenda Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let mut do_task = serde_yaml::Mapping::new();
        do_task.insert(
            serde_yaml::Value::String("id".to_string()),
            serde_yaml::Value::String("task_do".to_string()),
        );
        do_task.insert(
            serde_yaml::Value::String("title".to_string()),
            serde_yaml::Value::String("Handle urgent launch issue".to_string()),
        );
        do_task.insert(
            serde_yaml::Value::String("status".to_string()),
            serde_yaml::Value::String("todo".to_string()),
        );
        do_task.insert(
            serde_yaml::Value::String("eisenhower_quadrant".to_string()),
            serde_yaml::Value::String("do".to_string()),
        );
        do_task.insert(
            serde_yaml::Value::String("due_date".to_string()),
            serde_yaml::Value::String("2026-04-26".to_string()),
        );

        let mut schedule_task = serde_yaml::Mapping::new();
        schedule_task.insert(
            serde_yaml::Value::String("id".to_string()),
            serde_yaml::Value::String("task_schedule".to_string()),
        );
        schedule_task.insert(
            serde_yaml::Value::String("title".to_string()),
            serde_yaml::Value::String("Review product notes".to_string()),
        );
        schedule_task.insert(
            serde_yaml::Value::String("status".to_string()),
            serde_yaml::Value::String("todo".to_string()),
        );
        schedule_task.insert(
            serde_yaml::Value::String("eisenhower_quadrant".to_string()),
            serde_yaml::Value::String("schedule".to_string()),
        );
        schedule_task.insert(
            serde_yaml::Value::String("due_date".to_string()),
            serde_yaml::Value::String("2026-05-15".to_string()),
        );

        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert(
            "id".into(),
            serde_yaml::Value::String("goal_heuristic".to_string()),
        );
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Launch Goal".to_string()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("goal".to_string()));
        frontmatter.insert(
            "status".into(),
            serde_yaml::Value::String("active".to_string()),
        );
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![
                serde_yaml::Value::Mapping(schedule_task),
                serde_yaml::Value::Mapping(do_task),
            ]),
        );
        manager
            .write_goal("goal_heuristic", &frontmatter, "Launch notes")
            .unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        let agenda_path = manager.structure().agenda_file("2026-04-26");
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let plan = create_plan_for_date(
            &vault_id,
            &app_state,
            NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
        )
        .unwrap();

        assert_eq!(
            plan.task_order,
            vec!["task_do".to_string(), "task_schedule".to_string()]
        );
        assert_eq!(plan.scheduled_tasks.len(), 2);
        assert_eq!(plan.scheduled_tasks[0].task_id, "task_do");
        assert_eq!(
            plan.task_titles.get("task_schedule").map(String::as_str),
            Some("Review product notes")
        );

        let agenda_markdown = std::fs::read_to_string(agenda_path).unwrap();
        assert!(agenda_markdown.contains("generated_by: heuristic"));
        assert!(agenda_markdown.contains("Handle urgent launch issue"));

        release_agenda_state(&vault_id, &app_state).unwrap();
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn create_plan_for_date_includes_specific_day_tasks_only_on_that_day() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-specific-day-agenda-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Specific Day Agenda Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let task = |id: &str, title: &str, scheduled_date: Option<&str>| {
            let mut map = serde_yaml::Mapping::new();
            map.insert(
                serde_yaml::Value::String("id".to_string()),
                serde_yaml::Value::String(id.to_string()),
            );
            map.insert(
                serde_yaml::Value::String("title".to_string()),
                serde_yaml::Value::String(title.to_string()),
            );
            map.insert(
                serde_yaml::Value::String("status".to_string()),
                serde_yaml::Value::String("todo".to_string()),
            );
            map.insert(
                serde_yaml::Value::String("eisenhower_quadrant".to_string()),
                serde_yaml::Value::String("schedule".to_string()),
            );
            if let Some(date) = scheduled_date {
                map.insert(
                    serde_yaml::Value::String("scheduled_date".to_string()),
                    serde_yaml::Value::String(date.to_string()),
                );
            }
            serde_yaml::Value::Mapping(map)
        };

        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert(
            "id".into(),
            serde_yaml::Value::String("goal_specific_day".to_string()),
        );
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Specific Day Goal".to_string()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("goal".to_string()));
        frontmatter.insert(
            "status".into(),
            serde_yaml::Value::String("active".to_string()),
        );
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![
                task("task_flexible", "Flexible task", None),
                task("task_exact", "Exact day task", Some("2026-04-27")),
                task("task_past_exact", "Past exact task", Some("2026-04-25")),
            ]),
        );
        manager
            .write_goal("goal_specific_day", &frontmatter, "Specific day notes")
            .unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let day_before = create_plan_for_date(
            &vault_id,
            &app_state,
            NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
        )
        .unwrap();
        assert_eq!(day_before.task_order, vec!["task_flexible".to_string()]);

        let exact_day = create_plan_for_date(
            &vault_id,
            &app_state,
            NaiveDate::from_ymd_opt(2026, 4, 27).unwrap(),
        )
        .unwrap();
        assert!(exact_day.task_order.contains(&"task_exact".to_string()));
        assert!(!exact_day
            .task_order
            .contains(&"task_past_exact".to_string()));

        let day_after = create_plan_for_date(
            &vault_id,
            &app_state,
            NaiveDate::from_ymd_opt(2026, 4, 28).unwrap(),
        )
        .unwrap();
        assert_eq!(day_after.task_order, vec!["task_flexible".to_string()]);

        release_agenda_state(&vault_id, &app_state).unwrap();
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn read_agenda_overlay_syncs_markdown_into_derived_db() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-cache-sync-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Cache Sync Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();
        let agenda_path = manager.structure().agenda_file("2026-04-26");
        manager
            .write_markdown_file(
                &agenda_path,
                r#"---
id: plan_today
type: agenda
date: "2026-04-26"
status: active
generated_at: "2026-04-26T09:00:00-07:00"
top_outcome_ids:
  - outcome_beta
completed_task_ids: []
scheduled_tasks:
  - id: scheduled_task_beta
    task_id: task_beta
    title: Beta from frontmatter
    start_time: "9:00 AM"
    duration_minutes: 30
  - id: scheduled_task_alpha
    task_id: task_alpha
    title: Alpha from frontmatter
    start_time: "9:30 AM"
    duration_minutes: 30
---

## Schedule

- [x] 9:00 AM Beta from markdown (30 min) <!-- task_id: task_beta -->
- [ ] 9:30 AM Alpha from markdown (30 min) <!-- task_id: task_alpha -->
"#,
                "user",
                "write_agenda",
                Some("plan_today"),
            )
            .unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);
        let date = NaiveDate::from_ymd_opt(2026, 4, 26).unwrap();
        let stale_plan = with_db(&vault_id, &app_state, |db| {
            let plan = db.create_plan(date)?;
            db.update_plan(
                &plan.id,
                Some(vec!["old_outcome".into()]),
                Some(vec!["task_alpha".into()]),
            )
        })
        .unwrap();

        let overlay = read_agenda_overlay(&vault_id, &app_state, stale_plan).unwrap();

        assert_eq!(
            overlay.task_order,
            vec!["task_beta".to_string(), "task_alpha".to_string()]
        );
        assert_eq!(overlay.completed_task_ids, vec!["task_beta".to_string()]);
        assert_eq!(
            overlay.task_titles.get("task_beta").map(String::as_str),
            Some("Beta from markdown")
        );

        let cached = with_db(&vault_id, &app_state, |db| db.get_plan_by_id(&overlay.id)).unwrap();
        assert_eq!(cached.top_3_outcome_ids, vec!["outcome_beta".to_string()]);
        assert_eq!(
            cached.task_order,
            vec!["task_beta".to_string(), "task_alpha".to_string()]
        );
        assert_eq!(cached.completed_task_ids, vec!["task_beta".to_string()]);
        assert_eq!(
            cached.task_titles.get("task_alpha").map(String::as_str),
            Some("Alpha from markdown")
        );
        assert_eq!(
            cached.generated_at.as_deref(),
            Some("2026-04-26T09:00:00-07:00")
        );
        assert_eq!(cached.scheduled_tasks.len(), 2);
        assert_eq!(cached.scheduled_tasks[0].task_id, "task_beta");
        assert_eq!(cached.scheduled_tasks[0].title, "Beta from markdown");
        assert_eq!(cached.scheduled_tasks[0].start_time, "9:00 AM");

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn read_agenda_overlay_repairs_completion_from_completed_goal_task() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-completion-repair-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Completion Repair Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert("id".into(), serde_yaml::Value::String("goal_launch".into()));
        goal_fm.insert("title".into(), serde_yaml::Value::String("Launch".into()));
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".into()));
        goal_fm.insert("status".into(), serde_yaml::Value::String("active".into()));
        let mut task = serde_yaml::Mapping::new();
        task.insert(
            "id".into(),
            serde_yaml::Value::String("task_existing".into()),
        );
        task.insert(
            "title".into(),
            serde_yaml::Value::String("Existing task".into()),
        );
        task.insert(
            "status".into(),
            serde_yaml::Value::String("completed".into()),
        );
        task.insert(
            "completed_at".into(),
            serde_yaml::Value::String("2026-04-27T12:00:00Z".into()),
        );
        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(task)]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();

        let agenda_path = manager.structure().agenda_file("2026-04-27");
        manager
            .write_markdown_file(
                &agenda_path,
                r#"---
id: plan_today
type: agenda
date: "2026-04-27"
status: active
generated_at: "2026-04-27T09:00:00-07:00"
completed_task_ids: []
scheduled_tasks:
  - id: scheduled_task_existing
    task_id: task_existing
    title: Existing task
    start_time: "9:00 AM"
    duration_minutes: 30
---

## Schedule

- [ ] 9:00 AM Existing task (30 min) <!-- task_id: task_existing -->
"#,
                "user",
                "write_agenda",
                Some("plan_today"),
            )
            .unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);
        let date = NaiveDate::from_ymd_opt(2026, 4, 27).unwrap();
        let stale_plan = with_db(&vault_id, &app_state, |db| db.create_plan(date)).unwrap();

        let overlay = read_agenda_overlay(&vault_id, &app_state, stale_plan).unwrap();

        assert_eq!(
            overlay.completed_task_ids,
            vec!["task_existing".to_string()]
        );
        let cached = with_db(&vault_id, &app_state, |db| db.get_plan_by_id(&overlay.id)).unwrap();
        assert_eq!(cached.completed_task_ids, vec!["task_existing".to_string()]);

        let repaired = std::fs::read_to_string(agenda_path).unwrap();
        assert!(repaired.contains("completed_task_ids:\n- task_existing"));
        assert!(repaired.contains("- [x] 9:00 AM Existing task (30 min)"));

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn read_agenda_overlay_repairs_goal_status_from_checked_agenda_row() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-goal-completion-repair-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Goal Completion Repair Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert("id".into(), serde_yaml::Value::String("goal_launch".into()));
        goal_fm.insert("title".into(), serde_yaml::Value::String("Launch".into()));
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".into()));
        goal_fm.insert("status".into(), serde_yaml::Value::String("active".into()));
        let mut task = serde_yaml::Mapping::new();
        task.insert(
            "id".into(),
            serde_yaml::Value::String("task_existing".into()),
        );
        task.insert(
            "title".into(),
            serde_yaml::Value::String("Existing task".into()),
        );
        task.insert("status".into(), serde_yaml::Value::String("todo".into()));
        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(task)]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();

        let agenda_path = manager.structure().agenda_file("2026-04-27");
        manager
            .write_markdown_file(
                &agenda_path,
                r#"---
id: plan_today
type: agenda
date: "2026-04-27"
status: active
generated_at: "2026-04-27T09:00:00-07:00"
completed_task_ids: []
scheduled_tasks:
  - id: scheduled_task_existing
    task_id: task_existing
    title: Existing task
    start_time: "9:00 AM"
    duration_minutes: 30
---

## Schedule

- [x] 9:00 AM Existing task (30 min) <!-- task_id: task_existing -->
"#,
                "user",
                "write_agenda",
                Some("plan_today"),
            )
            .unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);
        let date = NaiveDate::from_ymd_opt(2026, 4, 27).unwrap();
        let stale_plan = with_db(&vault_id, &app_state, |db| db.create_plan(date)).unwrap();

        let overlay = read_agenda_overlay(&vault_id, &app_state, stale_plan).unwrap();

        assert_eq!(
            overlay.completed_task_ids,
            vec!["task_existing".to_string()]
        );
        let vaults = app_state.vaults.lock().unwrap();
        let vault = vaults.get(&vault_id).unwrap();
        let (updated_goal_fm, _) = vault.read_goal("goal_launch").unwrap();
        let task = updated_goal_fm
            .get("tasks")
            .and_then(|v| v.as_sequence())
            .and_then(|tasks| tasks.first())
            .unwrap();
        assert_eq!(
            task.get("status").and_then(|v| v.as_str()),
            Some("completed")
        );
        let completed_at = task.get("completed_at").and_then(|v| v.as_str()).unwrap();
        assert!(chrono::DateTime::parse_from_rfc3339(completed_at).is_ok());
        let mutation_log = std::fs::read_to_string(&vault.structure().mutation_log).unwrap();
        assert!(mutation_log.contains("- Actor: system"));
        assert!(mutation_log.contains("- Action: repair_goal_completion_from_agenda"));
        drop(vaults);

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn read_agenda_overlay_skips_goal_completion_repair_for_invalid_goal_task_rows() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-goal-completion-invalid-repair-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Invalid Goal Completion Repair Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();
        let goal_path = manager.structure().goal_file_flat("goal_launch");
        let error_log_path = manager.structure().error_log.clone();
        let mutation_log_path = manager.structure().mutation_log.clone();

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert("id".into(), serde_yaml::Value::String("goal_launch".into()));
        goal_fm.insert("title".into(), serde_yaml::Value::String("Launch".into()));
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".into()));
        goal_fm.insert("status".into(), serde_yaml::Value::String("active".into()));
        let mut invalid_task = serde_yaml::Mapping::new();
        invalid_task.insert(
            "id".into(),
            serde_yaml::Value::String("task_invalid".into()),
        );
        invalid_task.insert("status".into(), serde_yaml::Value::String("todo".into()));
        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(invalid_task)]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();
        let original_goal = std::fs::read_to_string(&goal_path).unwrap();

        let agenda_path = manager.structure().agenda_file("2026-04-27");
        manager
            .write_markdown_file(
                &agenda_path,
                r#"---
id: plan_today
type: agenda
date: "2026-04-27"
status: active
generated_at: "2026-04-27T09:00:00-07:00"
completed_task_ids: []
scheduled_tasks:
  - id: scheduled_task_invalid
    task_id: task_invalid
    title: Invalid task from Agenda
    start_time: "9:00 AM"
    duration_minutes: 30
---

## Schedule

- [x] 9:00 AM Invalid task from Agenda (30 min) <!-- task_id: task_invalid -->
"#,
                "user",
                "write_agenda",
                Some("plan_today"),
            )
            .unwrap();
        let original_mutation_log = std::fs::read_to_string(&mutation_log_path).unwrap_or_default();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);
        let date = NaiveDate::from_ymd_opt(2026, 4, 27).unwrap();
        let stale_plan = with_db(&vault_id, &app_state, |db| db.create_plan(date)).unwrap();

        let overlay = read_agenda_overlay(&vault_id, &app_state, stale_plan).unwrap();

        assert_eq!(overlay.completed_task_ids, vec!["task_invalid".to_string()]);
        let cached = with_db(&vault_id, &app_state, |db| db.get_plan_by_id(&overlay.id)).unwrap();
        assert_eq!(cached.completed_task_ids, vec!["task_invalid".to_string()]);
        let warnings =
            agenda_warnings_for_date(&vault_id, NaiveDate::from_ymd_opt(2026, 4, 27).unwrap())
                .unwrap();
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("task_invalid"));
        assert!(warnings[0].contains("logs/errors.md"));

        assert_eq!(std::fs::read_to_string(&goal_path).unwrap(), original_goal);
        let error_log = std::fs::read_to_string(&error_log_path).unwrap();
        assert!(error_log.contains("goals/goal_launch.md"));
        assert!(error_log.contains("tasks[0].title"));
        assert_eq!(
            std::fs::read_to_string(&mutation_log_path).unwrap_or_default(),
            original_mutation_log
        );

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn read_agenda_overlay_rejects_invalid_frontmatter_scheduled_task_row() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-invalid-row-read-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Invalid Row Read Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();
        let agenda_path = manager.structure().agenda_file("2026-04-26");
        let error_log_path = manager.structure().error_log.clone();
        let invalid_agenda = r#"---
id: plan_today
type: agenda
date: "2026-04-26"
status: active
generated_at: "2026-04-26T09:00:00-07:00"
scheduled_tasks:
  - id: scheduled_task_beta
    task_id: task_beta
    title: Beta from frontmatter
    duration_minutes: 30
---

## Schedule
"#;
        manager
            .write_markdown_file(
                &agenda_path,
                invalid_agenda,
                "user",
                "write_agenda",
                Some("plan_today"),
            )
            .unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);
        let stale_plan = with_db(&vault_id, &app_state, |db| {
            db.create_plan(NaiveDate::from_ymd_opt(2026, 4, 26).unwrap())
        })
        .unwrap();

        let error = read_agenda_overlay(&vault_id, &app_state, stale_plan).unwrap_err();
        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error.message.contains("scheduled_tasks[0].start_time"));
        let error_log = std::fs::read_to_string(error_log_path).unwrap();
        assert!(error_log.contains("agenda/2026-04-26.md"));
        assert!(error_log.contains("scheduled_tasks[0].start_time"));
        assert_eq!(
            std::fs::read_to_string(agenda_path).unwrap(),
            invalid_agenda
        );

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn read_agenda_overlay_logs_frontmatter_parse_errors() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-parse-error-read-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Parse Error Read Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();
        let agenda_path = manager.structure().agenda_file("2026-04-26");
        let error_log_path = manager.structure().error_log.clone();
        let invalid_agenda = r#"---
id: [unterminated
---

## Schedule
"#;
        std::fs::write(&agenda_path, invalid_agenda).unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);
        let stale_plan = with_db(&vault_id, &app_state, |db| {
            db.create_plan(NaiveDate::from_ymd_opt(2026, 4, 26).unwrap())
        })
        .unwrap();

        let error = read_agenda_overlay(&vault_id, &app_state, stale_plan).unwrap_err();
        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error.message.contains("Markdown parse error"));
        let error_log = std::fs::read_to_string(error_log_path).unwrap();
        assert!(error_log.contains("agenda/2026-04-26.md"));
        assert!(error_log.contains("Markdown parse error"));
        assert_eq!(
            std::fs::read_to_string(agenda_path).unwrap(),
            invalid_agenda
        );

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn update_plan_with_scheduled_tasks_writes_markdown_and_cache() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-manual-edit-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Manual Edit Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let date = NaiveDate::from_ymd_opt(2026, 4, 26).unwrap();
        let plan = with_db(&vault_id, &app_state, |db| {
            let plan = db.create_plan(date)?;
            db.update_plan(
                &plan.id,
                None,
                Some(vec!["task_alpha".into(), "task_beta".into()]),
            )
        })
        .unwrap();

        let updated = update_plan_from_input(
            UpdatePlanInput {
                vault_id: vault_id.clone(),
                plan_id: plan.id.clone(),
                top_3_outcome_ids: Some(vec!["outcome_manual".into()]),
                task_order: None,
                scheduled_tasks: Some(vec![
                    ScheduledTask {
                        id: "scheduled_task_beta".into(),
                        task_id: "task_beta".into(),
                        title: "Beta renamed".into(),
                        start_time: "9:00 AM".into(),
                        duration_minutes: 25,
                        estimate_source: Some("manual".into()),
                        eisenhower_quadrant: Some("do".into()),
                    },
                    ScheduledTask {
                        id: "scheduled_task_alpha".into(),
                        task_id: "task_alpha".into(),
                        title: "Alpha moved later".into(),
                        start_time: "9:25 AM".into(),
                        duration_minutes: 35,
                        estimate_source: Some("manual".into()),
                        eisenhower_quadrant: Some("schedule".into()),
                    },
                ]),
            },
            &app_state,
        )
        .unwrap();

        assert_eq!(
            updated.task_order,
            vec!["task_beta".to_string(), "task_alpha".to_string()]
        );
        assert_eq!(
            updated.task_titles.get("task_beta").map(String::as_str),
            Some("Beta renamed")
        );
        assert_eq!(updated.scheduled_tasks[0].start_time, "9:00 AM");

        let agenda_path = app_state
            .vaults
            .lock()
            .unwrap()
            .get(&vault_id)
            .unwrap()
            .structure()
            .agenda_file("2026-04-26");
        let content = std::fs::read_to_string(agenda_path).unwrap();
        assert!(content.contains("- [ ] 9:00 AM Beta renamed (25 min)"));
        assert!(content.contains("task_id: task_beta"));

        let cached = with_db(&vault_id, &app_state, |db| db.get_plan_by_id(&plan.id)).unwrap();
        assert_eq!(
            cached.task_order,
            vec!["task_beta".to_string(), "task_alpha".to_string()]
        );
        assert_eq!(
            cached.task_titles.get("task_alpha").map(String::as_str),
            Some("Alpha moved later")
        );
        assert_eq!(cached.scheduled_tasks.len(), 2);
        assert_eq!(cached.scheduled_tasks[0].task_id, "task_beta");
        assert_eq!(cached.scheduled_tasks[0].title, "Beta renamed");
        assert_eq!(cached.scheduled_tasks[0].start_time, "9:00 AM");

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn update_plan_with_task_order_rebuilds_stale_cached_schedule() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-task-order-cache-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Task Order Cache Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let date = NaiveDate::from_ymd_opt(2026, 4, 26).unwrap();
        let plan = with_db(&vault_id, &app_state, |db| {
            let plan = db.create_plan(date)?;
            db.update_plan(
                &plan.id,
                None,
                Some(vec!["task_alpha".into(), "task_beta".into()]),
            )
        })
        .unwrap();

        update_plan_from_input(
            UpdatePlanInput {
                vault_id: vault_id.clone(),
                plan_id: plan.id.clone(),
                top_3_outcome_ids: None,
                task_order: None,
                scheduled_tasks: Some(vec![
                    ScheduledTask {
                        id: "scheduled_task_beta".into(),
                        task_id: "task_beta".into(),
                        title: "Beta cached first".into(),
                        start_time: "9:00 AM".into(),
                        duration_minutes: 25,
                        estimate_source: Some("manual".into()),
                        eisenhower_quadrant: None,
                    },
                    ScheduledTask {
                        id: "scheduled_task_alpha".into(),
                        task_id: "task_alpha".into(),
                        title: "Alpha cached second".into(),
                        start_time: "9:25 AM".into(),
                        duration_minutes: 35,
                        estimate_source: Some("manual".into()),
                        eisenhower_quadrant: None,
                    },
                ]),
            },
            &app_state,
        )
        .unwrap();

        let updated = update_plan_from_input(
            UpdatePlanInput {
                vault_id: vault_id.clone(),
                plan_id: plan.id.clone(),
                top_3_outcome_ids: None,
                task_order: Some(vec!["task_alpha".into(), "task_beta".into()]),
                scheduled_tasks: None,
            },
            &app_state,
        )
        .unwrap();

        assert_eq!(
            updated.task_order,
            vec!["task_alpha".to_string(), "task_beta".to_string()]
        );
        assert_eq!(updated.scheduled_tasks[0].task_id, "task_alpha");
        assert_eq!(updated.scheduled_tasks[1].task_id, "task_beta");

        let cached = with_db(&vault_id, &app_state, |db| db.get_plan_by_id(&plan.id)).unwrap();
        assert_eq!(
            cached.task_order,
            vec!["task_alpha".to_string(), "task_beta".to_string()]
        );
        assert_eq!(cached.scheduled_tasks[0].task_id, "task_alpha");

        let agenda_path = app_state
            .vaults
            .lock()
            .unwrap()
            .get(&vault_id)
            .unwrap()
            .structure()
            .agenda_file("2026-04-26");
        let content = std::fs::read_to_string(agenda_path).unwrap();
        let alpha_index = content.find("task_id: task_alpha").unwrap();
        let beta_index = content.find("task_id: task_beta").unwrap();
        assert!(alpha_index < beta_index);

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn defer_task_preserves_remaining_manual_schedule_rows() {
        let temp = tempfile::tempdir().unwrap();
        let vault_root = temp.path().join("vault");
        let manager = vault_core::VaultManager::create(
            "Agenda Defer Manual Rows Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let date = NaiveDate::from_ymd_opt(2026, 4, 26).unwrap();
        let plan = with_db(&vault_id, &app_state, |db| db.create_plan(date)).unwrap();
        let updated = update_plan_from_input(
            UpdatePlanInput {
                vault_id: vault_id.clone(),
                plan_id: plan.id.clone(),
                top_3_outcome_ids: None,
                task_order: None,
                scheduled_tasks: Some(vec![
                    ScheduledTask {
                        id: "scheduled_task_alpha".into(),
                        task_id: "task_alpha".into(),
                        title: "Alpha manually edited".into(),
                        start_time: "9:00 AM".into(),
                        duration_minutes: 30,
                        estimate_source: Some("manual".into()),
                        eisenhower_quadrant: Some("schedule".into()),
                    },
                    ScheduledTask {
                        id: "scheduled_task_beta".into(),
                        task_id: "task_beta".into(),
                        title: "Beta to defer".into(),
                        start_time: "9:30 AM".into(),
                        duration_minutes: 45,
                        estimate_source: Some("manual".into()),
                        eisenhower_quadrant: Some("do".into()),
                    },
                ]),
            },
            &app_state,
        )
        .unwrap();
        assert_eq!(updated.scheduled_tasks[0].duration_minutes, 30);

        defer_task_from_input(
            DeferTaskInput {
                vault_id: vault_id.clone(),
                task_id: "task_beta".into(),
                date: "2026-04-26".into(),
                reason: Some("Native QA".into()),
            },
            &app_state,
        )
        .unwrap();

        let cached = with_db(&vault_id, &app_state, |db| db.get_plan_by_id(&plan.id)).unwrap();
        let refreshed = read_agenda_overlay(&vault_id, &app_state, cached).unwrap();
        assert_eq!(refreshed.task_order, vec!["task_alpha".to_string()]);
        assert_eq!(refreshed.scheduled_tasks.len(), 1);
        assert_eq!(refreshed.scheduled_tasks[0].title, "Alpha manually edited");
        assert_eq!(refreshed.scheduled_tasks[0].duration_minutes, 30);

        let agenda_path = app_state
            .vaults
            .lock()
            .unwrap()
            .get(&vault_id)
            .unwrap()
            .structure()
            .agenda_file("2026-04-26");
        let content = std::fs::read_to_string(agenda_path).unwrap();
        assert!(content.contains("- [ ] 9:00 AM Alpha manually edited (30 min)"));
        assert!(!content.contains("Beta to defer"));

        release_agenda_state(&vault_id, &app_state).unwrap();
    }

    #[test]
    fn write_agenda_markdown_for_plan_rejects_invalid_scheduled_task_rows() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-invalid-row-write-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Invalid Row Write Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let date = NaiveDate::from_ymd_opt(2026, 4, 26).unwrap();
        let timestamp = date.and_hms_opt(9, 0, 0).unwrap();
        let plan = DailyPlan {
            id: "plan_invalid".into(),
            date,
            top_3_outcome_ids: vec![],
            task_order: vec!["task_beta".into()],
            task_titles: HashMap::new(),
            completed_task_ids: vec![],
            generated_at: Some("2026-04-26T09:00:00-07:00".into()),
            scheduled_tasks: vec![ScheduledTask {
                id: "scheduled_task_beta".into(),
                task_id: "task_beta".into(),
                title: "Beta".into(),
                start_time: "not a time".into(),
                duration_minutes: 30,
                estimate_source: Some("manual".into()),
                eisenhower_quadrant: None,
            }],
            locked_at: None,
            created_at: timestamp,
            updated_at: timestamp,
        };

        let error =
            write_agenda_markdown_for_plan(&vault_id, &app_state, plan, &[], "manual", None)
                .unwrap_err();
        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error.message.contains("scheduled_tasks[0].start_time"));

        let agenda_path = app_state
            .vaults
            .lock()
            .unwrap()
            .get(&vault_id)
            .unwrap()
            .structure()
            .agenda_file("2026-04-26");
        assert!(!agenda_path.exists());

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn schedule_task_for_date_writes_agenda_cache_and_seen_metadata() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-continue-subtask-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Continue Subtask Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert("id".into(), serde_yaml::Value::String("goal_launch".into()));
        goal_fm.insert("title".into(), serde_yaml::Value::String("Launch".into()));
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".into()));
        goal_fm.insert("domain".into(), serde_yaml::Value::String("Work".into()));
        goal_fm.insert("status".into(), serde_yaml::Value::String("active".into()));
        goal_fm.insert("priority".into(), serde_yaml::Value::String("high".into()));
        goal_fm.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-01".into()),
        );

        let mut parent = serde_yaml::Mapping::new();
        parent.insert("id".into(), serde_yaml::Value::String("task_parent".into()));
        parent.insert(
            "title".into(),
            serde_yaml::Value::String("Draft proposal".into()),
        );
        parent.insert("status".into(), serde_yaml::Value::String("todo".into()));
        let mut subtask = serde_yaml::Mapping::new();
        subtask.insert(
            "id".into(),
            serde_yaml::Value::String("subtask_outline".into()),
        );
        subtask.insert(
            "title".into(),
            serde_yaml::Value::String("Outline the ask".into()),
        );
        subtask.insert("status".into(), serde_yaml::Value::String("todo".into()));
        subtask.insert(
            "first_seen_on_agenda".into(),
            serde_yaml::Value::String("2026-04-24".into()),
        );
        parent.insert(
            "subtasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(subtask)]),
        );
        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(parent)]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let updated = schedule_task_for_date_from_input(
            ScheduleTaskForDateInput {
                vault_id: vault_id.clone(),
                task_id: "subtask_outline".into(),
                title: "Outline the ask".into(),
                date: "2026-04-27".into(),
                start_time: None,
                duration_minutes: Some(30),
                estimate_source: Some("manual".into()),
                eisenhower_quadrant: Some("do".into()),
            },
            &app_state,
        )
        .unwrap();

        assert_eq!(updated.date.to_string(), "2026-04-27");
        assert_eq!(updated.task_order, vec!["subtask_outline".to_string()]);
        assert_eq!(updated.scheduled_tasks[0].start_time, "9:00 AM");

        let vaults = app_state.vaults.lock().unwrap();
        let vault = vaults.get(&vault_id).unwrap();
        let agenda_path = vault.structure().agenda_file("2026-04-27");
        let agenda = std::fs::read_to_string(agenda_path).unwrap();
        assert!(agenda.contains("- [ ] 9:00 AM Outline the ask (30 min)"));
        assert!(agenda.contains("task_id: subtask_outline"));

        let (updated_goal_fm, _) = vault.read_goal("goal_launch").unwrap();
        let tasks = updated_goal_fm
            .get("tasks")
            .and_then(|v| v.as_sequence())
            .unwrap();
        let nested = tasks[0]
            .get("subtasks")
            .and_then(|v| v.as_sequence())
            .unwrap();
        assert_eq!(
            nested[0]
                .get("first_seen_on_agenda")
                .and_then(|v| v.as_str()),
            Some("2026-04-24")
        );
        assert_eq!(
            nested[0]
                .get("last_seen_on_agenda")
                .and_then(|v| v.as_str()),
            Some("2026-04-27")
        );
        drop(vaults);

        let cached = with_db(&vault_id, &app_state, |db| {
            db.get_plan_by_date(NaiveDate::from_ymd_opt(2026, 4, 27).unwrap())
        })
        .unwrap()
        .unwrap();
        assert_eq!(cached.task_order, vec!["subtask_outline".to_string()]);
        assert_eq!(
            cached
                .task_titles
                .get("subtask_outline")
                .map(String::as_str),
            Some("Outline the ask")
        );
        assert!(cached.generated_at.is_some());
        assert_eq!(cached.scheduled_tasks.len(), 1);
        assert_eq!(cached.scheduled_tasks[0].task_id, "subtask_outline");
        assert_eq!(cached.scheduled_tasks[0].start_time, "9:00 AM");

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn toggle_task_completion_updates_nested_goal_subtask_status_and_timestamp() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-complete-nested-subtask-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Complete Nested Subtask Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert("id".into(), serde_yaml::Value::String("goal_launch".into()));
        goal_fm.insert("title".into(), serde_yaml::Value::String("Launch".into()));
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".into()));
        goal_fm.insert("status".into(), serde_yaml::Value::String("active".into()));

        let mut parent = serde_yaml::Mapping::new();
        parent.insert("id".into(), serde_yaml::Value::String("task_parent".into()));
        parent.insert(
            "title".into(),
            serde_yaml::Value::String("Draft proposal".into()),
        );
        parent.insert("status".into(), serde_yaml::Value::String("todo".into()));

        let mut subtask = serde_yaml::Mapping::new();
        subtask.insert(
            "id".into(),
            serde_yaml::Value::String("subtask_outline".into()),
        );
        subtask.insert(
            "title".into(),
            serde_yaml::Value::String("Outline the ask".into()),
        );
        subtask.insert("status".into(), serde_yaml::Value::String("todo".into()));
        parent.insert(
            "subtasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(subtask)]),
        );
        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(parent)]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();
        let mutation_log_path = manager.structure().mutation_log.clone();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);
        let plan = with_db(&vault_id, &app_state, |db| {
            let plan = db.create_plan(NaiveDate::from_ymd_opt(2026, 4, 27).unwrap())?;
            db.update_plan(&plan.id, None, Some(vec!["subtask_outline".into()]))
        })
        .unwrap();

        let updated =
            toggle_task_completion_in_state(&vault_id, &plan.id, "subtask_outline", &app_state)
                .unwrap();

        assert_eq!(
            updated.completed_task_ids,
            vec!["subtask_outline".to_string()]
        );

        let vaults = app_state.vaults.lock().unwrap();
        let vault = vaults.get(&vault_id).unwrap();
        let (updated_goal_fm, _) = vault.read_goal("goal_launch").unwrap();
        let nested = updated_goal_fm
            .get("tasks")
            .and_then(|v| v.as_sequence())
            .and_then(|tasks| tasks.first())
            .and_then(|task| task.get("subtasks"))
            .and_then(|v| v.as_sequence())
            .and_then(|subtasks| subtasks.first())
            .unwrap();
        assert_eq!(
            nested.get("status").and_then(|v| v.as_str()),
            Some("completed")
        );
        let completed_at = nested.get("completed_at").and_then(|v| v.as_str()).unwrap();
        assert!(chrono::DateTime::parse_from_rfc3339(completed_at).is_ok());
        drop(vaults);

        let mutation_log = std::fs::read_to_string(mutation_log_path).unwrap();
        assert!(mutation_log.contains("- Actor: user"));
        assert!(mutation_log.contains("- Action: update_goal_frontmatter_task_status"));

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn toggle_task_completion_writes_vault_markdown_and_refresh_rebuilds_cache() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-complete-refresh-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Complete Refresh Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert("id".into(), serde_yaml::Value::String("goal_launch".into()));
        goal_fm.insert("title".into(), serde_yaml::Value::String("Launch".into()));
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".into()));
        goal_fm.insert("status".into(), serde_yaml::Value::String("active".into()));

        let mut task = serde_yaml::Mapping::new();
        task.insert(
            "id".into(),
            serde_yaml::Value::String("task_existing".into()),
        );
        task.insert(
            "title".into(),
            serde_yaml::Value::String("Existing task".into()),
        );
        task.insert("status".into(), serde_yaml::Value::String("todo".into()));
        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(task)]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();
        let agenda_path = manager.structure().agenda_file("2026-04-27");

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);
        let plan = with_db(&vault_id, &app_state, |db| {
            let plan = db.create_plan(NaiveDate::from_ymd_opt(2026, 4, 27).unwrap())?;
            db.update_plan(&plan.id, None, Some(vec!["task_existing".into()]))
        })
        .unwrap();

        let updated =
            toggle_task_completion_in_state(&vault_id, &plan.id, "task_existing", &app_state)
                .unwrap();

        assert_eq!(
            updated.completed_task_ids,
            vec!["task_existing".to_string()]
        );
        let agenda_markdown = std::fs::read_to_string(&agenda_path).unwrap();
        assert!(agenda_markdown.contains("- [x]"));
        assert!(agenda_markdown.contains("<!-- task_id: task_existing -->"));

        let stale_cache_plan = with_db(&vault_id, &app_state, |db| {
            db.toggle_task_completion(&updated.id, "task_existing")
        })
        .unwrap();
        assert!(stale_cache_plan.completed_task_ids.is_empty());

        let refreshed = read_agenda_overlay(&vault_id, &app_state, stale_cache_plan).unwrap();

        assert_eq!(
            refreshed.completed_task_ids,
            vec!["task_existing".to_string()]
        );
        let cached = with_db(&vault_id, &app_state, |db| db.get_plan_by_id(&updated.id)).unwrap();
        assert_eq!(cached.completed_task_ids, vec!["task_existing".to_string()]);
        let vaults = app_state.vaults.lock().unwrap();
        let vault = vaults.get(&vault_id).unwrap();
        let (updated_goal_fm, _) = vault.read_goal("goal_launch").unwrap();
        let task = updated_goal_fm
            .get("tasks")
            .and_then(|v| v.as_sequence())
            .and_then(|tasks| tasks.first())
            .unwrap();
        assert_eq!(
            task.get("status").and_then(|v| v.as_str()),
            Some("completed")
        );
        assert!(task.get("completed_at").and_then(|v| v.as_str()).is_some());
        drop(vaults);

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn toggle_task_completion_clears_embedded_completion_metadata_when_unchecked() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-uncomplete-task-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Uncomplete Task Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert("id".into(), serde_yaml::Value::String("goal_launch".into()));
        goal_fm.insert("title".into(), serde_yaml::Value::String("Launch".into()));
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".into()));
        goal_fm.insert("status".into(), serde_yaml::Value::String("active".into()));

        let mut task = serde_yaml::Mapping::new();
        task.insert(
            "id".into(),
            serde_yaml::Value::String("task_existing".into()),
        );
        task.insert(
            "title".into(),
            serde_yaml::Value::String("Existing task".into()),
        );
        task.insert(
            "status".into(),
            serde_yaml::Value::String("completed".into()),
        );
        task.insert(
            "completed_at".into(),
            serde_yaml::Value::String("2026-04-26T12:00:00Z".into()),
        );
        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(task)]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);
        let plan = with_db(&vault_id, &app_state, |db| {
            let plan = db.create_plan(NaiveDate::from_ymd_opt(2026, 4, 27).unwrap())?;
            let plan = db.update_plan(&plan.id, None, Some(vec!["task_existing".into()]))?;
            db.toggle_task_completion(&plan.id, "task_existing")
        })
        .unwrap();

        let updated =
            toggle_task_completion_in_state(&vault_id, &plan.id, "task_existing", &app_state)
                .unwrap();

        assert!(updated.completed_task_ids.is_empty());

        let vaults = app_state.vaults.lock().unwrap();
        let vault = vaults.get(&vault_id).unwrap();
        let (updated_goal_fm, _) = vault.read_goal("goal_launch").unwrap();
        let task = updated_goal_fm
            .get("tasks")
            .and_then(|v| v.as_sequence())
            .and_then(|tasks| tasks.first())
            .unwrap();
        assert_eq!(task.get("status").and_then(|v| v.as_str()), Some("todo"));
        assert!(task.get("completed_at").is_none());
        drop(vaults);

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn toggle_task_completion_leaves_db_unchanged_when_goal_markdown_write_fails() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-complete-goal-write-fails-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Complete Goal Write Failure Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();
        let goal_path = manager.structure().goal_file_flat("goal_launch");

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert("id".into(), serde_yaml::Value::String("goal_launch".into()));
        goal_fm.insert("title".into(), serde_yaml::Value::String("Launch".into()));
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".into()));
        goal_fm.insert("status".into(), serde_yaml::Value::String("active".into()));

        let mut task = serde_yaml::Mapping::new();
        task.insert(
            "id".into(),
            serde_yaml::Value::String("task_existing".into()),
        );
        task.insert(
            "title".into(),
            serde_yaml::Value::String("Existing task".into()),
        );
        task.insert("status".into(), serde_yaml::Value::String("todo".into()));
        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(task)]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();

        let mut readonly_permissions = std::fs::metadata(&goal_path).unwrap().permissions();
        readonly_permissions.set_readonly(true);
        std::fs::set_permissions(&goal_path, readonly_permissions).unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);
        let plan = with_db(&vault_id, &app_state, |db| {
            let plan = db.create_plan(NaiveDate::from_ymd_opt(2026, 4, 27).unwrap())?;
            db.update_plan(&plan.id, None, Some(vec!["task_existing".into()]))
        })
        .unwrap();

        let result =
            toggle_task_completion_in_state(&vault_id, &plan.id, "task_existing", &app_state);
        assert!(result.is_err());

        let cached = with_db(&vault_id, &app_state, |db| db.get_plan_by_id(&plan.id)).unwrap();
        assert!(cached.completed_task_ids.is_empty());

        let vaults = app_state.vaults.lock().unwrap();
        let vault = vaults.get(&vault_id).unwrap();
        let (unchanged_goal_fm, _) = vault.read_goal("goal_launch").unwrap();
        let task = unchanged_goal_fm
            .get("tasks")
            .and_then(|v| v.as_sequence())
            .and_then(|tasks| tasks.first())
            .unwrap();
        assert_eq!(task.get("status").and_then(|v| v.as_str()), Some("todo"));
        drop(vaults);

        make_test_file_writable(&goal_path);

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn toggle_task_completion_leaves_db_unchanged_when_agenda_markdown_write_fails() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-complete-agenda-write-fails-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Complete Agenda Write Failure Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert("id".into(), serde_yaml::Value::String("goal_launch".into()));
        goal_fm.insert("title".into(), serde_yaml::Value::String("Launch".into()));
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".into()));
        goal_fm.insert("status".into(), serde_yaml::Value::String("active".into()));

        let mut task = serde_yaml::Mapping::new();
        task.insert(
            "id".into(),
            serde_yaml::Value::String("task_existing".into()),
        );
        task.insert(
            "title".into(),
            serde_yaml::Value::String("Existing task".into()),
        );
        task.insert("status".into(), serde_yaml::Value::String("todo".into()));
        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(task)]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();
        let agenda_path = manager.structure().agenda_file("2026-04-27");

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);
        let plan = with_db(&vault_id, &app_state, |db| {
            let plan = db.create_plan(NaiveDate::from_ymd_opt(2026, 4, 27).unwrap())?;
            db.update_plan(&plan.id, None, Some(vec!["task_existing".into()]))
        })
        .unwrap();
        write_agenda_markdown_for_plan(&vault_id, &app_state, plan.clone(), &[], "manual", None)
            .unwrap();

        let mut readonly_permissions = std::fs::metadata(&agenda_path).unwrap().permissions();
        readonly_permissions.set_readonly(true);
        std::fs::set_permissions(&agenda_path, readonly_permissions).unwrap();

        let result =
            toggle_task_completion_in_state(&vault_id, &plan.id, "task_existing", &app_state);
        assert!(result.is_err());

        let cached = with_db(&vault_id, &app_state, |db| db.get_plan_by_id(&plan.id)).unwrap();
        assert!(cached.completed_task_ids.is_empty());

        let vaults = app_state.vaults.lock().unwrap();
        let vault = vaults.get(&vault_id).unwrap();
        let (updated_goal_fm, _) = vault.read_goal("goal_launch").unwrap();
        let task = updated_goal_fm
            .get("tasks")
            .and_then(|v| v.as_sequence())
            .and_then(|tasks| tasks.first())
            .unwrap();
        assert_eq!(
            task.get("status").and_then(|v| v.as_str()),
            Some("completed")
        );
        drop(vaults);

        make_test_file_writable(&agenda_path);

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn toggle_task_completion_rejects_invalid_goal_rows_before_db_toggle() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-complete-invalid-goal-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Complete Invalid Goal Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();
        let goal_path = manager.structure().goal_file_flat("goal_launch");
        let error_log_path = manager.structure().error_log.clone();
        let mutation_log_path = manager.structure().mutation_log.clone();
        let snapshots_path = manager.structure().snapshots.clone();

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert("id".into(), serde_yaml::Value::String("goal_launch".into()));
        goal_fm.insert("title".into(), serde_yaml::Value::String("Launch".into()));
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".into()));
        goal_fm.insert("status".into(), serde_yaml::Value::String("active".into()));

        let mut valid_task = serde_yaml::Mapping::new();
        valid_task.insert(
            "id".into(),
            serde_yaml::Value::String("task_existing".into()),
        );
        valid_task.insert(
            "title".into(),
            serde_yaml::Value::String("Existing task".into()),
        );
        valid_task.insert("status".into(), serde_yaml::Value::String("todo".into()));

        let mut invalid_task = serde_yaml::Mapping::new();
        invalid_task.insert(
            "id".into(),
            serde_yaml::Value::String("task_invalid".into()),
        );
        invalid_task.insert("status".into(), serde_yaml::Value::String("todo".into()));

        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![
                serde_yaml::Value::Mapping(valid_task),
                serde_yaml::Value::Mapping(invalid_task),
            ]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();
        let original_goal = std::fs::read_to_string(&goal_path).unwrap();
        let original_mutation_log = std::fs::read_to_string(&mutation_log_path).unwrap_or_default();
        let original_snapshot_count = std::fs::read_dir(&snapshots_path).unwrap().count();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);
        let plan = with_db(&vault_id, &app_state, |db| {
            let plan = db.create_plan(NaiveDate::from_ymd_opt(2026, 4, 27).unwrap())?;
            db.update_plan(&plan.id, None, Some(vec!["task_existing".into()]))
        })
        .unwrap();

        let error =
            toggle_task_completion_in_state(&vault_id, &plan.id, "task_existing", &app_state)
                .unwrap_err();

        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error.message.contains("tasks[1].title"));
        let cached = with_db(&vault_id, &app_state, |db| db.get_plan_by_id(&plan.id)).unwrap();
        assert!(cached.completed_task_ids.is_empty());
        let vaults = app_state.vaults.lock().unwrap();
        let vault = vaults.get(&vault_id).unwrap();
        let agenda_path = vault.structure().agenda_file("2026-04-27");
        assert!(!agenda_path.exists());
        drop(vaults);
        assert_eq!(std::fs::read_to_string(goal_path).unwrap(), original_goal);
        let error_log = std::fs::read_to_string(error_log_path).unwrap();
        assert!(error_log.contains("goals/goal_launch.md"));
        assert!(error_log.contains("tasks[1].title"));
        assert_eq!(
            std::fs::read_to_string(mutation_log_path).unwrap_or_default(),
            original_mutation_log
        );
        assert_eq!(
            std::fs::read_dir(snapshots_path).unwrap().count(),
            original_snapshot_count
        );

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn schedule_task_for_date_rejects_invalid_goal_task_rows_before_seen_write() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-continue-invalid-goal-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Continue Invalid Goal Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();
        let goal_path = manager.structure().goal_file_flat("goal_launch");
        let error_log_path = manager.structure().error_log.clone();
        let mutation_log_path = manager.structure().mutation_log.clone();
        let snapshots_path = manager.structure().snapshots.clone();

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert("id".into(), serde_yaml::Value::String("goal_launch".into()));
        goal_fm.insert("title".into(), serde_yaml::Value::String("Launch".into()));
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".into()));
        goal_fm.insert("domain".into(), serde_yaml::Value::String("Work".into()));
        goal_fm.insert("status".into(), serde_yaml::Value::String("active".into()));
        goal_fm.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-01".into()),
        );

        let mut valid_task = serde_yaml::Mapping::new();
        valid_task.insert(
            "id".into(),
            serde_yaml::Value::String("subtask_outline".into()),
        );
        valid_task.insert(
            "title".into(),
            serde_yaml::Value::String("Outline the ask".into()),
        );
        valid_task.insert("status".into(), serde_yaml::Value::String("todo".into()));
        valid_task.insert(
            "first_seen_on_agenda".into(),
            serde_yaml::Value::String("2026-04-24".into()),
        );

        let mut invalid_task = serde_yaml::Mapping::new();
        invalid_task.insert(
            "id".into(),
            serde_yaml::Value::String("task_missing_title".into()),
        );
        invalid_task.insert("status".into(), serde_yaml::Value::String("todo".into()));

        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![
                serde_yaml::Value::Mapping(valid_task),
                serde_yaml::Value::Mapping(invalid_task),
            ]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();
        let original_goal = std::fs::read_to_string(&goal_path).unwrap();
        let original_mutation_log = std::fs::read_to_string(&mutation_log_path).unwrap_or_default();
        let original_snapshot_count = std::fs::read_dir(&snapshots_path).unwrap().count();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let error = schedule_task_for_date_from_input(
            ScheduleTaskForDateInput {
                vault_id: vault_id.clone(),
                task_id: "subtask_outline".into(),
                title: "Outline the ask".into(),
                date: "2026-04-27".into(),
                start_time: None,
                duration_minutes: Some(30),
                estimate_source: Some("manual".into()),
                eisenhower_quadrant: Some("do".into()),
            },
            &app_state,
        )
        .unwrap_err();

        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error.message.contains("tasks[1].title"));
        let error_log = std::fs::read_to_string(error_log_path).unwrap();
        assert!(error_log.contains("goals/goal_launch.md"));
        assert!(error_log.contains("tasks[1].title"));
        assert_eq!(std::fs::read_to_string(goal_path).unwrap(), original_goal);
        assert_eq!(
            std::fs::read_to_string(mutation_log_path).unwrap_or_default(),
            original_mutation_log
        );
        assert_eq!(
            std::fs::read_dir(snapshots_path).unwrap().count(),
            original_snapshot_count
        );

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn schedule_task_for_date_reports_invalid_target_row_missing_title() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-continue-invalid-target-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Continue Invalid Target Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();
        let goal_path = manager.structure().goal_file_flat("goal_launch");
        let error_log_path = manager.structure().error_log.clone();
        let mutation_log_path = manager.structure().mutation_log.clone();
        let snapshots_path = manager.structure().snapshots.clone();
        let agenda_path = manager.structure().agenda_file("2026-04-27");

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert("id".into(), serde_yaml::Value::String("goal_launch".into()));
        goal_fm.insert("title".into(), serde_yaml::Value::String("Launch".into()));
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".into()));
        goal_fm.insert("domain".into(), serde_yaml::Value::String("Work".into()));
        goal_fm.insert("status".into(), serde_yaml::Value::String("active".into()));
        goal_fm.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-01".into()),
        );

        let mut invalid_target = serde_yaml::Mapping::new();
        invalid_target.insert(
            "id".into(),
            serde_yaml::Value::String("subtask_outline".into()),
        );
        invalid_target.insert("status".into(), serde_yaml::Value::String("todo".into()));
        invalid_target.insert(
            "first_seen_on_agenda".into(),
            serde_yaml::Value::String("2026-04-24".into()),
        );

        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(invalid_target)]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();
        let original_goal = std::fs::read_to_string(&goal_path).unwrap();
        let original_mutation_log = std::fs::read_to_string(&mutation_log_path).unwrap_or_default();
        let original_snapshot_count = std::fs::read_dir(&snapshots_path).unwrap().count();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let error = schedule_task_for_date_from_input(
            ScheduleTaskForDateInput {
                vault_id: vault_id.clone(),
                task_id: "subtask_outline".into(),
                title: "Outline the ask".into(),
                date: "2026-04-27".into(),
                start_time: None,
                duration_minutes: Some(30),
                estimate_source: Some("manual".into()),
                eisenhower_quadrant: Some("do".into()),
            },
            &app_state,
        )
        .unwrap_err();

        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error.message.contains("tasks[0].title"));
        let error_log = std::fs::read_to_string(error_log_path).unwrap();
        assert!(error_log.contains("goals/goal_launch.md"));
        assert!(error_log.contains("tasks[0].title"));
        assert_eq!(std::fs::read_to_string(goal_path).unwrap(), original_goal);
        assert!(!agenda_path.exists());
        assert_eq!(
            std::fs::read_to_string(mutation_log_path).unwrap_or_default(),
            original_mutation_log
        );
        assert_eq!(
            std::fs::read_dir(snapshots_path).unwrap().count(),
            original_snapshot_count
        );

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn generate_alternative_subtask_writes_goal_agenda_cache_and_assistant_log() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-alternative-subtask-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Alternative Subtask Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert("id".into(), serde_yaml::Value::String("goal_launch".into()));
        goal_fm.insert("title".into(), serde_yaml::Value::String("Launch".into()));
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".into()));
        goal_fm.insert("domain".into(), serde_yaml::Value::String("Work".into()));
        goal_fm.insert("status".into(), serde_yaml::Value::String("active".into()));
        goal_fm.insert("priority".into(), serde_yaml::Value::String("high".into()));
        goal_fm.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-01".into()),
        );

        let mut parent = serde_yaml::Mapping::new();
        parent.insert("id".into(), serde_yaml::Value::String("task_parent".into()));
        parent.insert(
            "title".into(),
            serde_yaml::Value::String("Draft proposal".into()),
        );
        parent.insert("status".into(), serde_yaml::Value::String("todo".into()));
        let mut subtask = serde_yaml::Mapping::new();
        subtask.insert(
            "id".into(),
            serde_yaml::Value::String("subtask_outline".into()),
        );
        subtask.insert(
            "title".into(),
            serde_yaml::Value::String("Outline the ask".into()),
        );
        subtask.insert("status".into(), serde_yaml::Value::String("todo".into()));
        subtask.insert(
            "first_seen_on_agenda".into(),
            serde_yaml::Value::String("2026-04-24".into()),
        );
        parent.insert(
            "subtasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(subtask)]),
        );
        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(parent)]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let result = generate_alternative_subtask_from_input(
            GenerateAlternativeSubtaskInput {
                vault_id: vault_id.clone(),
                missed_task_id: "subtask_outline".into(),
                parent_task_id: Some("task_parent".into()),
                missed_title: Some("Outline the ask".into()),
                date: "2026-04-27".into(),
            },
            &app_state,
        )
        .unwrap();

        assert_eq!(result.task_id, "subtask_task_parent_alternative");
        assert_eq!(result.title, "Write one rough sentence for Draft proposal");
        assert_eq!(result.plan.date.to_string(), "2026-04-27");
        assert_eq!(
            result.plan.task_order,
            vec!["subtask_task_parent_alternative".to_string()]
        );

        let vaults = app_state.vaults.lock().unwrap();
        let vault = vaults.get(&vault_id).unwrap();
        let (updated_goal_fm, _) = vault.read_goal("goal_launch").unwrap();
        let tasks = updated_goal_fm
            .get("tasks")
            .and_then(|v| v.as_sequence())
            .unwrap();
        let nested = tasks[0]
            .get("subtasks")
            .and_then(|v| v.as_sequence())
            .unwrap();
        assert_eq!(nested.len(), 2);
        assert!(nested
            .iter()
            .any(|item| { item.get("id").and_then(|v| v.as_str()) == Some("subtask_outline") }));
        let missed = nested
            .iter()
            .find(|item| item.get("id").and_then(|v| v.as_str()) == Some("subtask_outline"))
            .unwrap();
        assert_eq!(
            missed
                .get("last_missed_decision_on")
                .and_then(|v| v.as_str()),
            Some("2026-04-27")
        );
        let generated = nested
            .iter()
            .find(|item| {
                item.get("id").and_then(|v| v.as_str()) == Some("subtask_task_parent_alternative")
            })
            .unwrap();
        assert_eq!(
            generated.get("title").and_then(|v| v.as_str()),
            Some("Write one rough sentence for Draft proposal")
        );
        assert_eq!(
            generated
                .get("generated_from_task_id")
                .and_then(|v| v.as_str()),
            Some("task_parent")
        );
        assert_eq!(
            generated
                .get("first_seen_on_agenda")
                .and_then(|v| v.as_str()),
            Some("2026-04-27")
        );
        assert_eq!(
            generated
                .get("last_seen_on_agenda")
                .and_then(|v| v.as_str()),
            Some("2026-04-27")
        );

        let agenda_path = vault.structure().agenda_file("2026-04-27");
        let agenda = std::fs::read_to_string(agenda_path).unwrap();
        assert!(
            agenda.contains("- [ ] 9:00 AM Write one rough sentence for Draft proposal (45 min)")
        );
        assert!(agenda.contains("task_id: subtask_task_parent_alternative"));

        let mutation_log = std::fs::read_to_string(&vault.structure().mutation_log).unwrap();
        assert!(mutation_log.contains("- Actor: assistant"));
        assert!(mutation_log.contains("- Action: assistant_generate_alternative_subtask"));
        drop(vaults);

        let cached = with_db(&vault_id, &app_state, |db| {
            db.get_plan_by_date(NaiveDate::from_ymd_opt(2026, 4, 27).unwrap())
        })
        .unwrap()
        .unwrap();
        assert_eq!(
            cached.task_order,
            vec!["subtask_task_parent_alternative".to_string()]
        );

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn generate_alternative_subtask_rejects_invalid_goal_task_rows_before_write() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-alternative-subtask-invalid-goal-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Alternative Subtask Invalid Goal Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();
        let goal_path = manager.structure().goal_file_flat("goal_launch");
        let error_log_path = manager.structure().error_log.clone();
        let mutation_log_path = manager.structure().mutation_log.clone();
        let snapshots_path = manager.structure().snapshots.clone();

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert("id".into(), serde_yaml::Value::String("goal_launch".into()));
        goal_fm.insert("title".into(), serde_yaml::Value::String("Launch".into()));
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".into()));
        goal_fm.insert("domain".into(), serde_yaml::Value::String("Work".into()));
        goal_fm.insert("status".into(), serde_yaml::Value::String("active".into()));
        goal_fm.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-01".into()),
        );

        let mut parent = serde_yaml::Mapping::new();
        parent.insert("id".into(), serde_yaml::Value::String("task_parent".into()));
        parent.insert(
            "title".into(),
            serde_yaml::Value::String("Draft proposal".into()),
        );
        parent.insert("status".into(), serde_yaml::Value::String("todo".into()));
        let mut subtask = serde_yaml::Mapping::new();
        subtask.insert(
            "id".into(),
            serde_yaml::Value::String("subtask_outline".into()),
        );
        subtask.insert(
            "title".into(),
            serde_yaml::Value::String("Outline the ask".into()),
        );
        subtask.insert("status".into(), serde_yaml::Value::String("todo".into()));
        parent.insert(
            "subtasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(subtask)]),
        );

        let mut invalid_task = serde_yaml::Mapping::new();
        invalid_task.insert(
            "id".into(),
            serde_yaml::Value::String("task_missing_title".into()),
        );
        invalid_task.insert("status".into(), serde_yaml::Value::String("todo".into()));

        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![
                serde_yaml::Value::Mapping(parent),
                serde_yaml::Value::Mapping(invalid_task),
            ]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();
        let original_goal = std::fs::read_to_string(&goal_path).unwrap();
        let original_mutation_log = std::fs::read_to_string(&mutation_log_path).unwrap_or_default();
        let original_snapshot_count = std::fs::read_dir(&snapshots_path).unwrap().count();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let error = generate_alternative_subtask_from_input(
            GenerateAlternativeSubtaskInput {
                vault_id: vault_id.clone(),
                missed_task_id: "subtask_outline".into(),
                parent_task_id: Some("task_parent".into()),
                missed_title: Some("Outline the ask".into()),
                date: "2026-04-27".into(),
            },
            &app_state,
        )
        .unwrap_err();

        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error.message.contains("tasks[1].title"));
        let error_log = std::fs::read_to_string(error_log_path).unwrap();
        assert!(error_log.contains("goals/goal_launch.md"));
        assert!(error_log.contains("tasks[1].title"));
        assert_eq!(std::fs::read_to_string(goal_path).unwrap(), original_goal);
        assert_eq!(
            std::fs::read_to_string(mutation_log_path).unwrap_or_default(),
            original_mutation_log
        );
        assert_eq!(
            std::fs::read_dir(snapshots_path).unwrap().count(),
            original_snapshot_count
        );

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn schedule_parent_task_for_missed_subtask_writes_agenda_cache_and_decision_marker() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-parent-for-missed-subtask-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Parent Task Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert("id".into(), serde_yaml::Value::String("goal_launch".into()));
        goal_fm.insert("title".into(), serde_yaml::Value::String("Launch".into()));
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".into()));
        goal_fm.insert("domain".into(), serde_yaml::Value::String("Work".into()));
        goal_fm.insert("status".into(), serde_yaml::Value::String("active".into()));
        goal_fm.insert("priority".into(), serde_yaml::Value::String("high".into()));
        goal_fm.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-01".into()),
        );

        let mut parent = serde_yaml::Mapping::new();
        parent.insert("id".into(), serde_yaml::Value::String("task_parent".into()));
        parent.insert(
            "title".into(),
            serde_yaml::Value::String("Draft proposal".into()),
        );
        parent.insert("status".into(), serde_yaml::Value::String("todo".into()));
        let mut subtask = serde_yaml::Mapping::new();
        subtask.insert(
            "id".into(),
            serde_yaml::Value::String("subtask_outline".into()),
        );
        subtask.insert(
            "title".into(),
            serde_yaml::Value::String("Outline the ask".into()),
        );
        subtask.insert("status".into(), serde_yaml::Value::String("todo".into()));
        subtask.insert(
            "first_seen_on_agenda".into(),
            serde_yaml::Value::String("2026-04-24".into()),
        );
        parent.insert(
            "subtasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(subtask)]),
        );
        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(parent)]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let updated = schedule_parent_task_for_missed_subtask_from_input(
            ScheduleParentTaskForMissedSubtaskInput {
                vault_id: vault_id.clone(),
                missed_task_id: "subtask_outline".into(),
                parent_task_id: Some("task_parent".into()),
                date: "2026-04-27".into(),
            },
            &app_state,
        )
        .unwrap();

        assert_eq!(updated.date.to_string(), "2026-04-27");
        assert_eq!(updated.task_order, vec!["task_parent".to_string()]);
        assert_eq!(
            updated.task_titles.get("task_parent").map(String::as_str),
            Some("Draft proposal")
        );

        let vaults = app_state.vaults.lock().unwrap();
        let vault = vaults.get(&vault_id).unwrap();
        let (updated_goal_fm, _) = vault.read_goal("goal_launch").unwrap();
        let tasks = updated_goal_fm
            .get("tasks")
            .and_then(|v| v.as_sequence())
            .unwrap();
        assert_eq!(
            tasks[0].get("last_seen_on_agenda").and_then(|v| v.as_str()),
            Some("2026-04-27")
        );
        let nested = tasks[0]
            .get("subtasks")
            .and_then(|v| v.as_sequence())
            .unwrap();
        assert_eq!(
            nested[0]
                .get("first_seen_on_agenda")
                .and_then(|v| v.as_str()),
            Some("2026-04-24")
        );
        assert_eq!(
            nested[0]
                .get("last_missed_decision_on")
                .and_then(|v| v.as_str()),
            Some("2026-04-27")
        );

        let agenda_path = vault.structure().agenda_file("2026-04-27");
        let agenda = std::fs::read_to_string(agenda_path).unwrap();
        assert!(agenda.contains("- [ ] 9:00 AM Draft proposal (45 min)"));
        assert!(agenda.contains("task_id: task_parent"));
        drop(vaults);

        let cached = with_db(&vault_id, &app_state, |db| {
            db.get_plan_by_date(NaiveDate::from_ymd_opt(2026, 4, 27).unwrap())
        })
        .unwrap()
        .unwrap();
        assert_eq!(cached.task_order, vec!["task_parent".to_string()]);

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn schedule_parent_task_for_missed_subtask_resolves_generated_from_task_id() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-parent-from-generated-id-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Generated Parent Link Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert("id".into(), serde_yaml::Value::String("goal_launch".into()));
        goal_fm.insert("title".into(), serde_yaml::Value::String("Launch".into()));
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".into()));
        goal_fm.insert("domain".into(), serde_yaml::Value::String("Work".into()));
        goal_fm.insert("status".into(), serde_yaml::Value::String("active".into()));
        goal_fm.insert("priority".into(), serde_yaml::Value::String("high".into()));
        goal_fm.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-01".into()),
        );

        let mut parent = serde_yaml::Mapping::new();
        parent.insert("id".into(), serde_yaml::Value::String("task_parent".into()));
        parent.insert(
            "title".into(),
            serde_yaml::Value::String("Draft proposal".into()),
        );
        parent.insert("status".into(), serde_yaml::Value::String("todo".into()));

        let mut subtask = serde_yaml::Mapping::new();
        subtask.insert(
            "id".into(),
            serde_yaml::Value::String("subtask_outline".into()),
        );
        subtask.insert(
            "title".into(),
            serde_yaml::Value::String("Outline the ask".into()),
        );
        subtask.insert("status".into(), serde_yaml::Value::String("todo".into()));
        subtask.insert(
            "generated_from_task_id".into(),
            serde_yaml::Value::String("task_parent".into()),
        );
        subtask.insert(
            "first_seen_on_agenda".into(),
            serde_yaml::Value::String("2026-04-24".into()),
        );

        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![
                serde_yaml::Value::Mapping(parent),
                serde_yaml::Value::Mapping(subtask),
            ]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let updated = schedule_parent_task_for_missed_subtask_from_input(
            ScheduleParentTaskForMissedSubtaskInput {
                vault_id: vault_id.clone(),
                missed_task_id: "subtask_outline".into(),
                parent_task_id: None,
                date: "2026-04-27".into(),
            },
            &app_state,
        )
        .unwrap();

        assert_eq!(updated.task_order, vec!["task_parent".to_string()]);
        assert_eq!(
            updated.task_titles.get("task_parent").map(String::as_str),
            Some("Draft proposal")
        );

        let vaults = app_state.vaults.lock().unwrap();
        let vault = vaults.get(&vault_id).unwrap();
        let (updated_goal_fm, _) = vault.read_goal("goal_launch").unwrap();
        let tasks = updated_goal_fm
            .get("tasks")
            .and_then(|v| v.as_sequence())
            .unwrap();
        let missed = tasks
            .iter()
            .find(|item| item.get("id").and_then(|v| v.as_str()) == Some("subtask_outline"))
            .unwrap();
        assert_eq!(
            missed
                .get("last_missed_decision_on")
                .and_then(|v| v.as_str()),
            Some("2026-04-27")
        );
        drop(vaults);

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn generate_alternative_task_writes_goal_agenda_cache_and_assistant_log() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-agenda-alternative-task-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Agenda Alternative Task Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert("id".into(), serde_yaml::Value::String("goal_launch".into()));
        goal_fm.insert("title".into(), serde_yaml::Value::String("Launch".into()));
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".into()));
        goal_fm.insert("domain".into(), serde_yaml::Value::String("Work".into()));
        goal_fm.insert("status".into(), serde_yaml::Value::String("active".into()));
        goal_fm.insert("priority".into(), serde_yaml::Value::String("high".into()));
        goal_fm.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-01".into()),
        );

        let mut parent = serde_yaml::Mapping::new();
        parent.insert("id".into(), serde_yaml::Value::String("task_parent".into()));
        parent.insert(
            "title".into(),
            serde_yaml::Value::String("Draft proposal".into()),
        );
        parent.insert("status".into(), serde_yaml::Value::String("todo".into()));
        let mut subtask = serde_yaml::Mapping::new();
        subtask.insert(
            "id".into(),
            serde_yaml::Value::String("subtask_outline".into()),
        );
        subtask.insert(
            "title".into(),
            serde_yaml::Value::String("Outline the ask".into()),
        );
        subtask.insert("status".into(), serde_yaml::Value::String("todo".into()));
        subtask.insert(
            "first_seen_on_agenda".into(),
            serde_yaml::Value::String("2026-04-24".into()),
        );
        parent.insert(
            "subtasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(subtask)]),
        );
        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(parent)]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let result = generate_alternative_task_from_input(
            GenerateAlternativeTaskInput {
                vault_id: vault_id.clone(),
                missed_task_id: "subtask_outline".into(),
                parent_task_id: Some("task_parent".into()),
                date: "2026-04-27".into(),
            },
            &app_state,
        )
        .unwrap();

        assert_eq!(result.task_id, "task_goal_launch_alternative");
        assert_eq!(result.title, "Write a simpler next step for Launch");
        assert_eq!(result.plan.date.to_string(), "2026-04-27");
        assert_eq!(
            result.plan.task_order,
            vec!["task_goal_launch_alternative".to_string()]
        );

        let vaults = app_state.vaults.lock().unwrap();
        let vault = vaults.get(&vault_id).unwrap();
        let (updated_goal_fm, _) = vault.read_goal("goal_launch").unwrap();
        let tasks = updated_goal_fm
            .get("tasks")
            .and_then(|v| v.as_sequence())
            .unwrap();
        assert_eq!(tasks.len(), 2);
        let generated = tasks
            .iter()
            .find(|item| {
                item.get("id").and_then(|v| v.as_str()) == Some("task_goal_launch_alternative")
            })
            .unwrap();
        assert_eq!(
            generated.get("title").and_then(|v| v.as_str()),
            Some("Write a simpler next step for Launch")
        );
        assert_eq!(
            generated
                .get("first_seen_on_agenda")
                .and_then(|v| v.as_str()),
            Some("2026-04-27")
        );
        assert_eq!(
            generated
                .get("last_seen_on_agenda")
                .and_then(|v| v.as_str()),
            Some("2026-04-27")
        );
        let nested = tasks[0]
            .get("subtasks")
            .and_then(|v| v.as_sequence())
            .unwrap();
        assert_eq!(
            nested[0]
                .get("last_missed_decision_on")
                .and_then(|v| v.as_str()),
            Some("2026-04-27")
        );

        let agenda_path = vault.structure().agenda_file("2026-04-27");
        let agenda = std::fs::read_to_string(agenda_path).unwrap();
        assert!(agenda.contains("- [ ] 9:00 AM Write a simpler next step for Launch (45 min)"));
        assert!(agenda.contains("task_id: task_goal_launch_alternative"));

        let mutation_log = std::fs::read_to_string(&vault.structure().mutation_log).unwrap();
        assert!(mutation_log.contains("- Actor: assistant"));
        assert!(mutation_log.contains("- Action: assistant_generate_alternative_task"));
        drop(vaults);

        let cached = with_db(&vault_id, &app_state, |db| {
            db.get_plan_by_date(NaiveDate::from_ymd_opt(2026, 4, 27).unwrap())
        })
        .unwrap()
        .unwrap();
        assert_eq!(
            cached.task_order,
            vec!["task_goal_launch_alternative".to_string()]
        );

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn archive_parent_task_for_missed_subtask_marks_branch_archived_and_logs() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-archive-parent-for-missed-subtask-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Archive Parent Task Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert("id".into(), serde_yaml::Value::String("goal_launch".into()));
        goal_fm.insert("title".into(), serde_yaml::Value::String("Launch".into()));
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".into()));
        goal_fm.insert("domain".into(), serde_yaml::Value::String("Work".into()));
        goal_fm.insert("status".into(), serde_yaml::Value::String("active".into()));
        goal_fm.insert("priority".into(), serde_yaml::Value::String("high".into()));
        goal_fm.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-01".into()),
        );

        let mut parent = serde_yaml::Mapping::new();
        parent.insert("id".into(), serde_yaml::Value::String("task_parent".into()));
        parent.insert(
            "title".into(),
            serde_yaml::Value::String("Draft proposal".into()),
        );
        parent.insert("status".into(), serde_yaml::Value::String("todo".into()));
        let mut nested_subtask = serde_yaml::Mapping::new();
        nested_subtask.insert(
            "id".into(),
            serde_yaml::Value::String("subtask_outline".into()),
        );
        nested_subtask.insert(
            "title".into(),
            serde_yaml::Value::String("Outline the ask".into()),
        );
        nested_subtask.insert("status".into(), serde_yaml::Value::String("todo".into()));
        nested_subtask.insert(
            "first_seen_on_agenda".into(),
            serde_yaml::Value::String("2026-04-24".into()),
        );
        parent.insert(
            "subtasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(nested_subtask)]),
        );

        let mut flat_child = serde_yaml::Mapping::new();
        flat_child.insert(
            "id".into(),
            serde_yaml::Value::String("subtask_flat_child".into()),
        );
        flat_child.insert(
            "title".into(),
            serde_yaml::Value::String("Collect source links".into()),
        );
        flat_child.insert("status".into(), serde_yaml::Value::String("todo".into()));
        flat_child.insert(
            "parent_id".into(),
            serde_yaml::Value::String("task_parent".into()),
        );

        let mut unrelated = serde_yaml::Mapping::new();
        unrelated.insert(
            "id".into(),
            serde_yaml::Value::String("task_unrelated".into()),
        );
        unrelated.insert(
            "title".into(),
            serde_yaml::Value::String("Keep working".into()),
        );
        unrelated.insert("status".into(), serde_yaml::Value::String("todo".into()));

        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![
                serde_yaml::Value::Mapping(parent),
                serde_yaml::Value::Mapping(flat_child),
                serde_yaml::Value::Mapping(unrelated),
            ]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let result = archive_parent_task_for_missed_subtask_from_input(
            ArchiveParentTaskForMissedSubtaskInput {
                vault_id: vault_id.clone(),
                missed_task_id: "subtask_outline".into(),
                parent_task_id: Some("task_parent".into()),
                date: "2026-04-27".into(),
            },
            &app_state,
        )
        .unwrap();

        assert_eq!(result.goal_id, "goal_launch");
        assert_eq!(result.archived_task_id, "task_parent");
        assert_eq!(
            result.archived_task_ids,
            vec![
                "task_parent".to_string(),
                "subtask_outline".to_string(),
                "subtask_flat_child".to_string()
            ]
        );

        let vaults = app_state.vaults.lock().unwrap();
        let vault = vaults.get(&vault_id).unwrap();
        let (updated_goal_fm, _) = vault.read_goal("goal_launch").unwrap();
        assert_eq!(
            updated_goal_fm.get("status").and_then(|v| v.as_str()),
            Some("active")
        );
        let tasks = updated_goal_fm
            .get("tasks")
            .and_then(|v| v.as_sequence())
            .unwrap();
        assert_eq!(
            tasks[0].get("status").and_then(|v| v.as_str()),
            Some("archived")
        );
        let nested = tasks[0]
            .get("subtasks")
            .and_then(|v| v.as_sequence())
            .unwrap();
        assert_eq!(
            nested[0].get("status").and_then(|v| v.as_str()),
            Some("archived")
        );
        assert_eq!(
            nested[0]
                .get("last_missed_decision_on")
                .and_then(|v| v.as_str()),
            Some("2026-04-27")
        );
        assert_eq!(
            tasks[1].get("status").and_then(|v| v.as_str()),
            Some("archived")
        );
        assert_eq!(
            tasks[2].get("status").and_then(|v| v.as_str()),
            Some("todo")
        );

        let mutation_log = std::fs::read_to_string(&vault.structure().mutation_log).unwrap();
        assert!(mutation_log.contains("- Actor: assistant"));
        assert!(mutation_log.contains("- Action: assistant_archive_parent_task_for_goal"));
        drop(vaults);

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn archive_goal_for_missed_subtask_marks_goal_archived_and_logs() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-archive-goal-for-missed-subtask-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Archive Goal Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let mut goal_fm = markdown_parser::Frontmatter::new();
        goal_fm.insert("id".into(), serde_yaml::Value::String("goal_launch".into()));
        goal_fm.insert("title".into(), serde_yaml::Value::String("Launch".into()));
        goal_fm.insert("type".into(), serde_yaml::Value::String("goal".into()));
        goal_fm.insert("domain".into(), serde_yaml::Value::String("Work".into()));
        goal_fm.insert("status".into(), serde_yaml::Value::String("active".into()));
        goal_fm.insert(
            "lifecycle".into(),
            serde_yaml::Value::String("active".into()),
        );
        goal_fm.insert("priority".into(), serde_yaml::Value::String("high".into()));
        goal_fm.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-01".into()),
        );

        let mut parent = serde_yaml::Mapping::new();
        parent.insert("id".into(), serde_yaml::Value::String("task_parent".into()));
        parent.insert(
            "title".into(),
            serde_yaml::Value::String("Draft proposal".into()),
        );
        parent.insert("status".into(), serde_yaml::Value::String("todo".into()));
        let mut subtask = serde_yaml::Mapping::new();
        subtask.insert(
            "id".into(),
            serde_yaml::Value::String("subtask_outline".into()),
        );
        subtask.insert(
            "title".into(),
            serde_yaml::Value::String("Outline the ask".into()),
        );
        subtask.insert("status".into(), serde_yaml::Value::String("todo".into()));
        subtask.insert(
            "first_seen_on_agenda".into(),
            serde_yaml::Value::String("2026-04-24".into()),
        );
        parent.insert(
            "subtasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(subtask)]),
        );
        goal_fm.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(parent)]),
        );
        manager.write_goal("goal_launch", &goal_fm, "").unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let result = archive_goal_for_missed_subtask_from_input(
            ArchiveGoalForMissedSubtaskInput {
                vault_id: vault_id.clone(),
                missed_task_id: "subtask_outline".into(),
                parent_task_id: Some("task_parent".into()),
                date: "2026-04-27".into(),
            },
            &app_state,
        )
        .unwrap();

        assert_eq!(result.goal_id, "goal_launch");
        assert_eq!(result.status, "archived");

        let vaults = app_state.vaults.lock().unwrap();
        let vault = vaults.get(&vault_id).unwrap();
        let (updated_goal_fm, _) = vault.read_goal("goal_launch").unwrap();
        assert_eq!(
            updated_goal_fm.get("status").and_then(|v| v.as_str()),
            Some("archived")
        );
        assert_eq!(
            updated_goal_fm.get("lifecycle").and_then(|v| v.as_str()),
            Some("archived")
        );
        let tasks = updated_goal_fm
            .get("tasks")
            .and_then(|v| v.as_sequence())
            .unwrap();
        assert_eq!(
            tasks[0].get("status").and_then(|v| v.as_str()),
            Some("todo")
        );
        let nested = tasks[0]
            .get("subtasks")
            .and_then(|v| v.as_sequence())
            .unwrap();
        assert_eq!(
            nested[0]
                .get("last_missed_decision_on")
                .and_then(|v| v.as_str()),
            Some("2026-04-27")
        );

        let mutation_log = std::fs::read_to_string(&vault.structure().mutation_log).unwrap();
        assert!(mutation_log.contains("- Actor: assistant"));
        assert!(mutation_log.contains("- Action: assistant_archive_goal_for_missed_subtask"));
        drop(vaults);

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }
}
