//! Goal milestone management commands for Tauri IPC
//!
//! These commands handle CRUD operations for milestones stored inline in a goal markdown file.

use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::Deserialize;
use tauri::State;

use crate::commands::vault::AppState;
use crate::error::AppError;
use crate::types::GoalTask;

const MILESTONES_HEADER: &str = "## Milestones";
const MILESTONE_ID_PREFIX: &str = "mil_";
const MILESTONE_ID_MARKER: &str = "id:";

#[derive(Debug, Clone)]
pub(crate) struct MilestoneEntry {
    id: String,
    title: String,
    done: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MilestoneCreate {
    pub title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MilestoneUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed: Option<bool>,
}

#[derive(Debug, Clone)]
pub(crate) struct GoalBodySections {
    pub(crate) notes: String,
    pub(crate) milestones: Vec<MilestoneEntry>,
    pub(crate) trailing: String,
    pub(crate) missing_ids: bool,
}

fn resolve_goal_file(vault_path: &str, goal_id: &str) -> Result<PathBuf, AppError> {
    let goals_dir = PathBuf::from(vault_path).join("goals");
    let flat_path = goals_dir.join(format!("{}.md", goal_id));
    if flat_path.exists() {
        return Ok(flat_path);
    }

    if goals_dir.exists() {
        for entry in std::fs::read_dir(&goals_dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let goal_dir = entry.path();
            let goal_file = goal_dir.join("goal.md");
            if !goal_file.exists() {
                continue;
            }
            let matches = std::fs::read_to_string(&goal_file)
                .ok()
                .and_then(|content| markdown_parser::parse_frontmatter(&content).ok())
                .and_then(|(fm, _)| fm.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()))
                .map(|id| id == goal_id)
                .unwrap_or(false);
            if matches {
                return Ok(goal_file);
            }
        }
    }

    Err(AppError::item_not_found("Goal", goal_id))
}

fn parse_milestone_line(line: &str) -> Option<(MilestoneEntry, bool)> {
    let trimmed = line.trim_start();
    let (done, rest) = if let Some(stripped) = trimmed.strip_prefix("- [x]") {
        (true, stripped)
    } else if let Some(stripped) = trimmed.strip_prefix("- [X]") {
        (true, stripped)
    } else if let Some(stripped) = trimmed.strip_prefix("- [ ]") {
        (false, stripped)
    } else {
        return None;
    };

    let mut title = rest.trim().to_string();
    let mut id = None;
    let mut had_id = false;

    if let Some(start) = title.find("<!--") {
        if let Some(end) = title[start..].find("-->") {
            let comment = title[start + 4..start + end].trim();
            if let Some(id_start) = comment.find(MILESTONE_ID_MARKER) {
                let value = comment[id_start + MILESTONE_ID_MARKER.len()..].trim();
                if !value.is_empty() {
                    id = Some(value.to_string());
                    had_id = true;
                }
            }
            title = format!(
                "{}{}",
                title[..start].trim_end(),
                title[start + end + 3..].trim_start()
            );
            title = title.trim().to_string();
        }
    }

    Some((
        MilestoneEntry {
            id: id.unwrap_or_else(|| {
                format!("{}{}", MILESTONE_ID_PREFIX, uuid::Uuid::new_v4().simple())
            }),
            title,
            done,
        },
        had_id,
    ))
}

fn format_milestone_line(entry: &MilestoneEntry) -> String {
    let checkbox = if entry.done { "- [x]" } else { "- [ ]" };
    format!(
        "{} {} <!-- {}{} -->",
        checkbox, entry.title, MILESTONE_ID_MARKER, entry.id
    )
}

pub(crate) fn split_goal_body(body: &str) -> GoalBodySections {
    let lines: Vec<&str> = body.lines().collect();
    let header_index = lines
        .iter()
        .position(|line| line.trim() == MILESTONES_HEADER);

    if header_index.is_none() {
        return GoalBodySections {
            notes: body.trim_end().to_string(),
            milestones: Vec::new(),
            trailing: String::new(),
            missing_ids: false,
        };
    }

    let header_index = header_index.unwrap();
    let mut end_index = lines.len();
    for (idx, line) in lines.iter().enumerate().skip(header_index + 1) {
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') {
            end_index = idx;
            break;
        }
    }

    let notes = lines[..header_index].join("\n").trim_end().to_string();
    let milestone_lines = &lines[header_index + 1..end_index];
    let trailing = lines[end_index..].join("\n").trim_end().to_string();

    let mut missing_ids = false;
    let milestones = milestone_lines
        .iter()
        .filter_map(|line| parse_milestone_line(line))
        .map(|(entry, had_id)| {
            if !had_id {
                missing_ids = true;
            }
            entry
        })
        .collect();

    GoalBodySections {
        notes,
        milestones,
        trailing,
        missing_ids,
    }
}

pub(crate) fn build_goal_body(sections: &GoalBodySections) -> String {
    let mut parts: Vec<String> = Vec::new();

    if !sections.notes.trim().is_empty() {
        parts.push(sections.notes.trim_end().to_string());
    }

    if !sections.milestones.is_empty() {
        let mut milestone_block = String::new();
        milestone_block.push_str(MILESTONES_HEADER);
        milestone_block.push('\n');
        for entry in &sections.milestones {
            milestone_block.push_str(&format_milestone_line(entry));
            milestone_block.push('\n');
        }
        parts.push(milestone_block.trim_end().to_string());
    }

    if !sections.trailing.trim().is_empty() {
        parts.push(sections.trailing.trim_end().to_string());
    }

    parts.join("\n\n")
}

fn load_goal_sections(
    path: &Path,
) -> Result<(markdown_parser::Frontmatter, GoalBodySections), AppError> {
    let content = std::fs::read_to_string(path)?;
    let (fm, body) = match markdown_parser::parse_frontmatter(&content) {
        Ok((frontmatter, body)) => (frontmatter, body),
        Err(markdown_parser::ParseError::MissingDelimiter) => {
            (markdown_parser::Frontmatter::new(), content)
        }
        Err(err) => return Err(err.into()),
    };

    Ok((fm, split_goal_body(&body)))
}

fn write_goal_sections(
    path: &Path,
    fm: &markdown_parser::Frontmatter,
    sections: &GoalBodySections,
) -> Result<(), AppError> {
    let body = build_goal_body(sections);
    let content = markdown_parser::serialize_frontmatter(fm, &body);
    std::fs::write(path, content)?;
    Ok(())
}

fn milestone_to_goal_task(entry: &MilestoneEntry) -> GoalTask {
    let now = Utc::now().to_rfc3339();
    GoalTask {
        id: entry.id.clone(),
        title: entry.title.clone(),
        column: if entry.done {
            "done".to_string()
        } else {
            "backlog".to_string()
        },
        points: 1,
        priority: "medium".to_string(),
        is_task: false,
        workspace_id: None,
        due_date: None,
        completed_at: None,
        completed_by: None,
        subtasks: Vec::new(),
        notes: None,
        publish_on_complete: false,
        recurring: None,
        recurrence_start: None,
        recurrence_end: None,
        created: now.clone(),
        updated: now,
    }
}

fn find_milestone_mut<'a>(
    milestones: &'a mut [MilestoneEntry],
    milestone_id: &str,
) -> Option<&'a mut MilestoneEntry> {
    milestones.iter_mut().find(|entry| entry.id == milestone_id)
}

/// List all milestones for a goal
#[tauri::command]
pub async fn list_goal_tasks(
    vault_id: String,
    goal_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<GoalTask>, AppError> {
    log::info!(
        "Listing milestones for goal '{}' in vault '{}'",
        goal_id,
        vault_id
    );

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let goal_file = resolve_goal_file(&vault_path, &goal_id)?;
    let (fm, sections) = load_goal_sections(&goal_file)?;
    if sections.missing_ids && !sections.milestones.is_empty() {
        write_goal_sections(&goal_file, &fm, &sections)?;
    }

    let tasks = sections
        .milestones
        .iter()
        .map(milestone_to_goal_task)
        .collect();

    Ok(tasks)
}

/// Get a specific milestone by ID
#[tauri::command]
pub async fn get_goal_task(
    vault_id: String,
    goal_id: String,
    task_id: String,
    state: State<'_, AppState>,
) -> Result<GoalTask, AppError> {
    log::info!(
        "Getting milestone '{}' from goal '{}' in vault '{}'",
        task_id,
        goal_id,
        vault_id
    );

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let goal_file = resolve_goal_file(&vault_path, &goal_id)?;
    let (_, sections) = load_goal_sections(&goal_file)?;

    let milestone = sections
        .milestones
        .into_iter()
        .find(|entry| entry.id == task_id)
        .ok_or_else(|| AppError::item_not_found("Milestone", &task_id))?;

    Ok(milestone_to_goal_task(&milestone))
}

/// Create a new milestone in a goal
#[tauri::command]
pub async fn create_goal_task(
    vault_id: String,
    goal_id: String,
    data: MilestoneCreate,
    state: State<'_, AppState>,
) -> Result<GoalTask, AppError> {
    log::info!(
        "Creating milestone '{}' in goal '{}' vault '{}'",
        data.title,
        goal_id,
        vault_id
    );

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let goal_file = resolve_goal_file(&vault_path, &goal_id)?;
    let (fm, mut sections) = load_goal_sections(&goal_file)?;

    let milestone = MilestoneEntry {
        id: format!("{}{}", MILESTONE_ID_PREFIX, uuid::Uuid::new_v4().simple()),
        title: data.title,
        done: false,
    };

    sections.milestones.push(milestone.clone());
    write_goal_sections(&goal_file, &fm, &sections)?;

    Ok(milestone_to_goal_task(&milestone))
}

/// Update an existing milestone
#[tauri::command]
pub async fn update_goal_task(
    vault_id: String,
    goal_id: String,
    task_id: String,
    data: MilestoneUpdate,
    state: State<'_, AppState>,
) -> Result<GoalTask, AppError> {
    log::info!(
        "Updating milestone '{}' in goal '{}' vault '{}'",
        task_id,
        goal_id,
        vault_id
    );

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let goal_file = resolve_goal_file(&vault_path, &goal_id)?;
    let (fm, mut sections) = load_goal_sections(&goal_file)?;

    let milestone_snapshot = {
        let milestone = find_milestone_mut(&mut sections.milestones, &task_id)
            .ok_or_else(|| AppError::item_not_found("Milestone", &task_id))?;

        if let Some(title) = data.title {
            milestone.title = title;
        }
        if let Some(completed) = data.completed {
            milestone.done = completed;
        }

        milestone.clone()
    };

    write_goal_sections(&goal_file, &fm, &sections)?;

    Ok(milestone_to_goal_task(&milestone_snapshot))
}

fn delete_milestone_from_sections(
    sections: &mut GoalBodySections,
    task_id: &str,
    confirmed: bool,
) -> Result<(), AppError> {
    if !confirmed {
        return Err(AppError::validation_error(
            "Deleting a goal milestone requires explicit confirmation",
        ));
    }

    let original_len = sections.milestones.len();
    sections.milestones.retain(|entry| entry.id != task_id);

    if sections.milestones.len() == original_len {
        return Err(AppError::item_not_found("Milestone", task_id));
    }

    Ok(())
}

/// Delete a milestone
#[tauri::command]
pub async fn delete_goal_task(
    vault_id: String,
    goal_id: String,
    task_id: String,
    confirmed: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    log::info!(
        "Deleting milestone '{}' from goal '{}' vault '{}'",
        task_id,
        goal_id,
        vault_id
    );

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let goal_file = resolve_goal_file(&vault_path, &goal_id)?;
    let (fm, mut sections) = load_goal_sections(&goal_file)?;

    delete_milestone_from_sections(&mut sections, &task_id, confirmed.unwrap_or(false))?;

    write_goal_sections(&goal_file, &fm, &sections)?;

    Ok(())
}

/// Move a milestone to a different column (maps to completed state)
#[tauri::command]
pub async fn move_goal_task(
    vault_id: String,
    goal_id: String,
    task_id: String,
    to_column: String,
    state: State<'_, AppState>,
) -> Result<GoalTask, AppError> {
    let completed = to_column == "done";
    let update = MilestoneUpdate {
        title: None,
        completed: Some(completed),
    };

    update_goal_task(vault_id, goal_id, task_id, update, state).await
}

/// Mark a milestone as complete
#[tauri::command]
pub async fn complete_goal_task(
    vault_id: String,
    goal_id: String,
    task_id: String,
    _completed_by: Option<String>,
    state: State<'_, AppState>,
) -> Result<GoalTask, AppError> {
    let update = MilestoneUpdate {
        title: None,
        completed: Some(true),
    };

    update_goal_task(vault_id, goal_id, task_id, update, state).await
}

#[cfg(test)]
mod tests {
    use super::{delete_milestone_from_sections, GoalBodySections, MilestoneEntry};

    fn sections_with_milestone() -> GoalBodySections {
        GoalBodySections {
            notes: String::new(),
            milestones: vec![MilestoneEntry {
                id: "mil_keep".to_string(),
                title: "Keep going".to_string(),
                done: false,
            }],
            trailing: String::new(),
            missing_ids: false,
        }
    }

    #[test]
    fn delete_milestone_rejects_missing_confirmation_without_changes() {
        let mut sections = sections_with_milestone();

        let error = delete_milestone_from_sections(&mut sections, "mil_keep", false)
            .expect_err("delete should require explicit confirmation");

        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error.message.contains("explicit confirmation"));
        assert_eq!(sections.milestones.len(), 1);
    }

    #[test]
    fn delete_milestone_allows_confirmed_remove() {
        let mut sections = sections_with_milestone();

        delete_milestone_from_sections(&mut sections, "mil_keep", true).unwrap();

        assert!(sections.milestones.is_empty());
    }
}
