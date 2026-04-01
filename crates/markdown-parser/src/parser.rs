//! Markdown parsing implementation

use crate::error::ParseError;
use crate::frontmatter::Frontmatter;

const FRONTMATTER_DELIMITER: &str = "---";

/// Parse a document with YAML frontmatter
pub fn parse_document(content: &str) -> Result<(Frontmatter, String), ParseError> {
    let content = content.trim();

    // Check for frontmatter start
    if !content.starts_with(FRONTMATTER_DELIMITER) {
        return Err(ParseError::MissingDelimiter);
    }

    // Find the end of frontmatter
    let rest = &content[FRONTMATTER_DELIMITER.len()..];
    let end_pos = rest
        .find(&format!("\n{}", FRONTMATTER_DELIMITER))
        .ok_or(ParseError::MissingDelimiter)?;

    let yaml_content = rest[..end_pos].trim();
    if yaml_content.is_empty() {
        return Err(ParseError::EmptyFrontmatter);
    }

    // Parse YAML
    let frontmatter: Frontmatter = serde_yaml::from_str(yaml_content)?;

    // Extract body (after second delimiter)
    let body_start = FRONTMATTER_DELIMITER.len() + end_pos + 1 + FRONTMATTER_DELIMITER.len();
    let body = if body_start < content.len() {
        content[body_start..].trim().to_string()
    } else {
        String::new()
    };

    Ok((frontmatter, body))
}

/// Serialize frontmatter and body to Markdown format
pub fn serialize_document(frontmatter: &Frontmatter, body: &str) -> String {
    let yaml = serde_yaml::to_string(frontmatter).unwrap_or_default();
    format!("---\n{}---\n\n{}", yaml, body.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_frontmatter() {
        let content = r#"---
title: Test Goal
priority: high
---

This is the body content."#;

        let (fm, body) = parse_document(content).unwrap();
        assert_eq!(fm.get("title").unwrap().as_str().unwrap(), "Test Goal");
        assert_eq!(fm.get("priority").unwrap().as_str().unwrap(), "high");
        assert_eq!(body, "This is the body content.");
    }

    #[test]
    fn test_parse_complex_frontmatter() {
        let content = r#"---
id: goal_123
title: Learn Rust
status: active
tags:
  - programming
  - learning
priority: high
---

## Notes

Some goal notes here."#;

        let (fm, body) = parse_document(content).unwrap();
        assert_eq!(fm.get("id").unwrap().as_str().unwrap(), "goal_123");
        assert_eq!(fm.get("title").unwrap().as_str().unwrap(), "Learn Rust");
        assert!(body.contains("## Notes"));
    }

    #[test]
    fn test_serialize_document() {
        let mut fm = Frontmatter::new();
        fm.insert("title".into(), serde_yaml::Value::String("Test".into()));
        fm.insert("priority".into(), serde_yaml::Value::String("high".into()));

        let result = serialize_document(&fm, "Body content");
        assert!(result.contains("title: Test"));
        assert!(result.contains("Body content"));
        assert!(result.starts_with("---\n"));
    }

    #[test]
    fn test_missing_delimiter() {
        let content = "No frontmatter here";
        assert!(matches!(
            parse_document(content),
            Err(ParseError::MissingDelimiter)
        ));
    }

    #[test]
    fn test_missing_end_delimiter() {
        let content = "---\ntitle: Test\nNo end delimiter";
        assert!(matches!(
            parse_document(content),
            Err(ParseError::MissingDelimiter)
        ));
    }

    #[test]
    fn test_empty_frontmatter() {
        let content = "---\n---\nBody only";
        assert!(matches!(
            parse_document(content),
            Err(ParseError::EmptyFrontmatter)
        ));
    }

    #[test]
    fn test_empty_body() {
        let content = r#"---
title: Test
---"#;

        let (fm, body) = parse_document(content).unwrap();
        assert_eq!(fm.get("title").unwrap().as_str().unwrap(), "Test");
        assert!(body.is_empty());
    }
}
