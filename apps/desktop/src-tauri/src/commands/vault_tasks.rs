//! Vault task library commands for Tauri IPC
//!
//! These commands manage markdown task files stored under a vault-level tasks directory.

use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use tauri::State;

use crate::commands::vault::AppState;
use crate::error::AppError;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultTaskEntry {
    pub path: String,
    pub name: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<VaultTaskEntry>>,
}

fn vault_root(vault_path: &str) -> PathBuf {
    PathBuf::from(vault_path)
}

fn allowed_file_extensions() -> HashSet<&'static str> {
    [
        "md", "markdown", "mdx", "txt", "pdf", "png", "jpg", "jpeg", "gif", "svg", "webp", "heic",
        "tiff", "bmp", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "json", "yaml", "yml",
        "toml",
    ]
    .into_iter()
    .collect()
}

fn should_ignore_entry(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.starts_with('.')
        || matches!(
            lower.as_str(),
            ".vault.json" | ".goalrate" | ".git" | ".ds_store" | "node_modules"
        )
}

fn is_allowed_file(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    let allowed = allowed_file_extensions();
    allowed.contains(ext.to_lowercase().as_str())
}

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| matches!(ext.to_lowercase().as_str(), "md" | "markdown" | "mdx"))
        .unwrap_or(false)
}

fn is_internal_goal_store_stem(stem: &str) -> bool {
    if !stem.starts_with("goal_") {
        return false;
    }
    let suffix = &stem[5..];
    suffix.len() == 12 && suffix.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn should_hide_internal_goal_file(path: &Path, base: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(base) else {
        return false;
    };
    let mut components = relative.components();
    let Some(Component::Normal(first)) = components.next() else {
        return false;
    };
    if first != std::ffi::OsStr::new("goals") {
        return false;
    }
    let Some(Component::Normal(file_name_component)) = components.next() else {
        return false;
    };
    if components.next().is_some() {
        return false;
    }
    let Some(file_name) = file_name_component.to_str() else {
        return false;
    };
    let file_path = Path::new(file_name);
    let Some(ext) = file_path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    if !ext.eq_ignore_ascii_case("md") {
        return false;
    }
    let Some(stem) = file_path.file_stem().and_then(|value| value.to_str()) else {
        return false;
    };
    is_internal_goal_store_stem(stem)
}

fn sanitize_relative_path(path: &str) -> Result<PathBuf, AppError> {
    let mut sanitized = PathBuf::new();
    for component in Path::new(path).components() {
        match component {
            Component::Normal(part) => sanitized.push(part),
            Component::CurDir => {}
            _ => {
                return Err(AppError::validation_error(
                    "Invalid path segment in asset library path",
                ))
            }
        }
    }
    Ok(sanitized)
}

fn resolve_existing_task_entry_path(root: &Path, path: &str) -> Result<PathBuf, AppError> {
    let sanitized = sanitize_relative_path(path)?;
    if sanitized.as_os_str().is_empty() {
        return Err(AppError::validation_error(
            "Task entry path cannot be empty",
        ));
    }
    let entry_path = root.join(sanitized);
    if !entry_path.starts_with(root) {
        return Err(AppError::validation_error(
            "Task entry path must stay inside the vault",
        ));
    }
    if !entry_path.exists() {
        return Err(AppError::item_not_found("Task entry", path));
    }
    Ok(entry_path)
}

fn delete_task_entry_at_root(root: &Path, path: &str, confirmed: bool) -> Result<(), AppError> {
    if !confirmed {
        return Err(AppError::validation_error(
            "Deleting a vault task entry requires explicit confirmation",
        ));
    }

    let entry_path = resolve_existing_task_entry_path(root, path)?;

    if entry_path.is_dir() {
        std::fs::remove_dir_all(entry_path)?;
    } else {
        std::fs::remove_file(entry_path)?;
    }

    Ok(())
}

fn validate_entry_name(name: &str) -> Result<(), AppError> {
    if name.trim().is_empty() {
        return Err(AppError::validation_error("Name cannot be empty"));
    }
    if name.contains('/') || name.contains('\\') {
        return Err(AppError::validation_error(
            "Name cannot contain path separators",
        ));
    }
    Ok(())
}

const TASK_FILE_STEM_MAX_CHARS: usize = 60;
const UNTITLED_TASK_STEM: &str = "Untitled Task";

fn is_invalid_task_file_char(value: char) -> bool {
    matches!(
        value,
        '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '.'
    )
}

fn trim_task_file_stem(value: &str) -> String {
    value
        .trim_matches(|c: char| c.is_whitespace() || c == '-')
        .to_string()
}

fn truncate_task_file_stem(value: &str, max_chars: usize) -> String {
    let char_count = value.chars().count();
    if char_count <= max_chars {
        return trim_task_file_stem(value);
    }

    let hard_truncated: String = value.chars().take(max_chars).collect();
    let hard_trimmed = hard_truncated.trim_end();

    let boundary_truncated = if let Some(boundary_index) = hard_trimmed.rfind(' ') {
        if boundary_index > 0 {
            &hard_trimmed[..boundary_index]
        } else {
            hard_trimmed
        }
    } else {
        hard_trimmed
    };

    let cleaned_boundary = trim_task_file_stem(boundary_truncated);
    if !cleaned_boundary.is_empty() {
        return cleaned_boundary;
    }

    trim_task_file_stem(hard_trimmed)
}

fn sanitize_file_stem(value: &str) -> String {
    let replaced: String = value
        .chars()
        .map(|ch| {
            if is_invalid_task_file_char(ch) {
                '-'
            } else {
                ch
            }
        })
        .collect();
    let collapsed_whitespace = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    let truncated = truncate_task_file_stem(&collapsed_whitespace, TASK_FILE_STEM_MAX_CHARS);
    if truncated.is_empty() {
        UNTITLED_TASK_STEM.to_string()
    } else {
        truncated
    }
}

fn file_name_for_attempt(stem: &str, extension: &str, attempt: usize) -> String {
    let suffix = if attempt == 0 {
        String::new()
    } else {
        format!(" ({})", attempt + 1)
    };
    format!("{}{}{}", stem, suffix, extension)
}

fn to_relative_string(path: &Path, base: &Path) -> Result<String, AppError> {
    let rel = path
        .strip_prefix(base)
        .map_err(|_| AppError::validation_error("Failed to compute relative path"))?;
    Ok(rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/"))
}

fn build_tree(dir: &Path, base: &Path) -> Result<Vec<VaultTaskEntry>, AppError> {
    let mut entries = Vec::new();

    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        if should_ignore_entry(&file_name) {
            continue;
        }
        if path.is_file() && should_hide_internal_goal_file(&path, base) {
            continue;
        }

        if path.is_dir() {
            let children = build_tree(&path, base)?;
            entries.push(VaultTaskEntry {
                path: to_relative_string(&path, base)?,
                name: file_name,
                kind: "folder".to_string(),
                extension: None,
                children: Some(children),
            });
        } else if is_allowed_file(&path) {
            let extension = path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.to_lowercase());
            let name = if extension
                .as_deref()
                .map(|ext| ext == "md" || ext == "markdown" || ext == "mdx")
                .unwrap_or(false)
            {
                path.file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or(file_name.clone())
            } else {
                file_name.clone()
            };
            entries.push(VaultTaskEntry {
                path: to_relative_string(&path, base)?,
                name,
                kind: "file".to_string(),
                extension,
                children: None,
            });
        }
    }

    entries.sort_by(|a, b| {
        let kind_order = |kind: &str| if kind == "folder" { 0 } else { 1 };
        let kind_cmp = kind_order(&a.kind).cmp(&kind_order(&b.kind));
        if kind_cmp == std::cmp::Ordering::Equal {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        } else {
            kind_cmp
        }
    });

    Ok(entries)
}

#[tauri::command]
pub async fn list_vault_tasks(
    vault_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<VaultTaskEntry>, AppError> {
    log::info!("Listing asset library entries for vault '{}'", vault_id);

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let root = vault_root(&vault_path);
    build_tree(&root, &root)
}

#[tauri::command]
pub async fn create_vault_task_folder(
    vault_id: String,
    parent_path: Option<String>,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    validate_entry_name(&name)?;

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let root = vault_root(&vault_path);

    let parent = match parent_path {
        Some(path) => root.join(sanitize_relative_path(&path)?),
        None => root.clone(),
    };

    if !parent.exists() {
        return Err(AppError::validation_error("Parent folder does not exist"));
    }

    let target = parent.join(name);
    std::fs::create_dir(&target)?;
    Ok(())
}

#[tauri::command]
pub async fn create_vault_task_file(
    vault_id: String,
    parent_path: Option<String>,
    name: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    validate_entry_name(&name)?;

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let root = vault_root(&vault_path);

    let parent = match parent_path {
        Some(path) => root.join(sanitize_relative_path(&path)?),
        None => root.clone(),
    };

    if !parent.exists() {
        return Err(AppError::validation_error("Parent folder does not exist"));
    }

    let (raw_stem, extension) = if name.ends_with(".md") {
        (name.trim_end_matches(".md").to_string(), ".md".to_string())
    } else {
        (name, ".md".to_string())
    };
    let stem = sanitize_file_stem(&raw_stem);

    for attempt in 0..20 {
        let file_name = file_name_for_attempt(&stem, &extension, attempt);
        let target = parent.join(file_name);
        if target.exists() {
            continue;
        }

        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        match options.open(&target) {
            Ok(mut file) => {
                use std::io::Write;
                file.write_all(content.as_bytes())?;
                return Ok(());
            }
            Err(err) if err.kind() == ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(err.into()),
        }
    }

    Err(AppError::validation_error(
        "Failed to create a unique task file",
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        delete_task_entry_at_root, file_name_for_attempt, is_internal_goal_store_stem,
        sanitize_file_stem, should_hide_internal_goal_file, TASK_FILE_STEM_MAX_CHARS,
        UNTITLED_TASK_STEM,
    };
    use std::path::PathBuf;
    use tempfile::TempDir;

    #[test]
    fn sanitize_file_stem_replaces_dot_and_invalid_characters() {
        assert_eq!(
            sanitize_file_stem(r#"Fix v2.0 bug / auth: "login""#),
            "Fix v2-0 bug - auth- -login"
        );
    }

    #[test]
    fn sanitize_file_stem_truncates_at_word_boundary() {
        let title = "This filename has many words and should truncate before it cuts a word";
        let sanitized = sanitize_file_stem(title);
        assert_eq!(
            sanitized,
            "This filename has many words and should truncate before it"
        );
        assert!(sanitized.chars().count() <= TASK_FILE_STEM_MAX_CHARS);
    }

    #[test]
    fn sanitize_file_stem_falls_back_when_stem_becomes_empty() {
        assert_eq!(sanitize_file_stem("...."), UNTITLED_TASK_STEM);
        assert_eq!(sanitize_file_stem(r#"////:::""#), UNTITLED_TASK_STEM);
    }

    #[test]
    fn file_name_for_attempt_appends_suffix_after_sanitized_stem() {
        let stem = "A".repeat(TASK_FILE_STEM_MAX_CHARS);
        assert_eq!(
            file_name_for_attempt(&stem, ".md", 0),
            format!("{}.md", stem)
        );
        assert_eq!(
            file_name_for_attempt(&stem, ".md", 1),
            format!("{} (2).md", stem)
        );
    }

    #[test]
    fn internal_goal_store_stem_matches_expected_pattern() {
        assert!(is_internal_goal_store_stem("goal_a0e14d28e81a"));
        assert!(!is_internal_goal_store_stem("goal_nothexvalue"));
        assert!(!is_internal_goal_store_stem("InventoryApp"));
    }

    #[test]
    fn hides_only_top_level_internal_goal_store_files() {
        let base = PathBuf::from("/vault");
        assert!(should_hide_internal_goal_file(
            &base.join("goals/goal_a0e14d28e81a.md"),
            &base
        ));
        assert!(!should_hide_internal_goal_file(
            &base.join("goals/InventoryApp.md"),
            &base
        ));
        assert!(!should_hide_internal_goal_file(
            &base.join("goals/InventoryApp/goal_a0e14d28e81a.md"),
            &base
        ));
    }

    #[test]
    fn delete_task_entry_rejects_missing_confirmation_without_file_changes() {
        let temp = TempDir::new().unwrap();
        let file_path = temp.path().join("tasks").join("draft.md");
        std::fs::create_dir_all(file_path.parent().unwrap()).unwrap();
        std::fs::write(&file_path, "draft").unwrap();

        let error = delete_task_entry_at_root(temp.path(), "tasks/draft.md", false)
            .expect_err("delete should require explicit confirmation");

        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error.message.contains("explicit confirmation"));
        assert_eq!(std::fs::read_to_string(file_path).unwrap(), "draft");
    }

    #[test]
    fn delete_task_entry_rejects_empty_path_without_deleting_vault_root() {
        let temp = TempDir::new().unwrap();
        let file_path = temp.path().join("tasks").join("draft.md");
        std::fs::create_dir_all(file_path.parent().unwrap()).unwrap();
        std::fs::write(&file_path, "draft").unwrap();

        let error = delete_task_entry_at_root(temp.path(), "", true)
            .expect_err("empty path should not resolve to the vault root");

        assert_eq!(error.code, "VALIDATION_ERROR");
        assert!(error.message.contains("cannot be empty"));
        assert!(temp.path().exists());
        assert!(file_path.exists());
    }

    #[test]
    fn delete_task_entry_allows_confirmed_file_delete() {
        let temp = TempDir::new().unwrap();
        let file_path = temp.path().join("tasks").join("draft.md");
        std::fs::create_dir_all(file_path.parent().unwrap()).unwrap();
        std::fs::write(&file_path, "draft").unwrap();

        delete_task_entry_at_root(temp.path(), "tasks/draft.md", true).unwrap();

        assert!(!file_path.exists());
        assert!(temp.path().join("tasks").exists());
    }

    #[test]
    fn delete_task_entry_allows_confirmed_folder_delete() {
        let temp = TempDir::new().unwrap();
        let folder_path = temp.path().join("tasks").join("nested");
        std::fs::create_dir_all(&folder_path).unwrap();
        std::fs::write(folder_path.join("draft.md"), "draft").unwrap();

        delete_task_entry_at_root(temp.path(), "tasks/nested", true).unwrap();

        assert!(!folder_path.exists());
        assert!(temp.path().join("tasks").exists());
    }
}

#[tauri::command]
pub async fn read_vault_task_file(
    vault_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let root = vault_root(&vault_path);
    let file_path = root.join(sanitize_relative_path(&path)?);

    if !file_path.exists() {
        return Err(AppError::item_not_found("Task file", &path));
    }
    if !is_markdown_file(&file_path) {
        return Err(AppError::validation_error(
            "Only markdown files can be opened in the editor",
        ));
    }

    Ok(std::fs::read_to_string(&file_path)?)
}

#[tauri::command]
pub async fn update_vault_task_file(
    vault_id: String,
    path: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let root = vault_root(&vault_path);
    let file_path = root.join(sanitize_relative_path(&path)?);

    if !file_path.exists() {
        return Err(AppError::item_not_found("Task file", &path));
    }
    if !is_markdown_file(&file_path) {
        return Err(AppError::validation_error(
            "Only markdown files can be edited",
        ));
    }

    std::fs::write(&file_path, content)?;
    Ok(())
}

#[tauri::command]
pub async fn rename_vault_task_entry(
    vault_id: String,
    path: String,
    new_name: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    validate_entry_name(&new_name)?;

    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let root = vault_root(&vault_path);
    let entry_path = root.join(sanitize_relative_path(&path)?);

    if !entry_path.exists() {
        return Err(AppError::item_not_found("Task entry", &path));
    }

    let parent = entry_path
        .parent()
        .ok_or_else(|| AppError::validation_error("Invalid entry path"))?;

    let new_path = if entry_path.is_file() {
        let new_path = if new_name.contains('.') {
            parent.join(new_name)
        } else if let Some(ext) = entry_path
            .extension()
            .and_then(|value: &std::ffi::OsStr| value.to_str())
        {
            parent.join(format!("{}.{}", new_name, ext))
        } else {
            parent.join(new_name)
        };
        new_path
    } else {
        parent.join(new_name)
    };

    std::fs::rename(&entry_path, &new_path)?;
    Ok(())
}

#[tauri::command]
pub async fn delete_vault_task_entry(
    vault_id: String,
    path: String,
    confirmed: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let root = vault_root(&vault_path);
    delete_task_entry_at_root(&root, &path, confirmed.unwrap_or(false))
}

#[tauri::command]
pub async fn move_vault_task_entry(
    vault_id: String,
    path: String,
    destination_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let root = vault_root(&vault_path);
    let entry_path = root.join(sanitize_relative_path(&path)?);

    if !entry_path.exists() {
        return Err(AppError::item_not_found("Library entry", &path));
    }

    let destination_dir = match destination_path {
        Some(path) => root.join(sanitize_relative_path(&path)?),
        None => root.clone(),
    };

    if !destination_dir.exists() || !destination_dir.is_dir() {
        return Err(AppError::validation_error(
            "Destination folder does not exist",
        ));
    }
    if entry_path.is_dir() && destination_dir.starts_with(&entry_path) {
        return Err(AppError::validation_error(
            "Cannot move a folder into itself",
        ));
    }

    let file_name = entry_path
        .file_name()
        .ok_or_else(|| AppError::validation_error("Invalid entry path"))?;
    let target_path = destination_dir.join(file_name);
    if target_path == entry_path {
        return Ok(());
    }
    if target_path.exists() {
        return Err(AppError::validation_error(
            "An entry with the same name already exists in the destination",
        ));
    }

    std::fs::rename(&entry_path, &target_path)?;
    Ok(())
}

#[tauri::command]
pub async fn open_vault_task_entry(
    vault_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let vaults = state.vaults.lock().unwrap();
    let manager = vaults
        .get(&vault_id)
        .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

    let vault_path = manager.config().path.clone();
    let root = vault_root(&vault_path);
    let entry_path = root.join(sanitize_relative_path(&path)?);

    if !entry_path.exists() {
        return Err(AppError::item_not_found("Library entry", &path));
    }

    open::that(&entry_path)
        .map_err(|err| AppError::validation_error(format!("Failed to open entry: {}", err)))?;

    Ok(())
}
