//! Error types for index operations

use thiserror::Error;

pub type IndexResult<T> = Result<T, IndexError>;

#[derive(Error, Debug)]
pub enum IndexError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Index not initialized")]
    NotInitialized,

    #[error("Index corrupted: {0}")]
    Corrupted(String),

    #[error("Item not found: {0}")]
    NotFound(String),

    #[error("Migration failed: {0}")]
    Migration(String),

    #[error("Invalid query: {0}")]
    InvalidQuery(String),
}
