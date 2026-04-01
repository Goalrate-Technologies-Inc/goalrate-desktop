//! Context assembly for AI plan generation
//!
//! Builds the context payload from local data that gets sent to the LLM.

use crate::db::DailyLoopDb;
use crate::error::DailyLoopResult;
use crate::prompts;

/// Maximum estimated tokens for the context payload
const MAX_CONTEXT_TOKENS: usize = 15_000;

/// Rough character-to-token ratio (conservative estimate)
const CHARS_PER_TOKEN: usize = 4;

/// Assembled context ready to be sent to the LLM
#[derive(Debug, Clone)]
pub struct ContextPayload {
    /// Goals context section
    pub goals_context: String,
    /// Tasks context section
    pub tasks_context: String,
    /// Check-in history section
    pub check_in_context: String,
    /// Historical stats section (empty if < PATTERN_RECOGNITION_THRESHOLD check-ins)
    pub stats_context: String,
    /// Rolling context snapshot (longer-term memory)
    pub snapshot_context: String,
    /// Whether pattern recognition is active
    pub patterns_active: bool,
    /// Total estimated token count
    pub estimated_tokens: usize,
}

impl ContextPayload {
    /// Combine all sections into a single user prompt string
    pub fn to_user_prompt(&self) -> String {
        let mut prompt = String::with_capacity(self.estimated_tokens * CHARS_PER_TOKEN);
        let today = chrono::Local::now().format("%Y-%m-%d (%A)").to_string();
        prompt.push_str(&format!("## Today's Date\n{today}\n\n"));
        prompt.push_str(&self.goals_context);
        prompt.push('\n');
        prompt.push_str(&self.tasks_context);
        prompt.push('\n');
        prompt.push_str(&self.check_in_context);

        if !self.stats_context.is_empty() {
            prompt.push('\n');
            prompt.push_str(&self.stats_context);
        }

        if !self.snapshot_context.is_empty() {
            prompt.push('\n');
            prompt.push_str(&self.snapshot_context);
        }

        prompt.push_str("\n\nGenerate today's daily plan based on the context above.");
        prompt
    }
}

/// Build a context payload from the database and vault data.
///
/// The `goals` and `tasks` parameters come from vault-core (read by the Tauri command layer).
/// The check-in history and stats come from the DailyLoopDb.
pub fn build_context(
    db: &DailyLoopDb,
    goals: &[(String, String, Option<String>)],
    tasks: &[(String, String, Option<String>, Option<String>, i32)],
) -> DailyLoopResult<ContextPayload> {
    let goals_context = prompts::format_goals_context(goals);
    let tasks_context = prompts::format_tasks_context(tasks);

    // Get last 3 check-ins
    let recent_check_ins = db.get_recent_check_ins(3)?;
    let check_in_data: Vec<_> = recent_check_ins
        .iter()
        .map(|ci| {
            (
                ci.date.to_string(),
                ci.completed_task_ids.clone(),
                ci.ai_summary.clone(),
            )
        })
        .collect();
    let check_in_context = prompts::format_check_in_history(&check_in_data);

    // Pattern recognition: only if 5+ check-ins exist
    let check_in_count = db.count_check_ins()?;
    let patterns_active = check_in_count >= prompts::PATTERN_RECOGNITION_THRESHOLD;

    let stats_context = if patterns_active {
        let recent_stats = db.get_recent_stats(14)?;
        let stats_data: Vec<_> = recent_stats
            .iter()
            .map(|s| {
                (
                    s.date.to_string(),
                    s.domain.clone(),
                    s.planned_count,
                    s.completed_count,
                    s.deferred_count,
                )
            })
            .collect();
        prompts::format_stats_context(&stats_data)
    } else {
        String::new()
    };

    // Rolling context snapshot
    let snapshot_context = match db.get_latest_context_snapshot()? {
        Some(snapshot) => format!("## Longer-Term Context\n{}\n", snapshot.summary_text),
        None => String::new(),
    };

    // Estimate tokens
    let total_chars = goals_context.len()
        + tasks_context.len()
        + check_in_context.len()
        + stats_context.len()
        + snapshot_context.len();
    let estimated_tokens = total_chars / CHARS_PER_TOKEN;

    // If over budget, truncate oldest check-in data first
    // (For V1, we just warn — truncation logic can be added later)
    if estimated_tokens > MAX_CONTEXT_TOKENS {
        log::warn!(
            "Context payload ({} tokens) exceeds budget ({} tokens)",
            estimated_tokens,
            MAX_CONTEXT_TOKENS
        );
    }

    Ok(ContextPayload {
        goals_context,
        tasks_context,
        check_in_context,
        stats_context,
        snapshot_context,
        patterns_active,
        estimated_tokens,
    })
}
