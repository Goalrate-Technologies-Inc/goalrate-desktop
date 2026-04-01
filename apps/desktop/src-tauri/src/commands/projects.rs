//! Project management commands for Tauri IPC
//!
//! These commands handle CRUD operations for projects.

use tauri::State;

use crate::commands::vault::AppState;
use crate::error::AppError;
use crate::types::{Project, ProjectCreate, ProjectUpdate};

/// List all projects in a vault
#[tauri::command]
pub async fn list_projects(
    vault_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<Project>, AppError> {
    log::info!("Listing projects for vault '{}'", vault_id);

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let project_ids = manager.list_projects()?;

    let mut projects = Vec::new();
    for project_id in project_ids {
        match manager.read_project(&project_id) {
            Ok((fm, body)) => match Project::from_frontmatter(&fm, &body) {
                Ok(project) => projects.push(project),
                Err(e) => log::warn!("Failed to parse project '{}': {}", project_id, e),
            },
            Err(e) => log::warn!("Failed to read project '{}': {}", project_id, e),
        }
    }

    Ok(projects)
}

/// Get a specific project by ID
#[tauri::command]
pub async fn get_project(
    vault_id: String,
    project_id: String,
    state: State<'_, AppState>,
) -> Result<Project, AppError> {
    log::info!("Getting project '{}' from vault '{}'", project_id, vault_id);

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let (fm, body) = manager.read_project(&project_id)?;
    let project = Project::from_frontmatter(&fm, &body)?;

    Ok(project)
}

/// Create a new project
#[tauri::command]
pub async fn create_project(
    vault_id: String,
    data: ProjectCreate,
    state: State<'_, AppState>,
) -> Result<Project, AppError> {
    log::info!("Creating project '{}' in vault '{}'", data.name, vault_id);

    let project = data.into_project();
    let project_id = project.id.clone();

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let (fm, body) = project.to_frontmatter();
    manager.write_project(&project_id, &fm, &body)?;

    Ok(project)
}

/// Update an existing project
#[tauri::command]
pub async fn update_project(
    vault_id: String,
    project_id: String,
    data: ProjectUpdate,
    state: State<'_, AppState>,
) -> Result<Project, AppError> {
    log::info!("Updating project '{}' in vault '{}'", project_id, vault_id);

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    // Read existing project
    let (fm, body) = manager.read_project(&project_id)?;
    let existing = Project::from_frontmatter(&fm, &body)?;

    // Apply updates
    let updated = data.apply_to(existing);

    // Write back
    let (fm, body) = updated.to_frontmatter();
    manager.write_project(&project_id, &fm, &body)?;

    Ok(updated)
}

/// Delete a project
#[tauri::command]
pub async fn delete_project(
    vault_id: String,
    project_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    log::info!(
        "Deleting project '{}' from vault '{}'",
        project_id,
        vault_id
    );

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    manager.delete_project(&project_id)?;

    Ok(())
}

/// Archive a project (set status to archived)
#[tauri::command]
pub async fn archive_project(
    vault_id: String,
    project_id: String,
    state: State<'_, AppState>,
) -> Result<Project, AppError> {
    log::info!("Archiving project '{}' in vault '{}'", project_id, vault_id);

    let update = ProjectUpdate {
        status: Some("archived".to_string()),
        name: None,
        key: None,
        description: None,
        priority: None,
        project_type: None,
        tags: None,
        start_date: None,
        target_completion_date: None,
        notes: None,
    };

    update_project(vault_id, project_id, update, state).await
}
