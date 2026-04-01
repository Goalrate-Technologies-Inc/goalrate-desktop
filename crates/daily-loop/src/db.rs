//! Database manager for the daily loop feature

use std::path::Path;

use chrono::{NaiveDate, NaiveDateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::error::{DailyLoopError, DailyLoopResult};
use crate::models::*;

/// Schema SQL for creating the daily loop database
const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS daily_plans (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,
    top_3_outcome_ids TEXT NOT NULL DEFAULT '[]',
    task_order TEXT NOT NULL DEFAULT '[]',
    task_titles TEXT NOT NULL DEFAULT '{}',
    completed_task_ids TEXT NOT NULL DEFAULT '[]',
    locked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outcomes (
    id TEXT PRIMARY KEY,
    daily_plan_id TEXT NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    linked_task_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    ai_generated INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS deferrals (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    date TEXT NOT NULL,
    reason TEXT,
    ai_interpretation TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS check_ins (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,
    completed_task_ids TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    ai_summary TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS context_snapshots (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    summary_text TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    daily_plan_id TEXT NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'ai')),
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_stats (
    date TEXT NOT NULL,
    domain TEXT NOT NULL DEFAULT '',
    planned_count INTEGER NOT NULL DEFAULT 0,
    completed_count INTEGER NOT NULL DEFAULT 0,
    deferred_count INTEGER NOT NULL DEFAULT 0,
    avg_task_minutes REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (date, domain)
);

CREATE TABLE IF NOT EXISTS plan_revisions (
    id TEXT PRIMARY KEY,
    daily_plan_id TEXT NOT NULL REFERENCES daily_plans(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    task_order TEXT NOT NULL DEFAULT '[]',
    top_3 TEXT NOT NULL DEFAULT '[]',
    trigger TEXT NOT NULL DEFAULT 'initial',
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deferrals_task_id ON deferrals(task_id);
CREATE INDEX IF NOT EXISTS idx_deferrals_date ON deferrals(date);
CREATE INDEX IF NOT EXISTS idx_chat_messages_plan_id ON chat_messages(daily_plan_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_plan_id ON outcomes(daily_plan_id);
CREATE INDEX IF NOT EXISTS idx_context_snapshots_date ON context_snapshots(date);
CREATE INDEX IF NOT EXISTS idx_plan_revisions_plan_id ON plan_revisions(daily_plan_id);
"#;

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

fn now() -> NaiveDateTime {
    Utc::now().naive_utc()
}

const DT_FMT: &str = "%Y-%m-%d %H:%M:%S";

fn fmt_dt(dt: &NaiveDateTime) -> String {
    dt.format(DT_FMT).to_string()
}

fn parse_dt(s: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(s, DT_FMT)
        .or_else(|_| s.parse())
        .unwrap_or_else(|_| now())
}

fn parse_json_vec(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_default()
}

fn parse_date(s: &str) -> NaiveDate {
    s.parse()
        .unwrap_or(NaiveDate::from_ymd_opt(2000, 1, 1).unwrap())
}

/// Manager for the daily loop SQLite database
pub struct DailyLoopDb {
    conn: Connection,
}

impl DailyLoopDb {
    /// Open or create a daily loop database at the specified path
    pub fn open(path: impl AsRef<Path>) -> DailyLoopResult<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    /// Open an in-memory database (for testing)
    pub fn open_in_memory() -> DailyLoopResult<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> DailyLoopResult<()> {
        self.conn
            .execute_batch(SCHEMA_SQL)
            .map_err(|e| DailyLoopError::Migration(e.to_string()))?;

        // Migration: add task_titles column to existing daily_plans tables
        let has_task_titles: bool = self
            .conn
            .prepare(
                "SELECT COUNT(*) FROM pragma_table_info('daily_plans') WHERE name='task_titles'",
            )?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|c| c > 0)
            .unwrap_or(false);
        if !has_task_titles {
            self.conn.execute_batch(
                "ALTER TABLE daily_plans ADD COLUMN task_titles TEXT NOT NULL DEFAULT '{}'",
            )?;
        }

        // Migration: add completed_task_ids column
        let has_completed: bool = self
            .conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('daily_plans') WHERE name='completed_task_ids'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|c| c > 0)
            .unwrap_or(false);
        if !has_completed {
            self.conn.execute_batch(
                "ALTER TABLE daily_plans ADD COLUMN completed_task_ids TEXT NOT NULL DEFAULT '[]'",
            )?;
        }

        Ok(())
    }

    fn read_plan(row: &rusqlite::Row) -> rusqlite::Result<DailyPlan> {
        let titles_json: String = row.get::<_, String>(4).unwrap_or_else(|_| "{}".to_string());
        let task_titles: std::collections::HashMap<String, String> =
            serde_json::from_str(&titles_json).unwrap_or_default();
        let completed_json: String = row.get::<_, String>(5).unwrap_or_else(|_| "[]".to_string());
        let completed_task_ids: Vec<String> =
            serde_json::from_str(&completed_json).unwrap_or_default();
        let locked_str: Option<String> = row.get(6)?;
        Ok(DailyPlan {
            id: row.get(0)?,
            date: parse_date(&row.get::<_, String>(1)?),
            top_3_outcome_ids: parse_json_vec(&row.get::<_, String>(2)?),
            task_order: parse_json_vec(&row.get::<_, String>(3)?),
            task_titles,
            completed_task_ids,
            locked_at: locked_str.as_deref().map(parse_dt),
            created_at: parse_dt(&row.get::<_, String>(7)?),
            updated_at: parse_dt(&row.get::<_, String>(8)?),
        })
    }

    // ── DailyPlan ──────────────────────────────────────────────

    /// Get plan for a specific date
    pub fn get_plan_by_date(&self, date: NaiveDate) -> DailyLoopResult<Option<DailyPlan>> {
        self.conn
            .prepare(
                "SELECT id, date, top_3_outcome_ids, task_order, task_titles, completed_task_ids, locked_at, created_at, updated_at
                 FROM daily_plans WHERE date = ?1",
            )?
            .query_row(params![date.to_string()], Self::read_plan)
            .optional()
            .map_err(Into::into)
    }

    /// Create a new daily plan
    pub fn create_plan(&self, date: NaiveDate) -> DailyLoopResult<DailyPlan> {
        if self.get_plan_by_date(date)?.is_some() {
            return Err(DailyLoopError::PlanAlreadyExists(date.to_string()));
        }

        let plan = DailyPlan {
            id: new_id(),
            date,
            top_3_outcome_ids: vec![],
            task_order: vec![],
            task_titles: std::collections::HashMap::new(),
            completed_task_ids: vec![],
            locked_at: None,
            created_at: now(),
            updated_at: now(),
        };

        self.conn.execute(
            "INSERT INTO daily_plans (id, date, top_3_outcome_ids, task_order, task_titles, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                plan.id,
                plan.date.to_string(),
                serde_json::to_string(&plan.top_3_outcome_ids)?,
                serde_json::to_string(&plan.task_order)?,
                serde_json::to_string(&plan.task_titles)?,
                fmt_dt(&plan.created_at),
                fmt_dt(&plan.updated_at),
            ],
        )?;

        Ok(plan)
    }

    /// Update a plan's task order and outcome IDs
    pub fn update_plan(
        &self,
        plan_id: &str,
        top_3_outcome_ids: Option<Vec<String>>,
        task_order: Option<Vec<String>>,
    ) -> DailyLoopResult<DailyPlan> {
        let plan = self.get_plan_by_id(plan_id)?;
        // Note: locked_at is set by check-in as a snapshot marker, but we allow
        // edits to continue (user requested always-editable plans). The snapshot
        // captures the plan state at check-in time via plan_revisions.

        let new_outcomes = top_3_outcome_ids.unwrap_or(plan.top_3_outcome_ids);
        let new_order = task_order.unwrap_or(plan.task_order);
        let updated = now();

        self.conn.execute(
            "UPDATE daily_plans SET top_3_outcome_ids = ?1, task_order = ?2, updated_at = ?3 WHERE id = ?4",
            params![
                serde_json::to_string(&new_outcomes)?,
                serde_json::to_string(&new_order)?,
                fmt_dt(&updated),
                plan_id,
            ],
        )?;

        Ok(DailyPlan {
            top_3_outcome_ids: new_outcomes,
            task_order: new_order,
            updated_at: updated,
            ..plan
        })
    }

    /// Merge task titles into a plan (additive — existing titles preserved, new ones added/updated)
    pub fn merge_task_titles(
        &self,
        plan_id: &str,
        titles: &std::collections::HashMap<String, String>,
    ) -> DailyLoopResult<()> {
        if titles.is_empty() {
            return Ok(());
        }
        let plan = self.get_plan_by_id(plan_id)?;
        let mut merged = plan.task_titles;
        for (k, v) in titles {
            merged.insert(k.clone(), v.clone());
        }
        self.conn.execute(
            "UPDATE daily_plans SET task_titles = ?1, updated_at = ?2 WHERE id = ?3",
            params![serde_json::to_string(&merged)?, fmt_dt(&now()), plan_id,],
        )?;
        Ok(())
    }

    /// Toggle a task's completion status on a plan
    pub fn toggle_task_completion(
        &self,
        plan_id: &str,
        task_id: &str,
    ) -> DailyLoopResult<DailyPlan> {
        let plan = self.get_plan_by_id(plan_id)?;
        let mut completed = plan.completed_task_ids.clone();
        if let Some(pos) = completed.iter().position(|id| id == task_id) {
            completed.remove(pos);
        } else {
            completed.push(task_id.to_string());
        }
        self.conn.execute(
            "UPDATE daily_plans SET completed_task_ids = ?1, updated_at = ?2 WHERE id = ?3",
            params![serde_json::to_string(&completed)?, fmt_dt(&now()), plan_id,],
        )?;
        self.get_plan_by_id(plan_id)
    }

    /// Lock a plan (end-of-day)
    pub fn lock_plan(&self, plan_id: &str) -> DailyLoopResult<DailyPlan> {
        let plan = self.get_plan_by_id(plan_id)?;
        let locked = now();

        self.conn.execute(
            "UPDATE daily_plans SET locked_at = ?1, updated_at = ?2 WHERE id = ?3",
            params![fmt_dt(&locked), fmt_dt(&locked), plan_id],
        )?;

        Ok(DailyPlan {
            locked_at: Some(locked),
            updated_at: locked,
            ..plan
        })
    }

    /// Get a plan by its ID
    pub fn get_plan_by_id(&self, plan_id: &str) -> DailyLoopResult<DailyPlan> {
        self.conn
            .query_row(
                "SELECT id, date, top_3_outcome_ids, task_order, task_titles, completed_task_ids, locked_at, created_at, updated_at
                 FROM daily_plans WHERE id = ?1",
                params![plan_id],
                Self::read_plan,
            )
            .map_err(|_| DailyLoopError::NotFound(format!("Plan {plan_id}")))
    }

    // ── Outcomes ───────────────────────────────────────────────

    fn read_outcome(row: &rusqlite::Row) -> rusqlite::Result<Outcome> {
        Ok(Outcome {
            id: row.get(0)?,
            daily_plan_id: row.get(1)?,
            title: row.get(2)?,
            linked_task_ids: parse_json_vec(&row.get::<_, String>(3)?),
            created_at: parse_dt(&row.get::<_, String>(4)?),
            ai_generated: row.get::<_, i32>(5)? != 0,
        })
    }

    /// Create an outcome linked to a daily plan
    pub fn create_outcome(
        &self,
        daily_plan_id: &str,
        title: &str,
        linked_task_ids: Vec<String>,
        ai_generated: bool,
    ) -> DailyLoopResult<Outcome> {
        let plan = self.get_plan_by_id(daily_plan_id)?;
        if plan.locked_at.is_some() {
            return Err(DailyLoopError::PlanLocked);
        }

        let outcome = Outcome {
            id: new_id(),
            daily_plan_id: daily_plan_id.to_string(),
            title: title.to_string(),
            linked_task_ids,
            created_at: now(),
            ai_generated,
        };

        self.conn.execute(
            "INSERT INTO outcomes (id, daily_plan_id, title, linked_task_ids, created_at, ai_generated)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                outcome.id,
                outcome.daily_plan_id,
                outcome.title,
                serde_json::to_string(&outcome.linked_task_ids)?,
                fmt_dt(&outcome.created_at),
                outcome.ai_generated as i32,
            ],
        )?;

        Ok(outcome)
    }

    /// Get all outcomes for a daily plan
    pub fn get_outcomes_for_plan(&self, daily_plan_id: &str) -> DailyLoopResult<Vec<Outcome>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, daily_plan_id, title, linked_task_ids, created_at, ai_generated
             FROM outcomes WHERE daily_plan_id = ?1 ORDER BY created_at ASC",
        )?;
        let outcomes = stmt
            .query_map(params![daily_plan_id], Self::read_outcome)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(outcomes)
    }

    /// Update an outcome's title or linked tasks
    pub fn update_outcome(
        &self,
        outcome_id: &str,
        title: Option<&str>,
        linked_task_ids: Option<Vec<String>>,
    ) -> DailyLoopResult<Outcome> {
        let outcome = self.get_outcome_by_id(outcome_id)?;
        let plan = self.get_plan_by_id(&outcome.daily_plan_id)?;
        if plan.locked_at.is_some() {
            return Err(DailyLoopError::PlanLocked);
        }

        let new_title = title.unwrap_or(&outcome.title).to_string();
        let new_linked = linked_task_ids.unwrap_or(outcome.linked_task_ids);

        self.conn.execute(
            "UPDATE outcomes SET title = ?1, linked_task_ids = ?2 WHERE id = ?3",
            params![new_title, serde_json::to_string(&new_linked)?, outcome_id],
        )?;

        Ok(Outcome {
            title: new_title,
            linked_task_ids: new_linked,
            ..outcome
        })
    }

    /// Delete an outcome
    pub fn delete_outcome(&self, outcome_id: &str) -> DailyLoopResult<()> {
        let outcome = self.get_outcome_by_id(outcome_id)?;
        let plan = self.get_plan_by_id(&outcome.daily_plan_id)?;
        if plan.locked_at.is_some() {
            return Err(DailyLoopError::PlanLocked);
        }
        self.conn
            .execute("DELETE FROM outcomes WHERE id = ?1", params![outcome_id])?;
        Ok(())
    }

    fn get_outcome_by_id(&self, outcome_id: &str) -> DailyLoopResult<Outcome> {
        self.conn
            .query_row(
                "SELECT id, daily_plan_id, title, linked_task_ids, created_at, ai_generated
                 FROM outcomes WHERE id = ?1",
                params![outcome_id],
                Self::read_outcome,
            )
            .map_err(|_| DailyLoopError::NotFound(format!("Outcome {outcome_id}")))
    }

    // ── Deferrals ──────────────────────────────────────────────

    /// Record a task deferral
    pub fn create_deferral(
        &self,
        task_id: &str,
        date: NaiveDate,
        reason: Option<&str>,
        ai_interpretation: Option<&str>,
    ) -> DailyLoopResult<Deferral> {
        let deferral = Deferral {
            id: new_id(),
            task_id: task_id.to_string(),
            date,
            reason: reason.map(|s| s.to_string()),
            ai_interpretation: ai_interpretation.map(|s| s.to_string()),
            created_at: now(),
        };

        self.conn.execute(
            "INSERT INTO deferrals (id, task_id, date, reason, ai_interpretation, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                deferral.id,
                deferral.task_id,
                deferral.date.to_string(),
                deferral.reason,
                deferral.ai_interpretation,
                fmt_dt(&deferral.created_at),
            ],
        )?;

        Ok(deferral)
    }

    /// Get all deferrals for a task
    pub fn get_deferrals_for_task(&self, task_id: &str) -> DailyLoopResult<Vec<Deferral>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, task_id, date, reason, ai_interpretation, created_at
             FROM deferrals WHERE task_id = ?1 ORDER BY date ASC",
        )?;
        let deferrals = stmt
            .query_map(params![task_id], |row| {
                Ok(Deferral {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    date: parse_date(&row.get::<_, String>(2)?),
                    reason: row.get(3)?,
                    ai_interpretation: row.get(4)?,
                    created_at: parse_dt(&row.get::<_, String>(5)?),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(deferrals)
    }

    /// Get deferral count for a task
    pub fn get_deferral_count(&self, task_id: &str) -> DailyLoopResult<i32> {
        let count: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM deferrals WHERE task_id = ?1",
            params![task_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Get all tasks with deferral count >= threshold (for confrontation)
    pub fn get_frequently_deferred_tasks(
        &self,
        threshold: i32,
    ) -> DailyLoopResult<Vec<(String, i32)>> {
        let mut stmt = self.conn.prepare(
            "SELECT task_id, COUNT(*) as cnt FROM deferrals
             GROUP BY task_id HAVING cnt >= ?1 ORDER BY cnt DESC",
        )?;
        let results = stmt
            .query_map(params![threshold], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(results)
    }

    // ── Check-Ins ──────────────────────────────────────────────

    /// Create an end-of-day check-in
    pub fn create_check_in(
        &self,
        date: NaiveDate,
        completed_task_ids: Vec<String>,
        notes: Option<&str>,
        ai_summary: Option<&str>,
    ) -> DailyLoopResult<CheckIn> {
        let check_in = CheckIn {
            id: new_id(),
            date,
            completed_task_ids,
            notes: notes.map(|s| s.to_string()),
            ai_summary: ai_summary.map(|s| s.to_string()),
            created_at: now(),
        };

        self.conn.execute(
            "INSERT OR REPLACE INTO check_ins (id, date, completed_task_ids, notes, ai_summary, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                check_in.id,
                check_in.date.to_string(),
                serde_json::to_string(&check_in.completed_task_ids)?,
                check_in.notes,
                check_in.ai_summary,
                fmt_dt(&check_in.created_at),
            ],
        )?;

        // Auto-lock the plan for this date so it can't be modified after check-in
        let locked_at = fmt_dt(&now());
        self.conn.execute(
            "UPDATE daily_plans SET locked_at = ?1 WHERE date = ?2 AND locked_at IS NULL",
            params![locked_at, date.to_string()],
        )?;

        Ok(check_in)
    }

    fn read_check_in(row: &rusqlite::Row) -> rusqlite::Result<CheckIn> {
        Ok(CheckIn {
            id: row.get(0)?,
            date: parse_date(&row.get::<_, String>(1)?),
            completed_task_ids: parse_json_vec(&row.get::<_, String>(2)?),
            notes: row.get(3)?,
            ai_summary: row.get(4)?,
            created_at: parse_dt(&row.get::<_, String>(5)?),
        })
    }

    /// Get check-in for a date
    pub fn get_check_in(&self, date: NaiveDate) -> DailyLoopResult<Option<CheckIn>> {
        self.conn
            .prepare(
                "SELECT id, date, completed_task_ids, notes, ai_summary, created_at
                 FROM check_ins WHERE date = ?1",
            )?
            .query_row(params![date.to_string()], Self::read_check_in)
            .optional()
            .map_err(Into::into)
    }

    /// Get recent check-ins (for context assembly)
    pub fn get_recent_check_ins(&self, limit: i32) -> DailyLoopResult<Vec<CheckIn>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, date, completed_task_ids, notes, ai_summary, created_at
             FROM check_ins ORDER BY date DESC LIMIT ?1",
        )?;
        let check_ins = stmt
            .query_map(params![limit], Self::read_check_in)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(check_ins)
    }

    /// Count total check-ins (for pattern recognition threshold)
    pub fn count_check_ins(&self) -> DailyLoopResult<i32> {
        let count: i32 = self
            .conn
            .query_row("SELECT COUNT(*) FROM check_ins", [], |row| row.get(0))?;
        Ok(count)
    }

    // ── Context Snapshots ──────────────────────────────────────

    /// Save a context snapshot
    pub fn save_context_snapshot(
        &self,
        date: NaiveDate,
        summary_text: &str,
        token_count: i32,
    ) -> DailyLoopResult<ContextSnapshot> {
        let snapshot = ContextSnapshot {
            id: new_id(),
            date,
            summary_text: summary_text.to_string(),
            token_count,
            created_at: now(),
        };

        self.conn.execute(
            "INSERT INTO context_snapshots (id, date, summary_text, token_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                snapshot.id,
                snapshot.date.to_string(),
                snapshot.summary_text,
                snapshot.token_count,
                fmt_dt(&snapshot.created_at),
            ],
        )?;

        Ok(snapshot)
    }

    /// Get the most recent context snapshot
    pub fn get_latest_context_snapshot(&self) -> DailyLoopResult<Option<ContextSnapshot>> {
        self.conn
            .prepare(
                "SELECT id, date, summary_text, token_count, created_at
                 FROM context_snapshots ORDER BY date DESC LIMIT 1",
            )?
            .query_row([], |row| {
                Ok(ContextSnapshot {
                    id: row.get(0)?,
                    date: parse_date(&row.get::<_, String>(1)?),
                    summary_text: row.get(2)?,
                    token_count: row.get(3)?,
                    created_at: parse_dt(&row.get::<_, String>(4)?),
                })
            })
            .optional()
            .map_err(Into::into)
    }

    // ── Chat Messages ──────────────────────────────────────────

    /// Add a chat message to a plan session
    pub fn add_chat_message(
        &self,
        daily_plan_id: &str,
        role: ChatRole,
        content: &str,
    ) -> DailyLoopResult<ChatMessage> {
        let msg = ChatMessage {
            id: new_id(),
            daily_plan_id: daily_plan_id.to_string(),
            role,
            content: content.to_string(),
            timestamp: now(),
        };

        self.conn.execute(
            "INSERT INTO chat_messages (id, daily_plan_id, role, content, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                msg.id,
                msg.daily_plan_id,
                msg.role.as_str(),
                msg.content,
                fmt_dt(&msg.timestamp),
            ],
        )?;

        Ok(msg)
    }

    /// Get chat history for a plan
    pub fn get_chat_history(&self, daily_plan_id: &str) -> DailyLoopResult<Vec<ChatMessage>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, daily_plan_id, role, content, timestamp
             FROM chat_messages WHERE daily_plan_id = ?1 ORDER BY timestamp ASC",
        )?;
        let messages = stmt
            .query_map(params![daily_plan_id], |row| {
                Ok(ChatMessage {
                    id: row.get(0)?,
                    daily_plan_id: row.get(1)?,
                    role: ChatRole::parse(&row.get::<_, String>(2)?).unwrap_or(ChatRole::User),
                    content: row.get(3)?,
                    timestamp: parse_dt(&row.get::<_, String>(4)?),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(messages)
    }

    /// Get dates that have chat messages, ordered most recent first
    pub fn get_dates_with_chat(&self, limit: i32) -> DailyLoopResult<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT dp.date FROM daily_plans dp
             INNER JOIN chat_messages cm ON cm.daily_plan_id = dp.id
             ORDER BY dp.date DESC LIMIT ?1",
        )?;
        let dates = stmt
            .query_map(params![limit], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(dates)
    }

    // ── Daily Stats ────────────────────────────────────────────

    /// Upsert daily stats for a date+domain
    pub fn upsert_daily_stats(&self, stats: &DailyStats) -> DailyLoopResult<()> {
        self.conn.execute(
            "INSERT INTO daily_stats (date, domain, planned_count, completed_count, deferred_count, avg_task_minutes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(date, domain) DO UPDATE SET
                planned_count = excluded.planned_count,
                completed_count = excluded.completed_count,
                deferred_count = excluded.deferred_count,
                avg_task_minutes = excluded.avg_task_minutes",
            params![
                stats.date.to_string(),
                stats.domain,
                stats.planned_count,
                stats.completed_count,
                stats.deferred_count,
                stats.avg_task_minutes,
            ],
        )?;
        Ok(())
    }

    /// Get stats for the last N days (for pattern recognition)
    pub fn get_recent_stats(&self, days: i32) -> DailyLoopResult<Vec<DailyStats>> {
        let mut stmt = self.conn.prepare(
            "SELECT date, domain, planned_count, completed_count, deferred_count, avg_task_minutes
             FROM daily_stats ORDER BY date DESC LIMIT ?1",
        )?;
        let stats = stmt
            .query_map(params![days], |row| {
                Ok(DailyStats {
                    date: parse_date(&row.get::<_, String>(0)?),
                    domain: row.get(1)?,
                    planned_count: row.get(2)?,
                    completed_count: row.get(3)?,
                    deferred_count: row.get(4)?,
                    avg_task_minutes: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(stats)
    }

    // ── Plan Revisions ─────────────────────────────────────────

    /// Create a plan revision snapshot
    pub fn create_revision(
        &self,
        daily_plan_id: &str,
        top_3: Vec<String>,
        task_order: Vec<String>,
        trigger: RevisionTrigger,
    ) -> DailyLoopResult<PlanRevision> {
        let next_num: i32 = self.conn.query_row(
            "SELECT COALESCE(MAX(revision_number), -1) + 1 FROM plan_revisions WHERE daily_plan_id = ?1",
            params![daily_plan_id],
            |row| row.get(0),
        )?;

        let rev = PlanRevision {
            id: new_id(),
            daily_plan_id: daily_plan_id.to_string(),
            revision_number: next_num,
            top_3,
            task_order,
            trigger,
            timestamp: now(),
        };

        self.conn.execute(
            "INSERT INTO plan_revisions (id, daily_plan_id, revision_number, top_3, task_order, trigger, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                rev.id,
                rev.daily_plan_id,
                rev.revision_number,
                serde_json::to_string(&rev.top_3)?,
                serde_json::to_string(&rev.task_order)?,
                rev.trigger.as_str(),
                fmt_dt(&rev.timestamp),
            ],
        )?;

        Ok(rev)
    }

    /// Get revision history for a plan
    pub fn get_revisions(&self, daily_plan_id: &str) -> DailyLoopResult<Vec<PlanRevision>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, daily_plan_id, revision_number, top_3, task_order, trigger, timestamp
             FROM plan_revisions WHERE daily_plan_id = ?1 ORDER BY revision_number ASC",
        )?;
        let revisions = stmt
            .query_map(params![daily_plan_id], |row| {
                Ok(PlanRevision {
                    id: row.get(0)?,
                    daily_plan_id: row.get(1)?,
                    revision_number: row.get(2)?,
                    top_3: parse_json_vec(&row.get::<_, String>(3)?),
                    task_order: parse_json_vec(&row.get::<_, String>(4)?),
                    trigger: RevisionTrigger::parse(&row.get::<_, String>(5)?)
                        .unwrap_or(RevisionTrigger::Initial),
                    timestamp: parse_dt(&row.get::<_, String>(6)?),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(revisions)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_and_get_plan() {
        let db = DailyLoopDb::open_in_memory().unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 3, 26).unwrap();

        let plan = db.create_plan(date).unwrap();
        assert_eq!(plan.date, date);
        assert!(plan.top_3_outcome_ids.is_empty());
        assert!(plan.locked_at.is_none());

        let fetched = db.get_plan_by_date(date).unwrap().unwrap();
        assert_eq!(fetched.id, plan.id);
    }

    #[test]
    fn test_duplicate_plan_rejected() {
        let db = DailyLoopDb::open_in_memory().unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 3, 26).unwrap();

        db.create_plan(date).unwrap();
        let result = db.create_plan(date);
        assert!(matches!(result, Err(DailyLoopError::PlanAlreadyExists(_))));
    }

    #[test]
    fn test_lock_allows_edits() {
        // Plans are always editable — lock is a snapshot marker, not a write guard
        let db = DailyLoopDb::open_in_memory().unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 3, 26).unwrap();
        let plan = db.create_plan(date).unwrap();

        db.lock_plan(&plan.id).unwrap();

        let result = db.update_plan(&plan.id, None, Some(vec!["t1".into()]));
        assert!(result.is_ok());
        assert_eq!(result.unwrap().task_order, vec!["t1".to_string()]);
    }

    #[test]
    fn test_toggle_task_completion() {
        let db = DailyLoopDb::open_in_memory().unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 3, 26).unwrap();
        let plan = db.create_plan(date).unwrap();
        assert!(plan.completed_task_ids.is_empty());

        // Toggle on
        let plan = db.toggle_task_completion(&plan.id, "t1").unwrap();
        assert_eq!(plan.completed_task_ids, vec!["t1".to_string()]);

        // Toggle another
        let plan = db.toggle_task_completion(&plan.id, "t2").unwrap();
        assert_eq!(
            plan.completed_task_ids,
            vec!["t1".to_string(), "t2".to_string()]
        );

        // Toggle off
        let plan = db.toggle_task_completion(&plan.id, "t1").unwrap();
        assert_eq!(plan.completed_task_ids, vec!["t2".to_string()]);

        // Persists across re-read
        let plan = db.get_plan_by_id(&plan.id).unwrap();
        assert_eq!(plan.completed_task_ids, vec!["t2".to_string()]);
    }

    #[test]
    fn test_outcomes_crud() {
        let db = DailyLoopDb::open_in_memory().unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 3, 26).unwrap();
        let plan = db.create_plan(date).unwrap();

        let outcome = db
            .create_outcome(
                &plan.id,
                "Ship onboarding",
                vec!["t1".into(), "t2".into()],
                true,
            )
            .unwrap();
        assert_eq!(outcome.title, "Ship onboarding");
        assert!(outcome.ai_generated);

        let outcomes = db.get_outcomes_for_plan(&plan.id).unwrap();
        assert_eq!(outcomes.len(), 1);

        db.update_outcome(&outcome.id, Some("Ship v2"), None)
            .unwrap();
        let updated = db.get_outcome_by_id(&outcome.id).unwrap();
        assert_eq!(updated.title, "Ship v2");

        db.delete_outcome(&outcome.id).unwrap();
        let outcomes = db.get_outcomes_for_plan(&plan.id).unwrap();
        assert!(outcomes.is_empty());
    }

    #[test]
    fn test_deferral_tracking() {
        let db = DailyLoopDb::open_in_memory().unwrap();
        let d1 = NaiveDate::from_ymd_opt(2026, 3, 24).unwrap();
        let d2 = NaiveDate::from_ymd_opt(2026, 3, 25).unwrap();
        let d3 = NaiveDate::from_ymd_opt(2026, 3, 26).unwrap();

        db.create_deferral("task_1", d1, Some("busy"), None)
            .unwrap();
        db.create_deferral("task_1", d2, Some("still busy"), None)
            .unwrap();
        db.create_deferral("task_1", d3, None, None).unwrap();
        db.create_deferral("task_2", d3, None, None).unwrap();

        assert_eq!(db.get_deferral_count("task_1").unwrap(), 3);
        assert_eq!(db.get_deferral_count("task_2").unwrap(), 1);

        let frequent = db.get_frequently_deferred_tasks(3).unwrap();
        assert_eq!(frequent.len(), 1);
        assert_eq!(frequent[0].0, "task_1");
    }

    #[test]
    fn test_check_in_and_stats() {
        let db = DailyLoopDb::open_in_memory().unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 3, 26).unwrap();

        let ci = db
            .create_check_in(date, vec!["t1".into(), "t2".into()], Some("good day"), None)
            .unwrap();
        assert_eq!(ci.completed_task_ids.len(), 2);

        let fetched = db.get_check_in(date).unwrap().unwrap();
        assert_eq!(fetched.notes.as_deref(), Some("good day"));

        let recents = db.get_recent_check_ins(5).unwrap();
        assert_eq!(recents.len(), 1);

        assert_eq!(db.count_check_ins().unwrap(), 1);
    }

    #[test]
    fn test_chat_messages() {
        let db = DailyLoopDb::open_in_memory().unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 3, 26).unwrap();
        let plan = db.create_plan(date).unwrap();

        db.add_chat_message(&plan.id, ChatRole::User, "push pitch deck to tomorrow")
            .unwrap();
        db.add_chat_message(
            &plan.id,
            ChatRole::Ai,
            "Done. Moved pitch deck to tomorrow.",
        )
        .unwrap();

        let history = db.get_chat_history(&plan.id).unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].role, ChatRole::User);
        assert_eq!(history[1].role, ChatRole::Ai);
    }

    #[test]
    fn test_plan_revisions() {
        let db = DailyLoopDb::open_in_memory().unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 3, 26).unwrap();
        let plan = db.create_plan(date).unwrap();

        let rev0 = db
            .create_revision(
                &plan.id,
                vec!["o1".into()],
                vec!["t1".into(), "t2".into()],
                RevisionTrigger::Initial,
            )
            .unwrap();
        assert_eq!(rev0.revision_number, 0);

        let rev1 = db
            .create_revision(
                &plan.id,
                vec!["o1".into(), "o2".into()],
                vec!["t2".into(), "t1".into()],
                RevisionTrigger::Chat,
            )
            .unwrap();
        assert_eq!(rev1.revision_number, 1);

        let revisions = db.get_revisions(&plan.id).unwrap();
        assert_eq!(revisions.len(), 2);
    }

    #[test]
    fn test_daily_stats_upsert() {
        let db = DailyLoopDb::open_in_memory().unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 3, 26).unwrap();

        let stats = DailyStats {
            date,
            domain: "Startup".into(),
            planned_count: 5,
            completed_count: 3,
            deferred_count: 2,
            avg_task_minutes: 45.0,
        };
        db.upsert_daily_stats(&stats).unwrap();

        let stats2 = DailyStats {
            completed_count: 4,
            ..stats
        };
        db.upsert_daily_stats(&stats2).unwrap();

        let recent = db.get_recent_stats(10).unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].completed_count, 4);
    }

    #[test]
    fn test_context_snapshot() {
        let db = DailyLoopDb::open_in_memory().unwrap();
        let date = NaiveDate::from_ymd_opt(2026, 3, 26).unwrap();

        db.save_context_snapshot(date, "User focused on startup tasks", 150)
            .unwrap();

        let latest = db.get_latest_context_snapshot().unwrap().unwrap();
        assert_eq!(latest.token_count, 150);
    }
}
