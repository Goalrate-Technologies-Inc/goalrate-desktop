//! Error types for focus engine

use thiserror::Error;

pub type FocusResult<T> = Result<T, FocusError>;

#[derive(Error, Debug)]
pub enum FocusError {
    #[error("Invalid candidate: {0}")]
    InvalidCandidate(String),

    #[error("No candidates available")]
    NoCandidates,

    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
}
