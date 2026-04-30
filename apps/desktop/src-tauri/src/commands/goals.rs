//! Goal management commands for Tauri IPC
//!
//! These commands handle CRUD operations for SMART goals.

use std::collections::HashSet;

use tauri::State;
use vault_core::VaultManager;

use crate::commands::goal_milestones::{build_goal_body, split_goal_body};
use crate::commands::vault::AppState;
use crate::error::{AppError, ErrorCode};
use crate::types::{priority_to_eisenhower, Goal, GoalCreate, GoalUpdate};

fn log_goal_typed_error(manager: &VaultManager, goal_id: &str, message: &str) {
    let path = manager
        .goal_markdown_path(goal_id)
        .ok()
        .flatten()
        .unwrap_or_else(|| manager.structure().goal_file_flat(goal_id));
    let _ = manager.log_vault_error(&path, message);
}

fn goal_from_frontmatter_or_log(
    manager: &VaultManager,
    goal_id: &str,
    fm: &markdown_parser::Frontmatter,
    notes: &str,
) -> Result<Goal, AppError> {
    Goal::from_frontmatter(fm, notes).map_err(|error| {
        log_goal_typed_error(
            manager,
            goal_id,
            &format!("Failed to load Goal frontmatter: {}", error.message),
        );
        error
    })
}

fn list_goals_from_manager(manager: &VaultManager) -> Result<Vec<Goal>, AppError> {
    let goal_ids = manager.list_goals()?;

    let mut goals = Vec::new();
    for goal_id in goal_ids {
        match manager.read_goal(&goal_id) {
            Ok((fm, body)) => {
                let sections = split_goal_body(&body);
                match goal_from_frontmatter_or_log(manager, &goal_id, &fm, &sections.notes) {
                    Ok(goal) => goals.push(goal),
                    Err(error) => {
                        log::warn!("Failed to parse goal '{}': {}", goal_id, error);
                    }
                }
            }
            Err(error) => log::warn!("Failed to read goal '{}': {}", goal_id, error),
        }
    }

    Ok(goals)
}

/// List all goals in a vault
#[tauri::command]
pub async fn list_goals(
    vault_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<Goal>, AppError> {
    log::info!("Listing goals for vault '{}'", vault_id);

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    list_goals_from_manager(manager)
}

/// Get a specific goal by ID
#[tauri::command]
pub async fn get_goal(
    vault_id: String,
    goal_id: String,
    state: State<'_, AppState>,
) -> Result<Goal, AppError> {
    log::info!("Getting goal '{}' from vault '{}'", goal_id, vault_id);

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let (fm, body) = manager.read_goal(&goal_id)?;
    let sections = split_goal_body(&body);
    let goal = goal_from_frontmatter_or_log(manager, &goal_id, &fm, &sections.notes)?;

    Ok(goal)
}

/// Create a new goal
#[tauri::command]
pub async fn create_goal(
    vault_id: String,
    data: GoalCreate,
    state: State<'_, AppState>,
) -> Result<Goal, AppError> {
    log::info!("Creating goal '{}' in vault '{}'", data.title, vault_id);

    // Extract tasks before consuming data
    let intake_tasks = data.tasks.clone();
    let goal = data.into_goal();
    let goal_id = goal.id.clone();

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let (mut fm, body) = goal.to_frontmatter();
    let goal_quadrant = fm
        .get("eisenhower_quadrant")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            fm.get("priority")
                .and_then(|v| v.as_str())
                .and_then(|p| priority_to_eisenhower(Some(p)))
        });

    // Inject tasks into frontmatter if provided
    if !intake_tasks.is_empty() {
        let task_entries: Vec<serde_yaml::Value> = intake_tasks
            .iter()
            .map(|t| {
                let mut map = serde_yaml::Mapping::new();
                let task_id = format!(
                    "task_{}",
                    &uuid::Uuid::new_v4().to_string().replace('-', "")[..8]
                );
                map.insert("id".into(), serde_yaml::Value::String(task_id));
                map.insert("title".into(), serde_yaml::Value::String(t.title.clone()));
                map.insert(
                    "status".into(),
                    serde_yaml::Value::String(
                        t.status.clone().unwrap_or_else(|| "todo".to_string()),
                    ),
                );
                map.insert(
                    "parent_goal_id".into(),
                    serde_yaml::Value::String(goal_id.clone()),
                );
                if let Some(quadrant) = t.eisenhower_quadrant.as_ref().or(goal_quadrant.as_ref()) {
                    map.insert(
                        "eisenhower_quadrant".into(),
                        serde_yaml::Value::String(quadrant.clone()),
                    );
                }
                if let Some(ref recurring) = t.recurring {
                    map.insert(
                        "recurring".into(),
                        serde_yaml::Value::String(recurring.clone()),
                    );
                }
                if let Some(ref start) = t.recurrence_start {
                    map.insert(
                        "recurrence_start".into(),
                        serde_yaml::Value::String(start.clone()),
                    );
                }
                if let Some(ref end) = t.recurrence_end {
                    map.insert(
                        "recurrence_end".into(),
                        serde_yaml::Value::String(end.clone()),
                    );
                }
                serde_yaml::Value::Mapping(map)
            })
            .collect();
        fm.insert("tasks".into(), serde_yaml::Value::Sequence(task_entries));
        log::info!(
            "Added {} tasks to goal '{}'",
            intake_tasks.len(),
            goal.title
        );
    }

    manager.write_goal(&goal_id, &fm, &body)?;

    Ok(goal)
}

/// Update an existing goal
fn update_goal_in_vault(
    manager: &VaultManager,
    goal_id: &str,
    data: GoalUpdate,
) -> Result<Goal, AppError> {
    let (fm, body) = manager.read_goal(goal_id)?;
    let mut sections = split_goal_body(&body);
    let existing = goal_from_frontmatter_or_log(manager, goal_id, &fm, &sections.notes)?;

    let updated = data.apply_to(existing);

    let (updated_fm, new_body) = updated.to_frontmatter();
    let mut new_fm = fm.clone();
    for (key, value) in updated_fm {
        new_fm.insert(key, value);
    }
    sections.notes = new_body;
    let merged_body = build_goal_body(&sections);
    manager.write_goal_with_audit(goal_id, &new_fm, &merged_body, "user", "update_goal")?;

    Ok(updated)
}

/// Update an existing goal
#[tauri::command]
pub async fn update_goal(
    vault_id: String,
    goal_id: String,
    data: GoalUpdate,
    state: State<'_, AppState>,
) -> Result<Goal, AppError> {
    log::info!("Updating goal '{}' in vault '{}'", goal_id, vault_id);

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    update_goal_in_vault(manager, &goal_id, data)
}

fn delete_goal_in_state(
    vault_id: &str,
    goal_id: &str,
    confirmed: bool,
    state: &AppState,
) -> Result<(), AppError> {
    if !confirmed {
        return Err(AppError::validation_error(
            "Deleting a goal file requires explicit confirmation",
        ));
    }

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(vault_id)
        .ok_or_else(|| AppError::vault_not_open(vault_id))?;

    manager.delete_goal(goal_id)?;

    Ok(())
}

/// Delete a goal
#[tauri::command]
pub async fn delete_goal(
    vault_id: String,
    goal_id: String,
    confirmed: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    log::info!("Deleting goal '{}' from vault '{}'", goal_id, vault_id);

    delete_goal_in_state(&vault_id, &goal_id, confirmed.unwrap_or(false), &state)
}

/// Archive a goal (set status to "archived")
#[tauri::command]
pub async fn archive_goal(
    vault_id: String,
    goal_id: String,
    state: State<'_, AppState>,
) -> Result<Goal, AppError> {
    log::info!("Archiving goal '{}' in vault '{}'", goal_id, vault_id);

    let update = GoalUpdate {
        status: Some("archived".to_string()),
        title: None,
        short_title: None,
        goal_type: None,
        deadline: None,
        priority: None,
        eisenhower_quadrant: None,
        start_date: None,
        target: None,
        current: None,
        tags: None,
        notes: None,
    };

    update_goal(vault_id, goal_id, update, state).await
}

/// Rename a domain (goal type) across all goals in a vault.
/// A lightweight task entry returned from goal frontmatter
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalFrontmatterTask {
    pub id: String,
    pub title: String,
    pub status: String,
    pub parent_id: Option<String>,
    pub generated_from_task_id: Option<String>,
    pub recurring: Option<String>,
    pub completed_at: Option<String>,
    pub due_date: Option<String>,
    pub scheduled_date: Option<String>,
    pub priority: Option<String>,
    pub eisenhower_quadrant: Option<String>,
    pub first_seen_on_agenda: Option<String>,
    pub last_seen_on_agenda: Option<String>,
    pub last_missed_decision_on: Option<String>,
}

fn frontmatter_string(value: &serde_yaml::Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(|v| v.as_str()).map(str::to_string))
}

fn frontmatter_recurring(value: &serde_yaml::Value) -> Option<String> {
    value
        .get("recurring")
        .or_else(|| value.get("recurrence"))
        .and_then(|v| {
            v.as_str().map(str::to_string).or_else(|| {
                v.as_bool()
                    .map(|b| if b { "true".to_string() } else { String::new() })
            })
        })
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !matches!(s.as_str(), "" | "none" | "false" | "no"))
}

fn goal_task_value_id(value: &serde_yaml::Value) -> Option<&str> {
    value.get("id").and_then(|v| v.as_str())
}

fn goal_task_parent_link(value: &serde_yaml::Value) -> Option<String> {
    frontmatter_string(
        value,
        &[
            "parent_id",
            "parentTaskId",
            "generated_from_task_id",
            "generatedFromTaskId",
        ],
    )
}

fn goal_task_value_contains_id(value: &serde_yaml::Value, task_id: &str) -> bool {
    if goal_task_value_id(value) == Some(task_id) {
        return true;
    }

    value
        .get("subtasks")
        .and_then(|v| v.as_sequence())
        .is_some_and(|subtasks| {
            subtasks
                .iter()
                .any(|subtask| goal_task_value_contains_id(subtask, task_id))
        })
}

fn goal_task_sequence_contains_id(tasks: &[serde_yaml::Value], task_id: &str) -> bool {
    tasks
        .iter()
        .any(|task| goal_task_value_contains_id(task, task_id))
}

fn collect_goal_task_branch_ids_from_value(
    value: &serde_yaml::Value,
    branch_ids: &mut HashSet<String>,
    inherited_branch: bool,
) -> bool {
    let parent_is_in_branch = goal_task_parent_link(value)
        .as_deref()
        .is_some_and(|parent_id| branch_ids.contains(parent_id));
    let value_is_in_branch = inherited_branch
        || goal_task_value_id(value).is_some_and(|id| branch_ids.contains(id))
        || parent_is_in_branch;

    let mut changed = false;
    if value_is_in_branch {
        if let Some(id) = goal_task_value_id(value) {
            changed |= branch_ids.insert(id.to_string());
        }
    }

    if let Some(subtasks) = value.get("subtasks").and_then(|v| v.as_sequence()) {
        for subtask in subtasks {
            changed |=
                collect_goal_task_branch_ids_from_value(subtask, branch_ids, value_is_in_branch);
        }
    }

    changed
}

fn collect_goal_task_branch_ids(
    tasks: &[serde_yaml::Value],
    root_task_id: &str,
) -> HashSet<String> {
    let mut branch_ids = HashSet::from([root_task_id.to_string()]);
    let mut changed = true;

    while changed {
        changed = false;
        for task in tasks {
            changed |= collect_goal_task_branch_ids_from_value(task, &mut branch_ids, false);
        }
    }

    branch_ids
}

fn goal_task_value_id_is_in_branch(
    value: &serde_yaml::Value,
    branch_ids: &HashSet<String>,
) -> bool {
    goal_task_value_id(value).is_some_and(|id| branch_ids.contains(id))
}

fn remove_goal_task_branch_from_nested_subtasks(
    value: &mut serde_yaml::Value,
    branch_ids: &HashSet<String>,
) -> bool {
    let Some(subtasks) = value.get_mut("subtasks").and_then(|v| v.as_sequence_mut()) else {
        return false;
    };

    let mut removed = false;
    for subtask in subtasks.iter_mut() {
        removed |= remove_goal_task_branch_from_nested_subtasks(subtask, branch_ids);
    }

    let original_len = subtasks.len();
    subtasks.retain(|subtask| !goal_task_value_id_is_in_branch(subtask, branch_ids));
    removed || subtasks.len() != original_len
}

fn update_goal_task_value_title(value: &mut serde_yaml::Value, task_id: &str, title: &str) -> bool {
    if goal_task_value_id(value) == Some(task_id) {
        if let Some(map) = value.as_mapping_mut() {
            map.insert("title".into(), serde_yaml::Value::String(title.to_string()));
        }
        return true;
    }

    value
        .get_mut("subtasks")
        .and_then(|v| v.as_sequence_mut())
        .is_some_and(|subtasks| {
            subtasks
                .iter_mut()
                .any(|subtask| update_goal_task_value_title(subtask, task_id, title))
        })
}

const SUPPORTED_GOAL_TASK_RECURRENCES: &[&str] =
    &["daily", "weekdays", "weekly", "monthly", "yearly"];

fn normalize_goal_task_recurrence(recurrence: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(raw) = recurrence else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || matches!(
            trimmed.to_ascii_lowercase().as_str(),
            "none" | "false" | "no"
        )
    {
        return Ok(None);
    }

    let normalized = trimmed.to_ascii_lowercase();
    if SUPPORTED_GOAL_TASK_RECURRENCES.contains(&normalized.as_str()) {
        return Ok(Some(normalized));
    }

    Err(AppError::validation_error(format!(
        "Unsupported task recurrence '{trimmed}'"
    )))
}

fn update_goal_task_value_recurrence(
    value: &mut serde_yaml::Value,
    task_id: &str,
    recurrence: Option<&str>,
) -> bool {
    if goal_task_value_id(value) == Some(task_id) {
        if let Some(map) = value.as_mapping_mut() {
            if let Some(recurrence) = recurrence {
                map.insert(
                    "recurring".into(),
                    serde_yaml::Value::String(recurrence.to_string()),
                );
                map.remove("recurrence");
            } else {
                map.remove("recurring");
                map.remove("recurrence");
                map.remove("recurrence_start");
                map.remove("recurrenceStart");
                map.remove("recurrence_end");
                map.remove("recurrenceEnd");
            }
        }
        return true;
    }

    value
        .get_mut("subtasks")
        .and_then(|v| v.as_sequence_mut())
        .is_some_and(|subtasks| {
            subtasks
                .iter_mut()
                .any(|subtask| update_goal_task_value_recurrence(subtask, task_id, recurrence))
        })
}

fn set_goal_frontmatter_task_recurrence(
    fm: &mut markdown_parser::Frontmatter,
    task_id: &str,
    recurrence: Option<&str>,
) -> Result<(), AppError> {
    let Some(task_seq) = fm.get_mut("tasks").and_then(|v| v.as_sequence_mut()) else {
        return Err(AppError::item_not_found("Task", task_id));
    };

    let found = task_seq
        .iter_mut()
        .any(|task| update_goal_task_value_recurrence(task, task_id, recurrence));
    if !found {
        return Err(AppError::item_not_found("Task", task_id));
    }

    Ok(())
}

fn normalize_goal_task_scheduled_date(
    scheduled_date: Option<&str>,
) -> Result<Option<String>, AppError> {
    let Some(raw) = scheduled_date else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || matches!(
            trimmed.to_ascii_lowercase().as_str(),
            "none" | "false" | "no"
        )
    {
        return Ok(None);
    }

    chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d").map_err(|_| {
        AppError::validation_error(format!(
            "Invalid task scheduled date '{trimmed}'. Use YYYY-MM-DD."
        ))
    })?;
    Ok(Some(trimmed.to_string()))
}

fn update_goal_task_value_scheduled_date(
    value: &mut serde_yaml::Value,
    task_id: &str,
    scheduled_date: Option<&str>,
) -> bool {
    if goal_task_value_id(value) == Some(task_id) {
        if let Some(map) = value.as_mapping_mut() {
            if let Some(scheduled_date) = scheduled_date {
                map.insert(
                    "scheduled_date".into(),
                    serde_yaml::Value::String(scheduled_date.to_string()),
                );
                map.remove("scheduledDate");
                map.remove("scheduled_for");
                map.remove("scheduledFor");
            } else {
                map.remove("scheduled_date");
                map.remove("scheduledDate");
                map.remove("scheduled_for");
                map.remove("scheduledFor");
            }
        }
        return true;
    }

    value
        .get_mut("subtasks")
        .and_then(|v| v.as_sequence_mut())
        .is_some_and(|subtasks| {
            subtasks.iter_mut().any(|subtask| {
                update_goal_task_value_scheduled_date(subtask, task_id, scheduled_date)
            })
        })
}

fn set_goal_frontmatter_task_scheduled_date(
    fm: &mut markdown_parser::Frontmatter,
    task_id: &str,
    scheduled_date: Option<&str>,
) -> Result<(), AppError> {
    let Some(task_seq) = fm.get_mut("tasks").and_then(|v| v.as_sequence_mut()) else {
        return Err(AppError::item_not_found("Task", task_id));
    };

    let found = task_seq
        .iter_mut()
        .any(|task| update_goal_task_value_scheduled_date(task, task_id, scheduled_date));
    if !found {
        return Err(AppError::item_not_found("Task", task_id));
    }

    Ok(())
}

fn update_goal_task_value_status(
    value: &mut serde_yaml::Value,
    task_id: &str,
    status: &str,
) -> bool {
    if goal_task_value_id(value) == Some(task_id) {
        if let Some(map) = value.as_mapping_mut() {
            map.insert(
                "status".into(),
                serde_yaml::Value::String(status.to_string()),
            );
            if status == "completed" {
                if !map.contains_key("completed_at") && !map.contains_key("completedAt") {
                    map.insert(
                        "completed_at".into(),
                        serde_yaml::Value::String(chrono::Utc::now().to_rfc3339()),
                    );
                }
            } else {
                map.remove("completed_at");
                map.remove("completedAt");
            }
        }
        return true;
    }

    value
        .get_mut("subtasks")
        .and_then(|v| v.as_sequence_mut())
        .is_some_and(|subtasks| {
            subtasks
                .iter_mut()
                .any(|subtask| update_goal_task_value_status(subtask, task_id, status))
        })
}

fn set_goal_frontmatter_task_status(
    fm: &mut markdown_parser::Frontmatter,
    task_id: &str,
    status: &str,
) -> Result<(), AppError> {
    let Some(task_seq) = fm.get_mut("tasks").and_then(|v| v.as_sequence_mut()) else {
        return Err(AppError::item_not_found("Task", task_id));
    };

    let found = task_seq
        .iter_mut()
        .any(|task| update_goal_task_value_status(task, task_id, status));
    if !found {
        return Err(AppError::item_not_found("Task", task_id));
    }

    Ok(())
}

fn is_supported_goal_task_status(status: &str) -> bool {
    matches!(
        status,
        "todo"
            | "in_progress"
            | "deferred"
            | "blocked"
            | "completed"
            | "archived"
            | "pending"
            | "done"
            | "cancelled"
    )
}

fn collect_goal_frontmatter_task(
    value: &serde_yaml::Value,
    fallback_parent_id: Option<String>,
    out: &mut Vec<GoalFrontmatterTask>,
    errors: &mut Vec<String>,
    field_path: &str,
) {
    let Some(id) = value.get("id").and_then(|v| v.as_str()).map(str::to_string) else {
        errors.push(format!("Invalid Goal {field_path}.id: field is required"));
        return;
    };
    let Some(title) = value
        .get("title")
        .and_then(|v| v.as_str())
        .map(str::to_string)
    else {
        errors.push(format!(
            "Invalid Goal {field_path}.title: field is required"
        ));
        return;
    };
    let Some(status) = value
        .get("status")
        .and_then(|v| v.as_str())
        .map(str::to_string)
    else {
        errors.push(format!(
            "Invalid Goal {field_path}.status: field is required"
        ));
        return;
    };
    if !is_supported_goal_task_status(&status) {
        errors.push(format!(
            "Invalid Goal {field_path}.status: unsupported value '{status}'"
        ));
        return;
    }

    let generated_from_task_id =
        frontmatter_string(value, &["generated_from_task_id", "generatedFromTaskId"]);
    let parent_id = frontmatter_string(value, &["parent_id", "parentTaskId"])
        .or_else(|| generated_from_task_id.clone())
        .or(fallback_parent_id);

    out.push(GoalFrontmatterTask {
        id: id.clone(),
        title,
        status,
        parent_id,
        generated_from_task_id,
        recurring: frontmatter_recurring(value),
        completed_at: frontmatter_string(value, &["completed_at", "completedAt"]),
        due_date: frontmatter_string(value, &["due_date", "dueDate", "deadline"]),
        scheduled_date: frontmatter_string(
            value,
            &[
                "scheduled_date",
                "scheduledDate",
                "scheduled_for",
                "scheduledFor",
            ],
        ),
        priority: frontmatter_string(value, &["priority"]),
        eisenhower_quadrant: frontmatter_string(
            value,
            &["eisenhower_quadrant", "eisenhowerQuadrant"],
        ),
        first_seen_on_agenda: frontmatter_string(
            value,
            &["first_seen_on_agenda", "firstSeenOnAgenda"],
        ),
        last_seen_on_agenda: frontmatter_string(
            value,
            &["last_seen_on_agenda", "lastSeenOnAgenda"],
        ),
        last_missed_decision_on: frontmatter_string(
            value,
            &["last_missed_decision_on", "lastMissedDecisionOn"],
        ),
    });

    if let Some(subtasks_value) = value.get("subtasks") {
        let Some(subtasks) = subtasks_value.as_sequence() else {
            errors.push(format!(
                "Invalid Goal {field_path}.subtasks: expected a list"
            ));
            return;
        };
        for (index, subtask) in subtasks.iter().enumerate() {
            collect_goal_frontmatter_task(
                subtask,
                Some(id.clone()),
                out,
                errors,
                &format!("{field_path}.subtasks[{index}]"),
            );
        }
    }
}

fn collect_goal_frontmatter_tasks_from_frontmatter(
    fm: &markdown_parser::Frontmatter,
) -> (Vec<GoalFrontmatterTask>, Vec<String>) {
    let mut tasks = Vec::new();
    let mut errors = Vec::new();

    if let Some(tasks_value) = fm.get("tasks") {
        if let Some(seq) = tasks_value.as_sequence() {
            for (index, task) in seq.iter().enumerate() {
                collect_goal_frontmatter_task(
                    task,
                    None,
                    &mut tasks,
                    &mut errors,
                    &format!("tasks[{index}]"),
                );
            }
        } else {
            errors.push("Invalid Goal tasks: expected a list".to_string());
        }
    }

    (tasks, errors)
}

fn log_goal_frontmatter_task_errors(
    manager: &VaultManager,
    goal_id: &str,
    errors: &[String],
) -> Result<(), AppError> {
    let path = manager
        .goal_markdown_path(goal_id)?
        .unwrap_or_else(|| manager.structure().goal_file_flat(goal_id));
    for error in errors {
        manager.log_vault_error(&path, error)?;
    }

    Ok(())
}

pub(crate) fn validate_goal_frontmatter_tasks_for_write(
    manager: &VaultManager,
    goal_id: &str,
    fm: &markdown_parser::Frontmatter,
) -> Result<(), AppError> {
    collect_valid_goal_frontmatter_tasks_for_write(manager, goal_id, fm).map(|_| ())
}

pub(crate) fn collect_valid_goal_frontmatter_tasks_for_write(
    manager: &VaultManager,
    goal_id: &str,
    fm: &markdown_parser::Frontmatter,
) -> Result<Vec<GoalFrontmatterTask>, AppError> {
    let (tasks, errors) = collect_goal_frontmatter_tasks_from_frontmatter(fm);
    if errors.is_empty() {
        return Ok(tasks);
    }

    log_goal_frontmatter_task_errors(manager, goal_id, &errors)?;
    Err(AppError::validation_error(format!(
        "Invalid Goal task frontmatter for {goal_id}: {}",
        errors.join("; ")
    )))
}

pub(crate) fn list_goal_frontmatter_tasks_from_manager(
    manager: &VaultManager,
    goal_id: &str,
) -> Result<Vec<GoalFrontmatterTask>, AppError> {
    let (fm, _body) = manager.read_goal(goal_id)?;
    let (tasks, errors) = collect_goal_frontmatter_tasks_from_frontmatter(&fm);

    if !errors.is_empty() {
        log_goal_frontmatter_task_errors(manager, goal_id, &errors)?;
    }

    Ok(tasks)
}

/// List tasks stored in a goal's YAML frontmatter
#[tauri::command]
pub async fn list_goal_frontmatter_tasks(
    vault_id: String,
    goal_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<GoalFrontmatterTask>, AppError> {
    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    list_goal_frontmatter_tasks_from_manager(manager, &goal_id)
}

fn add_goal_frontmatter_task_to_manager(
    manager: &VaultManager,
    goal_id: &str,
    title: String,
    parent_id: Option<String>,
) -> Result<GoalFrontmatterTask, AppError> {
    let (mut fm, body) = manager.read_goal(goal_id)?;
    let mut task_seq = fm
        .get("tasks")
        .and_then(|v| v.as_sequence().cloned())
        .unwrap_or_default();
    if let Some(parent_task_id) = parent_id.as_deref() {
        if !goal_task_sequence_contains_id(&task_seq, parent_task_id) {
            return Err(AppError::item_not_found("Task", parent_task_id));
        }
    }

    let task_id = format!(
        "task_{}",
        &uuid::Uuid::new_v4().to_string().replace('-', "")[..8]
    );
    let mut map = serde_yaml::Mapping::new();
    map.insert("id".into(), serde_yaml::Value::String(task_id.clone()));
    map.insert("title".into(), serde_yaml::Value::String(title.clone()));
    map.insert(
        "status".into(),
        serde_yaml::Value::String("todo".to_string()),
    );
    map.insert(
        "parent_goal_id".into(),
        serde_yaml::Value::String(goal_id.to_string()),
    );
    if let Some(ref pid) = parent_id {
        map.insert("parent_id".into(), serde_yaml::Value::String(pid.clone()));
        map.insert(
            "generated_from_task_id".into(),
            serde_yaml::Value::String(pid.clone()),
        );
    }
    task_seq.push(serde_yaml::Value::Mapping(map));
    fm.insert("tasks".into(), serde_yaml::Value::Sequence(task_seq));
    validate_goal_frontmatter_tasks_for_write(manager, goal_id, &fm)?;
    manager.write_goal_with_audit(goal_id, &fm, &body, "user", "add_goal_frontmatter_task")?;

    Ok(GoalFrontmatterTask {
        id: task_id,
        title,
        status: "todo".to_string(),
        parent_id: parent_id.clone(),
        generated_from_task_id: parent_id,
        recurring: None,
        completed_at: None,
        due_date: None,
        scheduled_date: None,
        priority: None,
        eisenhower_quadrant: None,
        first_seen_on_agenda: None,
        last_seen_on_agenda: None,
        last_missed_decision_on: None,
    })
}

/// Add a new task to a goal's frontmatter
#[tauri::command]
pub async fn add_goal_frontmatter_task(
    vault_id: String,
    goal_id: String,
    title: String,
    parent_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<GoalFrontmatterTask, AppError> {
    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    add_goal_frontmatter_task_to_manager(manager, &goal_id, title, parent_id)
}

fn update_goal_frontmatter_task_in_manager(
    manager: &VaultManager,
    goal_id: &str,
    task_id: &str,
    title: String,
) -> Result<(), AppError> {
    let (mut fm, body) = manager.read_goal(goal_id)?;
    if let Some(task_seq) = fm.get_mut("tasks").and_then(|v| v.as_sequence_mut()) {
        let found = task_seq
            .iter_mut()
            .any(|task| update_goal_task_value_title(task, task_id, &title));
        if !found {
            return Err(AppError::item_not_found("Task", task_id));
        }
    } else {
        return Err(AppError::item_not_found("Task", task_id));
    }

    validate_goal_frontmatter_tasks_for_write(manager, goal_id, &fm)?;
    manager.write_goal_with_audit(goal_id, &fm, &body, "user", "update_goal_frontmatter_task")?;
    Ok(())
}

fn update_goal_frontmatter_task_recurrence_in_manager(
    manager: &VaultManager,
    goal_id: &str,
    task_id: &str,
    recurrence: Option<String>,
) -> Result<(), AppError> {
    let normalized = normalize_goal_task_recurrence(recurrence.as_deref())?;
    let (mut fm, body) = manager.read_goal(goal_id)?;
    set_goal_frontmatter_task_recurrence(&mut fm, task_id, normalized.as_deref())?;
    validate_goal_frontmatter_tasks_for_write(manager, goal_id, &fm)?;
    manager.write_goal_with_audit(
        goal_id,
        &fm,
        &body,
        "user",
        "update_goal_frontmatter_task_recurrence",
    )?;
    Ok(())
}

fn update_goal_frontmatter_task_scheduled_date_in_manager(
    manager: &VaultManager,
    goal_id: &str,
    task_id: &str,
    scheduled_date: Option<String>,
) -> Result<(), AppError> {
    let normalized = normalize_goal_task_scheduled_date(scheduled_date.as_deref())?;
    let (mut fm, body) = manager.read_goal(goal_id)?;
    set_goal_frontmatter_task_scheduled_date(&mut fm, task_id, normalized.as_deref())?;
    validate_goal_frontmatter_tasks_for_write(manager, goal_id, &fm)?;
    manager.write_goal_with_audit(
        goal_id,
        &fm,
        &body,
        "user",
        "update_goal_frontmatter_task_scheduled_date",
    )?;
    Ok(())
}

/// Update a task's title in a goal's frontmatter
#[tauri::command]
pub async fn update_goal_frontmatter_task(
    vault_id: String,
    goal_id: String,
    task_id: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    update_goal_frontmatter_task_in_manager(manager, &goal_id, &task_id, title)
}

/// Update a task's recurrence in a goal's frontmatter
#[tauri::command]
pub async fn update_goal_frontmatter_task_recurrence(
    vault_id: String,
    goal_id: String,
    task_id: String,
    recurrence: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    update_goal_frontmatter_task_recurrence_in_manager(manager, &goal_id, &task_id, recurrence)
}

/// Update the exact Agenda date for a task in a goal's frontmatter
#[tauri::command]
pub async fn update_goal_frontmatter_task_scheduled_date(
    vault_id: String,
    goal_id: String,
    task_id: String,
    scheduled_date: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    update_goal_frontmatter_task_scheduled_date_in_manager(
        manager,
        &goal_id,
        &task_id,
        scheduled_date,
    )
}

pub(crate) fn update_goal_frontmatter_task_status_in_manager(
    manager: &VaultManager,
    goal_id: &str,
    task_id: &str,
    status: String,
) -> Result<(), AppError> {
    let (mut fm, body) = manager.read_goal(goal_id)?;
    set_goal_frontmatter_task_status(&mut fm, task_id, &status)?;
    validate_goal_frontmatter_tasks_for_write(manager, goal_id, &fm)?;
    manager.write_goal_with_audit(
        goal_id,
        &fm,
        &body,
        "user",
        "update_goal_frontmatter_task_status",
    )?;
    Ok(())
}

pub(crate) fn build_goal_frontmatter_task_status_update(
    manager: &VaultManager,
    goal_id: &str,
    task_id: &str,
    status: &str,
) -> Result<(markdown_parser::Frontmatter, String), AppError> {
    let (mut fm, body) = manager.read_goal(goal_id)?;
    set_goal_frontmatter_task_status(&mut fm, task_id, status)?;
    validate_goal_frontmatter_tasks_for_write(manager, goal_id, &fm)?;
    Ok((fm, body))
}

/// Update a task's status in a goal's frontmatter
#[tauri::command]
pub async fn update_goal_frontmatter_task_status(
    vault_id: String,
    goal_id: String,
    task_id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    update_goal_frontmatter_task_status_in_manager(manager, &goal_id, &task_id, status)
}

fn delete_goal_frontmatter_task_in_manager(
    manager: &VaultManager,
    goal_id: &str,
    task_id: &str,
    confirmed: bool,
) -> Result<Vec<String>, AppError> {
    if !confirmed {
        return Err(AppError::validation_error(
            "Deleting a task requires explicit confirmation",
        ));
    }

    let (mut fm, body) = manager.read_goal(goal_id)?;
    if let Some(task_seq) = fm.get_mut("tasks").and_then(|v| v.as_sequence_mut()) {
        if !goal_task_sequence_contains_id(task_seq, task_id) {
            return Err(AppError::item_not_found("Task", task_id));
        }

        let branch_ids = collect_goal_task_branch_ids(task_seq, task_id);
        let mut deleted_task_ids: Vec<String> = branch_ids.iter().cloned().collect();
        deleted_task_ids.sort();
        let mut removed = false;
        for task in task_seq.iter_mut() {
            removed |= remove_goal_task_branch_from_nested_subtasks(task, &branch_ids);
        }

        let original_len = task_seq.len();
        task_seq.retain(|task| !goal_task_value_id_is_in_branch(task, &branch_ids));
        removed |= task_seq.len() != original_len;

        if !removed {
            return Err(AppError::item_not_found("Task", task_id));
        }

        validate_goal_frontmatter_tasks_for_write(manager, goal_id, &fm)?;
        manager.write_goal_with_audit(
            goal_id,
            &fm,
            &body,
            "user",
            "delete_goal_frontmatter_task",
        )?;
        Ok(deleted_task_ids)
    } else {
        Err(AppError::item_not_found("Task", task_id))
    }
}

/// Delete a task from a goal's frontmatter
#[tauri::command]
pub async fn delete_goal_frontmatter_task(
    vault_id: String,
    goal_id: String,
    task_id: String,
    confirmed: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    delete_goal_frontmatter_task_in_manager(manager, &goal_id, &task_id, confirmed.unwrap_or(false))
}

/// Updates every goal where type == old_type to type = new_type.
#[tauri::command]
pub async fn rename_domain(
    vault_id: String,
    old_type: String,
    new_type: String,
    state: State<'_, AppState>,
) -> Result<usize, AppError> {
    log::info!(
        "Renaming domain '{}' → '{}' in vault '{}'",
        old_type,
        new_type,
        vault_id
    );

    let vaults = state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let goal_ids = manager.list_goals().unwrap_or_default();
    let mut count = 0;

    for gid in &goal_ids {
        if let Ok((mut fm, body)) = manager.read_goal(gid) {
            let current_type = fm.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if current_type == old_type {
                fm.insert("type".into(), serde_yaml::Value::String(new_type.clone()));
                // Also update the first tag if it matches the old type
                if let Some(tags) = fm.get_mut("tags").and_then(|v| v.as_sequence_mut()) {
                    if let Some(first) = tags.first_mut() {
                        if first.as_str() == Some(&old_type) {
                            *first = serde_yaml::Value::String(new_type.clone());
                        }
                    }
                }
                if let Err(e) = manager.write_goal(gid, &fm, &body) {
                    log::warn!("Failed to rename domain for goal {gid}: {e}");
                    continue;
                }
                count += 1;
            }
        }
    }

    Ok(count)
}

/// Known goal category names (case-insensitive) for migration heuristic
const KNOWN_CATEGORIES: &[&str] = &[
    "work",
    "health",
    "financial",
    "personal",
    "fitness",
    "career",
    "education",
    "family",
    "social",
    "creative",
    "spiritual",
    "hobby",
    "finance",
    "wellness",
    "learning",
    "relationship",
    "travel",
];

/// Migrate all goal files in a vault from old schema to new schema.
/// Returns a summary of changes made.
#[tauri::command]
pub async fn migrate_goal_frontmatter(
    vault_id: String,
    dry_run: bool,
    state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    log::info!(
        "Migrating goal frontmatter for vault '{}' (dry_run={})",
        vault_id,
        dry_run
    );

    let vaults = state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let goal_ids = manager.list_goals().unwrap_or_default();
    let mut changes = Vec::new();

    for gid in &goal_ids {
        let (mut fm, mut body) = match manager.read_goal(gid) {
            Ok(pair) => pair,
            Err(e) => {
                changes.push(format!("SKIP {gid}: read error: {e}"));
                continue;
            }
        };

        let mut modified = false;
        let mut goal_changes = Vec::new();

        // 1. Migrate legacy domain fields into spec-shaped `domain` + `type: goal`.
        let type_value = fm
            .get("type")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        if !fm.contains_key("domain") {
            let old_value = fm
                .get("objective")
                .or_else(|| fm.get("description"))
                .or_else(|| fm.get("specific"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            // Heuristic: if it's a short category-like word, use it as type
            let is_category = !old_value.is_empty()
                && (old_value.split_whitespace().count() <= 2
                    || KNOWN_CATEGORIES
                        .iter()
                        .any(|c| c.eq_ignore_ascii_case(old_value.trim())));

            let domain = type_value
                .as_deref()
                .filter(|value| !matches!(*value, "goal" | "objective"))
                .map(str::to_string)
                .unwrap_or_else(|| {
                    if is_category && !old_value.is_empty() {
                        old_value.clone()
                    } else {
                        // Try first tag as domain
                        fm.get("tags")
                            .and_then(|v| v.as_sequence())
                            .and_then(|seq| seq.first())
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| "Personal".to_string())
                    }
                });

            fm.insert("domain".into(), serde_yaml::Value::String(domain.clone()));
            goal_changes.push(format!("domain={domain}"));

            // Remove old keys
            for key in &["objective", "description", "specific"] {
                if fm.remove(*key).is_some() {
                    goal_changes.push(format!("removed {key}"));
                }
            }

            // If the old value was a real description (not a category), prepend it to the body
            if !is_category && !old_value.is_empty() && old_value.len() > 30 {
                goal_changes.push(format!(
                    "moved description to notes ({} chars)",
                    old_value.len()
                ));
                // We need to mutate body — rebind it as mutable shadow
                // body is written back below via write_goal
                let prefix = format!("{}\n\n", old_value);
                body = if body.trim().is_empty() {
                    old_value.clone()
                } else {
                    format!("{prefix}{body}")
                };
            }

            modified = true;
        }

        if type_value.as_deref() != Some("goal") {
            fm.insert("type".into(), serde_yaml::Value::String("goal".to_string()));
            goal_changes.push("type=goal".to_string());
            modified = true;
        }

        // 2. Flatten measurable → target/current, remove measurable
        if let Some(measurable) = fm.remove("measurable") {
            if let Some(target) = measurable.get("target").and_then(|v| v.as_f64()) {
                fm.insert(
                    "target".into(),
                    serde_yaml::to_value(target).unwrap_or_default(),
                );
                goal_changes.push(format!("target={target}"));
            }
            if let Some(current) = measurable.get("current").and_then(|v| v.as_f64()) {
                fm.insert(
                    "current".into(),
                    serde_yaml::to_value(current).unwrap_or_default(),
                );
                goal_changes.push(format!("current={current}"));
            }
            goal_changes.push("removed measurable".to_string());
            modified = true;
        }

        // 3. Add start_date from created if missing
        if !fm.contains_key("start_date") {
            let created_date = fm
                .get("created")
                .and_then(|v| v.as_str())
                .map(|s| s.split('T').next().unwrap_or(s).to_string());
            if let Some(date_part) = created_date {
                fm.insert(
                    "start_date".into(),
                    serde_yaml::Value::String(date_part.clone()),
                );
                goal_changes.push(format!("start_date={date_part}"));
                modified = true;
            }
        }

        // 4. Migrate legacy achievable → confidence
        if !fm.contains_key("confidence") {
            if let Some(achievable) = fm.remove("achievable").and_then(|v| v.as_u64()) {
                fm.insert(
                    "confidence".into(),
                    serde_yaml::Value::Number(serde_yaml::Number::from(achievable)),
                );
                goal_changes.push(format!("confidence={achievable} (from achievable)"));
                modified = true;
            }
        }

        // 5. Migrate legacy relevant → why
        if !fm.contains_key("why") {
            if let Some(relevant) = fm.remove("relevant") {
                fm.insert("why".into(), relevant);
                goal_changes.push("why (from relevant)".to_string());
                modified = true;
            }
        }

        // 6. Remove deprecated publish_milestones_on_complete
        if fm.remove("publish_milestones_on_complete").is_some() {
            goal_changes.push("removed publish_milestones_on_complete".to_string());
            modified = true;
        }

        if modified {
            let summary = format!("{gid}: {}", goal_changes.join(", "));
            if !dry_run {
                if let Err(e) = manager.write_goal(gid, &fm, &body) {
                    changes.push(format!("ERROR {gid}: write failed: {e}"));
                    continue;
                }
            }
            changes.push(summary);
        }
    }

    if changes.is_empty() {
        changes.push("No goals needed migration.".to_string());
    } else {
        changes.insert(
            0,
            format!(
                "{}Migrated {}/{} goals",
                if dry_run { "[DRY RUN] " } else { "" },
                changes.len(),
                goal_ids.len()
            ),
        );
    }

    Ok(changes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use vault_core::{VaultManager, VaultType};

    fn goal_update_with_notes(notes: &str) -> GoalUpdate {
        GoalUpdate {
            title: None,
            short_title: None,
            status: None,
            goal_type: None,
            deadline: None,
            priority: None,
            eisenhower_quadrant: None,
            start_date: None,
            target: None,
            current: None,
            tags: None,
            notes: Some(notes.to_string()),
        }
    }

    fn base_goal_frontmatter() -> markdown_parser::Frontmatter {
        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert("id".into(), serde_yaml::Value::String("goal_tasks".into()));
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Goal Tasks".into()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("goal".into()));
        frontmatter.insert("status".into(), serde_yaml::Value::String("active".into()));
        frontmatter.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-25T12:00:00Z".into()),
        );
        frontmatter
    }

    fn valid_task_mapping(id: &str, title: &str) -> serde_yaml::Mapping {
        let mut task = serde_yaml::Mapping::new();
        task.insert("id".into(), serde_yaml::Value::String(id.to_string()));
        task.insert("title".into(), serde_yaml::Value::String(title.to_string()));
        task.insert("status".into(), serde_yaml::Value::String("todo".into()));
        task
    }

    fn invalid_task_missing_title_mapping(id: &str) -> serde_yaml::Mapping {
        let mut task = serde_yaml::Mapping::new();
        task.insert("id".into(), serde_yaml::Value::String(id.to_string()));
        task.insert("status".into(), serde_yaml::Value::String("todo".into()));
        task
    }

    #[test]
    fn delete_goal_rejects_missing_explicit_confirmation_without_file_changes() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();
        let mut frontmatter = base_goal_frontmatter();
        frontmatter.insert("id".into(), serde_yaml::Value::String("goal_delete".into()));
        manager
            .write_goal("goal_delete", &frontmatter, "Goal to keep")
            .unwrap();
        let goal_path = manager.structure().goal_file_flat("goal_delete");
        let mutation_log_path = manager.structure().mutation_log.clone();
        let snapshots_path = manager.structure().snapshots.clone();
        let original_mutation_log = std::fs::read_to_string(&mutation_log_path).unwrap_or_default();
        let original_snapshot_count = std::fs::read_dir(&snapshots_path).unwrap().count();

        let app_state = AppState::default();
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert("vault_test".to_string(), manager);

        let error = delete_goal_in_state("vault_test", "goal_delete", false, &app_state)
            .expect_err("delete should require explicit confirmation");

        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error.message.contains("explicit confirmation"));
        assert!(goal_path.exists());
        assert_eq!(
            std::fs::read_to_string(mutation_log_path).unwrap_or_default(),
            original_mutation_log
        );
        assert_eq!(
            std::fs::read_dir(snapshots_path).unwrap().count(),
            original_snapshot_count
        );
    }

    #[test]
    fn delete_goal_allows_confirmed_destructive_file_delete() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();
        let mut frontmatter = base_goal_frontmatter();
        frontmatter.insert("id".into(), serde_yaml::Value::String("goal_delete".into()));
        manager
            .write_goal("goal_delete", &frontmatter, "Goal to delete")
            .unwrap();
        let goal_path = manager.structure().goal_file_flat("goal_delete");
        let mutation_log_path = manager.structure().mutation_log.clone();

        let app_state = AppState::default();
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert("vault_test".to_string(), manager);

        delete_goal_in_state("vault_test", "goal_delete", true, &app_state).unwrap();

        assert!(!goal_path.exists());
        let mutation_log = std::fs::read_to_string(mutation_log_path).unwrap();
        assert!(mutation_log.contains("- Action: delete_goal"));
        assert!(mutation_log.contains("- Actor: user"));
    }

    #[test]
    fn update_goal_notes_writes_markdown_snapshot_and_mutation_log() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert(
            "id".into(),
            serde_yaml::Value::String("goal_notes".to_string()),
        );
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Notes Goal".to_string()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("goal".to_string()));
        frontmatter.insert(
            "domain".into(),
            serde_yaml::Value::String("Personal".to_string()),
        );
        frontmatter.insert(
            "status".into(),
            serde_yaml::Value::String("active".to_string()),
        );
        frontmatter.insert(
            "deadline".into(),
            serde_yaml::Value::String("2026-05-01".to_string()),
        );
        frontmatter.insert(
            "priority".into(),
            serde_yaml::Value::String("medium".to_string()),
        );

        manager
            .write_goal("goal_notes", &frontmatter, "Original notes")
            .unwrap();

        let original_snapshot_count = std::fs::read_dir(&manager.structure().snapshots)
            .unwrap()
            .count();

        let updated = update_goal_in_vault(
            &manager,
            "goal_notes",
            goal_update_with_notes("Updated notes from autosave"),
        )
        .unwrap();

        assert_eq!(
            updated.notes.as_deref(),
            Some("Updated notes from autosave")
        );
        let (_, body) = manager.read_goal("goal_notes").unwrap();
        assert!(body.contains("Updated notes from autosave"));

        let mutation_log = std::fs::read_to_string(&manager.structure().mutation_log).unwrap();
        assert!(mutation_log.contains("- Actor: user"));
        assert!(mutation_log.contains("- Action: update_goal"));
        assert!(mutation_log.contains("- File: `goals/goal_notes.md`"));
        assert!(mutation_log.contains("- Entity: `goal_notes`"));
        assert!(mutation_log.contains("- Snapshot: `system/snapshots/"));

        let snapshot_count = std::fs::read_dir(&manager.structure().snapshots)
            .unwrap()
            .count();
        assert!(snapshot_count > original_snapshot_count);

        let history = manager.list_snapshot_history().unwrap();
        assert_eq!(history[0].target_path, "goals/goal_notes.md");
        assert_eq!(history[0].actor, "user");
        assert_eq!(history[0].action, "update_goal");
    }

    #[test]
    fn list_goals_logs_invalid_goal_frontmatter_without_rewriting() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();
        let goal_path = manager.structure().goal_file_flat("invalid_goal");
        let invalid_goal = r#"---
id: invalid_goal
type: goal
title: []
status: active
created: "2026-04-25T12:00:00Z"
---

## Notes
"#;
        std::fs::write(&goal_path, invalid_goal).unwrap();

        let goals = list_goals_from_manager(&manager).unwrap();

        assert!(goals.is_empty());
        let error_log = std::fs::read_to_string(&manager.structure().error_log).unwrap();
        assert!(error_log.contains("goals/invalid_goal.md"));
        assert!(error_log.contains("Goal missing 'title' field"));
        assert_eq!(std::fs::read_to_string(goal_path).unwrap(), invalid_goal);
    }

    #[test]
    fn list_goal_frontmatter_tasks_logs_invalid_task_rows_without_rewriting() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert("id".into(), serde_yaml::Value::String("goal_tasks".into()));
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Goal Tasks".into()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("goal".into()));
        frontmatter.insert("status".into(), serde_yaml::Value::String("active".into()));
        frontmatter.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-25T12:00:00Z".into()),
        );

        let mut valid_task = serde_yaml::Mapping::new();
        valid_task.insert("id".into(), serde_yaml::Value::String("task_valid".into()));
        valid_task.insert(
            "title".into(),
            serde_yaml::Value::String("Valid task".into()),
        );
        valid_task.insert("status".into(), serde_yaml::Value::String("todo".into()));

        let mut invalid_task = serde_yaml::Mapping::new();
        invalid_task.insert(
            "id".into(),
            serde_yaml::Value::String("task_missing_title".into()),
        );
        invalid_task.insert("status".into(), serde_yaml::Value::String("todo".into()));

        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![
                serde_yaml::Value::Mapping(valid_task),
                serde_yaml::Value::Mapping(invalid_task),
            ]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();
        let goal_path = manager.structure().goal_file_flat("goal_tasks");
        let before = std::fs::read_to_string(&goal_path).unwrap();

        let tasks = list_goal_frontmatter_tasks_from_manager(&manager, "goal_tasks").unwrap();

        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "task_valid");
        let error_log = std::fs::read_to_string(&manager.structure().error_log).unwrap();
        assert!(error_log.contains("goals/goal_tasks.md"));
        assert!(error_log.contains("tasks[1].title"));
        assert_eq!(std::fs::read_to_string(goal_path).unwrap(), before);
    }

    #[test]
    fn list_goal_frontmatter_tasks_logs_invalid_task_status_without_rewriting() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert("id".into(), serde_yaml::Value::String("goal_tasks".into()));
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Goal Tasks".into()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("goal".into()));
        frontmatter.insert("status".into(), serde_yaml::Value::String("active".into()));
        frontmatter.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-25T12:00:00Z".into()),
        );

        let mut valid_task = serde_yaml::Mapping::new();
        valid_task.insert("id".into(), serde_yaml::Value::String("task_valid".into()));
        valid_task.insert(
            "title".into(),
            serde_yaml::Value::String("Valid task".into()),
        );
        valid_task.insert("status".into(), serde_yaml::Value::String("pending".into()));

        let mut invalid_task = serde_yaml::Mapping::new();
        invalid_task.insert(
            "id".into(),
            serde_yaml::Value::String("task_invalid_status".into()),
        );
        invalid_task.insert(
            "title".into(),
            serde_yaml::Value::String("Invalid status task".into()),
        );
        invalid_task.insert("status".into(), serde_yaml::Value::String("later".into()));

        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![
                serde_yaml::Value::Mapping(valid_task),
                serde_yaml::Value::Mapping(invalid_task),
            ]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();
        let goal_path = manager.structure().goal_file_flat("goal_tasks");
        let before = std::fs::read_to_string(&goal_path).unwrap();

        let tasks = list_goal_frontmatter_tasks_from_manager(&manager, "goal_tasks").unwrap();

        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "task_valid");
        assert_eq!(tasks[0].status, "pending");
        let error_log = std::fs::read_to_string(&manager.structure().error_log).unwrap();
        assert!(error_log.contains("goals/goal_tasks.md"));
        assert!(error_log.contains("tasks[1].status"));
        assert!(error_log.contains("later"));
        assert_eq!(std::fs::read_to_string(goal_path).unwrap(), before);
    }

    #[test]
    fn add_goal_frontmatter_child_task_writes_generated_from_task_id() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert("id".into(), serde_yaml::Value::String("goal_tasks".into()));
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Goal Tasks".into()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("goal".into()));
        frontmatter.insert("status".into(), serde_yaml::Value::String("active".into()));
        frontmatter.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-25T12:00:00Z".into()),
        );

        let mut parent_task = serde_yaml::Mapping::new();
        parent_task.insert("id".into(), serde_yaml::Value::String("task_parent".into()));
        parent_task.insert(
            "title".into(),
            serde_yaml::Value::String("Parent task".into()),
        );
        parent_task.insert("status".into(), serde_yaml::Value::String("todo".into()));
        parent_task.insert(
            "parent_goal_id".into(),
            serde_yaml::Value::String("goal_tasks".into()),
        );
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(parent_task)]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();
        let original_mutation_log =
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default();
        let original_snapshot_count = std::fs::read_dir(&manager.structure().snapshots)
            .unwrap()
            .count();

        let created = add_goal_frontmatter_task_to_manager(
            &manager,
            "goal_tasks",
            "Child task".to_string(),
            Some("task_parent".to_string()),
        )
        .unwrap();

        assert_eq!(
            created.generated_from_task_id.as_deref(),
            Some("task_parent")
        );

        let (updated_frontmatter, _) = manager.read_goal("goal_tasks").unwrap();
        let tasks = updated_frontmatter
            .get("tasks")
            .and_then(|value| value.as_sequence())
            .unwrap();
        let child = tasks
            .iter()
            .find(|task| {
                task.get("id").and_then(|value| value.as_str()) == Some(created.id.as_str())
            })
            .unwrap();
        assert_eq!(
            child.get("parent_id").and_then(|value| value.as_str()),
            Some("task_parent")
        );
        assert_eq!(
            child
                .get("generated_from_task_id")
                .and_then(|value| value.as_str()),
            Some("task_parent")
        );

        let mutation_log = std::fs::read_to_string(&manager.structure().mutation_log).unwrap();
        assert_ne!(mutation_log, original_mutation_log);
        assert!(mutation_log.contains("- Actor: user"));
        assert!(mutation_log.contains("- Action: add_goal_frontmatter_task"));
        assert!(mutation_log.contains("- File: `goals/goal_tasks.md`"));
        assert!(mutation_log.contains("- Entity: `goal_tasks`"));
        assert!(mutation_log.contains("- Snapshot: `system/snapshots/"));
        assert!(
            std::fs::read_dir(&manager.structure().snapshots)
                .unwrap()
                .count()
                > original_snapshot_count
        );
    }

    #[test]
    fn add_goal_frontmatter_child_task_rejects_missing_parent_without_write() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert("id".into(), serde_yaml::Value::String("goal_tasks".into()));
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Goal Tasks".into()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("goal".into()));
        frontmatter.insert("status".into(), serde_yaml::Value::String("active".into()));
        frontmatter.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-25T12:00:00Z".into()),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();
        let goal_path = manager.structure().goal_file_flat("goal_tasks");
        let before = std::fs::read_to_string(&goal_path).unwrap();
        let original_mutation_log =
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default();
        let original_snapshot_count = std::fs::read_dir(&manager.structure().snapshots)
            .unwrap()
            .count();

        let error = add_goal_frontmatter_task_to_manager(
            &manager,
            "goal_tasks",
            "Orphan child".to_string(),
            Some("task_missing".to_string()),
        )
        .unwrap_err();

        assert_eq!(error.code, "ITEM_NOT_FOUND");
        assert!(error.message.contains("task_missing"));
        assert_eq!(std::fs::read_to_string(&goal_path).unwrap(), before);
        assert_eq!(
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default(),
            original_mutation_log
        );
        assert_eq!(
            std::fs::read_dir(&manager.structure().snapshots)
                .unwrap()
                .count(),
            original_snapshot_count
        );
    }

    #[test]
    fn add_goal_frontmatter_task_rejects_invalid_existing_rows_without_write() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert("id".into(), serde_yaml::Value::String("goal_tasks".into()));
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Goal Tasks".into()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("goal".into()));
        frontmatter.insert("status".into(), serde_yaml::Value::String("active".into()));
        frontmatter.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-25T12:00:00Z".into()),
        );

        let mut invalid_task = serde_yaml::Mapping::new();
        invalid_task.insert(
            "id".into(),
            serde_yaml::Value::String("task_invalid".into()),
        );
        invalid_task.insert("status".into(), serde_yaml::Value::String("todo".into()));
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(invalid_task)]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();
        let goal_path = manager.structure().goal_file_flat("goal_tasks");
        let before = std::fs::read_to_string(&goal_path).unwrap();
        let original_mutation_log =
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default();
        let original_snapshot_count = std::fs::read_dir(&manager.structure().snapshots)
            .unwrap()
            .count();

        let error = add_goal_frontmatter_task_to_manager(
            &manager,
            "goal_tasks",
            "New task".to_string(),
            None,
        )
        .unwrap_err();

        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error.message.contains("tasks[0].title"));
        assert_eq!(std::fs::read_to_string(&goal_path).unwrap(), before);
        let error_log = std::fs::read_to_string(&manager.structure().error_log).unwrap();
        assert!(error_log.contains("goals/goal_tasks.md"));
        assert!(error_log.contains("tasks[0].title"));
        assert_eq!(
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default(),
            original_mutation_log
        );
        assert_eq!(
            std::fs::read_dir(&manager.structure().snapshots)
                .unwrap()
                .count(),
            original_snapshot_count
        );
    }

    #[test]
    fn update_goal_frontmatter_task_writes_snapshot_and_user_mutation_log() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert("id".into(), serde_yaml::Value::String("goal_tasks".into()));
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Goal Tasks".into()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("goal".into()));
        frontmatter.insert("status".into(), serde_yaml::Value::String("active".into()));
        frontmatter.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-25T12:00:00Z".into()),
        );

        let mut task = serde_yaml::Mapping::new();
        task.insert(
            "id".into(),
            serde_yaml::Value::String("task_existing".into()),
        );
        task.insert(
            "title".into(),
            serde_yaml::Value::String("Original task".into()),
        );
        task.insert("status".into(), serde_yaml::Value::String("todo".into()));
        task.insert(
            "parent_goal_id".into(),
            serde_yaml::Value::String("goal_tasks".into()),
        );
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(task)]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();
        let original_mutation_log =
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default();
        let original_snapshot_count = std::fs::read_dir(&manager.structure().snapshots)
            .unwrap()
            .count();

        update_goal_frontmatter_task_in_manager(
            &manager,
            "goal_tasks",
            "task_existing",
            "Renamed task".to_string(),
        )
        .unwrap();

        let (updated_frontmatter, _) = manager.read_goal("goal_tasks").unwrap();
        let tasks = updated_frontmatter
            .get("tasks")
            .and_then(|value| value.as_sequence())
            .unwrap();
        assert_eq!(
            tasks[0].get("title").and_then(|value| value.as_str()),
            Some("Renamed task")
        );

        let mutation_log = std::fs::read_to_string(&manager.structure().mutation_log).unwrap();
        assert_ne!(mutation_log, original_mutation_log);
        assert!(mutation_log.contains("- Actor: user"));
        assert!(mutation_log.contains("- Action: update_goal_frontmatter_task"));
        assert!(mutation_log.contains("- File: `goals/goal_tasks.md`"));
        assert!(mutation_log.contains("- Entity: `goal_tasks`"));
        assert!(mutation_log.contains("- Snapshot: `system/snapshots/"));
        assert!(
            std::fs::read_dir(&manager.structure().snapshots)
                .unwrap()
                .count()
                > original_snapshot_count
        );
    }

    #[test]
    fn update_goal_frontmatter_task_updates_nested_subtask() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert("id".into(), serde_yaml::Value::String("goal_tasks".into()));
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Goal Tasks".into()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("goal".into()));
        frontmatter.insert("status".into(), serde_yaml::Value::String("active".into()));
        frontmatter.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-25T12:00:00Z".into()),
        );

        let mut nested_subtask = serde_yaml::Mapping::new();
        nested_subtask.insert(
            "id".into(),
            serde_yaml::Value::String("subtask_nested".into()),
        );
        nested_subtask.insert(
            "title".into(),
            serde_yaml::Value::String("Original nested title".into()),
        );
        nested_subtask.insert("status".into(), serde_yaml::Value::String("todo".into()));

        let mut parent_task = serde_yaml::Mapping::new();
        parent_task.insert("id".into(), serde_yaml::Value::String("task_parent".into()));
        parent_task.insert(
            "title".into(),
            serde_yaml::Value::String("Parent task".into()),
        );
        parent_task.insert("status".into(), serde_yaml::Value::String("todo".into()));
        parent_task.insert(
            "parent_goal_id".into(),
            serde_yaml::Value::String("goal_tasks".into()),
        );
        parent_task.insert(
            "subtasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(nested_subtask)]),
        );

        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(parent_task)]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();

        update_goal_frontmatter_task_in_manager(
            &manager,
            "goal_tasks",
            "subtask_nested",
            "Renamed nested title".to_string(),
        )
        .unwrap();

        let (updated_frontmatter, _) = manager.read_goal("goal_tasks").unwrap();
        let parent = updated_frontmatter
            .get("tasks")
            .and_then(|value| value.as_sequence())
            .and_then(|tasks| tasks.first())
            .unwrap();
        assert_eq!(
            parent.get("title").and_then(|value| value.as_str()),
            Some("Parent task")
        );
        let nested = parent
            .get("subtasks")
            .and_then(|value| value.as_sequence())
            .and_then(|subtasks| subtasks.first())
            .unwrap();
        assert_eq!(
            nested.get("title").and_then(|value| value.as_str()),
            Some("Renamed nested title")
        );
    }

    #[test]
    fn update_goal_frontmatter_task_rejects_invalid_remaining_rows_without_write() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = base_goal_frontmatter();
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![
                serde_yaml::Value::Mapping(valid_task_mapping("task_existing", "Original task")),
                serde_yaml::Value::Mapping(invalid_task_missing_title_mapping("task_invalid")),
            ]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();
        let goal_path = manager.structure().goal_file_flat("goal_tasks");
        let before = std::fs::read_to_string(&goal_path).unwrap();
        let original_mutation_log =
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default();
        let original_snapshot_count = std::fs::read_dir(&manager.structure().snapshots)
            .unwrap()
            .count();

        let error = update_goal_frontmatter_task_in_manager(
            &manager,
            "goal_tasks",
            "task_existing",
            "Renamed task".to_string(),
        )
        .unwrap_err();

        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error.message.contains("tasks[1].title"));
        assert_eq!(std::fs::read_to_string(&goal_path).unwrap(), before);
        let error_log = std::fs::read_to_string(&manager.structure().error_log).unwrap();
        assert!(error_log.contains("goals/goal_tasks.md"));
        assert!(error_log.contains("tasks[1].title"));
        assert_eq!(
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default(),
            original_mutation_log
        );
        assert_eq!(
            std::fs::read_dir(&manager.structure().snapshots)
                .unwrap()
                .count(),
            original_snapshot_count
        );
    }

    #[test]
    fn update_goal_frontmatter_task_recurrence_writes_snapshot_and_user_mutation_log() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = base_goal_frontmatter();
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(valid_task_mapping(
                "task_existing",
                "Existing task",
            ))]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();
        let original_mutation_log =
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default();
        let original_snapshot_count = std::fs::read_dir(&manager.structure().snapshots)
            .unwrap()
            .count();

        update_goal_frontmatter_task_recurrence_in_manager(
            &manager,
            "goal_tasks",
            "task_existing",
            Some("weekly".to_string()),
        )
        .unwrap();

        let (updated_frontmatter, _) = manager.read_goal("goal_tasks").unwrap();
        let tasks = updated_frontmatter
            .get("tasks")
            .and_then(|value| value.as_sequence())
            .unwrap();
        assert_eq!(
            tasks[0].get("recurring").and_then(|value| value.as_str()),
            Some("weekly")
        );

        let mutation_log = std::fs::read_to_string(&manager.structure().mutation_log).unwrap();
        assert_ne!(mutation_log, original_mutation_log);
        assert!(mutation_log.contains("- Actor: user"));
        assert!(mutation_log.contains("- Action: update_goal_frontmatter_task_recurrence"));
        assert!(mutation_log.contains("- File: `goals/goal_tasks.md`"));
        assert!(mutation_log.contains("- Entity: `goal_tasks`"));
        assert!(mutation_log.contains("- Snapshot: `system/snapshots/"));
        assert!(
            std::fs::read_dir(&manager.structure().snapshots)
                .unwrap()
                .count()
                > original_snapshot_count
        );
    }

    #[test]
    fn update_goal_frontmatter_task_recurrence_clears_recurrence_fields() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = base_goal_frontmatter();
        let mut task = valid_task_mapping("task_existing", "Existing task");
        task.insert(
            "recurring".into(),
            serde_yaml::Value::String("daily".to_string()),
        );
        task.insert(
            "recurrence_start".into(),
            serde_yaml::Value::String("2026-04-27".to_string()),
        );
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(task)]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();

        update_goal_frontmatter_task_recurrence_in_manager(
            &manager,
            "goal_tasks",
            "task_existing",
            None,
        )
        .unwrap();

        let (updated_frontmatter, _) = manager.read_goal("goal_tasks").unwrap();
        let task = updated_frontmatter
            .get("tasks")
            .and_then(|value| value.as_sequence())
            .and_then(|tasks| tasks.first())
            .unwrap();

        assert!(task.get("recurring").is_none());
        assert!(task.get("recurrence_start").is_none());
    }

    #[test]
    fn update_goal_frontmatter_task_scheduled_date_writes_snapshot_and_user_mutation_log() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = base_goal_frontmatter();
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(valid_task_mapping(
                "task_existing",
                "Existing task",
            ))]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();
        let original_mutation_log =
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default();
        let original_snapshot_count = std::fs::read_dir(&manager.structure().snapshots)
            .unwrap()
            .count();

        update_goal_frontmatter_task_scheduled_date_in_manager(
            &manager,
            "goal_tasks",
            "task_existing",
            Some("2026-04-30".to_string()),
        )
        .unwrap();

        let (updated_frontmatter, _) = manager.read_goal("goal_tasks").unwrap();
        let tasks = updated_frontmatter
            .get("tasks")
            .and_then(|value| value.as_sequence())
            .unwrap();
        assert_eq!(
            tasks[0]
                .get("scheduled_date")
                .and_then(|value| value.as_str()),
            Some("2026-04-30")
        );

        let mutation_log = std::fs::read_to_string(&manager.structure().mutation_log).unwrap();
        assert_ne!(mutation_log, original_mutation_log);
        assert!(mutation_log.contains("- Actor: user"));
        assert!(mutation_log.contains("- Action: update_goal_frontmatter_task_scheduled_date"));
        assert!(mutation_log.contains("- File: `goals/goal_tasks.md`"));
        assert!(mutation_log.contains("- Entity: `goal_tasks`"));
        assert!(mutation_log.contains("- Snapshot: `system/snapshots/"));
        assert!(
            std::fs::read_dir(&manager.structure().snapshots)
                .unwrap()
                .count()
                > original_snapshot_count
        );
    }

    #[test]
    fn update_goal_frontmatter_task_scheduled_date_clears_scheduled_date_fields() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = base_goal_frontmatter();
        let mut task = valid_task_mapping("task_existing", "Existing task");
        task.insert(
            "scheduled_date".into(),
            serde_yaml::Value::String("2026-04-30".to_string()),
        );
        task.insert(
            "scheduledDate".into(),
            serde_yaml::Value::String("2026-05-01".to_string()),
        );
        task.insert(
            "scheduled_for".into(),
            serde_yaml::Value::String("2026-05-02".to_string()),
        );
        task.insert(
            "scheduledFor".into(),
            serde_yaml::Value::String("2026-05-03".to_string()),
        );
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(task)]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();

        update_goal_frontmatter_task_scheduled_date_in_manager(
            &manager,
            "goal_tasks",
            "task_existing",
            None,
        )
        .unwrap();

        let (updated_frontmatter, _) = manager.read_goal("goal_tasks").unwrap();
        let task = updated_frontmatter
            .get("tasks")
            .and_then(|value| value.as_sequence())
            .and_then(|tasks| tasks.first())
            .unwrap();

        assert!(task.get("scheduled_date").is_none());
        assert!(task.get("scheduledDate").is_none());
        assert!(task.get("scheduled_for").is_none());
        assert!(task.get("scheduledFor").is_none());
    }

    #[test]
    fn update_goal_frontmatter_task_scheduled_date_rejects_invalid_date_without_write() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = base_goal_frontmatter();
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(valid_task_mapping(
                "task_existing",
                "Existing task",
            ))]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();
        let goal_path = manager.structure().goal_file_flat("goal_tasks");
        let before = std::fs::read_to_string(&goal_path).unwrap();
        let original_mutation_log =
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default();
        let original_snapshot_count = std::fs::read_dir(&manager.structure().snapshots)
            .unwrap()
            .count();

        let error = update_goal_frontmatter_task_scheduled_date_in_manager(
            &manager,
            "goal_tasks",
            "task_existing",
            Some("April 30".to_string()),
        )
        .unwrap_err();

        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error.message.contains("April 30"));
        assert_eq!(std::fs::read_to_string(&goal_path).unwrap(), before);
        assert_eq!(
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default(),
            original_mutation_log
        );
        assert_eq!(
            std::fs::read_dir(&manager.structure().snapshots)
                .unwrap()
                .count(),
            original_snapshot_count
        );
    }

    #[test]
    fn update_goal_frontmatter_task_status_writes_snapshot_and_user_mutation_log() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = base_goal_frontmatter();
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(valid_task_mapping(
                "task_existing",
                "Existing task",
            ))]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();
        let original_mutation_log =
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default();
        let original_snapshot_count = std::fs::read_dir(&manager.structure().snapshots)
            .unwrap()
            .count();

        update_goal_frontmatter_task_status_in_manager(
            &manager,
            "goal_tasks",
            "task_existing",
            "completed".to_string(),
        )
        .unwrap();

        let (updated_frontmatter, _) = manager.read_goal("goal_tasks").unwrap();
        let tasks = updated_frontmatter
            .get("tasks")
            .and_then(|value| value.as_sequence())
            .unwrap();
        assert_eq!(
            tasks[0].get("status").and_then(|value| value.as_str()),
            Some("completed")
        );

        let mutation_log = std::fs::read_to_string(&manager.structure().mutation_log).unwrap();
        assert_ne!(mutation_log, original_mutation_log);
        assert!(mutation_log.contains("- Actor: user"));
        assert!(mutation_log.contains("- Action: update_goal_frontmatter_task_status"));
        assert!(mutation_log.contains("- File: `goals/goal_tasks.md`"));
        assert!(mutation_log.contains("- Entity: `goal_tasks`"));
        assert!(mutation_log.contains("- Snapshot: `system/snapshots/"));
        assert!(
            std::fs::read_dir(&manager.structure().snapshots)
                .unwrap()
                .count()
                > original_snapshot_count
        );
    }

    #[test]
    fn update_goal_frontmatter_task_status_updates_nested_subtask() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = base_goal_frontmatter();
        let mut nested_subtask = valid_task_mapping("subtask_nested", "Nested subtask");
        nested_subtask.insert(
            "parent_id".into(),
            serde_yaml::Value::String("task_parent".into()),
        );

        let mut parent_task = valid_task_mapping("task_parent", "Parent task");
        parent_task.insert(
            "subtasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(nested_subtask)]),
        );
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(parent_task)]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();

        update_goal_frontmatter_task_status_in_manager(
            &manager,
            "goal_tasks",
            "subtask_nested",
            "archived".to_string(),
        )
        .unwrap();

        let (updated_frontmatter, _) = manager.read_goal("goal_tasks").unwrap();
        let parent = updated_frontmatter
            .get("tasks")
            .and_then(|value| value.as_sequence())
            .and_then(|tasks| tasks.first())
            .unwrap();
        assert_eq!(
            parent.get("status").and_then(|value| value.as_str()),
            Some("todo")
        );
        let nested = parent
            .get("subtasks")
            .and_then(|value| value.as_sequence())
            .and_then(|subtasks| subtasks.first())
            .unwrap();
        assert_eq!(
            nested.get("status").and_then(|value| value.as_str()),
            Some("archived")
        );
    }

    #[test]
    fn update_goal_frontmatter_task_status_rejects_invalid_status_without_write() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = base_goal_frontmatter();
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(valid_task_mapping(
                "task_existing",
                "Existing task",
            ))]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();
        let goal_path = manager.structure().goal_file_flat("goal_tasks");
        let before = std::fs::read_to_string(&goal_path).unwrap();
        let original_mutation_log =
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default();
        let original_snapshot_count = std::fs::read_dir(&manager.structure().snapshots)
            .unwrap()
            .count();

        let error = update_goal_frontmatter_task_status_in_manager(
            &manager,
            "goal_tasks",
            "task_existing",
            "later".to_string(),
        )
        .unwrap_err();

        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error.message.contains("later"));
        assert_eq!(std::fs::read_to_string(&goal_path).unwrap(), before);
        assert_eq!(
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default(),
            original_mutation_log
        );
        assert_eq!(
            std::fs::read_dir(&manager.structure().snapshots)
                .unwrap()
                .count(),
            original_snapshot_count
        );
    }

    #[test]
    fn update_goal_frontmatter_task_status_sets_completed_at_when_completed() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = base_goal_frontmatter();
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(valid_task_mapping(
                "task_existing",
                "Existing task",
            ))]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();

        update_goal_frontmatter_task_status_in_manager(
            &manager,
            "goal_tasks",
            "task_existing",
            "completed".to_string(),
        )
        .unwrap();

        let (updated_frontmatter, _) = manager.read_goal("goal_tasks").unwrap();
        let completed_at = updated_frontmatter
            .get("tasks")
            .and_then(|value| value.as_sequence())
            .and_then(|tasks| tasks.first())
            .and_then(|task| task.get("completed_at"))
            .and_then(|value| value.as_str())
            .unwrap();

        assert!(chrono::DateTime::parse_from_rfc3339(completed_at).is_ok());
    }

    #[test]
    fn update_goal_frontmatter_task_status_preserves_existing_completed_at() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = base_goal_frontmatter();
        let mut task = valid_task_mapping("task_existing", "Existing task");
        task.insert(
            "completed_at".into(),
            serde_yaml::Value::String("2026-04-26T12:00:00Z".into()),
        );
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(task)]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();

        update_goal_frontmatter_task_status_in_manager(
            &manager,
            "goal_tasks",
            "task_existing",
            "completed".to_string(),
        )
        .unwrap();

        let (updated_frontmatter, _) = manager.read_goal("goal_tasks").unwrap();
        let completed_at = updated_frontmatter
            .get("tasks")
            .and_then(|value| value.as_sequence())
            .and_then(|tasks| tasks.first())
            .and_then(|task| task.get("completed_at"))
            .and_then(|value| value.as_str());

        assert_eq!(completed_at, Some("2026-04-26T12:00:00Z"));
    }

    #[test]
    fn update_goal_frontmatter_task_status_clears_completed_at_when_uncompleted() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = base_goal_frontmatter();
        let mut task = valid_task_mapping("task_existing", "Existing task");
        task.insert(
            "status".into(),
            serde_yaml::Value::String("completed".into()),
        );
        task.insert(
            "completed_at".into(),
            serde_yaml::Value::String("2026-04-26T12:00:00Z".into()),
        );
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(task)]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();

        update_goal_frontmatter_task_status_in_manager(
            &manager,
            "goal_tasks",
            "task_existing",
            "todo".to_string(),
        )
        .unwrap();

        let (updated_frontmatter, _) = manager.read_goal("goal_tasks").unwrap();
        let task = updated_frontmatter
            .get("tasks")
            .and_then(|value| value.as_sequence())
            .and_then(|tasks| tasks.first())
            .unwrap();

        assert_eq!(
            task.get("status").and_then(|value| value.as_str()),
            Some("todo")
        );
        assert!(task.get("completed_at").is_none());
    }

    #[test]
    fn delete_goal_frontmatter_task_rejects_missing_confirmation_without_write() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = base_goal_frontmatter();
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(valid_task_mapping(
                "task_existing",
                "Existing task",
            ))]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();
        let goal_path = manager.structure().goal_file_flat("goal_tasks");
        let before = std::fs::read_to_string(&goal_path).unwrap();
        let original_mutation_log =
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default();
        let original_snapshot_count = std::fs::read_dir(&manager.structure().snapshots)
            .unwrap()
            .count();

        let error =
            delete_goal_frontmatter_task_in_manager(&manager, "goal_tasks", "task_existing", false)
                .expect_err("task delete should require explicit confirmation");

        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error.message.contains("explicit confirmation"));
        assert_eq!(std::fs::read_to_string(&goal_path).unwrap(), before);
        assert_eq!(
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default(),
            original_mutation_log
        );
        assert_eq!(
            std::fs::read_dir(&manager.structure().snapshots)
                .unwrap()
                .count(),
            original_snapshot_count
        );
    }

    #[test]
    fn delete_goal_frontmatter_task_writes_snapshot_and_user_mutation_log() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert("id".into(), serde_yaml::Value::String("goal_tasks".into()));
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Goal Tasks".into()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("goal".into()));
        frontmatter.insert("status".into(), serde_yaml::Value::String("active".into()));
        frontmatter.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-25T12:00:00Z".into()),
        );

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
        task.insert(
            "parent_goal_id".into(),
            serde_yaml::Value::String("goal_tasks".into()),
        );

        let mut child = serde_yaml::Mapping::new();
        child.insert("id".into(), serde_yaml::Value::String("task_child".into()));
        child.insert(
            "title".into(),
            serde_yaml::Value::String("Child task".into()),
        );
        child.insert("status".into(), serde_yaml::Value::String("todo".into()));
        child.insert(
            "parent_id".into(),
            serde_yaml::Value::String("task_existing".into()),
        );

        let mut unrelated = serde_yaml::Mapping::new();
        unrelated.insert(
            "id".into(),
            serde_yaml::Value::String("task_unrelated".into()),
        );
        unrelated.insert(
            "title".into(),
            serde_yaml::Value::String("Unrelated task".into()),
        );
        unrelated.insert("status".into(), serde_yaml::Value::String("todo".into()));
        unrelated.insert(
            "parent_goal_id".into(),
            serde_yaml::Value::String("goal_tasks".into()),
        );

        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![
                serde_yaml::Value::Mapping(task),
                serde_yaml::Value::Mapping(child),
                serde_yaml::Value::Mapping(unrelated),
            ]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();
        let goal_path = manager.structure().goal_file_flat("goal_tasks");
        let original_mutation_log =
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default();
        let original_snapshot_count = std::fs::read_dir(&manager.structure().snapshots)
            .unwrap()
            .count();

        delete_goal_frontmatter_task_in_manager(&manager, "goal_tasks", "task_existing", true)
            .unwrap();

        let (updated_frontmatter, _) = manager.read_goal("goal_tasks").unwrap();
        let tasks = updated_frontmatter
            .get("tasks")
            .and_then(|value| value.as_sequence())
            .unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(
            tasks[0].get("id").and_then(|value| value.as_str()),
            Some("task_unrelated")
        );
        assert!(goal_path.exists());

        let mutation_log = std::fs::read_to_string(&manager.structure().mutation_log).unwrap();
        assert_ne!(mutation_log, original_mutation_log);
        assert!(mutation_log.contains("- Actor: user"));
        assert!(mutation_log.contains("- Action: delete_goal_frontmatter_task"));
        assert!(mutation_log.contains("- File: `goals/goal_tasks.md`"));
        assert!(mutation_log.contains("- Entity: `goal_tasks`"));
        assert!(mutation_log.contains("- Snapshot: `system/snapshots/"));
        assert!(
            std::fs::read_dir(&manager.structure().snapshots)
                .unwrap()
                .count()
                > original_snapshot_count
        );
    }

    #[test]
    fn delete_goal_frontmatter_task_rejects_invalid_remaining_rows_without_write() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = base_goal_frontmatter();
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![
                serde_yaml::Value::Mapping(invalid_task_missing_title_mapping("task_invalid")),
                serde_yaml::Value::Mapping(valid_task_mapping("task_existing", "Existing task")),
            ]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();
        let goal_path = manager.structure().goal_file_flat("goal_tasks");
        let before = std::fs::read_to_string(&goal_path).unwrap();
        let original_mutation_log =
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default();
        let original_snapshot_count = std::fs::read_dir(&manager.structure().snapshots)
            .unwrap()
            .count();

        let error =
            delete_goal_frontmatter_task_in_manager(&manager, "goal_tasks", "task_existing", true)
                .unwrap_err();

        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error.message.contains("tasks[0].title"));
        assert_eq!(std::fs::read_to_string(&goal_path).unwrap(), before);
        let error_log = std::fs::read_to_string(&manager.structure().error_log).unwrap();
        assert!(error_log.contains("goals/goal_tasks.md"));
        assert!(error_log.contains("tasks[0].title"));
        assert_eq!(
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap_or_default(),
            original_mutation_log
        );
        assert_eq!(
            std::fs::read_dir(&manager.structure().snapshots)
                .unwrap()
                .count(),
            original_snapshot_count
        );
    }

    #[test]
    fn delete_goal_frontmatter_task_removes_nested_and_generated_descendants() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert("id".into(), serde_yaml::Value::String("goal_tasks".into()));
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Goal Tasks".into()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("goal".into()));
        frontmatter.insert("status".into(), serde_yaml::Value::String("active".into()));
        frontmatter.insert(
            "created".into(),
            serde_yaml::Value::String("2026-04-25T12:00:00Z".into()),
        );

        let mut nested_grandchild = serde_yaml::Mapping::new();
        nested_grandchild.insert(
            "id".into(),
            serde_yaml::Value::String("subtask_grandchild".into()),
        );
        nested_grandchild.insert(
            "title".into(),
            serde_yaml::Value::String("Nested grandchild".into()),
        );
        nested_grandchild.insert("status".into(), serde_yaml::Value::String("todo".into()));

        let mut nested_subtask = serde_yaml::Mapping::new();
        nested_subtask.insert(
            "id".into(),
            serde_yaml::Value::String("subtask_nested".into()),
        );
        nested_subtask.insert(
            "title".into(),
            serde_yaml::Value::String("Nested subtask".into()),
        );
        nested_subtask.insert("status".into(), serde_yaml::Value::String("todo".into()));
        nested_subtask.insert(
            "subtasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(nested_grandchild)]),
        );

        let mut parent_task = serde_yaml::Mapping::new();
        parent_task.insert("id".into(), serde_yaml::Value::String("task_parent".into()));
        parent_task.insert(
            "title".into(),
            serde_yaml::Value::String("Parent task".into()),
        );
        parent_task.insert("status".into(), serde_yaml::Value::String("todo".into()));
        parent_task.insert(
            "parent_goal_id".into(),
            serde_yaml::Value::String("goal_tasks".into()),
        );
        parent_task.insert(
            "subtasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(nested_subtask)]),
        );

        let mut generated_child = serde_yaml::Mapping::new();
        generated_child.insert(
            "id".into(),
            serde_yaml::Value::String("subtask_generated".into()),
        );
        generated_child.insert(
            "title".into(),
            serde_yaml::Value::String("Generated child".into()),
        );
        generated_child.insert("status".into(), serde_yaml::Value::String("todo".into()));
        generated_child.insert(
            "generated_from_task_id".into(),
            serde_yaml::Value::String("subtask_nested".into()),
        );

        let mut camel_child = serde_yaml::Mapping::new();
        camel_child.insert(
            "id".into(),
            serde_yaml::Value::String("subtask_camel_child".into()),
        );
        camel_child.insert(
            "title".into(),
            serde_yaml::Value::String("Camel child".into()),
        );
        camel_child.insert("status".into(), serde_yaml::Value::String("todo".into()));
        camel_child.insert(
            "parentTaskId".into(),
            serde_yaml::Value::String("subtask_generated".into()),
        );

        let mut unrelated_child = serde_yaml::Mapping::new();
        unrelated_child.insert(
            "id".into(),
            serde_yaml::Value::String("subtask_unrelated".into()),
        );
        unrelated_child.insert(
            "title".into(),
            serde_yaml::Value::String("Unrelated child".into()),
        );
        unrelated_child.insert("status".into(), serde_yaml::Value::String("todo".into()));
        unrelated_child.insert(
            "parentTaskId".into(),
            serde_yaml::Value::String("task_parent".into()),
        );

        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![
                serde_yaml::Value::Mapping(parent_task),
                serde_yaml::Value::Mapping(generated_child),
                serde_yaml::Value::Mapping(camel_child),
                serde_yaml::Value::Mapping(unrelated_child),
            ]),
        );
        manager
            .write_goal("goal_tasks", &frontmatter, "Goal task notes")
            .unwrap();

        delete_goal_frontmatter_task_in_manager(&manager, "goal_tasks", "subtask_nested", true)
            .unwrap();

        let (updated_frontmatter, _) = manager.read_goal("goal_tasks").unwrap();
        let tasks = updated_frontmatter
            .get("tasks")
            .and_then(|value| value.as_sequence())
            .unwrap();
        let task_ids: Vec<&str> = tasks
            .iter()
            .filter_map(|task| task.get("id").and_then(|value| value.as_str()))
            .collect();

        assert_eq!(task_ids, vec!["task_parent", "subtask_unrelated"]);

        let parent = tasks
            .iter()
            .find(|task| task.get("id").and_then(|value| value.as_str()) == Some("task_parent"))
            .unwrap();
        assert!(parent
            .get("subtasks")
            .and_then(|value| value.as_sequence())
            .is_none_or(|subtasks| subtasks.is_empty()));
    }
}
