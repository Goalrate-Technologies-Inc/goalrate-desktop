//! Daily Loop commands for Tauri IPC
//!
//! CRUD operations for the AI Chief of Staff daily planning loop.

use std::collections::HashMap;
use std::sync::Mutex;

use chrono::NaiveDate;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::State;

use daily_loop::{
    ChatMessage, ChatRole, CheckIn, DailyLoopDb, DailyPlan, DailyStats, Deferral, Outcome,
    PlanRevision,
};

use crate::commands::vault::AppState;
use crate::error::{AppError, ErrorCode};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMetadata {
    pub priority: String,
    pub deadline: String,
}

/// Global map of vault_id -> DailyLoopDb instances
pub(crate) static DAILY_LOOP_DBS: Lazy<Mutex<HashMap<String, DailyLoopDb>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Ensure a DailyLoopDb is open for a vault, creating it if needed.
/// Acquires locks in a safe order: check DAILY_LOOP_DBS first (drop it),
/// then acquire vaults lock to get the path (drop it), create DB,
/// then re-acquire DAILY_LOOP_DBS to insert.
fn ensure_db(vault_id: &str, app_state: &AppState) -> Result<(), AppError> {
    // Check if DB already exists — acquire and immediately drop the lock
    {
        let dbs = DAILY_LOOP_DBS.lock().map_err(|e| {
            AppError::new(
                ErrorCode::UnknownError,
                format!("Failed to lock daily loop DBs: {e}"),
            )
        })?;
        if dbs.contains_key(vault_id) {
            return Ok(());
        }
    } // Lock dropped here

    // Get vault path — separate lock scope to avoid nesting
    let db_path = {
        let vaults = app_state.vaults.lock().map_err(|e| {
            AppError::new(
                ErrorCode::UnknownError,
                format!("Failed to lock vaults: {e}"),
            )
        })?;
        let vault = vaults
            .get(vault_id)
            .ok_or_else(|| AppError::vault_not_open(vault_id))?;
        vault.structure().goalrate_dir.join("daily-loop.db")
    }; // Vaults lock dropped here

    // Open DB without any locks held
    let db = DailyLoopDb::open(&db_path).map_err(|e| {
        AppError::new(
            ErrorCode::UnknownError,
            format!("Failed to open daily loop DB: {e}"),
        )
    })?;

    // Re-acquire to insert (another thread may have inserted in the meantime — that's fine)
    let mut dbs = DAILY_LOOP_DBS.lock().map_err(|e| {
        AppError::new(
            ErrorCode::UnknownError,
            format!("Failed to lock daily loop DBs: {e}"),
        )
    })?;
    dbs.entry(vault_id.to_string()).or_insert(db);
    Ok(())
}

pub(crate) fn with_db<T>(
    vault_id: &str,
    app_state: &AppState,
    f: impl FnOnce(&DailyLoopDb) -> Result<T, daily_loop::DailyLoopError>,
) -> Result<T, AppError> {
    ensure_db(vault_id, app_state)?;

    let dbs = DAILY_LOOP_DBS.lock().map_err(|e| {
        AppError::new(
            ErrorCode::UnknownError,
            format!("Failed to lock daily loop DBs: {e}"),
        )
    })?;

    let db = dbs.get(vault_id).ok_or_else(|| {
        AppError::new(
            ErrorCode::UnknownError,
            "Daily loop DB disappeared unexpectedly",
        )
    })?;

    f(db).map_err(|e| match e {
        daily_loop::DailyLoopError::NotFound(msg) => AppError::item_not_found("DailyLoop", &msg),
        daily_loop::DailyLoopError::PlanAlreadyExists(date) => AppError::new(
            ErrorCode::ItemAlreadyExists,
            format!("Plan already exists for {date}"),
        ),
        daily_loop::DailyLoopError::PlanLocked => AppError::new(
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

// ── Plan Commands ──────────────────────────────────────────────

#[tauri::command]
pub fn daily_loop_get_plan(
    vault_id: String,
    date: String,
    app_state: State<'_, AppState>,
) -> Result<Option<DailyPlan>, AppError> {
    let date = parse_date(&date)?;
    with_db(&vault_id, &app_state, |db| db.get_plan_by_date(date))
}

#[tauri::command]
pub fn daily_loop_create_plan(
    vault_id: String,
    date: String,
    app_state: State<'_, AppState>,
) -> Result<DailyPlan, AppError> {
    let date = parse_date(&date)?;
    with_db(&vault_id, &app_state, |db| db.create_plan(date))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlanInput {
    pub vault_id: String,
    pub plan_id: String,
    pub top_3_outcome_ids: Option<Vec<String>>,
    pub task_order: Option<Vec<String>>,
}

#[tauri::command]
pub fn daily_loop_update_plan(
    input: UpdatePlanInput,
    app_state: State<'_, AppState>,
) -> Result<DailyPlan, AppError> {
    with_db(&input.vault_id, &app_state, |db| {
        db.update_plan(
            &input.plan_id,
            input.top_3_outcome_ids.clone(),
            input.task_order.clone(),
        )
    })
}

#[tauri::command]
pub fn daily_loop_lock_plan(
    vault_id: String,
    plan_id: String,
    app_state: State<'_, AppState>,
) -> Result<DailyPlan, AppError> {
    with_db(&vault_id, &app_state, |db| db.lock_plan(&plan_id))
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
pub fn daily_loop_create_outcome(
    input: CreateOutcomeInput,
    app_state: State<'_, AppState>,
) -> Result<Outcome, AppError> {
    with_db(&input.vault_id, &app_state, |db| {
        db.create_outcome(
            &input.daily_plan_id,
            &input.title,
            input.linked_task_ids.clone(),
            input.ai_generated,
        )
    })
}

#[tauri::command]
pub fn daily_loop_get_outcomes(
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
pub fn daily_loop_update_outcome(
    input: UpdateOutcomeInput,
    app_state: State<'_, AppState>,
) -> Result<Outcome, AppError> {
    with_db(&input.vault_id, &app_state, |db| {
        db.update_outcome(
            &input.outcome_id,
            input.title.as_deref(),
            input.linked_task_ids.clone(),
        )
    })
}

#[tauri::command]
pub fn daily_loop_delete_outcome(
    vault_id: String,
    outcome_id: String,
    app_state: State<'_, AppState>,
) -> Result<(), AppError> {
    with_db(&vault_id, &app_state, |db| db.delete_outcome(&outcome_id))
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
pub fn daily_loop_defer_task(
    input: DeferTaskInput,
    app_state: State<'_, AppState>,
) -> Result<Deferral, AppError> {
    let date = parse_date(&input.date)?;
    with_db(&input.vault_id, &app_state, |db| {
        let deferral = db.create_deferral(&input.task_id, date, input.reason.as_deref(), None)?;

        // Remove the deferred task from today's plan taskOrder
        if let Some(plan) = db.get_plan_by_date(date)? {
            let new_order: Vec<String> = plan
                .task_order
                .into_iter()
                .filter(|id| id != &input.task_id)
                .collect();
            db.update_plan(&plan.id, None, Some(new_order))?;
        }

        Ok(deferral)
    })
}

#[tauri::command]
pub fn daily_loop_toggle_task_completion(
    vault_id: String,
    plan_id: String,
    task_id: String,
    app_state: State<'_, AppState>,
) -> Result<DailyPlan, AppError> {
    let plan = with_db(&vault_id, &app_state, |db| {
        db.toggle_task_completion(&plan_id, &task_id)
    })?;

    // Update vault frontmatter with completed_at
    let is_completed = plan.completed_task_ids.contains(&task_id);
    let completed_at_value = if is_completed {
        Some(chrono::Local::now().format("%Y-%m-%d").to_string())
    } else {
        None
    };

    // Find and update the task in vault goal frontmatter
    if let Ok(vaults) = app_state.vaults.lock() {
        if let Some(vault) = vaults.get(&vault_id) {
            let goal_ids = vault.list_goals().unwrap_or_default();
            for gid in &goal_ids {
                if let Ok((mut fm, body)) = vault.read_goal(gid) {
                    if let Some(tasks) = fm.get_mut("tasks").and_then(|v| v.as_sequence_mut()) {
                        let mut found = false;
                        for task_val in tasks.iter_mut() {
                            let tid = task_val.get("id").and_then(|v| v.as_str()).unwrap_or("");
                            if tid == task_id {
                                if let Some(map) = task_val.as_mapping_mut() {
                                    match &completed_at_value {
                                        Some(date) => {
                                            map.insert(
                                                "completed_at".into(),
                                                serde_yaml::Value::String(date.clone()),
                                            );
                                        }
                                        None => {
                                            map.remove("completed_at");
                                        }
                                    }
                                }
                                found = true;
                                break;
                            }
                        }
                        if found {
                            vault.write_goal(gid, &fm, &body).map_err(|e| {
                                log::error!(
                                    "Failed to update completed_at in vault for task {task_id}: {e}"
                                );
                                AppError::new(
                                    ErrorCode::UnknownError,
                                    format!(
                                        "DB updated but vault write failed for task {task_id}: {e}"
                                    ),
                                )
                            })?;
                            break;
                        }
                    }
                }
            }
        }
    }

    Ok(plan)
}

/// Returns metadata (priority, deadline) for all tasks across goals in a vault.
/// Keyed by task_id. Used by the frontend to sort tasks by priority and deadline.
#[tauri::command]
pub fn daily_loop_get_task_metadata(
    vault_id: String,
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

    for gid in &goal_ids {
        if let Ok((fm, _)) = vault.read_goal(gid) {
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

            if let Some(tasks) = fm.get("tasks").and_then(|v| v.as_sequence()) {
                for task_val in tasks {
                    let tid = task_val
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if tid.is_empty() {
                        continue;
                    }
                    let task_deadline = task_val
                        .get("due_date")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_default();
                    metadata.insert(
                        tid,
                        TaskMetadata {
                            priority: goal_priority.clone(),
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
    }

    Ok(metadata)
}

#[tauri::command]
pub fn daily_loop_get_deferral_count(
    vault_id: String,
    task_id: String,
    app_state: State<'_, AppState>,
) -> Result<i32, AppError> {
    with_db(&vault_id, &app_state, |db| db.get_deferral_count(&task_id))
}

#[tauri::command]
pub fn daily_loop_get_deferrals(
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
pub fn daily_loop_create_check_in(
    input: CreateCheckInInput,
    app_state: State<'_, AppState>,
) -> Result<CheckIn, AppError> {
    let date = parse_date(&input.date)?;
    with_db(&input.vault_id, &app_state, |db| {
        db.create_check_in(
            date,
            input.completed_task_ids.clone(),
            input.notes.as_deref(),
            input.ai_summary.as_deref(),
        )
    })
}

#[tauri::command]
pub fn daily_loop_get_check_in(
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
pub fn daily_loop_send_chat(
    input: SendChatInput,
    app_state: State<'_, AppState>,
) -> Result<ChatMessage, AppError> {
    with_db(&input.vault_id, &app_state, |db| {
        db.add_chat_message(&input.daily_plan_id, ChatRole::User, &input.content)
    })
}

#[tauri::command]
pub fn daily_loop_get_chat_history(
    vault_id: String,
    daily_plan_id: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<ChatMessage>, AppError> {
    with_db(&vault_id, &app_state, |db| {
        db.get_chat_history(&daily_plan_id)
    })
}

#[tauri::command]
pub fn daily_loop_get_chat_dates(
    vault_id: String,
    limit: Option<i32>,
    app_state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let limit = limit.unwrap_or(90);
    with_db(&vault_id, &app_state, |db| db.get_dates_with_chat(limit))
}

// ── Stats Commands ─────────────────────────────────────────────

#[tauri::command]
pub fn daily_loop_get_recent_stats(
    vault_id: String,
    days: Option<i32>,
    app_state: State<'_, AppState>,
) -> Result<Vec<DailyStats>, AppError> {
    let days = days.unwrap_or(14);
    with_db(&vault_id, &app_state, |db| db.get_recent_stats(days))
}

#[tauri::command]
pub fn daily_loop_count_check_ins(
    vault_id: String,
    app_state: State<'_, AppState>,
) -> Result<i32, AppError> {
    with_db(&vault_id, &app_state, |db| db.count_check_ins())
}

// ── Revision Commands ──────────────────────────────────────────

#[tauri::command]
pub fn daily_loop_get_revisions(
    vault_id: String,
    daily_plan_id: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<PlanRevision>, AppError> {
    with_db(&vault_id, &app_state, |db| db.get_revisions(&daily_plan_id))
}
