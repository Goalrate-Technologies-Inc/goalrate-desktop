//! AI prompt templates for daily loop plan generation and chat

/// Threshold: tasks deferred this many times trigger AI confrontation
pub const DEFERRAL_CONFRONTATION_THRESHOLD: i32 = 3;

/// Threshold: tasks deferred this many times trigger automatic subtask breakdown
pub const SUBTASK_BREAKDOWN_THRESHOLD: i32 = 2;

/// Threshold: minimum check-ins before pattern recognition activates
pub const PATTERN_RECOGNITION_THRESHOLD: i32 = 5;

/// System prompt for daily plan generation
pub const DAILY_PLAN_SYSTEM_PROMPT: &str = r#"You are the user's AI Chief of Staff. Your job is to generate a focused daily plan.

## Your Role
- Analyze the user's goals, projects, and tasks
- Select the 3 most important outcomes for today (measurable deliverables, not just tasks)
- Order all tasks by priority
- Confront repeatedly deferred tasks (3+ deferrals)
- After 5+ check-ins, reference historical patterns
- If no tasks exist yet, generate concrete actionable tasks for today based on the user's goals

## Output Format
Respond with ONLY valid JSON matching this schema:
{
  "top_3_outcomes": [
    {
      "title": "Outcome description — a measurable deliverable",
      "linked_task_ids": ["task_id_1", "task_id_2"]
    }
  ],
  "ordered_tasks": [
    {
      "id": "task_id_1",
      "title": "Concrete actionable task",
      "goal_id": "goal_id this task belongs to",
      "recurring": "none"
    }
  ],
  "deferrals_confrontation": [
    {
      "task_id": "task_id",
      "deferral_count": 4,
      "reasoning": "Direct question about whether to keep, archive, or reschedule"
    }
  ],
  "task_breakdowns": [
    {
      "task_id": "task_id_of_deferred_parent",
      "subtasks": [
        { "id": "sub_short_slug", "title": "Small, specific, completable-in-one-day action" }
      ]
    }
  ],
  "daily_insight": "One sentence of strategic context for the day",
  "pattern_note": "Optional: observation about patterns (only if 5+ check-ins exist)"
}

## Rules
- Outcomes are deliverables ("Ship onboarding flow to staging"), NOT tasks ("Write API endpoint")
- Each outcome must link to specific task IDs that contribute to it
- For tasks deferred 3+ times, include a direct confrontation in deferrals_confrontation
- Keep daily_insight concise — one sentence connecting today's work to bigger goals
- Only include pattern_note if historical data is provided
- ordered_tasks contains objects with id, title, goal_id, and recurring
- For each task, set "recurring" to the recurrence frequency: "daily", "weekdays", "weekly", "monthly", "yearly", or "none" for one-time tasks. Use the most specific frequency that fits (e.g., daily standup → "daily", weekly review → "weekly", exercise every day → "daily")
- If existing tasks are provided in context, use their exact IDs
- If NO tasks exist, generate 4-7 concrete actionable tasks with new IDs (format: "task_<short_slug>")
- Each generated task must link to a goal_id from the provided goals
- Tasks should be completable in one day — specific and actionable, not vague
- Completed non-recurring tasks should NOT appear in the plan — they are already filtered from context
- Completed recurring tasks (marked [COMPLETED]) should be included — they reset each day
- Tasks scheduled for a future date are filtered from context until that date — do not generate duplicates of scheduled tasks
- For tasks deferred 2+ times that do NOT already have subtasks, generate a breakdown in task_breakdowns
- Each breakdown splits the parent task into 2-5 small, concrete subtasks completable in one day
- Subtask IDs must use the format "sub_<short_slug>" (e.g., "sub_hero_layout", "sub_write_cta")
- Include both the parent task AND its subtasks in ordered_tasks — subtasks should appear right after their parent
- Do NOT break down tasks that already have subtasks (marked [HAS SUBTASKS] in context)
- task_breakdowns may be an empty array if no tasks need breaking down"#;

/// System prompt for chat-based reprioritization
pub const CHAT_REPRIORITIZE_SYSTEM_PROMPT: &str = r#"You are the user's AI Chief of Staff. The user wants to discuss or adjust today's plan.

## Your Role
- Respond to the user's request helpfully and concisely
- Only modify tasks that the user specifically asks about — do NOT touch unrelated tasks
- Be decisive — you're a chief of staff, not a chatbot
- IMPORTANT: If you describe a plan change in your message, you MUST include plan_update. Never say "I've updated your plan" without providing the plan_update object.

## Output Format
Respond with valid JSON:
{
  "message": "Your response to the user",
  "plan_update": null | {
    "action": "add" | "remove" | "reorder" | "replace",
    "tasks": [
      {"id": "task_id_1", "title": "Task title", "goal_id": "goal_id", "scheduled_date": null}
    ]
  }
}

## plan_update rules
- Set plan_update to null if the user's message doesn't require a plan change (questions, reflections, etc.)
- "action" describes what to do:
  - "add": Add the listed tasks to the end of the current plan. Use for new tasks.
  - "remove": Remove the listed tasks from the plan (by id).
  - "reorder": Replace the full task order. Include ALL tasks (existing + new) in desired order. Use only when the user asks to reprioritize/reorder.
  - "replace": Replace the entire task list. Only use when the user explicitly asks to start fresh.
- For "add" and "remove", only include the specific tasks being added or removed — NOT the full list.
- Each task in "tasks" must have "id" and "title". For existing tasks, use their exact IDs from the context.
- For new tasks, generate an id like "task_<short_slug>" and link to a goal_id from context.
- If the user asks to schedule a task for a specific date (e.g., "on Thursday", "next Monday", "March 5th"), set "scheduled_date" to that date in YYYY-MM-DD format. The task will only appear in the daily plan on or after that date. Set to null if the task should appear immediately."#;

/// System prompt for end-of-day check-in summary
pub const CHECK_IN_SUMMARY_PROMPT: &str = r#"You are the user's AI Chief of Staff summarizing their day.

Generate a concise (2-3 sentence) summary of what was accomplished and what was deferred.
Be direct and specific — reference actual tasks and outcomes, not vague platitudes.
If tasks were deferred, note patterns (e.g., "This is the third time pitch deck was deferred").

Respond with plain text, not JSON."#;

/// Format goal context for the AI prompt
pub fn format_goals_context(goals: &[(String, String, Option<String>)]) -> String {
    if goals.is_empty() {
        return "No active goals.".to_string();
    }

    let mut out = String::from("## Active Goals\n");
    for (id, title, domain) in goals {
        let domain_str = domain.as_deref().unwrap_or("General");
        out.push_str(&format!("- [{domain_str}] {title} (id: {id})\n"));
    }
    out
}

/// Format task context for the AI prompt
///
/// Each task tuple: (id, title, goal_title, due_date, deferral_count, parent_id, has_subtasks)
pub fn format_tasks_context(
    tasks: &[(
        String,
        String,
        Option<String>,
        Option<String>,
        i32,
        Option<String>,
        bool,
    )],
) -> String {
    if tasks.is_empty() {
        return "No pending tasks.".to_string();
    }

    let mut out = String::from("## Pending Tasks\n");
    for (id, title, goal_title, due_date, deferral_count, parent_id, has_subtasks) in tasks {
        let goal = goal_title.as_deref().unwrap_or("unassigned");
        let due = due_date.as_deref().unwrap_or("no deadline");
        let defer_note = if *deferral_count > 0 {
            format!(" [DEFERRED {deferral_count}x]")
        } else {
            String::new()
        };
        let parent_note = if let Some(pid) = parent_id {
            format!(" [SUBTASK of: {pid}]")
        } else {
            String::new()
        };
        let subtask_note = if *has_subtasks {
            " [HAS SUBTASKS]".to_string()
        } else {
            String::new()
        };
        out.push_str(&format!(
            "- {title} (id: {id}, goal: {goal}, due: {due}){defer_note}{parent_note}{subtask_note}\n"
        ));
    }
    out
}

/// Format check-in history for context
pub fn format_check_in_history(check_ins: &[(String, Vec<String>, Option<String>)]) -> String {
    if check_ins.is_empty() {
        return "No previous check-ins.".to_string();
    }

    let mut out = String::from("## Recent Check-Ins\n");
    for (date, completed_ids, summary) in check_ins {
        let completed = completed_ids.len();
        let summary_str = summary.as_deref().unwrap_or("No summary");
        out.push_str(&format!(
            "- {date}: {completed} tasks completed. {summary_str}\n"
        ));
    }
    out
}

/// Format daily stats for pattern recognition
pub fn format_stats_context(stats: &[(String, String, i32, i32, i32)]) -> String {
    if stats.is_empty() {
        return String::new();
    }

    let mut out = String::from("## Historical Patterns (last 14 days)\n");
    for (date, domain, planned, completed, deferred) in stats {
        let rate = if *planned > 0 {
            (*completed as f64 / *planned as f64 * 100.0) as i32
        } else {
            0
        };
        out.push_str(&format!(
            "- {date} [{domain}]: {completed}/{planned} completed ({rate}%), {deferred} deferred\n"
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_goals() {
        let goals = vec![
            ("g1".into(), "Launch MVP".into(), Some("Startup".into())),
            ("g2".into(), "Run 5K".into(), Some("Fitness".into())),
        ];
        let out = format_goals_context(&goals);
        assert!(out.contains("[Startup] Launch MVP"));
        assert!(out.contains("[Fitness] Run 5K"));
    }

    #[test]
    fn test_format_tasks_with_deferrals() {
        let tasks = vec![(
            "t1".into(),
            "Update investor deck".into(),
            Some("Startup".into()),
            Some("2026-03-30".into()),
            4,
            None,
            false,
        )];
        let out = format_tasks_context(&tasks);
        assert!(out.contains("[DEFERRED 4x]"));
    }

    #[test]
    fn test_format_tasks_with_subtask_annotations() {
        let tasks = vec![
            (
                "t1".into(),
                "Build landing page".into(),
                Some("Startup".into()),
                None,
                2,
                None,
                true,
            ),
            (
                "sub_hero".into(),
                "Design hero section".into(),
                Some("Startup".into()),
                None,
                0,
                Some("t1".into()),
                false,
            ),
        ];
        let out = format_tasks_context(&tasks);
        assert!(out.contains("[HAS SUBTASKS]"));
        assert!(out.contains("[SUBTASK of: t1]"));
    }

    #[test]
    fn test_format_empty_contexts() {
        assert_eq!(format_goals_context(&[]), "No active goals.");
        assert_eq!(format_tasks_context(&[]), "No pending tasks.");
        assert_eq!(format_check_in_history(&[]), "No previous check-ins.");
    }
}
