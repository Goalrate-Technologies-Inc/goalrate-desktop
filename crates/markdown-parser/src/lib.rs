//! markdown-parser - YAML frontmatter parser for Goalrate
//!
//! This crate provides parsing functionality for Markdown files with
//! YAML frontmatter, which is the format used for goals, projects,
//! and other vault items.
//!
//! # Format
//! ```markdown
//! ---
//! title: My Goal
//! priority: high
//! ---
//!
//! Goal description and notes here.
//! ```

pub mod error;
pub mod frontmatter;
pub mod parser;

pub use error::ParseError;
pub use frontmatter::Frontmatter;
pub use parser::{parse_document, serialize_document};

/// Parse YAML frontmatter from Markdown content
///
/// # Example
/// ```
/// use markdown_parser::parse_frontmatter;
///
/// let content = r#"---
/// title: Test
/// priority: high
/// ---
///
/// Content here.
/// "#;
///
/// let (frontmatter, body) = parse_frontmatter(content).unwrap();
/// assert_eq!(frontmatter.get("title").unwrap().as_str().unwrap(), "Test");
/// ```
pub fn parse_frontmatter(content: &str) -> Result<(Frontmatter, String), ParseError> {
    parser::parse_document(content)
}

/// Serialize frontmatter and body back to Markdown
pub fn serialize_frontmatter(frontmatter: &Frontmatter, body: &str) -> String {
    parser::serialize_document(frontmatter, body)
}
