//! Error types for agenda operations

use thiserror::Error;

pub type AgendaResult<T> = Result<T, AgendaError>;

#[derive(Error, Debug)]
pub enum AgendaError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Plan already exists for date: {0}")]
    PlanAlreadyExists(String),

    #[error("Plan is locked and cannot be modified")]
    PlanLocked,

    #[error("Migration failed: {0}")]
    Migration(String),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Invalid input: {0}")]
    InvalidInput(String),
}
