//! Project task management commands for Tauri IPC
//!
//! These commands handle CRUD operations for tasks within projects.

use chrono::Utc;
use std::path::PathBuf;
use tauri::State;

use crate::commands::vault::AppState;
use crate::error::AppError;
use crate::types::{ProjectTask, ProjectTaskCreate, ProjectTaskUpdate};

/// Get the tasks directory path for a project
fn get_tasks_dir(vault_path: &str, project_id: &str) -> PathBuf {
    PathBuf::from(vault_path)
        .join("projects")
        .join(project_id)
        .join("tasks")
}

/// Get the path for a specific task file
fn get_task_path(vault_path: &str, project_id: &str, task_id: &str) -> PathBuf {
    get_tasks_dir(vault_path, project_id).join(format!("{}.md", task_id))
}

/// List all tasks for a project
#[tauri::command]
pub async fn list_project_tasks(
    vault_id: String,
    project_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ProjectTask>, AppError> {
    log::info!(
        "Listing tasks for project '{}' in vault '{}'",
        project_id,
        vault_id
    );

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let tasks_dir = get_tasks_dir(&vault_path, &project_id);

    if !tasks_dir.exists() {
        return Ok(vec![]);
    }

    let mut tasks = Vec::new();

    for entry in std::fs::read_dir(&tasks_dir)? {
        let entry = entry?;
        let path = entry.path();

        if path.extension().map(|e| e == "md").unwrap_or(false) {
            match std::fs::read_to_string(&path) {
                Ok(content) => match markdown_parser::parse_frontmatter(&content) {
                    Ok((fm, body)) => match ProjectTask::from_frontmatter(&fm, &body) {
                        Ok(task) => tasks.push(task),
                        Err(e) => log::warn!("Failed to parse task {:?}: {}", path, e),
                    },
                    Err(e) => log::warn!("Failed to parse frontmatter {:?}: {}", path, e),
                },
                Err(e) => log::warn!("Failed to read task file {:?}: {}", path, e),
            }
        }
    }

    // Sort by column order (backlog, doing, done) then by priority
    let column_order = |col: &str| match col {
        "backlog" => 0,
        "doing" => 1,
        "done" => 2,
        _ => 3,
    };

    let priority_order = |p: &str| match p {
        "critical" => 0,
        "high" => 1,
        "medium" => 2,
        "low" => 3,
        _ => 4,
    };

    tasks.sort_by(|a, b| {
        let col_cmp = column_order(&a.column).cmp(&column_order(&b.column));
        if col_cmp != std::cmp::Ordering::Equal {
            return col_cmp;
        }
        priority_order(&a.priority).cmp(&priority_order(&b.priority))
    });

    Ok(tasks)
}

/// Get a specific task by ID
#[tauri::command]
pub async fn get_project_task(
    vault_id: String,
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<ProjectTask, AppError> {
    log::info!(
        "Getting task '{}' from project '{}' in vault '{}'",
        task_id,
        project_id,
        vault_id
    );

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let task_path = get_task_path(&vault_path, &project_id, &task_id);

    if !task_path.exists() {
        return Err(AppError::item_not_found("Task", &task_id));
    }

    let content = std::fs::read_to_string(&task_path)?;
    let (fm, body) = markdown_parser::parse_frontmatter(&content)?;
    let task = ProjectTask::from_frontmatter(&fm, &body)?;

    Ok(task)
}

/// Create a new task in a project
#[tauri::command]
pub async fn create_project_task(
    vault_id: String,
    project_id: String,
    data: ProjectTaskCreate,
    state: State<'_, AppState>,
) -> Result<ProjectTask, AppError> {
    log::info!(
        "Creating task '{}' in project '{}' vault '{}'",
        data.title,
        project_id,
        vault_id
    );

    let task = data.into_task();
    let task_id = task.id.clone();

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let tasks_dir = get_tasks_dir(&vault_path, &project_id);
    let task_path = get_task_path(&vault_path, &project_id, &task_id);

    // Ensure tasks directory exists
    std::fs::create_dir_all(&tasks_dir)?;

    // Write task file
    let (fm, body) = task.to_frontmatter();
    let content = markdown_parser::serialize_frontmatter(&fm, &body);
    std::fs::write(&task_path, content)?;

    Ok(task)
}

/// Update an existing task
#[tauri::command]
pub async fn update_project_task(
    vault_id: String,
    project_id: String,
    task_id: String,
    data: ProjectTaskUpdate,
    state: State<'_, AppState>,
) -> Result<ProjectTask, AppError> {
    log::info!(
        "Updating task '{}' in project '{}' vault '{}'",
        task_id,
        project_id,
        vault_id
    );

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let task_path = get_task_path(&vault_path, &project_id, &task_id);

    if !task_path.exists() {
        return Err(AppError::item_not_found("Task", &task_id));
    }

    // Read existing task
    let content = std::fs::read_to_string(&task_path)?;
    let (fm, body) = markdown_parser::parse_frontmatter(&content)?;
    let existing = ProjectTask::from_frontmatter(&fm, &body)?;

    // Apply updates
    let updated = data.apply_to(existing);

    // Write back
    let (new_fm, new_body) = updated.to_frontmatter();
    let new_content = markdown_parser::serialize_frontmatter(&new_fm, &new_body);
    std::fs::write(&task_path, new_content)?;

    Ok(updated)
}

/// Delete a task
#[tauri::command]
pub async fn delete_project_task(
    vault_id: String,
    project_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    log::info!(
        "Deleting task '{}' from project '{}' vault '{}'",
        task_id,
        project_id,
        vault_id
    );

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let task_path = get_task_path(&vault_path, &project_id, &task_id);

    if !task_path.exists() {
        return Err(AppError::item_not_found("Task", &task_id));
    }

    std::fs::remove_file(&task_path)?;

    Ok(())
}

/// Move a task to a different column
#[tauri::command]
pub async fn move_project_task(
    vault_id: String,
    project_id: String,
    task_id: String,
    to_column: String,
    state: State<'_, AppState>,
) -> Result<ProjectTask, AppError> {
    log::info!(
        "Moving task '{}' to column '{}' in project '{}' vault '{}'",
        task_id,
        to_column,
        project_id,
        vault_id
    );

    let update = ProjectTaskUpdate {
        column: Some(to_column),
        title: None,
        points: None,
        priority: None,
        due_date: None,
        completed_at: None,
        completed_by: None,
        subtasks: None,
        notes: None,
    };

    update_project_task(vault_id, project_id, task_id, update, state).await
}

/// Mark a task as complete
#[tauri::command]
pub async fn complete_project_task(
    vault_id: String,
    project_id: String,
    task_id: String,
    completed_by: Option<String>,
    state: State<'_, AppState>,
) -> Result<ProjectTask, AppError> {
    log::info!(
        "Completing task '{}' in project '{}' vault '{}'",
        task_id,
        project_id,
        vault_id
    );

    let update = ProjectTaskUpdate {
        column: Some("done".to_string()),
        completed_at: Some(Utc::now().to_rfc3339()),
        completed_by,
        title: None,
        points: None,
        priority: None,
        due_date: None,
        subtasks: None,
        notes: None,
    };

    update_project_task(vault_id, project_id, task_id, update, state).await
}

#[cfg(test)]
mod tests {
    // Tests would require a Tauri runtime context
}
