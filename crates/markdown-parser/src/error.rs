//! Error types for markdown parsing

use thiserror::Error;

/// Errors that can occur during parsing
#[derive(Error, Debug)]
pub enum ParseError {
    #[error("Invalid frontmatter format: {0}")]
    InvalidFormat(String),

    #[error("YAML parse error: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("Missing frontmatter delimiter")]
    MissingDelimiter,

    #[error("Empty frontmatter")]
    EmptyFrontmatter,
}
