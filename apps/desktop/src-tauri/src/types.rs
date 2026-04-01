//! Type definitions for Tauri IPC
//!
//! These types mirror the TypeScript types in `@goalrate-app/shared` and are used
//! for serialization/deserialization across the Tauri IPC boundary.

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::error::AppError;

// =============================================================================
// Vault Types
// =============================================================================

/// Vault list item returned when listing vaults
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultListItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub vault_type: String,
    pub last_opened: Option<String>,
}

/// Full vault configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultConfig {
    pub id: String,
    pub name: String,
    pub path: String,
    pub vault_type: String,
    pub created: String,
    pub last_opened: Option<String>,
}

impl From<&vault_core::VaultConfig> for VaultConfig {
    fn from(config: &vault_core::VaultConfig) -> Self {
        Self {
            id: config.id.clone(),
            name: config.name.clone(),
            path: config.path.clone(),
            vault_type: config.vault_type.to_string(),
            created: config.created.to_rfc3339(),
            last_opened: config.last_opened.map(|dt| dt.to_rfc3339()),
        }
    }
}

impl From<&vault_core::VaultConfig> for VaultListItem {
    fn from(config: &vault_core::VaultConfig) -> Self {
        Self {
            id: config.id.clone(),
            name: config.name.clone(),
            path: config.path.clone(),
            vault_type: config.vault_type.to_string(),
            last_opened: config.last_opened.map(|dt| dt.to_rfc3339()),
        }
    }
}

/// Data for creating a new vault
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultCreate {
    pub name: String,
    /// Vault directory path. When omitted, defaults to `~/Documents/GoalRate/<name>`.
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default = "default_vault_type")]
    pub vault_type: String,
}

fn default_vault_type() -> String {
    "private".to_string()
}

impl VaultCreate {
    /// Sanitize name to prevent path traversal
    fn sanitized_name(&self) -> String {
        self.name
            .replace(['/', '\\', '\0'], "_")
            .replace("..", "_")
            .trim_matches('.')
            .to_string()
    }

    /// Resolve the vault path, falling back to the default location.
    pub fn resolve_path(&self) -> String {
        if let Some(ref p) = self.path {
            if !p.is_empty() {
                return p.clone();
            }
        }
        // Default: ~/Documents/GoalRate/<name>
        let base = dirs::document_dir()
            .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join("Documents"));
        base.join("GoalRate")
            .join(self.sanitized_name())
            .to_string_lossy()
            .to_string()
    }
}

/// Vault statistics
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStats {
    /// Number of objectives (OKRs)
    pub okr_count: usize,
    /// Backward compatible alias
    #[serde(rename = "goalCount")]
    pub goal_count: usize,
    pub project_count: usize,
    pub total_tasks: usize,
    pub completed_tasks: usize,
}

// =============================================================================
// OKR Types (Objectives and Key Results)
// =============================================================================

/// Measurable component for tracking progress
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Measurable {
    pub unit: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<f64>,
}

/// Kanban column definition
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wip: Option<u32>,
}

impl Default for Column {
    fn default() -> Self {
        Self {
            id: "backlog".to_string(),
            name: "To Do".to_string(),
            wip: None,
        }
    }
}

/// Default columns for key results
pub fn default_okr_columns() -> Vec<Column> {
    vec![
        Column {
            id: "backlog".to_string(),
            name: "Not Started".to_string(),
            wip: None,
        },
        Column {
            id: "doing".to_string(),
            name: "In Progress".to_string(),
            wip: Some(3),
        },
        Column {
            id: "done".to_string(),
            name: "Complete".to_string(),
            wip: None,
        },
    ]
}

// Keep Goal as an alias for backward compatibility during migration
pub type Goal = Objective;

/// An Objective in the OKR framework
/// Objectives are qualitative, inspirational goals that describe what you want to achieve
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Objective {
    pub id: String,
    pub title: String,
    /// Shortened version of the title for compact UI contexts
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short_title: Option<String>,
    /// Goal category (e.g. Work, Health, Financial, Personal)
    #[serde(rename = "type", default)]
    pub goal_type: String,
    pub status: String,
    /// Target completion date
    pub deadline: String,
    pub priority: String,
    /// When work on this goal started
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    /// Numerical target for progress tracking
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<f64>,
    /// Current progress toward target
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<f64>,
    pub tags: Vec<String>,
    /// Confidence score (0-100)
    #[serde(default = "default_confidence")]
    pub confidence: u8,
    /// Why this objective matters
    #[serde(default)]
    pub why: Vec<String>,
    /// Kanban columns for organizing key results
    pub columns: Vec<Column>,
    pub created: String,
    pub updated: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

fn default_confidence() -> u8 {
    70
}

impl Objective {
    /// Create an Objective from frontmatter and body content
    /// Supports both old "specific"/"relevant"/"achievable" fields and new "description"/"why"/"confidence" fields
    pub fn from_frontmatter(
        fm: &markdown_parser::Frontmatter,
        body: &str,
    ) -> Result<Self, AppError> {
        let get_str = |key: &str| -> String {
            fm.get(key)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string()
        };

        let get_str_opt = |key: &str| -> Option<String> {
            fm.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
        };

        let id = get_str("id");
        if id.is_empty() {
            return Err(AppError::validation_error("Objective missing 'id' field"));
        }

        let title = get_str("title");
        if title.is_empty() {
            return Err(AppError::validation_error(
                "Objective missing 'title' field",
            ));
        }

        // Parse short_title (optional)
        let short_title = get_str_opt("short_title");

        // Parse goal type (new schema) with fallback to objective/description/specific (legacy)
        let goal_type = get_str_opt("type")
            .or_else(|| get_str_opt("objective"))
            .or_else(|| get_str_opt("description"))
            .or_else(|| get_str_opt("specific"))
            .unwrap_or_else(|| "Personal".to_string());

        // Parse start_date (new field)
        let start_date = get_str_opt("start_date");

        // Parse flat target/current (new schema), falling back to measurable.target/current (legacy)
        let measurable = fm.get("measurable");
        let target = fm.get("target").and_then(|v| v.as_f64()).or_else(|| {
            measurable
                .and_then(|m| m.get("target"))
                .and_then(|t| t.as_f64())
        });
        let current = fm.get("current").and_then(|v| v.as_f64()).or_else(|| {
            measurable
                .and_then(|m| m.get("current"))
                .and_then(|c| c.as_f64())
        });

        // Parse columns (optional)
        let columns = fm
            .get("columns")
            .and_then(|v| v.as_sequence())
            .map(|seq| {
                seq.iter()
                    .filter_map(|col| {
                        let id = col.get("id")?.as_str()?.to_string();
                        let name = col.get("name")?.as_str()?.to_string();
                        let wip = col.get("wip").and_then(|w| w.as_u64()).map(|w| w as u32);
                        Some(Column { id, name, wip })
                    })
                    .collect()
            })
            .unwrap_or_else(default_okr_columns);

        // Parse why (optional, legacy)
        let why = fm
            .get("why")
            .or_else(|| fm.get("relevant"))
            .and_then(|v| v.as_sequence())
            .map(|seq| {
                seq.iter()
                    .filter_map(|item| item.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        // Parse tags
        let tags = fm
            .get("tags")
            .and_then(|v| v.as_sequence())
            .map(|seq| {
                seq.iter()
                    .filter_map(|item| item.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        // Parse confidence (optional, legacy)
        let confidence = fm
            .get("confidence")
            .or_else(|| fm.get("achievable"))
            .and_then(|v| v.as_u64())
            .map(|v| v as u8)
            .unwrap_or(70);

        Ok(Self {
            id,
            title,
            short_title,
            goal_type,
            status: get_str_opt("status").unwrap_or_else(|| "active".to_string()),
            deadline: get_str("deadline"),
            priority: get_str_opt("priority").unwrap_or_else(|| "medium".to_string()),
            start_date,
            target,
            current,
            tags,
            confidence,
            why,
            columns,
            created: get_str("created"),
            updated: get_str("updated"),
            notes: if body.trim().is_empty() {
                None
            } else {
                Some(body.trim().to_string())
            },
        })
    }

    /// Convert to frontmatter for serialization (new schema)
    pub fn to_frontmatter(&self) -> (markdown_parser::Frontmatter, String) {
        let mut fm = markdown_parser::Frontmatter::new();

        fm.insert("id".into(), serde_yaml::Value::String(self.id.clone()));
        fm.insert(
            "title".into(),
            serde_yaml::Value::String(self.title.clone()),
        );
        if let Some(ref short_title) = self.short_title {
            fm.insert(
                "short_title".into(),
                serde_yaml::Value::String(short_title.clone()),
            );
        }
        fm.insert(
            "type".into(),
            serde_yaml::Value::String(self.goal_type.clone()),
        );
        fm.insert(
            "status".into(),
            serde_yaml::Value::String(self.status.clone()),
        );
        fm.insert(
            "deadline".into(),
            serde_yaml::Value::String(self.deadline.clone()),
        );
        fm.insert(
            "priority".into(),
            serde_yaml::Value::String(self.priority.clone()),
        );

        // start_date
        if let Some(ref start_date) = self.start_date {
            fm.insert(
                "start_date".into(),
                serde_yaml::Value::String(start_date.clone()),
            );
        }

        // Flat target/current (no nested measurable, no unit)
        if let Some(target) = self.target {
            fm.insert(
                "target".into(),
                serde_yaml::to_value(target).unwrap_or_default(),
            );
        }
        if let Some(current) = self.current {
            fm.insert(
                "current".into(),
                serde_yaml::to_value(current).unwrap_or_default(),
            );
        }

        // Tags
        let tags: Vec<serde_yaml::Value> = self
            .tags
            .iter()
            .map(|s| serde_yaml::Value::String(s.clone()))
            .collect();
        fm.insert("tags".into(), serde_yaml::Value::Sequence(tags));

        // Confidence (fix: was previously read but never written back)
        if self.confidence != default_confidence() {
            fm.insert(
                "confidence".into(),
                serde_yaml::Value::Number(serde_yaml::Number::from(self.confidence as u64)),
            );
        }

        // Why (fix: was previously read but never written back)
        if !self.why.is_empty() {
            let why: Vec<serde_yaml::Value> = self
                .why
                .iter()
                .map(|s| serde_yaml::Value::String(s.clone()))
                .collect();
            fm.insert("why".into(), serde_yaml::Value::Sequence(why));
        }

        // Columns (fix: was previously read but never written back)
        let default_cols = default_okr_columns();
        let is_default_columns = self.columns.len() == default_cols.len()
            && self
                .columns
                .iter()
                .zip(default_cols.iter())
                .all(|(a, b)| a.id == b.id && a.name == b.name && a.wip == b.wip);
        if !is_default_columns {
            let columns = serde_yaml::to_value(&self.columns).unwrap_or_default();
            fm.insert("columns".into(), columns);
        }

        fm.insert(
            "created".into(),
            serde_yaml::Value::String(self.created.clone()),
        );
        fm.insert(
            "updated".into(),
            serde_yaml::Value::String(self.updated.clone()),
        );

        let body = self.notes.clone().unwrap_or_default();
        (fm, body)
    }
}

// Type aliases for backward compatibility
pub type GoalCreate = ObjectiveCreate;
pub type GoalUpdate = ObjectiveUpdate;

/// Data for creating a new objective
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveCreate {
    pub title: String,
    /// Shortened version of the title
    #[serde(default)]
    pub short_title: Option<String>,
    /// Goal category (Work, Health, Financial, Personal)
    #[serde(default, alias = "type", alias = "goalType", alias = "goal_type")]
    pub goal_type: String,
    #[serde(default)]
    pub deadline: String,
    #[serde(default = "default_priority")]
    pub priority: String,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub target: Option<f64>,
    #[serde(default)]
    pub current: Option<f64>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: Option<String>,
    /// Legacy description field (kept for backward compat with old SMART payloads)
    #[serde(
        default,
        alias = "objective",
        alias = "description",
        alias = "specific"
    )]
    pub legacy_description: Option<String>,
    /// Legacy confidence score (from "achievable" in old SMART payloads)
    #[serde(default, alias = "achievable")]
    pub confidence: Option<u8>,
    /// Legacy why/motivation (from "relevant" in old SMART payloads)
    #[serde(default, alias = "relevant")]
    pub why: Option<Vec<String>>,
    /// Optional initial tasks (each with id and title)
    #[serde(default)]
    pub tasks: Vec<TaskCreate>,
    /// Legacy measurable field (backward compat)
    #[serde(default)]
    pub measurable: Measurable,
}

/// A task to attach to a goal during creation
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCreate {
    pub title: String,
    #[serde(default)]
    pub status: Option<String>,
}

fn default_priority() -> String {
    "medium".to_string()
}

impl ObjectiveCreate {
    /// Convert to a full Objective with generated ID and timestamps
    pub fn into_objective(self) -> Objective {
        let now = Utc::now().to_rfc3339();
        let id = format!(
            "goal_{}",
            uuid::Uuid::new_v4().to_string().replace("-", "")[..12].to_string()
        );

        // Use flat target/current if provided, else pull from legacy measurable
        let target = self.target.or(self.measurable.target);
        let current = self.current.or(self.measurable.current);

        // If goal_type is empty but a legacy description was provided, derive type
        // from tags or default to "Personal", and use legacy_description as notes
        let (goal_type, notes) = if self.goal_type.is_empty() {
            let derived_type = self
                .tags
                .first()
                .cloned()
                .unwrap_or_else(|| "Personal".to_string());
            // Legacy description becomes notes if no explicit notes provided
            let notes = self.notes.or(self.legacy_description);
            (derived_type, notes)
        } else {
            (self.goal_type, self.notes)
        };

        Objective {
            id,
            title: self.title,
            short_title: self.short_title,
            goal_type,
            status: "active".to_string(),
            deadline: self.deadline,
            priority: self.priority,
            start_date: self.start_date,
            target,
            current,
            tags: self.tags,
            confidence: self.confidence.unwrap_or_else(default_confidence),
            why: self.why.unwrap_or_default(),
            columns: default_okr_columns(),
            created: now.clone(),
            updated: now,
            notes,
        }
    }

    /// Backward compatible alias
    pub fn into_goal(self) -> Goal {
        self.into_objective()
    }
}

/// Data for updating an existing objective
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Goal category (Work, Health, Financial, Personal)
    #[serde(
        skip_serializing_if = "Option::is_none",
        alias = "type",
        alias = "goalType",
        alias = "goal_type"
    )]
    pub goal_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl ObjectiveUpdate {
    /// Apply updates to an existing objective
    pub fn apply_to(self, mut objective: Objective) -> Objective {
        if let Some(title) = self.title {
            objective.title = title;
        }
        if let Some(short_title) = self.short_title {
            objective.short_title = Some(short_title);
        }
        if let Some(status) = self.status {
            objective.status = status;
        }
        if let Some(goal_type) = self.goal_type {
            objective.goal_type = goal_type;
        }
        if let Some(deadline) = self.deadline {
            objective.deadline = deadline;
        }
        if let Some(priority) = self.priority {
            objective.priority = priority;
        }
        if let Some(start_date) = self.start_date {
            objective.start_date = Some(start_date);
        }
        if let Some(target) = self.target {
            objective.target = Some(target);
        }
        if let Some(current) = self.current {
            objective.current = Some(current);
        }
        if let Some(tags) = self.tags {
            objective.tags = tags;
        }
        if let Some(notes) = self.notes {
            objective.notes = Some(notes);
        }
        objective.updated = Utc::now().to_rfc3339();
        objective
    }
}

// =============================================================================
// Key Result Types (tasks/outcomes for objectives)
// =============================================================================

/// Subtask within a key result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtask {
    pub title: String,
    pub done: bool,
}

// Type alias for backward compatibility
pub type GoalTask = KeyResult;

/// A Key Result within an Objective
/// Key Results are measurable outcomes that indicate progress toward an Objective
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyResult {
    pub id: String,
    pub title: String,
    /// Status column (backlog, doing, done)
    pub column: String,
    /// Effort/complexity points (1-8)
    pub points: u8,
    pub priority: String,
    /// Flag to identify task entries for indexing
    pub is_task: bool,
    /// Workspace ID associated with this task
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_by: Option<String>,
    /// Sub-tasks or initiatives for this key result
    #[serde(default)]
    pub subtasks: Vec<Subtask>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default)]
    pub publish_on_complete: bool,
    pub created: String,
    pub updated: String,
}

impl KeyResult {
    /// Create a KeyResult from frontmatter and body content
    pub fn from_frontmatter(
        fm: &markdown_parser::Frontmatter,
        body: &str,
    ) -> Result<Self, AppError> {
        let get_str = |key: &str| -> String {
            fm.get(key)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string()
        };

        let get_str_opt = |key: &str| -> Option<String> {
            fm.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
        };

        let get_bool = |key: &str| -> Option<bool> { fm.get(key).and_then(|v| v.as_bool()) };

        let id = get_str("id");
        if id.is_empty() {
            return Err(AppError::validation_error("Task missing 'id' field"));
        }

        let title = get_str("title");
        if title.is_empty() {
            return Err(AppError::validation_error("Task missing 'title' field"));
        }

        // Parse subtasks
        let subtasks = fm
            .get("subtasks")
            .and_then(|v| v.as_sequence())
            .map(|seq| {
                seq.iter()
                    .filter_map(|item| {
                        let title = item.get("title")?.as_str()?.to_string();
                        let done = item.get("done").and_then(|d| d.as_bool()).unwrap_or(false);
                        Some(Subtask { title, done })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let points = fm
            .get("points")
            .and_then(|v| v.as_u64())
            .map(|v| v as u8)
            .unwrap_or(1);

        Ok(Self {
            id,
            title,
            column: get_str_opt("column").unwrap_or_else(|| "backlog".to_string()),
            points,
            priority: get_str_opt("priority").unwrap_or_else(|| "medium".to_string()),
            is_task: get_bool("is_task")
                .or_else(|| get_bool("isTask"))
                .unwrap_or(false),
            workspace_id: get_str_opt("workspace_id").or_else(|| get_str_opt("workspaceId")),
            due_date: get_str_opt("due_date").or_else(|| get_str_opt("dueDate")),
            completed_at: get_str_opt("completed_at").or_else(|| get_str_opt("completedAt")),
            completed_by: get_str_opt("completed_by").or_else(|| get_str_opt("completedBy")),
            subtasks,
            notes: if body.trim().is_empty() {
                None
            } else {
                Some(body.trim().to_string())
            },
            publish_on_complete: get_bool("publish_on_complete")
                .or_else(|| get_bool("publishOnComplete"))
                .unwrap_or(false),
            created: get_str_opt("created").unwrap_or_else(|| Utc::now().to_rfc3339()),
            updated: get_str_opt("updated").unwrap_or_else(|| Utc::now().to_rfc3339()),
        })
    }
}

fn default_column() -> String {
    "backlog".to_string()
}

fn default_points() -> u8 {
    1
}

// =============================================================================
// Focus Types
// =============================================================================

/// A single item in the focus day
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusItem {
    /// Source ID of the task/story this item references
    pub source: String,
    /// Type of item: "goal_task", "project_task", or "story"
    #[serde(rename = "type")]
    pub item_type: String,
    /// Display title
    pub title: String,
    /// Point value
    pub points: u32,
    /// Priority score (0-100)
    pub score: f64,
    /// Human-readable reason for priority
    pub reason: String,
    /// Status: "pending", "in_progress", "done", "deferred"
    pub status: String,
    /// Goal ID if from a goal task
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal_id: Option<String>,
    /// Goal title for display
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal_title: Option<String>,
    /// Project ID if from a story
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// Project title for display
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_title: Option<String>,
    /// Date deferred to (if deferred)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deferred_to: Option<String>,
    /// Completion timestamp
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

/// A day's focus list
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusDay {
    /// Unique ID (format: focus_YYYY-MM-DD)
    pub id: String,
    /// Date string (YYYY-MM-DD)
    pub date: String,
    /// Hours available for focused work
    pub available_hours: f64,
    /// Calculated point capacity
    pub point_capacity: u32,
    /// Focus items for the day
    pub items: Vec<FocusItem>,
    /// Total planned points
    pub planned_points: u32,
    /// Completed points
    pub completed_points: u32,
    /// Count of completed items
    pub completed_items: u32,
    /// Optional notes for the day
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// Mood indicator
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mood: Option<String>,
    /// End of day reflection
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reflection: Option<String>,
}

/// A candidate item that could be added to focus
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusCandidate {
    /// Unique ID
    pub id: String,
    /// Type: "goal_task", "project_task", or "story"
    #[serde(rename = "type")]
    pub item_type: String,
    /// Display title
    pub title: String,
    /// Point value
    pub points: u32,
    /// Priority level: "low", "medium", "high", "critical"
    pub priority: String,
    /// Due date if set
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    /// IDs of items this blocks
    #[serde(default)]
    pub blocks: Vec<String>,
    /// Whether this blocks other people
    #[serde(default)]
    pub blocks_people: bool,
    /// Whether in current sprint
    #[serde(default)]
    pub in_current_sprint: bool,
    /// Last activity timestamp
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_activity: Option<String>,
    /// Goal ID if from goal task
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal_id: Option<String>,
    /// Goal title
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal_title: Option<String>,
    /// Goal objective for tagging
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal_objective: Option<String>,
    /// Project ID if from story
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// Project title
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_title: Option<String>,
    /// Epic title if available
    #[serde(skip_serializing_if = "Option::is_none")]
    pub epic_title: Option<String>,
    /// Sprint ID if assigned
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sprint_id: Option<String>,
    /// Board column for the task
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board_column: Option<String>,
    /// Vault ID for cross-vault focus
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vault_id: Option<String>,
    /// Vault name for display
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vault_name: Option<String>,
    /// Workspace ID if available
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// Velocity metrics for focus tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusVelocity {
    /// Average points completed per day
    pub average_points_per_day: f64,
    /// Average completion rate (0-100)
    pub average_completion_rate: f64,
    /// Total days tracked
    pub total_days_tracked: u32,
    /// Current streak of consecutive days
    pub current_streak: u32,
    /// Longest streak achieved
    pub longest_streak: u32,
    /// Points for last 7 days
    #[serde(default)]
    pub weekly_trend: Vec<u32>,
}

// =============================================================================
// Desktop Focus List Types
// =============================================================================

/// Focus list entry status values.
pub type FocusListEntryStatus = String;

/// Focus list entry persisted for a given date.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusListEntry {
    pub id: String,
    pub task_id: String,
    pub vault_id: String,
    pub title: String,
    pub due_at: Option<String>,
    pub priority: u8,
    pub story_points: f64,
    pub status: FocusListEntryStatus,
}

/// Focus list day payload returned to the desktop UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusListDay {
    pub date: String,
    #[serde(rename = "capacitySP")]
    pub capacity_sp: f64,
    #[serde(rename = "packedSP")]
    pub packed_sp: f64,
    pub planned_count: u32,
    pub completed_count: u32,
    #[serde(rename = "completedSP")]
    pub completed_sp: f64,
    pub entries: Vec<FocusListEntry>,
    pub generated_at: String,
}

/// Day close stats used to compute the next-day capacity.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusListDayStats {
    pub date: String,
    pub planned_count: u32,
    #[serde(rename = "plannedSP")]
    pub planned_sp: f64,
    pub completed_count: u32,
    #[serde(rename = "completedSP")]
    pub completed_sp: f64,
    pub all_done: bool,
}

/// IPC payload for generating a focus list day.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusListGenerateInput {
    pub user_id: String,
    #[serde(default)]
    pub open_vault_ids: Vec<String>,
    pub date: String,
}

/// IPC payload for retrieving a current focus list day.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusListGetCurrentInput {
    pub user_id: String,
    pub date: String,
}

/// IPC payload for closing a focus list day.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusListCloseDayInput {
    pub user_id: String,
    pub stats: FocusListDayStats,
}

/// IPC response for closing a focus list day.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusListCloseDayResult {
    #[serde(rename = "nextCapacitySP")]
    pub next_capacity_sp: f64,
}

/// IPC payload for opening a focus task in a vault context.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusListNavigationClickInput {
    pub task_id: String,
    pub vault_id: String,
}

/// IPC response for focus task navigation requests.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusListNavigationResult {
    pub ok: bool,
}

// =============================================================================
// Project Types
// =============================================================================

/// A project for managing stories and epics
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub key: String,
    pub description: Option<String>,
    pub status: String,
    pub priority: String,
    pub project_type: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created: String,
    pub updated: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_completion_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl Project {
    /// Create a Project from frontmatter and body content
    pub fn from_frontmatter(
        fm: &markdown_parser::Frontmatter,
        body: &str,
    ) -> Result<Self, AppError> {
        let get_str = |key: &str| -> String {
            fm.get(key)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string()
        };

        let get_str_opt = |key: &str| -> Option<String> {
            fm.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
        };

        let id = get_str("id");
        if id.is_empty() {
            return Err(AppError::validation_error("Project missing 'id' field"));
        }

        let name = get_str("name");
        if name.is_empty() {
            return Err(AppError::validation_error("Project missing 'name' field"));
        }

        // Parse tags
        let tags = fm
            .get("tags")
            .and_then(|v| v.as_sequence())
            .map(|seq| {
                seq.iter()
                    .filter_map(|item| item.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        Ok(Self {
            id,
            name,
            key: get_str_opt("key").unwrap_or_else(|| "PROJ".to_string()),
            description: get_str_opt("description"),
            status: get_str_opt("status").unwrap_or_else(|| "active".to_string()),
            priority: get_str_opt("priority").unwrap_or_else(|| "medium".to_string()),
            project_type: get_str_opt("project_type").unwrap_or_else(|| "software".to_string()),
            tags,
            created: get_str("created"),
            updated: get_str("updated"),
            start_date: get_str_opt("start_date"),
            target_completion_date: get_str_opt("target_completion_date"),
            notes: if body.trim().is_empty() {
                None
            } else {
                Some(body.trim().to_string())
            },
        })
    }

    /// Convert to frontmatter for serialization
    pub fn to_frontmatter(&self) -> (markdown_parser::Frontmatter, String) {
        let mut fm = markdown_parser::Frontmatter::new();

        fm.insert("id".into(), serde_yaml::Value::String(self.id.clone()));
        fm.insert("name".into(), serde_yaml::Value::String(self.name.clone()));
        fm.insert("key".into(), serde_yaml::Value::String(self.key.clone()));
        fm.insert(
            "status".into(),
            serde_yaml::Value::String(self.status.clone()),
        );
        fm.insert(
            "priority".into(),
            serde_yaml::Value::String(self.priority.clone()),
        );
        fm.insert(
            "project_type".into(),
            serde_yaml::Value::String(self.project_type.clone()),
        );

        if let Some(ref description) = self.description {
            fm.insert(
                "description".into(),
                serde_yaml::Value::String(description.clone()),
            );
        }

        if let Some(ref start_date) = self.start_date {
            fm.insert(
                "start_date".into(),
                serde_yaml::Value::String(start_date.clone()),
            );
        }

        if let Some(ref target_completion_date) = self.target_completion_date {
            fm.insert(
                "target_completion_date".into(),
                serde_yaml::Value::String(target_completion_date.clone()),
            );
        }

        // Tags
        let tags: Vec<serde_yaml::Value> = self
            .tags
            .iter()
            .map(|s| serde_yaml::Value::String(s.clone()))
            .collect();
        fm.insert("tags".into(), serde_yaml::Value::Sequence(tags));

        fm.insert(
            "created".into(),
            serde_yaml::Value::String(self.created.clone()),
        );
        fm.insert(
            "updated".into(),
            serde_yaml::Value::String(self.updated.clone()),
        );

        let body = self.notes.clone().unwrap_or_default();
        (fm, body)
    }
}

/// Data for creating a new project
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCreate {
    pub name: String,
    #[serde(default = "default_project_key")]
    pub key: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_project_type")]
    pub project_type: String,
    #[serde(default = "default_priority")]
    pub priority: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub target_completion_date: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

fn default_project_key() -> String {
    "PROJ".to_string()
}

fn default_project_type() -> String {
    "software".to_string()
}

impl ProjectCreate {
    /// Convert to a full Project with generated ID and timestamps
    pub fn into_project(self) -> Project {
        let now = Utc::now().to_rfc3339();
        let id = format!(
            "proj_{}",
            uuid::Uuid::new_v4().to_string().replace("-", "")[..12].to_string()
        );

        Project {
            id,
            name: self.name,
            key: self.key,
            description: self.description,
            status: "active".to_string(),
            priority: self.priority,
            project_type: self.project_type,
            tags: self.tags,
            created: now.clone(),
            updated: now,
            start_date: self.start_date,
            target_completion_date: self.target_completion_date,
            notes: self.notes,
        }
    }
}

/// Data for updating an existing project
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_completion_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl ProjectUpdate {
    /// Apply updates to an existing project
    pub fn apply_to(self, mut project: Project) -> Project {
        if let Some(name) = self.name {
            project.name = name;
        }
        if let Some(key) = self.key {
            project.key = key;
        }
        if let Some(description) = self.description {
            project.description = Some(description);
        }
        if let Some(status) = self.status {
            project.status = status;
        }
        if let Some(priority) = self.priority {
            project.priority = priority;
        }
        if let Some(project_type) = self.project_type {
            project.project_type = project_type;
        }
        if let Some(tags) = self.tags {
            project.tags = tags;
        }
        if let Some(start_date) = self.start_date {
            project.start_date = Some(start_date);
        }
        if let Some(target_completion_date) = self.target_completion_date {
            project.target_completion_date = Some(target_completion_date);
        }
        if let Some(notes) = self.notes {
            project.notes = Some(notes);
        }
        project.updated = Utc::now().to_rfc3339();
        project
    }
}

// =============================================================================
// Project Task Types
// =============================================================================

/// A task within a project
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTask {
    pub id: String,
    pub title: String,
    pub column: String,
    pub points: u8,
    pub priority: String,
    /// Flag to identify task entries for indexing
    pub is_task: bool,
    /// Workspace ID associated with this task
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_by: Option<String>,
    #[serde(default)]
    pub subtasks: Vec<Subtask>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub created: String,
    pub updated: String,
}

impl ProjectTask {
    /// Create a ProjectTask from frontmatter and body content
    pub fn from_frontmatter(
        fm: &markdown_parser::Frontmatter,
        body: &str,
    ) -> Result<Self, AppError> {
        let get_str = |key: &str| -> String {
            fm.get(key)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string()
        };

        let get_str_opt = |key: &str| -> Option<String> {
            fm.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
        };

        let get_bool = |key: &str| -> Option<bool> { fm.get(key).and_then(|v| v.as_bool()) };

        let id = get_str("id");
        if id.is_empty() {
            return Err(AppError::validation_error("Task missing 'id' field"));
        }

        let title = get_str("title");
        if title.is_empty() {
            return Err(AppError::validation_error("Task missing 'title' field"));
        }

        // Parse subtasks
        let subtasks = fm
            .get("subtasks")
            .and_then(|v| v.as_sequence())
            .map(|seq| {
                seq.iter()
                    .filter_map(|item| {
                        let title = item.get("title")?.as_str()?.to_string();
                        let done = item.get("done").and_then(|d| d.as_bool()).unwrap_or(false);
                        Some(Subtask { title, done })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let points = fm
            .get("points")
            .and_then(|v| v.as_u64())
            .map(|v| v as u8)
            .unwrap_or(1);

        Ok(Self {
            id,
            title,
            column: get_str_opt("column").unwrap_or_else(|| "backlog".to_string()),
            points,
            priority: get_str_opt("priority").unwrap_or_else(|| "medium".to_string()),
            is_task: get_bool("is_task")
                .or_else(|| get_bool("isTask"))
                .unwrap_or(true),
            workspace_id: get_str_opt("workspace_id").or_else(|| get_str_opt("workspaceId")),
            due_date: get_str_opt("due_date").or_else(|| get_str_opt("dueDate")),
            completed_at: get_str_opt("completed_at").or_else(|| get_str_opt("completedAt")),
            completed_by: get_str_opt("completed_by").or_else(|| get_str_opt("completedBy")),
            subtasks,
            notes: if body.trim().is_empty() {
                None
            } else {
                Some(body.trim().to_string())
            },
            created: get_str_opt("created").unwrap_or_else(|| Utc::now().to_rfc3339()),
            updated: get_str_opt("updated").unwrap_or_else(|| Utc::now().to_rfc3339()),
        })
    }

    /// Convert to frontmatter for serialization
    pub fn to_frontmatter(&self) -> (markdown_parser::Frontmatter, String) {
        let mut fm = markdown_parser::Frontmatter::new();

        fm.insert("id".into(), serde_yaml::Value::String(self.id.clone()));
        fm.insert(
            "title".into(),
            serde_yaml::Value::String(self.title.clone()),
        );
        fm.insert(
            "column".into(),
            serde_yaml::Value::String(self.column.clone()),
        );
        fm.insert(
            "points".into(),
            serde_yaml::Value::Number(self.points.into()),
        );
        fm.insert(
            "priority".into(),
            serde_yaml::Value::String(self.priority.clone()),
        );
        fm.insert("is_task".into(), serde_yaml::Value::Bool(self.is_task));

        if let Some(ref workspace_id) = self.workspace_id {
            fm.insert(
                "workspace_id".into(),
                serde_yaml::Value::String(workspace_id.clone()),
            );
        }

        if let Some(ref due_date) = self.due_date {
            fm.insert(
                "due_date".into(),
                serde_yaml::Value::String(due_date.clone()),
            );
        }

        if let Some(ref completed_at) = self.completed_at {
            fm.insert(
                "completed_at".into(),
                serde_yaml::Value::String(completed_at.clone()),
            );
        }

        if let Some(ref completed_by) = self.completed_by {
            fm.insert(
                "completed_by".into(),
                serde_yaml::Value::String(completed_by.clone()),
            );
        }

        // Subtasks
        if !self.subtasks.is_empty() {
            let subtasks = serde_yaml::to_value(&self.subtasks).unwrap_or_default();
            fm.insert("subtasks".into(), subtasks);
        }

        fm.insert(
            "created".into(),
            serde_yaml::Value::String(self.created.clone()),
        );
        fm.insert(
            "updated".into(),
            serde_yaml::Value::String(self.updated.clone()),
        );

        let body = self.notes.clone().unwrap_or_default();
        (fm, body)
    }
}

/// Data for creating a new project task
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTaskCreate {
    pub title: String,
    #[serde(default = "default_column")]
    pub column: String,
    #[serde(default = "default_points")]
    pub points: u8,
    #[serde(default = "default_priority")]
    pub priority: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(default)]
    pub subtasks: Vec<Subtask>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl ProjectTaskCreate {
    /// Convert to a full ProjectTask with generated ID and timestamps
    pub fn into_task(self) -> ProjectTask {
        let now = Utc::now().to_rfc3339();
        let id = format!(
            "ptask_{}",
            uuid::Uuid::new_v4().to_string().replace("-", "")[..8].to_string()
        );

        ProjectTask {
            id,
            title: self.title,
            column: self.column,
            points: self.points,
            priority: self.priority,
            is_task: true,
            workspace_id: self.workspace_id,
            due_date: self.due_date,
            completed_at: None,
            completed_by: None,
            subtasks: self.subtasks,
            notes: self.notes,
            created: now.clone(),
            updated: now,
        }
    }
}

/// Data for updating an existing project task
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTaskUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub points: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtasks: Option<Vec<Subtask>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl ProjectTaskUpdate {
    /// Apply updates to an existing task
    pub fn apply_to(self, mut task: ProjectTask) -> ProjectTask {
        if let Some(title) = self.title {
            task.title = title;
        }
        if let Some(column) = self.column {
            task.column = column;
        }
        if let Some(points) = self.points {
            task.points = points;
        }
        if let Some(priority) = self.priority {
            task.priority = priority;
        }
        if let Some(due_date) = self.due_date {
            task.due_date = Some(due_date);
        }
        if let Some(completed_at) = self.completed_at {
            task.completed_at = Some(completed_at);
        }
        if let Some(completed_by) = self.completed_by {
            task.completed_by = Some(completed_by);
        }
        if let Some(subtasks) = self.subtasks {
            task.subtasks = subtasks;
        }
        if let Some(notes) = self.notes {
            task.notes = Some(notes);
        }
        task.updated = Utc::now().to_rfc3339();
        task
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_goal_from_frontmatter() {
        let mut fm = markdown_parser::Frontmatter::new();
        fm.insert(
            "id".into(),
            serde_yaml::Value::String("goal_test123".into()),
        );
        fm.insert(
            "title".into(),
            serde_yaml::Value::String("Learn Rust".into()),
        );
        fm.insert("status".into(), serde_yaml::Value::String("active".into()));
        fm.insert(
            "specific".into(),
            serde_yaml::Value::String("Build a CLI tool".into()),
        );
        fm.insert(
            "deadline".into(),
            serde_yaml::Value::String("2026-06-01".into()),
        );
        fm.insert("priority".into(), serde_yaml::Value::String("high".into()));
        fm.insert(
            "created".into(),
            serde_yaml::Value::String("2026-01-01T00:00:00Z".into()),
        );
        fm.insert(
            "updated".into(),
            serde_yaml::Value::String("2026-01-01T00:00:00Z".into()),
        );

        let goal = Goal::from_frontmatter(&fm, "Some notes here").unwrap();
        assert_eq!(goal.id, "goal_test123");
        assert_eq!(goal.title, "Learn Rust");
        assert_eq!(goal.priority, "high");
        assert_eq!(goal.notes, Some("Some notes here".to_string()));
    }

    #[test]
    fn test_goal_task_from_frontmatter() {
        let mut fm = markdown_parser::Frontmatter::new();
        fm.insert("id".into(), serde_yaml::Value::String("task_abc123".into()));
        fm.insert(
            "title".into(),
            serde_yaml::Value::String("Read the book".into()),
        );
        fm.insert("column".into(), serde_yaml::Value::String("doing".into()));
        fm.insert("points".into(), serde_yaml::Value::Number(3.into()));
        fm.insert("priority".into(), serde_yaml::Value::String("high".into()));

        let task = GoalTask::from_frontmatter(&fm, "").unwrap();
        assert_eq!(task.id, "task_abc123");
        assert_eq!(task.title, "Read the book");
        assert_eq!(task.column, "doing");
        assert_eq!(task.points, 3);
    }

    #[test]
    fn test_goal_create_into_goal() {
        let create = GoalCreate {
            title: "Test Goal".to_string(),
            short_title: None,
            goal_type: "Personal".to_string(),
            deadline: "2026-12-31".to_string(),
            priority: "high".to_string(),
            start_date: None,
            target: None,
            current: None,
            tags: vec![],
            notes: None,
            legacy_description: None,
            confidence: None,
            why: None,
            tasks: vec![],
            measurable: Measurable::default(),
        };

        let goal = create.into_goal();
        assert!(goal.id.starts_with("goal_"));
        assert_eq!(goal.title, "Test Goal");
        assert_eq!(goal.status, "active");
        assert!(!goal.created.is_empty());
    }
}
