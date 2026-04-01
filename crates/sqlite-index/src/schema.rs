//! Index schema and manager

use std::path::Path;

use rusqlite::{params, Connection};

use crate::error::{IndexError, IndexResult};
use crate::{ItemType, SearchResult};

/// Schema SQL for creating the index database
const SCHEMA_SQL: &str = r#"
-- Main items table
CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    vault_id TEXT NOT NULL,
    item_type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    status TEXT,
    priority TEXT,
    deadline TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Full-text search index using FTS5 (standalone, not content-sync)
-- We manage sync manually to avoid issues with INSERT OR REPLACE
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    id,
    title,
    content,
    item_type
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_items_vault ON items(vault_id);
CREATE INDEX IF NOT EXISTS idx_items_type ON items(item_type);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_deadline ON items(deadline);
CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at);
"#;

/// Manager for the SQLite index
pub struct IndexManager {
    conn: Connection,
}

impl IndexManager {
    /// Open or create an index database at the specified path
    pub fn open(path: impl AsRef<Path>) -> IndexResult<Self> {
        let conn = Connection::open(path)?;
        let manager = Self { conn };
        manager.migrate()?;
        Ok(manager)
    }

    /// Open an in-memory index (for testing)
    pub fn open_in_memory() -> IndexResult<Self> {
        let conn = Connection::open_in_memory()?;
        let manager = Self { conn };
        manager.migrate()?;
        Ok(manager)
    }

    /// Run migrations/schema creation
    fn migrate(&self) -> IndexResult<()> {
        self.conn
            .execute_batch(SCHEMA_SQL)
            .map_err(|e| IndexError::Migration(e.to_string()))
    }

    /// Index a goal
    #[allow(clippy::too_many_arguments)]
    pub fn index_goal(
        &self,
        id: &str,
        vault_id: &str,
        title: &str,
        content: Option<&str>,
        status: &str,
        priority: &str,
        deadline: Option<&str>,
    ) -> IndexResult<()> {
        // First, remove any existing entry from FTS
        self.conn
            .execute("DELETE FROM search_index WHERE id = ?1", params![id])?;

        self.conn.execute(
            "INSERT OR REPLACE INTO items (id, vault_id, item_type, title, content, status, priority, deadline, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))",
            params![
                id,
                vault_id,
                ItemType::Goal.as_str(),
                title,
                content,
                status,
                priority,
                deadline,
            ],
        )?;

        // Insert into FTS
        self.conn.execute(
            "INSERT INTO search_index (id, title, content, item_type) VALUES (?1, ?2, ?3, ?4)",
            params![id, title, content.unwrap_or(""), ItemType::Goal.as_str()],
        )?;

        Ok(())
    }

    /// Index a goal task
    #[allow(clippy::too_many_arguments)]
    pub fn index_goal_task(
        &self,
        id: &str,
        vault_id: &str,
        title: &str,
        content: Option<&str>,
        status: &str,
        priority: &str,
        deadline: Option<&str>,
    ) -> IndexResult<()> {
        // First, remove any existing entry from FTS
        self.conn
            .execute("DELETE FROM search_index WHERE id = ?1", params![id])?;

        self.conn.execute(
            "INSERT OR REPLACE INTO items (id, vault_id, item_type, title, content, status, priority, deadline, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))",
            params![
                id,
                vault_id,
                ItemType::GoalTask.as_str(),
                title,
                content,
                status,
                priority,
                deadline,
            ],
        )?;

        // Insert into FTS
        self.conn.execute(
            "INSERT INTO search_index (id, title, content, item_type) VALUES (?1, ?2, ?3, ?4)",
            params![
                id,
                title,
                content.unwrap_or(""),
                ItemType::GoalTask.as_str()
            ],
        )?;

        Ok(())
    }

    /// Index a project
    pub fn index_project(
        &self,
        id: &str,
        vault_id: &str,
        title: &str,
        content: Option<&str>,
        status: &str,
    ) -> IndexResult<()> {
        // First, remove any existing entry from FTS
        self.conn
            .execute("DELETE FROM search_index WHERE id = ?1", params![id])?;

        self.conn.execute(
            "INSERT OR REPLACE INTO items (id, vault_id, item_type, title, content, status, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))",
            params![
                id,
                vault_id,
                ItemType::Project.as_str(),
                title,
                content,
                status,
            ],
        )?;

        // Insert into FTS
        self.conn.execute(
            "INSERT INTO search_index (id, title, content, item_type) VALUES (?1, ?2, ?3, ?4)",
            params![id, title, content.unwrap_or(""), ItemType::Project.as_str()],
        )?;

        Ok(())
    }

    /// Index a story
    pub fn index_story(
        &self,
        id: &str,
        vault_id: &str,
        title: &str,
        content: Option<&str>,
        status: &str,
        priority: &str,
    ) -> IndexResult<()> {
        // First, remove any existing entry from FTS
        self.conn
            .execute("DELETE FROM search_index WHERE id = ?1", params![id])?;

        self.conn.execute(
            "INSERT OR REPLACE INTO items (id, vault_id, item_type, title, content, status, priority, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))",
            params![
                id,
                vault_id,
                ItemType::Story.as_str(),
                title,
                content,
                status,
                priority,
            ],
        )?;

        // Insert into FTS
        self.conn.execute(
            "INSERT INTO search_index (id, title, content, item_type) VALUES (?1, ?2, ?3, ?4)",
            params![id, title, content.unwrap_or(""), ItemType::Story.as_str()],
        )?;

        Ok(())
    }

    /// Search the index using FTS5
    pub fn search(&self, query: &str, limit: usize) -> IndexResult<Vec<SearchResult>> {
        // Escape special FTS5 characters for safety
        let safe_query = query.replace('"', "\"\"");

        let mut stmt = self.conn.prepare(
            r#"SELECT
                id,
                item_type,
                title,
                COALESCE(snippet(search_index, 2, '<b>', '</b>', '...', 32), '') as snippet,
                rank as score
             FROM search_index
             WHERE search_index MATCH ?1
             ORDER BY rank
             LIMIT ?2"#,
        )?;

        let results = stmt
            .query_map(params![safe_query, limit as i64], |row| {
                let type_str: String = row.get(1)?;
                let item_type = ItemType::parse(&type_str).unwrap_or(ItemType::Goal);

                Ok(SearchResult {
                    id: row.get(0)?,
                    item_type,
                    title: row.get(2)?,
                    snippet: row.get(3)?,
                    relevance_score: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(results)
    }

    /// Search within a specific vault
    pub fn search_vault(
        &self,
        vault_id: &str,
        query: &str,
        limit: usize,
    ) -> IndexResult<Vec<SearchResult>> {
        let safe_query = query.replace('"', "\"\"");

        let mut stmt = self.conn.prepare(
            r#"SELECT
                s.id,
                s.item_type,
                s.title,
                COALESCE(snippet(search_index, 2, '<b>', '</b>', '...', 32), '') as snippet,
                s.rank as score
             FROM search_index s
             JOIN items i ON s.id = i.id
             WHERE search_index MATCH ?1 AND i.vault_id = ?2
             ORDER BY s.rank
             LIMIT ?3"#,
        )?;

        let results = stmt
            .query_map(params![safe_query, vault_id, limit as i64], |row| {
                let type_str: String = row.get(1)?;
                let item_type = ItemType::parse(&type_str).unwrap_or(ItemType::Goal);

                Ok(SearchResult {
                    id: row.get(0)?,
                    item_type,
                    title: row.get(2)?,
                    snippet: row.get(3)?,
                    relevance_score: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(results)
    }

    /// Delete an item from the index
    pub fn delete(&self, id: &str) -> IndexResult<bool> {
        // Delete from FTS first
        self.conn
            .execute("DELETE FROM search_index WHERE id = ?1", params![id])?;

        let rows = self
            .conn
            .execute("DELETE FROM items WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    }

    /// Delete all items in a vault
    pub fn delete_vault(&self, vault_id: &str) -> IndexResult<usize> {
        // Delete from FTS first (need to get the IDs)
        self.conn.execute(
            "DELETE FROM search_index WHERE id IN (SELECT id FROM items WHERE vault_id = ?1)",
            params![vault_id],
        )?;

        let rows = self
            .conn
            .execute("DELETE FROM items WHERE vault_id = ?1", params![vault_id])?;
        Ok(rows)
    }

    /// Get items by type in a vault
    pub fn get_by_type(
        &self,
        vault_id: &str,
        item_type: ItemType,
        limit: usize,
    ) -> IndexResult<Vec<SearchResult>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, item_type, title, COALESCE(content, '') as snippet, 0.0 as score
             FROM items
             WHERE vault_id = ?1 AND item_type = ?2
             ORDER BY updated_at DESC
             LIMIT ?3",
        )?;

        let results = stmt
            .query_map(params![vault_id, item_type.as_str(), limit as i64], |row| {
                let type_str: String = row.get(1)?;
                let parsed_type = ItemType::parse(&type_str).unwrap_or(ItemType::Goal);

                Ok(SearchResult {
                    id: row.get(0)?,
                    item_type: parsed_type,
                    title: row.get(2)?,
                    snippet: row.get(3)?,
                    relevance_score: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(results)
    }

    /// Rebuild the FTS index by re-syncing from the items table
    pub fn rebuild_index(&self) -> IndexResult<()> {
        // Clear FTS and rebuild from items table
        self.conn.execute("DELETE FROM search_index", [])?;
        self.conn.execute(
            "INSERT INTO search_index (id, title, content, item_type)
             SELECT id, title, COALESCE(content, ''), item_type FROM items",
            [],
        )?;
        Ok(())
    }

    /// Get statistics about the index
    pub fn stats(&self) -> IndexResult<IndexStats> {
        let total: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))?;

        let mut stmt = self
            .conn
            .prepare("SELECT item_type, COUNT(*) FROM items GROUP BY item_type")?;

        let by_type: Vec<(String, i64)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(IndexStats {
            total_items: total as usize,
            by_type,
        })
    }
}

/// Index statistics
#[derive(Debug, Clone)]
pub struct IndexStats {
    pub total_items: usize,
    pub by_type: Vec<(String, i64)>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_and_search() {
        let manager = IndexManager::open_in_memory().unwrap();

        manager
            .index_goal(
                "goal_1",
                "vault_1",
                "Learn Rust",
                Some("Study the Rust programming language"),
                "active",
                "high",
                None,
            )
            .unwrap();

        let results = manager.search("Rust", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Learn Rust");
        assert_eq!(results[0].item_type, ItemType::Goal);
    }

    #[test]
    fn test_search_multiple_items() {
        let manager = IndexManager::open_in_memory().unwrap();

        manager
            .index_goal(
                "goal_1",
                "vault_1",
                "Learn Rust",
                Some("Programming language"),
                "active",
                "high",
                None,
            )
            .unwrap();

        manager
            .index_goal(
                "goal_2",
                "vault_1",
                "Learn TypeScript",
                Some("Programming language"),
                "active",
                "medium",
                None,
            )
            .unwrap();

        let results = manager.search("Learn", 10).unwrap();
        assert_eq!(results.len(), 2);

        let results = manager.search("Rust", 10).unwrap();
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn test_search_vault_filter() {
        let manager = IndexManager::open_in_memory().unwrap();

        manager
            .index_goal(
                "goal_1",
                "vault_1",
                "Goal in vault 1",
                None,
                "active",
                "high",
                None,
            )
            .unwrap();

        manager
            .index_goal(
                "goal_2",
                "vault_2",
                "Goal in vault 2",
                None,
                "active",
                "high",
                None,
            )
            .unwrap();

        let results = manager.search_vault("vault_1", "Goal", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "goal_1");
    }

    #[test]
    fn test_delete() {
        let manager = IndexManager::open_in_memory().unwrap();

        manager
            .index_goal(
                "goal_1",
                "vault_1",
                "Test Goal",
                None,
                "active",
                "high",
                None,
            )
            .unwrap();

        let results = manager.search("Test", 10).unwrap();
        assert_eq!(results.len(), 1);

        assert!(manager.delete("goal_1").unwrap());

        let results = manager.search("Test", 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_stats() {
        let manager = IndexManager::open_in_memory().unwrap();

        manager
            .index_goal("goal_1", "vault_1", "Goal 1", None, "active", "high", None)
            .unwrap();

        manager
            .index_goal_task("task_1", "vault_1", "Task 1", None, "todo", "medium", None)
            .unwrap();

        let stats = manager.stats().unwrap();
        assert_eq!(stats.total_items, 2);
    }

    #[test]
    fn test_update_existing_item() {
        let manager = IndexManager::open_in_memory().unwrap();

        manager
            .index_goal(
                "goal_1",
                "vault_1",
                "Original Title",
                None,
                "active",
                "high",
                None,
            )
            .unwrap();

        // Update the same item
        manager
            .index_goal(
                "goal_1",
                "vault_1",
                "Updated Title",
                None,
                "active",
                "high",
                None,
            )
            .unwrap();

        let results = manager.search("Updated", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Updated Title");

        // Original should not be found
        let results = manager.search("Original", 10).unwrap();
        assert!(results.is_empty());
    }
}
