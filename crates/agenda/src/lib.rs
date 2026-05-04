//! agenda - Assistant-backed Agenda planning for Goalrate
//!
//! Provides local SQLite-backed storage for Agenda indexes, outcomes, deferrals,
//! check-ins, chat messages, and context snapshots. The core data layer for
//! the Assistant-backed Agenda feature.
//!
//! # Features
//!
//! - Daily plan creation and management (one plan per day)
//! - Outcome tracking (Top 3 measurable deliverables per day)
//! - Deferral tracking with confrontation threshold detection
//! - End-of-day check-ins with AI summaries
//! - Chat history for Assistant-driven Agenda reprioritization
//! - Plan revision history (append-only audit trail)
//! - Daily stats aggregation for pattern recognition
//! - Context snapshots for rolling AI memory
//!
//! # Example
//!
//! ```no_run
//! use agenda::AgendaDb;
//! use chrono::NaiveDate;
//!
//! let db = AgendaDb::open_in_memory().unwrap();
//! let today = NaiveDate::from_ymd_opt(2026, 3, 26).unwrap();
//!
//! let plan = db.create_plan(today).unwrap();
//! let outcome = db.create_outcome(
//!     &plan.id,
//!     "Ship onboarding flow to staging",
//!     vec!["task_1".into(), "task_2".into()],
//!     true,
//! ).unwrap();
//! ```

pub mod context;
pub mod db;
pub mod error;
pub mod models;
pub mod prompts;

pub use context::{build_context, ContextPayload};
pub use db::AgendaDb;
pub use error::{AgendaError, AgendaResult};
pub use models::*;
pub use prompts::{
    CHAT_REPRIORITIZE_SYSTEM_PROMPT, CHECK_IN_SUMMARY_PROMPT, DAILY_PLAN_SYSTEM_PROMPT,
    DEFERRAL_CONFRONTATION_THRESHOLD, PATTERN_RECOGNITION_THRESHOLD,
};
