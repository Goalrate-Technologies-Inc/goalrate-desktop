//! focus-engine - Prioritization algorithm for Goalrate
//!
//! Implements the focus scoring algorithm from the PRD, providing
//! high-performance task prioritization for Today's Focus feature.
//!
//! # Scoring Components
//!
//! The algorithm scores candidates based on:
//! - **Deadline**: How urgent is the task? (max 30 points)
//! - **Blocking**: Is it blocking other tasks/people? (max 25 points)
//! - **Priority**: What's the priority level? (max 20 points)
//! - **Streak**: Activity recency for streak maintenance (max 15 points)
//! - **Sprint**: Is it in the current sprint? (max 10 points)
//!
//! # Example
//!
//! ```
//! use focus_engine::{FocusCandidate, Priority, FocusItemType, generate_focus_list};
//! use chrono::NaiveDate;
//!
//! let today = NaiveDate::from_ymd_opt(2024, 1, 15).unwrap();
//! let candidates = vec![
//!     FocusCandidate {
//!         id: "task_1".into(),
//!         item_type: FocusItemType::GoalTask,
//!         title: "Important task".into(),
//!         points: 3,
//!         priority: Priority::High,
//!         due_date: Some(today),
//!         blocks: vec![],
//!         blocks_people: false,
//!         in_current_sprint: true,
//!         last_activity: None,
//!         goal_id: None,
//!         goal_title: None,
//!         project_id: None,
//!         project_title: None,
//!         sprint_id: None,
//!     },
//! ];
//!
//! let focus_list = generate_focus_list(candidates, 10, today).unwrap();
//! assert!(!focus_list.is_empty());
//! ```

pub mod candidates;
pub mod error;
pub mod generator;
pub mod scoring;

pub use candidates::{FocusCandidate, FocusItemType, Priority};
pub use error::{FocusError, FocusResult};
pub use generator::{generate_focus_list, FocusDay, FocusItem, FocusItemStatus};
pub use scoring::{score_candidate, ScoringBreakdown, ScoringConfig, SCORING_CONFIG};
