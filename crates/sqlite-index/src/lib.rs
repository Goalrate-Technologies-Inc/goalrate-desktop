//! sqlite-index - Local database operations for Goalrate
//!
//! Provides SQLite-based indexing for fast search across vault content.
//! Uses FTS5 (Full-Text Search) for efficient text search capabilities.
//!
//! # Features
//!
//! - Full-text search with FTS5
//! - Automatic index synchronization via triggers
//! - Support for goals, tasks, projects, and stories
//! - Relevance-based search results
//!
//! # Example
//!
//! ```no_run
//! use sqlite_index::IndexManager;
//!
//! let manager = IndexManager::open_in_memory().unwrap();
//!
//! manager.index_goal(
//!     "goal_1",
//!     "vault_1",
//!     "Learn Rust",
//!     Some("Master the Rust programming language"),
//!     "active",
//!     "high",
//!     None,
//! ).unwrap();
//!
//! let results = manager.search("Rust", 10).unwrap();
//! assert!(!results.is_empty());
//! ```

pub mod error;
pub mod schema;

pub use error::{IndexError, IndexResult};
pub use schema::IndexManager;

/// Search result from vault index
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SearchResult {
    /// Item ID
    pub id: String,
    /// Type of item
    pub item_type: ItemType,
    /// Item title
    pub title: String,
    /// Highlighted snippet from content
    pub snippet: String,
    /// Relevance score (lower is better in FTS5)
    pub relevance_score: f64,
}

/// Type of indexed item
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemType {
    Goal,
    GoalTask,
    Project,
    Story,
    Sprint,
    Focus,
}

impl ItemType {
    /// Convert to string representation
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Goal => "goal",
            Self::GoalTask => "goal_task",
            Self::Project => "project",
            Self::Story => "story",
            Self::Sprint => "sprint",
            Self::Focus => "focus",
        }
    }

    /// Parse from string
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "goal" => Some(Self::Goal),
            "goal_task" => Some(Self::GoalTask),
            "project" => Some(Self::Project),
            "story" => Some(Self::Story),
            "sprint" => Some(Self::Sprint),
            "focus" => Some(Self::Focus),
            _ => None,
        }
    }
}
