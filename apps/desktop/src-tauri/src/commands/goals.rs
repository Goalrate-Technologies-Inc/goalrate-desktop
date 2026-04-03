//! Goal management commands for Tauri IPC
//!
//! These commands handle CRUD operations for SMART goals.

use tauri::State;

use crate::commands::goal_milestones::{build_goal_body, split_goal_body};
use crate::commands::vault::AppState;
use crate::error::{AppError, ErrorCode};
use crate::types::{Goal, GoalCreate, GoalUpdate};

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

    let goal_ids = manager.list_goals()?;

    let mut goals = Vec::new();
    for goal_id in goal_ids {
        match manager.read_goal(&goal_id) {
            Ok((fm, body)) => {
                let sections = split_goal_body(&body);
                match Goal::from_frontmatter(&fm, &sections.notes) {
                    Ok(goal) => goals.push(goal),
                    Err(e) => log::warn!("Failed to parse goal '{}': {}", goal_id, e),
                }
            }
            Err(e) => log::warn!("Failed to read goal '{}': {}", goal_id, e),
        }
    }

    Ok(goals)
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
    let goal = Goal::from_frontmatter(&fm, &sections.notes)?;

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

    // Inject tasks into frontmatter if provided
    if !intake_tasks.is_empty() {
        let task_entries: Vec<serde_yaml::Value> = intake_tasks
            .iter()
            .map(|t| {
                let mut map = serde_yaml::Mapping::new();
                let task_id = format!(
                    "task_{}",
                    uuid::Uuid::new_v4().to_string().replace("-", "")[..8].to_string()
                );
                map.insert("id".into(), serde_yaml::Value::String(task_id));
                map.insert("title".into(), serde_yaml::Value::String(t.title.clone()));
                map.insert(
                    "status".into(),
                    serde_yaml::Value::String(
                        t.status.clone().unwrap_or_else(|| "todo".to_string()),
                    ),
                );
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

    // Read existing goal
    let (fm, body) = manager.read_goal(&goal_id)?;
    let mut sections = split_goal_body(&body);
    let existing = Goal::from_frontmatter(&fm, &sections.notes)?;

    // Apply updates
    let updated = data.apply_to(existing);

    // Write back, preserving frontmatter keys that to_frontmatter() doesn't include (e.g. tasks)
    let (mut new_fm, new_body) = updated.to_frontmatter();
    // Preserve "tasks" from original frontmatter (intake-created tasks)
    if let Some(tasks_val) = fm.get("tasks") {
        new_fm.insert("tasks".into(), tasks_val.clone());
    }
    sections.notes = new_body;
    let merged_body = build_goal_body(&sections);
    manager.write_goal(&goal_id, &new_fm, &merged_body)?;

    Ok(updated)
}

/// Delete a goal
#[tauri::command]
pub async fn delete_goal(
    vault_id: String,
    goal_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    log::info!("Deleting goal '{}' from vault '{}'", goal_id, vault_id);

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    manager.delete_goal(&goal_id)?;

    Ok(())
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
    pub recurring: Option<String>,
    pub completed_at: Option<String>,
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

    let (fm, _body) = manager.read_goal(&goal_id)?;
    let tasks = fm
        .get("tasks")
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|tv| {
                    let id = tv.get("id").and_then(|v| v.as_str())?.to_string();
                    let title = tv.get("title").and_then(|v| v.as_str())?.to_string();
                    let status = tv
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("todo")
                        .to_string();
                    let parent_id = tv
                        .get("parent_id")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let recurring = tv
                        .get("recurring")
                        .and_then(|v| {
                            v.as_str().map(|s| s.to_string()).or_else(|| {
                                v.as_bool()
                                    .map(|b| if b { "true".to_string() } else { String::new() })
                            })
                        })
                        .filter(|s| !s.is_empty());
                    let completed_at = tv
                        .get("completed_at")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    Some(GoalFrontmatterTask {
                        id,
                        title,
                        status,
                        parent_id,
                        recurring,
                        completed_at,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(tasks)
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

    let (mut fm, body) = manager.read_goal(&goal_id)?;
    let mut task_seq = fm
        .get("tasks")
        .and_then(|v| v.as_sequence().cloned())
        .unwrap_or_default();

    let task_id = format!(
        "task_{}",
        uuid::Uuid::new_v4().to_string().replace('-', "")[..8].to_string()
    );
    let mut map = serde_yaml::Mapping::new();
    map.insert("id".into(), serde_yaml::Value::String(task_id.clone()));
    map.insert("title".into(), serde_yaml::Value::String(title.clone()));
    map.insert(
        "status".into(),
        serde_yaml::Value::String("todo".to_string()),
    );
    if let Some(ref pid) = parent_id {
        map.insert("parent_id".into(), serde_yaml::Value::String(pid.clone()));
    }
    task_seq.push(serde_yaml::Value::Mapping(map));
    fm.insert("tasks".into(), serde_yaml::Value::Sequence(task_seq));
    manager.write_goal(&goal_id, &fm, &body)?;

    Ok(GoalFrontmatterTask {
        id: task_id,
        title,
        status: "todo".to_string(),
        parent_id,
        recurring: None,
        completed_at: None,
    })
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

    let (mut fm, body) = manager.read_goal(&goal_id)?;
    if let Some(task_seq) = fm.get_mut("tasks").and_then(|v| v.as_sequence_mut()) {
        let found = task_seq.iter_mut().any(|tv| {
            let matches = tv.get("id").and_then(|v| v.as_str()) == Some(&task_id);
            if matches {
                if let Some(map) = tv.as_mapping_mut() {
                    map.insert("title".into(), serde_yaml::Value::String(title.clone()));
                }
            }
            matches
        });
        if !found {
            return Err(AppError::item_not_found("Task", &task_id));
        }
    } else {
        return Err(AppError::item_not_found("Task", &task_id));
    }

    manager.write_goal(&goal_id, &fm, &body)?;
    Ok(())
}

/// Delete a task from a goal's frontmatter
#[tauri::command]
pub async fn delete_goal_frontmatter_task(
    vault_id: String,
    goal_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let (mut fm, body) = manager.read_goal(&goal_id)?;
    if let Some(task_seq) = fm.get_mut("tasks").and_then(|v| v.as_sequence_mut()) {
        let original_len = task_seq.len();
        // Remove the task and any children that have it as parent_id
        task_seq.retain(|tv| {
            let tid = tv.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let pid = tv.get("parent_id").and_then(|v| v.as_str()).unwrap_or("");
            tid != task_id && pid != task_id
        });
        if task_seq.len() == original_len {
            return Err(AppError::item_not_found("Task", &task_id));
        }
    } else {
        return Err(AppError::item_not_found("Task", &task_id));
    }

    manager.write_goal(&goal_id, &fm, &body)?;
    Ok(())
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

        // 1. Migrate objective/description/specific → type
        if fm.get("type").is_none() {
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

            let goal_type = if is_category && !old_value.is_empty() {
                old_value.clone()
            } else {
                // Try first tag as type
                fm.get("tags")
                    .and_then(|v| v.as_sequence())
                    .and_then(|seq| seq.first())
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "Personal".to_string())
            };

            fm.insert("type".into(), serde_yaml::Value::String(goal_type.clone()));
            goal_changes.push(format!("type={goal_type}"));

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
        if fm.get("start_date").is_none() {
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
        if fm.get("confidence").is_none() {
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
        if fm.get("why").is_none() {
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
    // Tests would require a Tauri runtime context
    // See vault.rs for test patterns
}
