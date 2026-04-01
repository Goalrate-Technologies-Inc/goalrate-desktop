//! Frontmatter types

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Frontmatter data from a Markdown file
pub type Frontmatter = HashMap<String, serde_yaml::Value>;

/// Typed frontmatter for a goal file (new schema)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalFrontmatter {
    pub id: String,
    pub title: String,
    /// Goal category (e.g. Work, Health, Financial, Personal)
    #[serde(rename = "type")]
    pub goal_type: String,
    pub status: String,
    pub deadline: String,
    pub priority: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<f64>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub confidence: Option<u8>,
    #[serde(default)]
    pub why: Vec<String>,
    pub created: String,
    pub updated: String,
}

/// Legacy measurable field (kept for migration tooling)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeasurableField {
    pub unit: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<f64>,
}

/// Typed frontmatter for a goal task file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalTaskFrontmatter {
    pub id: String,
    pub title: String,
    pub column: String,
    pub points: u32,
    pub priority: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recurring: Option<bool>,
    /// Earliest date this task should appear in a daily plan (YYYY-MM-DD)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduled_date: Option<String>,
    #[serde(default)]
    pub subtasks: Vec<SubtaskField>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtaskField {
    pub title: String,
    pub done: bool,
}

/// Typed frontmatter for a project file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectFrontmatter {
    pub id: String,
    pub title: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_sprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_goal: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created: String,
    pub updated: String,
}

/// Typed frontmatter for a story file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoryFrontmatter {
    pub id: String,
    pub title: String,
    pub column: String,
    pub epic_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sprint_id: Option<String>,
    pub points: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee: Option<String>,
    pub priority: String,
    #[serde(default)]
    pub blocks: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub subtasks: Vec<SubtaskField>,
}
