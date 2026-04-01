//! Focus list generation

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use crate::candidates::{FocusCandidate, FocusItemType};
use crate::error::FocusResult;
use crate::scoring::{score_candidate, ScoringBreakdown};

/// Status of a focus item
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FocusItemStatus {
    #[default]
    Pending,
    InProgress,
    Done,
    Deferred,
}

/// A selected focus item for today
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusItem {
    /// Source item ID
    pub source: String,

    /// Type of item
    #[serde(rename = "type")]
    pub item_type: FocusItemType,

    /// Display title
    pub title: String,

    /// Story points
    pub points: u32,

    /// Calculated score
    pub score: u32,

    /// Human-readable reason for selection
    pub reason: String,

    /// Current status
    pub status: FocusItemStatus,

    /// Score breakdown
    pub breakdown: ScoringBreakdown,

    // Context
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal_title: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_title: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub deferred_to: Option<NaiveDate>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

/// Daily focus configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusDay {
    /// Unique ID (format: focus_YYYY-MM-DD)
    pub id: String,

    /// Date for this focus day
    pub date: NaiveDate,

    /// Available working hours
    pub available_hours: f32,

    /// Point capacity based on velocity
    pub point_capacity: u32,

    /// Selected focus items
    pub items: Vec<FocusItem>,

    /// Total planned points
    pub planned_points: u32,

    /// Completed points so far
    pub completed_points: u32,

    /// Number of completed items
    pub completed_items: u32,
}

impl FocusDay {
    /// Create a new focus day
    pub fn new(date: NaiveDate, available_hours: f32, point_capacity: u32) -> Self {
        Self {
            id: format!("focus_{}", date),
            date,
            available_hours,
            point_capacity,
            items: vec![],
            planned_points: 0,
            completed_points: 0,
            completed_items: 0,
        }
    }

    /// Mark an item as complete
    pub fn complete_item(&mut self, source: &str) -> bool {
        if let Some(item) = self.items.iter_mut().find(|i| i.source == source) {
            if item.status != FocusItemStatus::Done {
                item.status = FocusItemStatus::Done;
                item.completed_at = Some(chrono::Utc::now().to_rfc3339());
                self.completed_points += item.points;
                self.completed_items += 1;
                return true;
            }
        }
        false
    }

    /// Defer an item to another date
    pub fn defer_item(&mut self, source: &str, to_date: NaiveDate) -> bool {
        if let Some(item) = self.items.iter_mut().find(|i| i.source == source) {
            if item.status == FocusItemStatus::Pending {
                item.status = FocusItemStatus::Deferred;
                item.deferred_to = Some(to_date);
                self.planned_points -= item.points;
                return true;
            }
        }
        false
    }

    /// Get completion percentage
    pub fn completion_percentage(&self) -> f32 {
        if self.planned_points == 0 {
            0.0
        } else {
            (self.completed_points as f32 / self.planned_points as f32) * 100.0
        }
    }
}

/// Generate a focus list using a knapsack-like greedy algorithm
pub fn generate_focus_list(
    candidates: Vec<FocusCandidate>,
    point_capacity: u32,
    today: NaiveDate,
) -> FocusResult<Vec<FocusItem>> {
    // Score all candidates
    let mut scored: Vec<(FocusCandidate, ScoringBreakdown)> = candidates
        .into_iter()
        .map(|c| {
            let score = score_candidate(&c, today);
            (c, score)
        })
        .collect();

    // Sort by total score descending
    scored.sort_by(|a, b| b.1.total.cmp(&a.1.total));

    // Greedy selection up to capacity
    let mut selected = Vec::new();
    let mut points_used: u32 = 0;

    for (candidate, breakdown) in scored {
        if points_used + candidate.points <= point_capacity {
            let reason = generate_reason(&candidate, &breakdown);

            selected.push(FocusItem {
                source: candidate.id,
                item_type: candidate.item_type,
                title: candidate.title,
                points: candidate.points,
                score: breakdown.total,
                reason,
                status: FocusItemStatus::Pending,
                breakdown,
                goal_id: candidate.goal_id,
                goal_title: candidate.goal_title,
                project_id: candidate.project_id,
                project_title: candidate.project_title,
                deferred_to: None,
                completed_at: None,
            });

            points_used += candidate.points;
        }
    }

    Ok(selected)
}

/// Generate a human-readable reason for selection
fn generate_reason(candidate: &FocusCandidate, breakdown: &ScoringBreakdown) -> String {
    let mut reasons = Vec::new();

    // Deadline reasons
    if breakdown.deadline >= 28 {
        if breakdown.deadline == 30 {
            reasons.push("Overdue".to_string());
        } else {
            reasons.push("Due today".to_string());
        }
    } else if breakdown.deadline >= 20 {
        reasons.push("Due this week".to_string());
    }

    // Blocking reasons
    if candidate.blocks_people {
        reasons.push("Blocking teammates".to_string());
    } else if !candidate.blocks.is_empty() {
        reasons.push(format!("Blocking {} tasks", candidate.blocks.len()));
    }

    // Sprint reason
    if candidate.in_current_sprint {
        reasons.push("Sprint commitment".to_string());
    }

    // Priority reason (only for high/critical)
    if breakdown.priority >= 15 {
        if breakdown.priority == 20 {
            reasons.push("Critical priority".to_string());
        } else {
            reasons.push("High priority".to_string());
        }
    }

    if reasons.is_empty() {
        "Available task".to_string()
    } else {
        reasons.join(", ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::candidates::Priority;

    #[test]
    fn test_generate_focus_list() {
        let today = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();

        let candidates = vec![
            FocusCandidate::new("task_1", FocusItemType::GoalTask, "High priority task", 3)
                .with_priority(Priority::High)
                .with_due_date(today)
                .in_sprint(),
            FocusCandidate::new("task_2", FocusItemType::GoalTask, "Low priority task", 5)
                .with_priority(Priority::Low),
        ];

        let result = generate_focus_list(candidates, 10, today).unwrap();

        // High priority should be selected first
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].title, "High priority task");
        assert!(result[0].score > result[1].score);
    }

    #[test]
    fn test_capacity_constraint() {
        let today = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();

        let candidates = vec![
            FocusCandidate::new("task_1", FocusItemType::GoalTask, "Task 1", 5)
                .with_priority(Priority::High),
            FocusCandidate::new("task_2", FocusItemType::GoalTask, "Task 2", 5)
                .with_priority(Priority::Medium),
            FocusCandidate::new("task_3", FocusItemType::GoalTask, "Task 3", 5)
                .with_priority(Priority::Low),
        ];

        // Only 8 points capacity - should only fit highest priority
        let result = generate_focus_list(candidates, 8, today).unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].title, "Task 1");
    }

    #[test]
    fn test_focus_day_complete_item() {
        let today = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let mut focus_day = FocusDay::new(today, 8.0, 15);

        focus_day.items.push(FocusItem {
            source: "task_1".into(),
            item_type: FocusItemType::GoalTask,
            title: "Test".into(),
            points: 3,
            score: 50,
            reason: "Test".into(),
            status: FocusItemStatus::Pending,
            breakdown: ScoringBreakdown {
                deadline: 20,
                blocking: 0,
                priority: 15,
                streak: 5,
                sprint: 10,
                total: 50,
            },
            goal_id: None,
            goal_title: None,
            project_id: None,
            project_title: None,
            deferred_to: None,
            completed_at: None,
        });
        focus_day.planned_points = 3;

        assert!(focus_day.complete_item("task_1"));
        assert_eq!(focus_day.completed_points, 3);
        assert_eq!(focus_day.completed_items, 1);
        assert_eq!(focus_day.items[0].status, FocusItemStatus::Done);
    }

    #[test]
    fn test_focus_day_defer_item() {
        let today = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
        let tomorrow = NaiveDate::from_ymd_opt(2024, 1, 16).unwrap();
        let mut focus_day = FocusDay::new(today, 8.0, 15);

        focus_day.items.push(FocusItem {
            source: "task_1".into(),
            item_type: FocusItemType::GoalTask,
            title: "Test".into(),
            points: 3,
            score: 50,
            reason: "Test".into(),
            status: FocusItemStatus::Pending,
            breakdown: ScoringBreakdown {
                deadline: 20,
                blocking: 0,
                priority: 15,
                streak: 5,
                sprint: 10,
                total: 50,
            },
            goal_id: None,
            goal_title: None,
            project_id: None,
            project_title: None,
            deferred_to: None,
            completed_at: None,
        });
        focus_day.planned_points = 3;

        assert!(focus_day.defer_item("task_1", tomorrow));
        assert_eq!(focus_day.planned_points, 0);
        assert_eq!(focus_day.items[0].status, FocusItemStatus::Deferred);
        assert_eq!(focus_day.items[0].deferred_to, Some(tomorrow));
    }

    #[test]
    fn test_reason_generation() {
        let today = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();

        // Overdue + blocking people + high priority
        let candidate = FocusCandidate::new("task_1", FocusItemType::GoalTask, "Test", 3)
            .with_priority(Priority::High)
            .with_due_date(NaiveDate::from_ymd_opt(2024, 1, 10).unwrap())
            .blocking_people();

        let result = generate_focus_list(vec![candidate], 10, today).unwrap();

        assert!(result[0].reason.contains("Overdue"));
        assert!(result[0].reason.contains("Blocking teammates"));
        assert!(result[0].reason.contains("High priority"));
    }
}
