//! Vault manager implementation

use chrono::Utc;
use std::collections::HashSet;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use crate::{VaultConfig, VaultError, VaultResult, VaultType};

/// Directory structure within a vault
#[derive(Debug, Clone)]
pub struct VaultStructure {
    /// Root vault directory
    pub root: PathBuf,
    /// Goals directory
    pub goals: PathBuf,
    /// Domain metadata directory (reserved; domains are inferred from goals in v1)
    pub domains: PathBuf,
    /// Agenda markdown directory
    pub agenda: PathBuf,
    /// Root task compatibility directory. V1 tasks are embedded in goal markdown,
    /// but this folder keeps the vault shape obvious and forwards-compatible.
    pub tasks: PathBuf,
    /// User-readable logs directory
    pub logs: PathBuf,
    /// User-readable system metadata directory
    pub system: PathBuf,
    /// Focus files directory
    pub focus: PathBuf,
    /// App-managed cache directory
    pub cache: PathBuf,
    /// SQLite index file
    pub index: PathBuf,
    /// Vault config file
    pub config: PathBuf,
    /// Internal goalrate directory
    pub goalrate_dir: PathBuf,
    /// Append-only markdown error log
    pub error_log: PathBuf,
    /// Append-only markdown mutation log
    pub mutation_log: PathBuf,
    /// Snapshot directory for pre-write copies
    pub snapshots: PathBuf,
}

/// Result returned when a vault snapshot is restored.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRestoreResult {
    /// Vault-relative path that was restored.
    pub restored_path: String,
    /// Vault-relative snapshot path used as the restore source.
    pub snapshot_path: String,
}

/// Read-only preview of restoring a vault snapshot.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotPreview {
    /// Vault-relative path that would be restored.
    pub target_path: String,
    /// Vault-relative snapshot path used as the restore source.
    pub snapshot_path: String,
    /// Whether the target file currently exists.
    pub current_exists: bool,
    /// Lines that would be added from the snapshot content.
    pub added_lines: usize,
    /// Lines that would be removed from the current content.
    pub removed_lines: usize,
    /// Lines shared by current and restored content.
    pub unchanged_lines: usize,
    /// Bounded excerpt of the current file content.
    pub current_excerpt: String,
    /// Bounded excerpt of the snapshot content to restore.
    pub restored_excerpt: String,
}

/// A restorable snapshot recorded in `system/mutations.md`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotHistoryEntry {
    /// Timestamp copied from the mutation log heading.
    pub created_at: String,
    /// Actor that caused the original mutation.
    pub actor: String,
    /// Action that caused the original mutation.
    pub action: String,
    /// Vault-relative path the snapshot can restore.
    pub target_path: String,
    /// Vault-relative snapshot file path.
    pub snapshot_path: String,
}

/// A parse or validation issue recorded in `logs/errors.md`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultErrorLogEntry {
    /// Timestamp copied from the error log heading.
    pub created_at: String,
    /// Vault-relative path affected by the issue.
    pub file_path: String,
    /// User-readable error summary.
    pub message: String,
}

impl VaultStructure {
    /// Create a new vault structure for a path
    pub fn new(root: impl AsRef<Path>) -> Self {
        let root = root.as_ref().to_path_buf();
        let goalrate_dir = root.join(".goalrate");

        Self {
            goals: root.join("goals"),
            domains: root.join("domains"),
            agenda: root.join("agenda"),
            tasks: root.join("tasks"),
            logs: root.join("logs"),
            system: root.join("system"),
            focus: root.join("focus"),
            cache: goalrate_dir.join("cache"),
            index: goalrate_dir.join("index.db"),
            config: root.join(".vault.json"),
            goalrate_dir,
            error_log: root.join("logs").join("errors.md"),
            mutation_log: root.join("system").join("mutations.md"),
            snapshots: root.join("system").join("snapshots"),
            root,
        }
    }

    /// Check if the vault structure is valid
    pub fn is_valid(&self) -> bool {
        self.config.exists()
    }

    /// Get the path for a specific goal
    pub fn goal_path(&self, goal_id: &str) -> PathBuf {
        self.goals.join(goal_id)
    }

    /// Get the path for a goal's main file (legacy directory layout)
    pub fn goal_file(&self, goal_id: &str) -> PathBuf {
        self.goal_path(goal_id).join("goal.md")
    }

    /// Get the path for a goal's root-level file
    pub fn goal_file_flat(&self, goal_id: &str) -> PathBuf {
        self.goals.join(format!("{}.md", goal_id))
    }

    /// Get the path for a goal's milestones directory (legacy directory layout)
    pub fn goal_tasks_path(&self, goal_id: &str) -> PathBuf {
        self.goal_path(goal_id).join("milestones")
    }

    /// Get the path for a focus file by date
    pub fn focus_file(&self, date: &str) -> PathBuf {
        self.focus.join(format!("{}.md", date))
    }

    /// Get the path for an agenda file by date
    pub fn agenda_file(&self, date: &str) -> PathBuf {
        self.agenda.join(format!("{}.md", date))
    }

    /// Get the path for persistent planning memory
    pub fn memory_file(&self) -> PathBuf {
        self.root.join("memory.md")
    }

    /// Get the path for Eisenhower priority notes
    pub fn eisenhower_matrix_file(&self) -> PathBuf {
        self.root.join("eisenhower-matrix.md")
    }
}

const SNAPSHOT_PREVIEW_MAX_LINES: usize = 12;
const SNAPSHOT_PREVIEW_MAX_CHARS: usize = 2_000;

fn count_shared_lines(current: &[&str], restored: &[&str]) -> usize {
    let mut previous = vec![0; restored.len() + 1];
    let mut current_row = vec![0; restored.len() + 1];

    for current_line in current {
        for (index, restored_line) in restored.iter().enumerate() {
            current_row[index + 1] = if current_line == restored_line {
                previous[index] + 1
            } else {
                current_row[index].max(previous[index + 1])
            };
        }
        std::mem::swap(&mut previous, &mut current_row);
        current_row.fill(0);
    }

    previous[restored.len()]
}

fn bounded_snapshot_excerpt(content: &str) -> String {
    let excerpt = content
        .lines()
        .take(SNAPSHOT_PREVIEW_MAX_LINES)
        .collect::<Vec<_>>()
        .join("\n");

    if excerpt.len() <= SNAPSHOT_PREVIEW_MAX_CHARS {
        return excerpt;
    }

    let mut end = SNAPSHOT_PREVIEW_MAX_CHARS;
    while !excerpt.is_char_boundary(end) {
        end -= 1;
    }
    excerpt[..end].to_string()
}

enum GoalLocation {
    Directory(PathBuf),
    Flat(PathBuf),
}

/// Manager for vault operations
pub struct VaultManager {
    structure: VaultStructure,
    config: VaultConfig,
}

impl VaultManager {
    fn goal_id_from_frontmatter_path(&self, path: &Path) -> Option<String> {
        let content = std::fs::read_to_string(path).ok()?;
        match markdown_parser::parse_frontmatter(&content) {
            Ok((fm, _)) => fm.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()),
            Err(err) => {
                let _ = self.log_vault_error(path, &format!("Failed to parse frontmatter: {err}"));
                None
            }
        }
    }

    fn relative_path_for_log(&self, path: &Path) -> String {
        path.strip_prefix(&self.structure.root)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string()
    }

    fn safe_snapshot_name(&self, path: &Path) -> String {
        self.relative_path_for_log(path)
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                    ch
                } else {
                    '_'
                }
            })
            .collect()
    }

    fn markdown_log_value(line: &str, label: &str) -> Option<String> {
        let trimmed = line.trim();
        let prefix = format!("- {label}: `");
        trimmed
            .strip_prefix(&prefix)?
            .strip_suffix('`')
            .map(ToOwned::to_owned)
    }

    fn markdown_plain_log_value(line: &str, label: &str) -> Option<String> {
        let trimmed = line.trim();
        let prefix = format!("- {label}: ");
        trimmed
            .strip_prefix(&prefix)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    }

    fn resolve_logged_relative_path(&self, value: &str, field: &str) -> VaultResult<PathBuf> {
        let rel_path = Path::new(value);
        if rel_path.is_absolute() {
            return Err(VaultError::InvalidPath(format!(
                "{field} must be vault-relative: {value}"
            )));
        }

        let mut clean = PathBuf::new();
        for component in rel_path.components() {
            match component {
                Component::Normal(part) => clean.push(part),
                Component::CurDir => {}
                Component::ParentDir | Component::Prefix(_) | Component::RootDir => {
                    return Err(VaultError::InvalidPath(format!(
                        "{field} must stay inside the vault root: {value}"
                    )));
                }
            }
        }

        let resolved = self.structure.root.join(clean);
        if !resolved.starts_with(&self.structure.root) {
            return Err(VaultError::InvalidPath(format!(
                "{field} must stay inside the vault root: {value}"
            )));
        }

        Ok(resolved)
    }

    fn append_markdown_entry(path: &Path, entry: &str) -> VaultResult<()> {
        let mut file = OpenOptions::new().create(true).append(true).open(path)?;
        if file.metadata()?.len() > 0 {
            file.write_all(b"\n")?;
        }
        file.write_all(entry.as_bytes())?;
        file.write_all(b"\n")?;
        Ok(())
    }

    fn ensure_log_files(&self) -> VaultResult<()> {
        std::fs::create_dir_all(&self.structure.logs)?;
        std::fs::create_dir_all(&self.structure.system)?;
        std::fs::create_dir_all(&self.structure.snapshots)?;

        if !self.structure.error_log.exists() {
            std::fs::write(&self.structure.error_log, default_error_log_markdown())?;
        }
        if !self.structure.mutation_log.exists() {
            std::fs::write(
                &self.structure.mutation_log,
                default_mutation_log_markdown(),
            )?;
        }
        Ok(())
    }

    /// Append a recoverable vault error to `logs/errors.md`.
    pub fn log_vault_error(&self, path: &Path, message: &str) -> VaultResult<()> {
        self.ensure_log_files()?;
        let timestamp = Utc::now().to_rfc3339();
        let entry = format!(
            "## {timestamp}\n\n- File: `{}`\n- Error: {}\n",
            self.relative_path_for_log(path),
            message.trim()
        );
        Self::append_markdown_entry(&self.structure.error_log, &entry)
    }

    fn snapshot_existing_file(
        &self,
        path: &Path,
        actor: &str,
        action: &str,
    ) -> VaultResult<Option<String>> {
        if !path.exists() || !path.is_file() {
            return Ok(None);
        }

        self.ensure_log_files()?;
        let content = std::fs::read_to_string(path)?;
        let timestamp = Utc::now().format("%Y%m%dT%H%M%S%.3fZ").to_string();
        let nonce = uuid::Uuid::new_v4().simple();
        let snapshot_name = format!(
            "{}_{}_{}_{}_{}.md",
            timestamp,
            nonce,
            actor,
            action,
            self.safe_snapshot_name(path)
        );
        let snapshot_path = self.structure.snapshots.join(snapshot_name);
        std::fs::write(&snapshot_path, content)?;
        Ok(Some(self.relative_path_for_log(&snapshot_path)))
    }

    fn append_mutation_log(
        &self,
        actor: &str,
        action: &str,
        path: &Path,
        entity_id: Option<&str>,
        snapshot_path: Option<&str>,
    ) -> VaultResult<()> {
        self.ensure_log_files()?;
        let timestamp = Utc::now().to_rfc3339();
        let mut entry = format!(
            "## {timestamp}\n\n- Actor: {actor}\n- Action: {action}\n- File: `{}`\n",
            self.relative_path_for_log(path)
        );
        if let Some(entity_id) = entity_id {
            entry.push_str(&format!("- Entity: `{entity_id}`\n"));
        }
        if let Some(snapshot_path) = snapshot_path {
            entry.push_str(&format!("- Snapshot: `{snapshot_path}`\n"));
        }
        Self::append_markdown_entry(&self.structure.mutation_log, &entry)
    }

    fn append_snapshot_restore_log(
        &self,
        actor: &str,
        path: &Path,
        restored_from: &str,
        snapshot_path: Option<&str>,
    ) -> VaultResult<()> {
        self.ensure_log_files()?;
        let timestamp = Utc::now().to_rfc3339();
        let mut entry = format!(
            "## {timestamp}\n\n- Actor: {actor}\n- Action: restore_snapshot\n- File: `{}`\n- Restored From: `{restored_from}`\n",
            self.relative_path_for_log(path)
        );
        if let Some(snapshot_path) = snapshot_path {
            entry.push_str(&format!("- Snapshot: `{snapshot_path}`\n"));
        }
        Self::append_markdown_entry(&self.structure.mutation_log, &entry)
    }

    fn read_logged_snapshot_history(&self) -> VaultResult<Vec<SnapshotHistoryEntry>> {
        if !self.structure.mutation_log.exists() {
            return Ok(Vec::new());
        }

        let content = std::fs::read_to_string(&self.structure.mutation_log)?;

        let mut entries = Vec::new();
        let mut current_created_at: Option<String> = None;
        let mut current_actor: Option<String> = None;
        let mut current_action: Option<String> = None;
        let mut current_file: Option<String> = None;
        let mut current_snapshot: Option<String> = None;

        let mut flush_entry = |created_at: &mut Option<String>,
                               actor: &mut Option<String>,
                               action: &mut Option<String>,
                               file: &mut Option<String>,
                               snapshot: &mut Option<String>| {
            if let (
                Some(created_at),
                Some(actor),
                Some(action),
                Some(target_path),
                Some(snapshot_path),
            ) = (
                created_at.take(),
                actor.take(),
                action.take(),
                file.take(),
                snapshot.take(),
            ) {
                entries.push(SnapshotHistoryEntry {
                    created_at,
                    actor,
                    action,
                    target_path,
                    snapshot_path,
                });
            } else {
                actor.take();
                action.take();
                file.take();
                snapshot.take();
            }
        };

        for line in content.lines() {
            if let Some(timestamp) = line.strip_prefix("## ") {
                flush_entry(
                    &mut current_created_at,
                    &mut current_actor,
                    &mut current_action,
                    &mut current_file,
                    &mut current_snapshot,
                );
                current_created_at = Some(timestamp.trim().to_string());
                continue;
            }
            if let Some(value) = Self::markdown_plain_log_value(line, "Actor") {
                current_actor = Some(value);
            } else if let Some(value) = Self::markdown_plain_log_value(line, "Action") {
                current_action = Some(value);
            } else if let Some(value) = Self::markdown_log_value(line, "File") {
                current_file = Some(value);
            } else if let Some(value) = Self::markdown_log_value(line, "Snapshot") {
                current_snapshot = Some(value);
            }
        }
        flush_entry(
            &mut current_created_at,
            &mut current_actor,
            &mut current_action,
            &mut current_file,
            &mut current_snapshot,
        );

        entries.reverse();
        Ok(entries)
    }

    fn read_error_log_entries(&self) -> VaultResult<Vec<VaultErrorLogEntry>> {
        if !self.structure.error_log.exists() {
            return Ok(Vec::new());
        }

        let content = std::fs::read_to_string(&self.structure.error_log)?;

        let mut entries = Vec::new();
        let mut current_created_at: Option<String> = None;
        let mut current_file: Option<String> = None;
        let mut current_error: Option<String> = None;

        let mut flush_entry = |created_at: &mut Option<String>,
                               file: &mut Option<String>,
                               error: &mut Option<String>| {
            if let (Some(created_at), Some(file_path), Some(message)) =
                (created_at.take(), file.take(), error.take())
            {
                entries.push(VaultErrorLogEntry {
                    created_at,
                    file_path,
                    message,
                });
            } else {
                file.take();
                error.take();
            }
        };

        for line in content.lines() {
            if let Some(timestamp) = line.strip_prefix("## ") {
                flush_entry(
                    &mut current_created_at,
                    &mut current_file,
                    &mut current_error,
                );
                current_created_at = Some(timestamp.trim().to_string());
                continue;
            }
            if let Some(value) = Self::markdown_log_value(line, "File") {
                current_file = Some(value);
            } else if let Some(value) = Self::markdown_plain_log_value(line, "Error") {
                current_error = Some(value);
            }
        }
        flush_entry(
            &mut current_created_at,
            &mut current_file,
            &mut current_error,
        );

        entries.reverse();
        Ok(entries)
    }

    fn logged_snapshot_history(&self) -> VaultResult<Vec<SnapshotHistoryEntry>> {
        self.ensure_log_files()?;
        self.read_logged_snapshot_history()
    }

    fn snapshot_entry_paths(
        &self,
        entry: &SnapshotHistoryEntry,
    ) -> VaultResult<(PathBuf, PathBuf)> {
        let target_path =
            self.resolve_logged_relative_path(&entry.target_path, "snapshot target")?;
        let snapshot_path =
            self.resolve_logged_relative_path(&entry.snapshot_path, "snapshot source")?;

        if !snapshot_path.starts_with(&self.structure.snapshots) {
            return Err(VaultError::InvalidPath(format!(
                "Snapshot path must be inside system/snapshots: {}",
                entry.snapshot_path
            )));
        }

        Ok((target_path, snapshot_path))
    }

    fn restore_snapshot_entry(
        &self,
        entry: &SnapshotHistoryEntry,
        actor: &str,
    ) -> VaultResult<SnapshotRestoreResult> {
        let (target_path, snapshot_path) = self.snapshot_entry_paths(entry)?;
        if !snapshot_path.is_file() {
            return Err(VaultError::ItemNotFound(format!(
                "Snapshot not found: {}",
                entry.snapshot_path
            )));
        }

        let restored_content = std::fs::read_to_string(&snapshot_path)?;
        if let Some(parent) = target_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let current_snapshot =
            self.snapshot_existing_file(&target_path, actor, "restore_snapshot")?;
        std::fs::write(&target_path, restored_content)?;
        self.append_snapshot_restore_log(
            actor,
            &target_path,
            &entry.snapshot_path,
            current_snapshot.as_deref(),
        )?;

        Ok(SnapshotRestoreResult {
            restored_path: self.relative_path_for_log(&target_path),
            snapshot_path: entry.snapshot_path.clone(),
        })
    }

    /// Write a markdown file inside the vault after taking a pre-write snapshot.
    pub fn write_markdown_file(
        &self,
        path: &Path,
        content: &str,
        actor: &str,
        action: &str,
        entity_id: Option<&str>,
    ) -> VaultResult<()> {
        if !path.starts_with(&self.structure.root) {
            return Err(VaultError::InvalidPath(format!(
                "Refusing to write outside vault root: {}",
                path.display()
            )));
        }

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let snapshot = self.snapshot_existing_file(path, actor, action)?;
        std::fs::write(path, content)?;
        self.append_mutation_log(actor, action, path, entity_id, snapshot.as_deref())?;
        Ok(())
    }

    /// Restore the latest restorable markdown snapshot recorded in `system/mutations.md`.
    pub fn restore_latest_snapshot(
        &self,
        actor: &str,
    ) -> VaultResult<Option<SnapshotRestoreResult>> {
        let snapshot = match self.list_snapshot_history()?.into_iter().next() {
            Some(snapshot) => snapshot,
            None => return Ok(None),
        };

        Ok(Some(self.restore_snapshot_entry(&snapshot, actor)?))
    }

    /// List restorable snapshots recorded in `system/mutations.md`, newest first.
    pub fn list_snapshot_history(&self) -> VaultResult<Vec<SnapshotHistoryEntry>> {
        let mut snapshots = Vec::new();

        for entry in self.logged_snapshot_history()? {
            match self.snapshot_entry_paths(&entry) {
                Ok((_, snapshot_path)) if snapshot_path.is_file() => snapshots.push(entry),
                Ok(_) => {}
                Err(err) => {
                    let _ = self.log_vault_error(
                        &self.structure.mutation_log,
                        &format!(
                            "Invalid snapshot log entry `{}`: {err}",
                            entry.snapshot_path
                        ),
                    );
                }
            }
        }

        Ok(snapshots)
    }

    /// List recent parse and validation issues recorded in `logs/errors.md`, newest first.
    pub fn list_error_log_entries(&self, limit: usize) -> VaultResult<Vec<VaultErrorLogEntry>> {
        let mut entries = self.read_error_log_entries()?;
        entries.truncate(limit);
        Ok(entries)
    }

    /// Build a read-only preview for a specific snapshot path from the mutation log.
    pub fn preview_snapshot(&self, snapshot_path: &str) -> VaultResult<Option<SnapshotPreview>> {
        let Some(snapshot) = self
            .read_logged_snapshot_history()?
            .into_iter()
            .find(|entry| entry.snapshot_path == snapshot_path)
        else {
            return Ok(None);
        };

        let (target_path, resolved_snapshot_path) = self.snapshot_entry_paths(&snapshot)?;
        if !resolved_snapshot_path.is_file() {
            return Ok(None);
        }

        let current_exists = target_path.is_file();
        let current_content = if current_exists {
            std::fs::read_to_string(&target_path)?
        } else {
            String::new()
        };
        let restored_content = std::fs::read_to_string(&resolved_snapshot_path)?;
        let current_lines = current_content.lines().collect::<Vec<_>>();
        let restored_lines = restored_content.lines().collect::<Vec<_>>();
        let unchanged_lines = count_shared_lines(&current_lines, &restored_lines);

        Ok(Some(SnapshotPreview {
            target_path: snapshot.target_path,
            snapshot_path: snapshot.snapshot_path,
            current_exists,
            added_lines: restored_lines.len().saturating_sub(unchanged_lines),
            removed_lines: current_lines.len().saturating_sub(unchanged_lines),
            unchanged_lines,
            current_excerpt: bounded_snapshot_excerpt(&current_content),
            restored_excerpt: bounded_snapshot_excerpt(&restored_content),
        }))
    }

    /// Restore a specific snapshot path from the mutation log.
    pub fn restore_snapshot(
        &self,
        snapshot_path: &str,
        actor: &str,
    ) -> VaultResult<Option<SnapshotRestoreResult>> {
        let Some(snapshot) = self
            .list_snapshot_history()?
            .into_iter()
            .find(|entry| entry.snapshot_path == snapshot_path)
        else {
            return Ok(None);
        };

        Ok(Some(self.restore_snapshot_entry(&snapshot, actor)?))
    }

    fn find_goal_location(&self, goal_id: &str) -> VaultResult<Option<GoalLocation>> {
        let dir_path = self.structure.goal_path(goal_id);
        if dir_path.join("goal.md").exists() {
            return Ok(Some(GoalLocation::Directory(dir_path)));
        }

        let flat_path = self.structure.goal_file_flat(goal_id);
        if flat_path.exists() {
            return Ok(Some(GoalLocation::Flat(flat_path)));
        }

        if !self.structure.goals.exists() {
            return Ok(None);
        }

        for entry in std::fs::read_dir(&self.structure.goals)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let goal_dir = entry.path();
            let goal_file = goal_dir.join("goal.md");
            if !goal_file.exists() {
                continue;
            }
            if self
                .goal_id_from_frontmatter_path(&goal_file)
                .map(|id| id == goal_id)
                .unwrap_or(false)
            {
                return Ok(Some(GoalLocation::Directory(goal_dir)));
            }
        }

        for entry in std::fs::read_dir(&self.structure.goals)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
                continue;
            }
            if self
                .goal_id_from_frontmatter_path(&path)
                .map(|id| id == goal_id)
                .unwrap_or(false)
            {
                return Ok(Some(GoalLocation::Flat(path)));
            }
        }

        Ok(None)
    }

    /// Resolve the markdown file backing a goal id, supporting flat and legacy layouts.
    pub fn goal_markdown_path(&self, goal_id: &str) -> VaultResult<Option<PathBuf>> {
        Ok(self
            .find_goal_location(goal_id)?
            .map(|location| match location {
                GoalLocation::Directory(dir_path) => dir_path.join("goal.md"),
                GoalLocation::Flat(path) => path,
            }))
    }

    /// Open an existing vault
    pub fn open(path: impl AsRef<Path>) -> VaultResult<Self> {
        let path = path.as_ref();
        let structure = VaultStructure::new(path);

        if !structure.config.exists() {
            return Err(VaultError::InvalidStructure(
                "Missing .vault.json config file".into(),
            ));
        }

        let config_content = std::fs::read_to_string(&structure.config)?;
        let mut config: VaultConfig = serde_json::from_str(&config_content)?;

        // Update last opened timestamp
        config.touch();

        // Save the updated config
        let updated_content = serde_json::to_string_pretty(&config)?;
        std::fs::write(&structure.config, updated_content)?;

        let manager = Self { structure, config };
        manager.migrate_goals_to_flat()?;
        manager.ensure_v1_markdown_structure()?;
        Ok(manager)
    }

    /// Create a new vault
    pub fn create(
        name: impl Into<String>,
        path: impl AsRef<Path>,
        vault_type: VaultType,
    ) -> VaultResult<Self> {
        let path = path.as_ref();
        let structure = VaultStructure::new(path);

        if structure.config.exists() {
            return Err(VaultError::AlreadyExists(path.display().to_string()));
        }

        // Create directory structure
        std::fs::create_dir_all(&structure.root)?;
        std::fs::create_dir_all(&structure.goalrate_dir)?;

        // Create config
        let config = VaultConfig::new(name, path.display().to_string(), vault_type);
        let config_content = serde_json::to_string_pretty(&config)?;
        std::fs::write(&structure.config, config_content)?;

        // Create .gitignore for .goalrate directory
        let gitignore_path = structure.goalrate_dir.join(".gitignore");
        std::fs::write(
            &gitignore_path,
            "# App-managed local indexes and caches\nindex.db\nindex.db-*\nagenda.db\nagenda.db-*\ncache/\n",
        )?;

        let manager = Self { structure, config };
        manager.ensure_v1_markdown_structure()?;
        Ok(manager)
    }

    /// Get vault configuration
    pub fn config(&self) -> &VaultConfig {
        &self.config
    }

    /// Get mutable vault configuration
    pub fn config_mut(&mut self) -> &mut VaultConfig {
        &mut self.config
    }

    /// Get vault structure
    pub fn structure(&self) -> &VaultStructure {
        &self.structure
    }

    /// Save the current configuration to disk
    pub fn save_config(&self) -> VaultResult<()> {
        let config_content = serde_json::to_string_pretty(&self.config)?;
        std::fs::write(&self.structure.config, config_content)?;
        Ok(())
    }

    /// Ensure the markdown-first v1 vault shape exists.
    ///
    /// This is intentionally additive: existing user markdown is never overwritten.
    pub fn ensure_v1_markdown_structure(&self) -> VaultResult<()> {
        std::fs::create_dir_all(&self.structure.goals)?;
        std::fs::create_dir_all(&self.structure.domains)?;
        std::fs::create_dir_all(&self.structure.agenda)?;
        std::fs::create_dir_all(&self.structure.tasks)?;
        std::fs::create_dir_all(&self.structure.logs)?;
        std::fs::create_dir_all(&self.structure.system)?;
        std::fs::create_dir_all(&self.structure.snapshots)?;
        std::fs::create_dir_all(&self.structure.focus)?;
        std::fs::create_dir_all(&self.structure.goalrate_dir)?;
        std::fs::create_dir_all(&self.structure.cache)?;

        let gitignore_path = self.structure.goalrate_dir.join(".gitignore");
        if !gitignore_path.exists() {
            std::fs::write(
                &gitignore_path,
                "# App-managed local indexes and caches\nindex.db\nindex.db-*\nagenda.db\nagenda.db-*\ncache/\n",
            )?;
        } else {
            let mut gitignore = std::fs::read_to_string(&gitignore_path)?;
            let mut changed = false;
            for line in ["agenda.db", "agenda.db-*", "cache/"] {
                if !gitignore.lines().any(|existing| existing.trim() == line) {
                    if !gitignore.ends_with('\n') {
                        gitignore.push('\n');
                    }
                    gitignore.push_str(line);
                    gitignore.push('\n');
                    changed = true;
                }
            }
            if changed {
                std::fs::write(&gitignore_path, gitignore)?;
            }
        }

        let memory_path = self.structure.memory_file();
        if !memory_path.exists() {
            std::fs::write(&memory_path, default_memory_markdown())?;
        }

        let matrix_path = self.structure.eisenhower_matrix_file();
        if !matrix_path.exists() {
            std::fs::write(&matrix_path, default_eisenhower_matrix_markdown())?;
        }

        self.ensure_log_files()?;

        Ok(())
    }

    /// List all goals in the vault
    pub fn list_goals(&self) -> VaultResult<Vec<String>> {
        let mut goals = Vec::new();
        let mut seen = HashSet::new();

        if !self.structure.goals.exists() {
            return Ok(goals);
        }

        for entry in std::fs::read_dir(&self.structure.goals)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if file_type.is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    // Check if goal.md exists
                    let goal_file = self.structure.goal_file(name);
                    if goal_file.exists() {
                        let id = self
                            .goal_id_from_frontmatter_path(&goal_file)
                            .unwrap_or_else(|| name.to_string());
                        if seen.insert(id.clone()) {
                            goals.push(id);
                        }
                    }
                }
                continue;
            }

            if file_type.is_file() {
                let path = entry.path();
                if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
                    continue;
                }
                if let Some(stem) = path.file_stem().and_then(|name| name.to_str()) {
                    let id = self
                        .goal_id_from_frontmatter_path(&path)
                        .unwrap_or_else(|| stem.to_string());
                    if seen.insert(id.clone()) {
                        goals.push(id);
                    }
                }
            }
        }

        Ok(goals)
    }

    /// Read a goal file
    pub fn read_goal(&self, goal_id: &str) -> VaultResult<(markdown_parser::Frontmatter, String)> {
        let location = self
            .find_goal_location(goal_id)?
            .ok_or_else(|| VaultError::ItemNotFound(goal_id.to_string()))?;

        let (path, is_flat, dir_name) = match location {
            GoalLocation::Directory(dir_path) => (
                dir_path.join("goal.md"),
                false,
                dir_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|s| s.to_string()),
            ),
            GoalLocation::Flat(flat_path) => (flat_path, true, None),
        };

        let content = std::fs::read_to_string(&path)?;
        let (mut frontmatter, body) = match markdown_parser::parse_frontmatter(&content) {
            Ok((frontmatter, body)) => (frontmatter, body),
            Err(markdown_parser::ParseError::MissingDelimiter) => {
                (markdown_parser::Frontmatter::new(), content)
            }
            Err(err) => {
                let _ = self.log_vault_error(&path, &format!("Failed to read goal: {err}"));
                return Err(err.into());
            }
        };
        if is_flat || !frontmatter.contains_key("id") {
            frontmatter.insert("id".into(), serde_yaml::Value::String(goal_id.to_string()));
        }
        if !frontmatter.contains_key("title") {
            let title = dir_name
                .unwrap_or_else(|| goal_id.to_string())
                .replace(['-', '_'], " ");
            frontmatter.insert("title".into(), serde_yaml::Value::String(title));
        }
        Ok((frontmatter, body))
    }

    /// Write a goal file
    pub fn write_goal(
        &self,
        goal_id: &str,
        frontmatter: &markdown_parser::Frontmatter,
        body: &str,
    ) -> VaultResult<()> {
        self.write_goal_with_audit(goal_id, frontmatter, body, "system", "write_goal")
    }

    /// Write a goal file with explicit mutation-log attribution.
    pub fn write_goal_with_audit(
        &self,
        goal_id: &str,
        frontmatter: &markdown_parser::Frontmatter,
        body: &str,
        actor: &str,
        action: &str,
    ) -> VaultResult<()> {
        let content = markdown_parser::serialize_frontmatter(frontmatter, body);
        std::fs::create_dir_all(&self.structure.goals)?;
        let path = self.structure.goal_file_flat(goal_id);
        self.write_markdown_file(&path, &content, actor, action, Some(goal_id))?;

        Ok(())
    }

    /// Delete a goal and all its tasks
    pub fn delete_goal(&self, goal_id: &str) -> VaultResult<()> {
        let location = self
            .find_goal_location(goal_id)?
            .ok_or_else(|| VaultError::ItemNotFound(goal_id.to_string()))?;

        match location {
            GoalLocation::Directory(dir_path) => {
                let goal_file = dir_path.join("goal.md");
                let snapshot = self.snapshot_existing_file(&goal_file, "user", "delete_goal")?;
                std::fs::remove_dir_all(&dir_path)?;
                self.append_mutation_log(
                    "user",
                    "delete_goal",
                    &goal_file,
                    Some(goal_id),
                    snapshot.as_deref(),
                )?;
            }
            GoalLocation::Flat(flat_path) => {
                let snapshot = self.snapshot_existing_file(&flat_path, "user", "delete_goal")?;
                std::fs::remove_file(&flat_path)?;
                self.append_mutation_log(
                    "user",
                    "delete_goal",
                    &flat_path,
                    Some(goal_id),
                    snapshot.as_deref(),
                )?;
            }
        }

        Ok(())
    }

    fn migrate_goals_to_flat(&self) -> VaultResult<()> {
        if !self.structure.goals.exists() {
            return Ok(());
        }

        for entry in std::fs::read_dir(&self.structure.goals)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }

            let goal_dir = entry.path();
            let goal_file = goal_dir.join("goal.md");
            if !goal_file.exists() {
                continue;
            }

            let content = std::fs::read_to_string(&goal_file)?;
            let (mut frontmatter, body) = match markdown_parser::parse_frontmatter(&content) {
                Ok((frontmatter, body)) => (frontmatter, body),
                Err(markdown_parser::ParseError::MissingDelimiter) => {
                    (markdown_parser::Frontmatter::new(), content)
                }
                Err(err) => return Err(err.into()),
            };

            let goal_id = frontmatter
                .get("id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| {
                    goal_dir
                        .file_name()
                        .and_then(|name| name.to_str())
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| "untitled-goal".to_string());

            if !frontmatter.contains_key("id") {
                frontmatter.insert("id".into(), serde_yaml::Value::String(goal_id.clone()));
            }

            let notes = strip_milestones_section(&body);
            let milestones = collect_milestones(&goal_dir)?;
            let merged_body = build_milestone_body(&notes, &milestones);

            let flat_path = self.structure.goal_file_flat(&goal_id);
            if flat_path.exists() {
                continue;
            }

            let flat_content = markdown_parser::serialize_frontmatter(&frontmatter, &merged_body);
            std::fs::write(&flat_path, flat_content)?;
            std::fs::remove_dir_all(&goal_dir)?;
        }

        Ok(())
    }
}

fn default_memory_markdown() -> String {
    r#"---
id: memory_local_user
type: memory
user_name: ""
age: null
important_days: []
likes: []
dislikes: []
limitations: []
meal_windows: []
snack_windows: []
exercise_minutes_needed: null
socialization_minutes_needed: null
self_care_minutes_needed: null
task_capacity_hours_per_day: null
task_capacity_tasks_per_day: null
sleep_hours_needed: null
downtime_hours_needed: null
consent:
  use_for_planning: true
  allow_ai_updates_from_chat: false
  allow_remote_ai_context: false
  require_confirmation_for_sensitive_updates: true
last_updated: null
---

## About Me

## Schedule and Capacity

## Preferences

## Limitations

## Important Days

## AI Notes
"#
    .to_string()
}

fn default_eisenhower_matrix_markdown() -> String {
    format!(
        r#"---
id: eisenhower_matrix
type: eisenhower_matrix
version: 1
last_updated: "{}"
---

## Do

Urgent and important work to complete immediately.

## Schedule

Important but not urgent work to plan after Do tasks.

## Delegate

Urgent but not important work the user should delegate.

## Delete

Neither urgent nor important work to delete, archive, or stop planning.
"#,
        Utc::now().to_rfc3339()
    )
}

fn default_error_log_markdown() -> String {
    format!(
        r#"---
id: vault_errors
type: error_log
created_at: "{}"
---

# Vault Errors
"#,
        Utc::now().to_rfc3339()
    )
}

fn default_mutation_log_markdown() -> String {
    format!(
        r#"---
id: agent_mutation_log
type: agent_mutation_log
created_at: "{}"
---

# Vault Mutations
"#,
        Utc::now().to_rfc3339()
    )
}

struct LegacyMilestone {
    id: String,
    title: String,
    done: bool,
}

fn strip_milestones_section(body: &str) -> String {
    let lines: Vec<&str> = body.lines().collect();
    let header_index = lines.iter().position(|line| line.trim() == "## Milestones");

    if header_index.is_none() {
        return body.trim_end().to_string();
    }

    let header_index = header_index.unwrap();
    lines[..header_index].join("\n").trim_end().to_string()
}

fn build_milestone_body(notes: &str, milestones: &[LegacyMilestone]) -> String {
    let mut sections: Vec<String> = Vec::new();
    if !notes.trim().is_empty() {
        sections.push(notes.trim_end().to_string());
    }

    if !milestones.is_empty() {
        let mut milestone_block = String::new();
        milestone_block.push_str("## Milestones\n");
        for milestone in milestones {
            let checkbox = if milestone.done { "- [x]" } else { "- [ ]" };
            milestone_block.push_str(&format!(
                "{} {} <!-- id:{} -->\n",
                checkbox, milestone.title, milestone.id
            ));
        }
        sections.push(milestone_block.trim_end().to_string());
    }

    sections.join("\n\n")
}

fn collect_milestones(goal_dir: &Path) -> VaultResult<Vec<LegacyMilestone>> {
    let mut milestones = Vec::new();
    let dirs = [goal_dir.join("milestones"), goal_dir.join("tasks")];

    for dir in dirs {
        if !dir.exists() {
            continue;
        }

        let mut entries: Vec<PathBuf> = std::fs::read_dir(&dir)?
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("md"))
            .collect();
        entries.sort();

        for path in entries {
            let content = std::fs::read_to_string(&path)?;
            let (fm, _) = match markdown_parser::parse_frontmatter(&content) {
                Ok(parsed) => parsed,
                Err(_) => continue,
            };

            let is_task = fm
                .get("is_task")
                .or_else(|| fm.get("isTask"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if is_task {
                continue;
            }

            let id = fm
                .get("id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| {
                    path.file_stem()
                        .and_then(|name| name.to_str())
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string());

            let title = fm
                .get("title")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| id.clone());

            let done = fm
                .get("column")
                .and_then(|v| v.as_str())
                .map(|s| s == "done")
                .unwrap_or(false)
                || fm.contains_key("completed_at")
                || fm.contains_key("completedAt");

            milestones.push(LegacyMilestone { id, title, done });
        }
    }

    Ok(milestones)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_create_vault() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("test-vault");

        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        assert_eq!(manager.config().name, "Test Vault");
        assert_eq!(manager.config().vault_type, VaultType::Private);
        assert!(manager.structure().config.exists());
        assert!(manager.structure().goals.exists());
        assert!(manager.structure().tasks.exists());
        assert!(manager.structure().logs.exists());
        assert!(manager.structure().system.exists());
        assert!(manager.structure().error_log.exists());
        assert!(manager.structure().mutation_log.exists());
        assert!(manager.structure().goalrate_dir.exists());
        assert!(!vault_path.join("projects").exists());
    }

    #[test]
    fn test_open_vault() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("test-vault");

        // Create first
        VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        // Open
        let manager = VaultManager::open(&vault_path).unwrap();
        assert_eq!(manager.config().name, "Test Vault");
        assert!(manager.config().last_opened.is_some());
    }

    #[test]
    fn test_list_error_log_entries_returns_recent_entries_newest_first() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("test-vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let first_path = manager.structure().goals.join("first.md");
        let second_path = manager.structure().agenda.join("2026-04-26.md");
        manager
            .log_vault_error(&first_path, "First problem")
            .unwrap();
        manager
            .log_vault_error(&second_path, "Second problem")
            .unwrap();

        let entries = manager.list_error_log_entries(5).unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].file_path, "agenda/2026-04-26.md");
        assert_eq!(entries[0].message, "Second problem");
        assert_eq!(entries[1].file_path, "goals/first.md");
        assert_eq!(entries[1].message, "First problem");

        let limited = manager.list_error_log_entries(1).unwrap();
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0].message, "Second problem");
    }

    #[test]
    fn test_open_nonexistent_vault() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("nonexistent");

        let result = VaultManager::open(&vault_path);
        assert!(matches!(result, Err(VaultError::InvalidStructure(_))));
    }

    #[test]
    fn test_create_duplicate_vault() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("test-vault");

        VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let result = VaultManager::create("Another Vault", &vault_path, VaultType::Private);
        assert!(matches!(result, Err(VaultError::AlreadyExists(_))));
    }

    #[test]
    fn test_goal_operations() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("test-vault");

        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        // Create a goal
        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert("id".into(), serde_yaml::Value::String("goal_test".into()));
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Test Goal".into()),
        );
        frontmatter.insert("status".into(), serde_yaml::Value::String("active".into()));

        manager
            .write_goal("goal_test", &frontmatter, "Goal description here.")
            .unwrap();
        assert!(manager.structure().mutation_log.exists());

        let flat_goal_path = manager.structure().goal_file_flat("flat-goal");
        std::fs::write(&flat_goal_path, "Flat goal body.").unwrap();

        // List goals
        let mut goals = manager.list_goals().unwrap();
        goals.sort();
        assert_eq!(goals, vec!["flat-goal", "goal_test"]);

        // Read goal
        let (fm, body) = manager.read_goal("goal_test").unwrap();
        assert_eq!(fm.get("title").unwrap().as_str().unwrap(), "Test Goal");
        assert_eq!(body, "Goal description here.");

        let (flat_fm, flat_body) = manager.read_goal("flat-goal").unwrap();
        assert_eq!(flat_fm.get("id").unwrap().as_str().unwrap(), "flat-goal");
        assert_eq!(flat_fm.get("title").unwrap().as_str().unwrap(), "flat goal");
        assert_eq!(flat_body, "Flat goal body.");

        // Delete goal
        manager.delete_goal("goal_test").unwrap();
        manager.delete_goal("flat-goal").unwrap();
        let snapshots: Vec<_> = std::fs::read_dir(&manager.structure().snapshots)
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        assert!(!snapshots.is_empty());
        let goals = manager.list_goals().unwrap();
        assert!(goals.is_empty());
    }

    #[test]
    fn test_restore_latest_snapshot_restores_previous_markdown_and_logs_restore() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("test-vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();
        let goal_path = manager.structure().goals.join("undoable.md");

        manager
            .write_markdown_file(
                &goal_path,
                "first version",
                "user",
                "write_test_goal",
                Some("undoable"),
            )
            .unwrap();
        manager
            .write_markdown_file(
                &goal_path,
                "second version",
                "user",
                "write_test_goal",
                Some("undoable"),
            )
            .unwrap();

        let restored = manager.restore_latest_snapshot("user").unwrap().unwrap();

        assert_eq!(restored.restored_path, "goals/undoable.md");
        assert!(restored.snapshot_path.starts_with("system/snapshots/"));
        assert_eq!(
            std::fs::read_to_string(&goal_path).unwrap(),
            "first version"
        );

        let mutation_log = std::fs::read_to_string(&manager.structure().mutation_log).unwrap();
        assert!(mutation_log.contains("- Action: restore_snapshot"));
        assert!(mutation_log.contains("- Restored From: `system/snapshots/"));

        let snapshots: Vec<_> = std::fs::read_dir(&manager.structure().snapshots)
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        assert!(
            snapshots.len() >= 2,
            "restore should snapshot the current file before replacing it"
        );
    }

    #[test]
    fn test_restore_latest_snapshot_recreates_missing_target_without_deleting() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("test-vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();
        let goal_path = manager.structure().goals.join("deleted.md");

        manager
            .write_markdown_file(
                &goal_path,
                "original",
                "user",
                "write_test_goal",
                Some("deleted"),
            )
            .unwrap();
        manager
            .write_markdown_file(
                &goal_path,
                "changed",
                "user",
                "write_test_goal",
                Some("deleted"),
            )
            .unwrap();
        std::fs::remove_file(&goal_path).unwrap();

        let restored = manager.restore_latest_snapshot("user").unwrap().unwrap();

        assert_eq!(restored.restored_path, "goals/deleted.md");
        assert_eq!(std::fs::read_to_string(&goal_path).unwrap(), "original");
    }

    #[test]
    fn test_list_snapshot_history_returns_restorable_snapshots_latest_first() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("test-vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();
        let goal_path = manager.structure().goals.join("history.md");

        manager
            .write_markdown_file(
                &goal_path,
                "first version",
                "user",
                "write_test_goal",
                Some("history"),
            )
            .unwrap();
        manager
            .write_markdown_file(
                &goal_path,
                "second version",
                "user",
                "write_test_goal",
                Some("history"),
            )
            .unwrap();
        manager
            .write_markdown_file(
                &goal_path,
                "third version",
                "assistant",
                "rewrite_test_goal",
                Some("history"),
            )
            .unwrap();

        let snapshots = manager.list_snapshot_history().unwrap();

        assert_eq!(snapshots.len(), 2);
        assert_eq!(snapshots[0].target_path, "goals/history.md");
        assert_eq!(snapshots[0].actor, "assistant");
        assert_eq!(snapshots[0].action, "rewrite_test_goal");
        assert!(snapshots[0].snapshot_path.starts_with("system/snapshots/"));
        assert_eq!(snapshots[1].target_path, "goals/history.md");
        assert_eq!(snapshots[1].actor, "user");
        assert_eq!(snapshots[1].action, "write_test_goal");
    }

    #[test]
    fn test_restore_specific_snapshot_restores_selected_version() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("test-vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();
        let goal_path = manager.structure().goals.join("specific.md");

        manager
            .write_markdown_file(
                &goal_path,
                "first version",
                "user",
                "write_test_goal",
                Some("specific"),
            )
            .unwrap();
        manager
            .write_markdown_file(
                &goal_path,
                "second version",
                "user",
                "write_test_goal",
                Some("specific"),
            )
            .unwrap();
        manager
            .write_markdown_file(
                &goal_path,
                "third version",
                "user",
                "write_test_goal",
                Some("specific"),
            )
            .unwrap();

        let snapshots = manager.list_snapshot_history().unwrap();
        let oldest_snapshot = snapshots.last().unwrap().snapshot_path.clone();
        let restored = manager
            .restore_snapshot(&oldest_snapshot, "user")
            .unwrap()
            .unwrap();

        assert_eq!(restored.restored_path, "goals/specific.md");
        assert_eq!(restored.snapshot_path, oldest_snapshot);
        assert_eq!(
            std::fs::read_to_string(&goal_path).unwrap(),
            "first version"
        );
    }

    #[test]
    fn test_preview_snapshot_reports_diff_without_writing_logs_or_snapshots() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("test-vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();
        let goal_path = manager.structure().goals.join("preview.md");

        manager
            .write_markdown_file(
                &goal_path,
                "title: first\nunchanged line",
                "user",
                "write_test_goal",
                Some("preview"),
            )
            .unwrap();
        manager
            .write_markdown_file(
                &goal_path,
                "title: second\nunchanged line",
                "user",
                "write_test_goal",
                Some("preview"),
            )
            .unwrap();

        let snapshot_path = manager.list_snapshot_history().unwrap()[0]
            .snapshot_path
            .clone();
        let mutation_log_before =
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap();
        let snapshot_count_before = std::fs::read_dir(&manager.structure().snapshots)
            .unwrap()
            .filter_map(Result::ok)
            .count();

        let preview = manager.preview_snapshot(&snapshot_path).unwrap().unwrap();

        assert_eq!(preview.target_path, "goals/preview.md");
        assert_eq!(preview.snapshot_path, snapshot_path);
        assert!(preview.current_exists);
        assert_eq!(preview.added_lines, 1);
        assert_eq!(preview.removed_lines, 1);
        assert_eq!(preview.unchanged_lines, 1);
        assert!(preview.current_excerpt.contains("title: second"));
        assert!(preview.restored_excerpt.contains("title: first"));
        assert_eq!(
            std::fs::read_to_string(&manager.structure().mutation_log).unwrap(),
            mutation_log_before
        );
        assert_eq!(
            std::fs::read_dir(&manager.structure().snapshots)
                .unwrap()
                .filter_map(Result::ok)
                .count(),
            snapshot_count_before
        );
    }

    #[test]
    fn test_preview_snapshot_handles_missing_target() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("test-vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();
        let goal_path = manager.structure().goals.join("missing-preview.md");

        manager
            .write_markdown_file(
                &goal_path,
                "original",
                "user",
                "write_test_goal",
                Some("missing-preview"),
            )
            .unwrap();
        manager
            .write_markdown_file(
                &goal_path,
                "changed",
                "user",
                "write_test_goal",
                Some("missing-preview"),
            )
            .unwrap();
        std::fs::remove_file(&goal_path).unwrap();

        let snapshot_path = manager.list_snapshot_history().unwrap()[0]
            .snapshot_path
            .clone();
        let preview = manager.preview_snapshot(&snapshot_path).unwrap().unwrap();

        assert_eq!(preview.target_path, "goals/missing-preview.md");
        assert!(!preview.current_exists);
        assert_eq!(preview.added_lines, 1);
        assert_eq!(preview.removed_lines, 0);
        assert_eq!(preview.unchanged_lines, 0);
        assert!(preview.current_excerpt.is_empty());
        assert!(preview.restored_excerpt.contains("original"));
    }

    #[test]
    fn test_restore_latest_snapshot_returns_none_when_no_snapshot_exists() {
        let temp = TempDir::new().unwrap();
        let vault_path = temp.path().join("test-vault");
        let manager = VaultManager::create("Test Vault", &vault_path, VaultType::Private).unwrap();

        let restored = manager.restore_latest_snapshot("user").unwrap();

        assert!(restored.is_none());
    }

    #[test]
    fn test_vault_structure_paths() {
        let structure = VaultStructure::new("/vault");

        assert_eq!(
            structure.goal_path("my-goal"),
            PathBuf::from("/vault/goals/my-goal")
        );
        assert_eq!(
            structure.goal_file("my-goal"),
            PathBuf::from("/vault/goals/my-goal/goal.md")
        );
        assert_eq!(
            structure.goal_tasks_path("my-goal"),
            PathBuf::from("/vault/goals/my-goal/milestones")
        );
        assert_eq!(
            structure.goal_file_flat("my-goal"),
            PathBuf::from("/vault/goals/my-goal.md")
        );
        assert_eq!(
            structure.focus_file("2024-01-15"),
            PathBuf::from("/vault/focus/2024-01-15.md")
        );
        assert_eq!(structure.tasks, PathBuf::from("/vault/tasks"));
        assert_eq!(structure.logs, PathBuf::from("/vault/logs"));
        assert_eq!(structure.system, PathBuf::from("/vault/system"));
    }
}
