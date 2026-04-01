//! Focus candidate types

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

/// Priority level
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Low,
    #[default]
    Medium,
    High,
    Critical,
}

/// Source type for focus items
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FocusItemType {
    GoalTask,
    Story,
}

/// A candidate for Today's Focus
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusCandidate {
    /// Unique identifier
    pub id: String,

    /// Type of item (goal task or story)
    #[serde(rename = "type")]
    pub item_type: FocusItemType,

    /// Display title
    pub title: String,

    /// Story points / effort estimate
    pub points: u32,

    /// Priority level
    pub priority: Priority,

    /// Due date if set
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<NaiveDate>,

    /// IDs of items this blocks
    #[serde(default)]
    pub blocks: Vec<String>,

    /// Whether this blocks other people (teammates)
    #[serde(default)]
    pub blocks_people: bool,

    /// Whether this is in the current sprint
    #[serde(default)]
    pub in_current_sprint: bool,

    /// Last activity timestamp for streak calculation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_activity: Option<DateTime<Utc>>,

    // Context fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal_title: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_title: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub sprint_id: Option<String>,
}

impl FocusCandidate {
    /// Create a new focus candidate with minimal required fields
    pub fn new(
        id: impl Into<String>,
        item_type: FocusItemType,
        title: impl Into<String>,
        points: u32,
    ) -> Self {
        Self {
            id: id.into(),
            item_type,
            title: title.into(),
            points,
            priority: Priority::default(),
            due_date: None,
            blocks: vec![],
            blocks_people: false,
            in_current_sprint: false,
            last_activity: None,
            goal_id: None,
            goal_title: None,
            project_id: None,
            project_title: None,
            sprint_id: None,
        }
    }

    /// Builder method: set priority
    pub fn with_priority(mut self, priority: Priority) -> Self {
        self.priority = priority;
        self
    }

    /// Builder method: set due date
    pub fn with_due_date(mut self, due_date: NaiveDate) -> Self {
        self.due_date = Some(due_date);
        self
    }

    /// Builder method: set sprint membership
    pub fn in_sprint(mut self) -> Self {
        self.in_current_sprint = true;
        self
    }

    /// Builder method: add blocked items
    pub fn blocking(mut self, blocked_ids: Vec<String>) -> Self {
        self.blocks = blocked_ids;
        self
    }

    /// Builder method: set blocks people flag
    pub fn blocking_people(mut self) -> Self {
        self.blocks_people = true;
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_candidate_builder() {
        let today = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();

        let candidate = FocusCandidate::new("task_1", FocusItemType::GoalTask, "Test Task", 3)
            .with_priority(Priority::High)
            .with_due_date(today)
            .in_sprint();

        assert_eq!(candidate.id, "task_1");
        assert_eq!(candidate.priority, Priority::High);
        assert_eq!(candidate.due_date, Some(today));
        assert!(candidate.in_current_sprint);
    }
}
