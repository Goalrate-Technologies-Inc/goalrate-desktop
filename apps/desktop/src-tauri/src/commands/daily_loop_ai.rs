//! AI-powered daily loop commands
//!
//! Handles plan generation, chat reprioritization, and check-in summaries
//! by calling LLM providers directly from the desktop app.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use tauri::State;

use daily_loop::{
    build_context, ChatRole, RevisionTrigger, CHAT_REPRIORITIZE_SYSTEM_PROMPT,
    CHECK_IN_SUMMARY_PROMPT, DAILY_PLAN_SYSTEM_PROMPT,
};

use crate::commands::daily_loop::{with_db, DAILY_LOOP_DBS};
use crate::commands::vault::AppState;
use crate::error::{AppError, ErrorCode};

const ANTHROPIC_MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION: &str = "2023-06-01";
const OPENAI_CHAT_URL: &str = "https://api.openai.com/v1/chat/completions";

// =============================================================================
// Dev-mode: Mock Responses
// =============================================================================

/// Returns true when `GOALRATE_AI_MOCK=true` or `1`.
fn is_mock_mode() -> bool {
    std::env::var("GOALRATE_AI_MOCK")
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false)
}

/// Mock response for daily plan generation.
const MOCK_PLAN_RESPONSE: &str = r#"{
  "top_3_outcomes": [
    {"title": "Ship core feature", "linked_task_ids": ["task_1", "task_2"]},
    {"title": "Clear review backlog", "linked_task_ids": ["task_3"]},
    {"title": "Prepare sprint demo", "linked_task_ids": ["task_4"]}
  ],
  "ordered_tasks": ["task_1", "task_2", "task_3", "task_4"],
  "daily_insight": "[MOCK] Focus on deep work before noon — your completion rate peaks in the morning.",
  "pattern_note": "",
  "deferrals_confrontation": []
}"#;

/// Mock response for chat reprioritization.
const MOCK_CHAT_RESPONSE: &str = r#"{
  "message": "[MOCK] Got it — I've noted your request and adjusted the plan accordingly.",
  "plan_update": null
}"#;

/// Mock response for end-of-day summary.
const MOCK_SUMMARY_RESPONSE: &str =
    "[MOCK] Solid day — you shipped the main feature and cleared most reviews. \
     One task was deferred; consider tackling it first thing tomorrow.";

/// Return a mock response if mock mode is active, matching the prompt type.
fn mock_llm_response(system_prompt: &str) -> Option<String> {
    if !is_mock_mode() {
        return None;
    }
    // Match on known system prompt prefixes
    if std::ptr::eq(system_prompt, DAILY_PLAN_SYSTEM_PROMPT) {
        Some(MOCK_PLAN_RESPONSE.to_string())
    } else if std::ptr::eq(system_prompt, CHAT_REPRIORITIZE_SYSTEM_PROMPT) {
        Some(MOCK_CHAT_RESPONSE.to_string())
    } else if std::ptr::eq(system_prompt, CHECK_IN_SUMMARY_PROMPT) {
        Some(MOCK_SUMMARY_RESPONSE.to_string())
    } else {
        // Fallback: heuristic matching by content
        if system_prompt.contains("daily plan") || system_prompt.contains("Daily Plan") {
            Some(MOCK_PLAN_RESPONSE.to_string())
        } else if system_prompt.contains("reprioritize") || system_prompt.contains("adjust") {
            Some(MOCK_CHAT_RESPONSE.to_string())
        } else if system_prompt.contains("summary") || system_prompt.contains("summariz") {
            Some(MOCK_SUMMARY_RESPONSE.to_string())
        } else {
            Some(r#"{"message": "[MOCK] AI response for development"}"#.to_string())
        }
    }
}

// =============================================================================
// Dev-mode: Prompt Cache Key
// =============================================================================

fn cache_key(model_id: &str, system_prompt: &str, user_prompt: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    model_id.hash(&mut hasher);
    system_prompt.hash(&mut hasher);
    user_prompt.hash(&mut hasher);
    hasher.finish()
}

// =============================================================================
// Dev-mode: Cheap Model Override
// =============================================================================

/// If `GOALRATE_AI_DEV_MODEL` is set, override the requested model.
fn resolve_model(model_id: &str) -> String {
    std::env::var("GOALRATE_AI_DEV_MODEL")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| model_id.to_string())
}

/// Sanitize a task ID from LLM output to prevent YAML injection or path traversal.
/// Strips non-alphanumeric characters (except underscore and hyphen), truncates to 64 chars.
fn sanitize_task_id(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(64)
        .collect()
}

/// Sanitize a text value from LLM output for safe YAML storage.
/// Removes control characters and truncates to a reasonable length.
fn sanitize_llm_text(text: &str, max_len: usize) -> String {
    text.chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .take(max_len)
        .collect::<String>()
        .trim()
        .to_string()
}

fn get_env_key(vars: &[&str]) -> Option<String> {
    vars.iter()
        .find_map(|var| std::env::var(var).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn get_anthropic_key() -> Option<String> {
    // Reuse the canonical keychain reader from integrations (handles user + device scopes)
    super::integrations::read_anthropic_api_key_from_keychain()
        .ok()
        .flatten()
        .or_else(|| get_env_key(&["GOALRATE_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"]))
}

fn get_openai_key() -> Option<String> {
    super::integrations::read_openai_api_key_from_keychain()
        .ok()
        .flatten()
        .or_else(|| get_env_key(&["GOALRATE_OPENAI_API_KEY", "OPENAI_API_KEY"]))
}

/// Determine provider from model_id (format: "provider::model")
fn parse_provider_model(model_id: &str) -> (&str, &str) {
    if let Some((provider, model)) = model_id.split_once("::") {
        (provider, model)
    } else {
        ("anthropic", model_id)
    }
}

/// AI plan generation response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedPlanResponse {
    pub plan: daily_loop::DailyPlan,
    pub outcomes: Vec<daily_loop::Outcome>,
    pub daily_insight: Option<String>,
    pub pattern_note: Option<String>,
    pub deferrals_confrontation: Vec<DeferralConfrontation>,
    /// Map of task_id → human-readable title (for AI-generated tasks)
    pub task_titles: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeferralConfrontation {
    pub task_id: String,
    pub deferral_count: i32,
    pub reasoning: String,
}

/// Chat reprioritization response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatReprioritizeResponse {
    pub ai_message: daily_loop::ChatMessage,
    pub plan_updated: bool,
    pub updated_plan: Option<daily_loop::DailyPlan>,
    /// Task titles from AI-generated tasks in the plan update
    pub task_titles: std::collections::HashMap<String, String>,
}

// ── LLM Call Helpers ───────────────────────────────────────────

async fn call_anthropic(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
) -> Result<String, AppError> {
    let client = reqwest::Client::new();
    let response = client
        .post(ANTHROPIC_MESSAGES_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_API_VERSION)
        .header("accept", "application/json")
        .header("user-agent", "GoalrateDesktop")
        .json(&json!({
            "model": model,
            "max_tokens": max_tokens,
            "temperature": 0.3,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_prompt}]
        }))
        .send()
        .await
        .map_err(|e| {
            AppError::new(
                ErrorCode::NetworkError,
                format!("Anthropic request failed: {e}"),
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::new(
            ErrorCode::NetworkError,
            format!("Anthropic error ({status}): {body}"),
        ));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Parse error: {e}")))?;

    // Extract text from Anthropic response
    payload
        .get("content")
        .and_then(Value::as_array)
        .and_then(|arr| {
            arr.iter()
                .find_map(|e| e.get("text").and_then(Value::as_str))
        })
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::new(ErrorCode::UnknownError, "Empty Anthropic response"))
}

async fn call_openai(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
    json_mode: bool,
) -> Result<String, AppError> {
    let client = reqwest::Client::new();
    let mut body = json!({
        "model": model,
        "max_tokens": max_tokens,
        "temperature": 0.3,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
    });
    if json_mode {
        body["response_format"] = json!({"type": "json_object"});
    }
    let response = client
        .post(OPENAI_CHAT_URL)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            AppError::new(
                ErrorCode::NetworkError,
                format!("OpenAI request failed: {e}"),
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::new(
            ErrorCode::NetworkError,
            format!("OpenAI error ({status}): {body}"),
        ));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Parse error: {e}")))?;

    payload
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|arr| arr.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::new(ErrorCode::UnknownError, "Empty OpenAI response"))
}

async fn call_llm(
    model_id: &str,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
    app_state: Option<&AppState>,
) -> Result<String, AppError> {
    call_llm_inner(
        model_id,
        system_prompt,
        user_prompt,
        max_tokens,
        app_state,
        true,
    )
    .await
}

/// Like call_llm but with explicit json_mode control (false for plain-text responses)
async fn call_llm_text(
    model_id: &str,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
    app_state: Option<&AppState>,
) -> Result<String, AppError> {
    call_llm_inner(
        model_id,
        system_prompt,
        user_prompt,
        max_tokens,
        app_state,
        false,
    )
    .await
}

async fn call_llm_inner(
    model_id: &str,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
    app_state: Option<&AppState>,
    json_mode: bool,
) -> Result<String, AppError> {
    // 1. Mock mode — return canned response, zero API calls
    if let Some(mock) = mock_llm_response(system_prompt) {
        log::info!("[AI-DEV] Mock mode active — returning canned response");
        return Ok(mock);
    }

    // 2. Cache check — return cached response if prompt was seen recently
    let effective_model = resolve_model(model_id);
    let key = cache_key(&effective_model, system_prompt, user_prompt);
    if let Some(state) = app_state {
        if let Ok(mut cache) = state.ai_cache.lock() {
            if let Some(cached) = cache.get(key) {
                log::info!("[AI-DEV] Cache hit — returning cached response");
                return Ok(cached);
            }
        }
    }

    // 3. Dev model override
    if effective_model != model_id {
        log::info!(
            "[AI-DEV] Model override: {} → {}",
            model_id,
            effective_model
        );
    }

    // 4. Real API call
    let (provider, model) = parse_provider_model(&effective_model);

    let response = match provider {
        "anthropic" => {
            let api_key = get_anthropic_key().ok_or_else(|| {
                AppError::auth_error(
                    "No Anthropic API key configured. Set one in Settings > Integrations.",
                )
            })?;
            call_anthropic(&api_key, model, system_prompt, user_prompt, max_tokens).await
        }
        "openai" => {
            let api_key = get_openai_key().ok_or_else(|| {
                AppError::auth_error(
                    "No OpenAI API key configured. Set one in Settings > Integrations.",
                )
            })?;
            call_openai(
                &api_key,
                model,
                system_prompt,
                user_prompt,
                max_tokens,
                json_mode,
            )
            .await
        }
        _ => Err(AppError::validation_error(format!(
            "Unsupported AI provider: {provider}. Use 'anthropic::model' or 'openai::model'."
        ))),
    }?;

    // 5. Store in cache
    if let Some(state) = app_state {
        if let Ok(mut cache) = state.ai_cache.lock() {
            cache.put(key, response.clone());
        }
    }

    Ok(response)
}

/// Extract JSON from LLM response (handles markdown code blocks)
fn extract_json(text: &str) -> &str {
    let trimmed = text.trim();
    if let Some(start) = trimmed.find("```json") {
        let after = &trimmed[start + 7..];
        if let Some(end) = after.find("```") {
            return after[..end].trim();
        }
    }
    if let Some(start) = trimmed.find("```") {
        let after = &trimmed[start + 3..];
        if let Some(end) = after.find("```") {
            return after[..end].trim();
        }
    }
    trimmed
}

// ── Tauri Commands ─────────────────────────────────────────────

/// Gather goals and tasks from vault for context assembly
fn gather_vault_context(
    vault_id: &str,
    app_state: &AppState,
) -> Result<
    (
        Vec<(String, String, Option<String>)>,
        Vec<(
            String,
            String,
            Option<String>,
            Option<String>,
            i32,
            Option<String>,
            bool,
        )>,
    ),
    AppError,
> {
    let vaults = app_state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let vault = vaults
        .get(vault_id)
        .ok_or_else(|| AppError::vault_not_open(vault_id))?;

    // Read goals from vault
    let goal_ids = vault.list_goals().unwrap_or_default();
    let mut goals = Vec::new();
    for gid in &goal_ids {
        if let Ok((fm, _body)) = vault.read_goal(gid) {
            let title = fm
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or(gid)
                .to_string();
            // Domain/type: read "type" (new schema) first, then "domain", then first tag (legacy)
            let domain = fm
                .get("type")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| {
                    fm.get("domain")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
                .or_else(|| {
                    fm.get("tags")
                        .and_then(|v| v.as_sequence())
                        .and_then(|seq| seq.first())
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                });
            let status = fm
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("active");
            if status != "archived" && status != "completed" {
                goals.push((gid.clone(), title, domain));
            }
        }
    }

    // For V1, tasks come from goal tasks in the vault
    // Each goal may have tasks in its frontmatter
    // First pass: collect all tasks and track parent_id relationships
    let mut tasks = Vec::new();
    let mut parent_ids_with_children: std::collections::HashSet<String> =
        std::collections::HashSet::new();

    // Pre-scan to find which tasks have subtasks (children with parent_id)
    for (gid, _gtitle, _domain) in &goals {
        if let Ok((fm, _body)) = vault.read_goal(gid) {
            if let Some(task_list) = fm.get("tasks").and_then(|v| v.as_sequence()) {
                for task_val in task_list {
                    if let Some(pid) = task_val.get("parent_id").and_then(|v| v.as_str()) {
                        parent_ids_with_children.insert(pid.to_string());
                    }
                }
            }
        }
    }

    for (gid, gtitle, _domain) in &goals {
        if let Ok((fm, _body)) = vault.read_goal(gid) {
            if let Some(task_list) = fm.get("tasks").and_then(|v| v.as_sequence()) {
                for task_val in task_list {
                    let tid = task_val
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let ttitle = task_val
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let due = task_val
                        .get("due_date")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let status = task_val
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("todo");
                    let parent_id = task_val
                        .get("parent_id")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    // Check if task is completed and non-recurring
                    let completed_at = task_val.get("completed_at").and_then(|v| v.as_str());
                    let is_recurring = task_val
                        .get("recurring")
                        .and_then(|v| v.as_bool())
                        .or_else(|| {
                            task_val
                                .get("recurring")
                                .and_then(|v| v.as_str())
                                .map(|s| !s.is_empty())
                        })
                        .unwrap_or(false);

                    // Skip completed non-recurring tasks
                    let is_completed_onetime = completed_at.is_some() && !is_recurring;

                    // Skip tasks scheduled for a future date
                    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
                    let is_future_scheduled = task_val
                        .get("scheduled_date")
                        .and_then(|v| v.as_str())
                        .is_some_and(|sd| sd > today_str.as_str());

                    if !tid.is_empty()
                        && !ttitle.is_empty()
                        && status != "done"
                        && status != "cancelled"
                        && !is_completed_onetime
                        && !is_future_scheduled
                    {
                        // Get deferral count from daily loop DB
                        let deferral_count = {
                            let dbs = DAILY_LOOP_DBS.lock().ok();
                            dbs.as_ref()
                                .and_then(|d| d.get(vault_id))
                                .and_then(|db| db.get_deferral_count(&tid).ok())
                                .unwrap_or(0)
                        };

                        let has_subtasks = parent_ids_with_children.contains(&tid);

                        tasks.push((
                            tid,
                            ttitle,
                            Some(gtitle.clone()),
                            due,
                            deferral_count,
                            parent_id,
                            has_subtasks,
                        ));
                    }
                }
            }
        }
    }

    Ok((goals, tasks))
}

#[tauri::command]
pub async fn daily_loop_generate_plan(
    vault_id: String,
    model_id: String,
    date: String,
    app_state: State<'_, AppState>,
) -> Result<GeneratedPlanResponse, AppError> {
    let date_parsed = date
        .parse::<NaiveDate>()
        .map_err(|_| AppError::validation_error(format!("Invalid date: {date}")))?;

    // Gather context from vault
    let (goals, tasks) = gather_vault_context(&vault_id, &app_state)?;

    // Build context payload from DB
    let context = with_db(&vault_id, &app_state, |db| {
        build_context(db, &goals, &tasks)
    })?;

    let user_prompt = context.to_user_prompt();

    // Call LLM
    let raw_response = call_llm(
        &model_id,
        DAILY_PLAN_SYSTEM_PROMPT,
        &user_prompt,
        2000,
        Some(&app_state),
    )
    .await?;
    let json_str = extract_json(&raw_response);

    // Parse response
    let parsed: Value = serde_json::from_str(json_str)
        .map_err(|e| AppError::validation_error(format!("AI response was not valid JSON: {e}")))?;

    // Extract outcomes
    let top_3_outcomes: Vec<(String, Vec<String>)> = parsed
        .get("top_3_outcomes")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|o| {
                    let title = o
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let linked: Vec<String> = o
                        .get("linked_task_ids")
                        .and_then(Value::as_array)
                        .map(|ids| {
                            ids.iter()
                                .filter_map(Value::as_str)
                                .map(String::from)
                                .collect()
                        })
                        .unwrap_or_default();
                    (title, linked)
                })
                .collect()
        })
        .unwrap_or_default();

    // Parse ordered_tasks — supports both object format and plain string format
    let mut ordered_task_ids: Vec<String> = Vec::new();
    let mut task_titles: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    // Track brand-new AI-generated tasks that need to be persisted to goal files
    let mut new_tasks: Vec<(String, String, String)> = Vec::new(); // (id, title, goal_id)
                                                                   // Track AI's recurring classification per task
    let mut recurring_flags: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    if let Some(arr) = parsed.get("ordered_tasks").and_then(Value::as_array) {
        for item in arr {
            if let Some(s) = item.as_str() {
                // Plain string format (backward compat)
                ordered_task_ids.push(sanitize_task_id(s));
            } else if item.is_object() {
                // Object format: { id, title, goal_id, recurring }
                let id = sanitize_task_id(item.get("id").and_then(Value::as_str).unwrap_or(""));
                let title =
                    sanitize_llm_text(item.get("title").and_then(Value::as_str).unwrap_or(""), 200);
                let goal_id =
                    sanitize_task_id(item.get("goal_id").and_then(Value::as_str).unwrap_or(""));
                // Accept both string ("daily") and bool (true→"daily", false→"none") for backwards compat
                let recurring = item
                    .get("recurring")
                    .and_then(|v| {
                        v.as_str().map(|s| s.to_string()).or_else(|| {
                            v.as_bool().map(|b| {
                                if b {
                                    "daily".to_string()
                                } else {
                                    "none".to_string()
                                }
                            })
                        })
                    })
                    .filter(|s| s != "none");
                if !id.is_empty() {
                    if !title.is_empty() {
                        task_titles.insert(id.clone(), title.clone());
                        // If the AI generated a new task with a goal_id, track it for persistence
                        if !goal_id.is_empty() {
                            new_tasks.push((id.clone(), title, goal_id));
                        }
                    }
                    if let Some(r) = recurring {
                        recurring_flags.insert(id.clone(), r);
                    }
                    ordered_task_ids.push(id);
                }
            }
        }
    }
    let ordered_tasks = ordered_task_ids;

    let daily_insight = parsed
        .get("daily_insight")
        .and_then(Value::as_str)
        .map(|s| sanitize_llm_text(s, 500));

    let pattern_note = parsed
        .get("pattern_note")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(|s| sanitize_llm_text(s, 500));

    let deferrals_confrontation: Vec<DeferralConfrontation> = parsed
        .get("deferrals_confrontation")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|d| {
                    Some(DeferralConfrontation {
                        task_id: d.get("task_id").and_then(Value::as_str)?.to_string(),
                        deferral_count: d.get("deferral_count").and_then(Value::as_i64)? as i32,
                        reasoning: d.get("reasoning").and_then(Value::as_str)?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    // Persist to DB
    let (plan, outcomes) = with_db(&vault_id, &app_state, |db| {
        // Create or get plan for this date
        let plan = match db.get_plan_by_date(date_parsed)? {
            Some(existing) => existing,
            None => db.create_plan(date_parsed)?,
        };

        // Create outcomes
        let mut outcome_ids = Vec::new();
        let mut outcomes = Vec::new();
        for (title, linked) in &top_3_outcomes {
            let outcome = db.create_outcome(&plan.id, title, linked.clone(), true)?;
            outcome_ids.push(outcome.id.clone());
            outcomes.push(outcome);
        }

        // Update plan with outcome IDs and task order
        let plan = db.update_plan(
            &plan.id,
            Some(outcome_ids.clone()),
            Some(ordered_tasks.clone()),
        )?;

        // Persist task titles so they survive app restarts
        db.merge_task_titles(&plan.id, &task_titles)?;

        // Create initial revision
        db.create_revision(
            &plan.id,
            outcome_ids,
            ordered_tasks.clone(),
            RevisionTrigger::Initial,
        )?;

        // Re-read plan to include merged task_titles
        let plan = db.get_plan_by_id(&plan.id)?;

        Ok((plan, outcomes))
    })?;

    // Persist AI-generated tasks into goal files so they survive across days
    // and appear in future context assembly.
    if !new_tasks.is_empty() {
        let existing_task_ids: std::collections::HashSet<String> =
            tasks.iter().map(|(tid, ..)| tid.clone()).collect();
        let truly_new: Vec<&(String, String, String)> = new_tasks
            .iter()
            .filter(|(tid, ..)| !existing_task_ids.contains(tid))
            .collect();

        if !truly_new.is_empty() {
            // Group new tasks by goal_id
            let mut by_goal: std::collections::HashMap<String, Vec<(String, String)>> =
                std::collections::HashMap::new();
            for (tid, title, gid) in truly_new {
                by_goal
                    .entry(gid.clone())
                    .or_default()
                    .push((tid.clone(), title.clone()));
            }

            let vaults = app_state
                .vaults
                .lock()
                .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
            if let Some(vault) = vaults.get(&vault_id) {
                for (gid, new_goal_tasks) in &by_goal {
                    if let Ok((mut fm, body)) = vault.read_goal(gid) {
                        let task_seq = fm
                            .get("tasks")
                            .and_then(|v| v.as_sequence().cloned())
                            .unwrap_or_default();
                        let mut task_seq = task_seq;
                        for (tid, title) in new_goal_tasks {
                            let mut map = serde_yaml::Mapping::new();
                            map.insert("id".into(), serde_yaml::Value::String(tid.clone()));
                            map.insert("title".into(), serde_yaml::Value::String(title.clone()));
                            map.insert(
                                "status".into(),
                                serde_yaml::Value::String("todo".to_string()),
                            );
                            if let Some(recurring) = recurring_flags.get(tid) {
                                map.insert(
                                    "recurring".into(),
                                    serde_yaml::Value::String(recurring.clone()),
                                );
                            }
                            task_seq.push(serde_yaml::Value::Mapping(map));
                        }
                        fm.insert("tasks".into(), serde_yaml::Value::Sequence(task_seq));
                        vault.write_goal(gid, &fm, &body).map_err(|e| {
                            log::error!("Failed to persist AI-generated tasks to goal {gid}: {e}");
                            AppError::new(
                                ErrorCode::UnknownError,
                                format!(
                                    "Plan created in DB but vault write failed for goal {gid}: {e}"
                                ),
                            )
                        })?;
                    }
                }
            }
        }
    }

    // Persist AI's recurring classification to vault task frontmatter
    if !recurring_flags.is_empty() {
        if let Ok(vaults) = app_state.vaults.lock() {
            if let Some(vault) = vaults.get(&vault_id) {
                let goal_ids = vault.list_goals().unwrap_or_default();
                for gid in &goal_ids {
                    if let Ok((mut fm, body)) = vault.read_goal(gid) {
                        if let Some(tasks_seq) =
                            fm.get_mut("tasks").and_then(|v| v.as_sequence_mut())
                        {
                            let mut changed = false;
                            for task_val in tasks_seq.iter_mut() {
                                let tid = task_val.get("id").and_then(|v| v.as_str()).unwrap_or("");
                                if let Some(recurring) = recurring_flags.get(tid) {
                                    if let Some(map) = task_val.as_mapping_mut() {
                                        // Only write if not already set
                                        if !map.contains_key("recurring") {
                                            map.insert(
                                                "recurring".into(),
                                                serde_yaml::Value::String(recurring.clone()),
                                            );
                                            changed = true;
                                        }
                                    }
                                }
                            }
                            if changed {
                                if let Err(e) = vault.write_goal(gid, &fm, &body) {
                                    log::warn!(
                                        "Failed to persist recurring flags to goal {gid}: {e}"
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Persist AI-generated subtask breakdowns for deferred tasks
    let task_breakdowns: Vec<(String, Vec<(String, String)>)> = parsed
        .get("task_breakdowns")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|b| {
                    let task_id =
                        sanitize_task_id(b.get("task_id").and_then(Value::as_str).unwrap_or(""));
                    let subtasks: Vec<(String, String)> = b
                        .get("subtasks")
                        .and_then(Value::as_array)
                        .map(|subs| {
                            subs.iter()
                                .filter_map(|s| {
                                    let sid = sanitize_task_id(
                                        s.get("id").and_then(Value::as_str).unwrap_or(""),
                                    );
                                    let stitle = sanitize_llm_text(
                                        s.get("title").and_then(Value::as_str).unwrap_or(""),
                                        200,
                                    );
                                    if !sid.is_empty() && !stitle.is_empty() {
                                        Some((sid, stitle))
                                    } else {
                                        None
                                    }
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    if !task_id.is_empty() && !subtasks.is_empty() {
                        Some((task_id, subtasks))
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    if !task_breakdowns.is_empty() {
        // Build a map of task_id → goal_id from the vault context
        let task_to_goal: std::collections::HashMap<String, String> = {
            let vaults_guard = app_state
                .vaults
                .lock()
                .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
            let vault = vaults_guard
                .get(&vault_id)
                .ok_or_else(|| AppError::vault_not_open(&vault_id))?;
            let mut map = std::collections::HashMap::new();
            for gid in vault.list_goals().unwrap_or_default() {
                if let Ok((fm, _)) = vault.read_goal(&gid) {
                    if let Some(task_list) = fm.get("tasks").and_then(|v| v.as_sequence()) {
                        for tv in task_list {
                            if let Some(tid) = tv.get("id").and_then(|v| v.as_str()) {
                                map.insert(tid.to_string(), gid.clone());
                            }
                        }
                    }
                }
            }
            map
        };

        // Group subtasks by goal_id
        let mut subtasks_by_goal: std::collections::HashMap<String, Vec<(String, String, String)>> =
            std::collections::HashMap::new(); // goal_id → [(sub_id, sub_title, parent_id)]
        for (parent_id, subtasks) in &task_breakdowns {
            if let Some(gid) = task_to_goal.get(parent_id) {
                for (sid, stitle) in subtasks {
                    subtasks_by_goal.entry(gid.clone()).or_default().push((
                        sid.clone(),
                        stitle.clone(),
                        parent_id.clone(),
                    ));
                    // Also store subtask titles for the plan
                    task_titles.insert(sid.clone(), stitle.clone());
                }
            }
        }

        // Persist subtasks to vault
        if let Ok(vaults_guard) = app_state.vaults.lock() {
            if let Some(vault) = vaults_guard.get(&vault_id) {
                for (gid, new_subtasks) in &subtasks_by_goal {
                    if let Ok((mut fm, body)) = vault.read_goal(gid) {
                        let mut task_seq = fm
                            .get("tasks")
                            .and_then(|v| v.as_sequence().cloned())
                            .unwrap_or_default();

                        // Collect existing subtask IDs to avoid duplicates
                        let existing_ids: std::collections::HashSet<String> = task_seq
                            .iter()
                            .filter_map(|tv| {
                                tv.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())
                            })
                            .collect();

                        for (sid, stitle, parent_id) in new_subtasks {
                            if existing_ids.contains(sid) {
                                continue;
                            }
                            let mut map = serde_yaml::Mapping::new();
                            map.insert("id".into(), serde_yaml::Value::String(sid.clone()));
                            map.insert("title".into(), serde_yaml::Value::String(stitle.clone()));
                            map.insert(
                                "status".into(),
                                serde_yaml::Value::String("todo".to_string()),
                            );
                            map.insert(
                                "parent_id".into(),
                                serde_yaml::Value::String(parent_id.clone()),
                            );
                            task_seq.push(serde_yaml::Value::Mapping(map));
                        }
                        fm.insert("tasks".into(), serde_yaml::Value::Sequence(task_seq));
                        if let Err(e) = vault.write_goal(gid, &fm, &body) {
                            log::warn!("Failed to persist subtask breakdowns to goal {gid}: {e}");
                        }
                    }
                }
            }
        }

        // Merge subtask titles into DB so they survive app restarts
        if !task_titles.is_empty() {
            let _ = with_db(&vault_id, &app_state, |db| {
                db.merge_task_titles(&plan.id, &task_titles)
            });
        }
    }

    Ok(GeneratedPlanResponse {
        plan,
        outcomes,
        daily_insight,
        pattern_note,
        deferrals_confrontation,
        task_titles,
    })
}

/// Assess goal priority using AI based on the goal's title, domain, and deadline.
/// Returns one of: "critical", "high", "medium", "low".
#[tauri::command]
pub async fn assess_goal_priority(
    model_id: String,
    title: String,
    domain: Option<String>,
    deadline: Option<String>,
    app_state: State<'_, AppState>,
) -> Result<String, AppError> {
    let system_prompt = "You are a goal prioritization assistant. Given a goal's title, domain, and deadline, assess its priority. Return ONLY one word: critical, high, medium, or low.\n\nGuidelines:\n- critical: urgent blockers, imminent deadlines (within days), safety/health emergencies\n- high: important goals with near deadlines (within 1-2 weeks), high-impact objectives\n- medium: standard goals with reasonable timelines, steady progress items\n- low: nice-to-haves, distant deadlines (months away), exploratory goals";

    let mut user_prompt = format!("Goal: {}", title.trim());
    if let Some(ref d) = domain {
        user_prompt.push_str(&format!("\nDomain: {}", d.trim()));
    }
    if let Some(ref dl) = deadline {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        user_prompt.push_str(&format!("\nDeadline: {} (today is {})", dl.trim(), today));
    }

    let raw = call_llm_text(&model_id, system_prompt, &user_prompt, 10, Some(&app_state)).await?;
    let priority = raw.trim().to_lowercase();

    // Validate and return
    match priority.as_str() {
        "critical" | "high" | "medium" | "low" => Ok(priority),
        _ => {
            // Try to extract a valid priority from the response
            for p in &["critical", "high", "medium", "low"] {
                if priority.contains(p) {
                    return Ok(p.to_string());
                }
            }
            Ok("medium".to_string())
        }
    }
}

/// Generate initial tasks for a newly created goal that has no tasks.
/// Reads sibling goals in the same domain for context, calls the LLM,
/// and persists the generated tasks directly to the goal's frontmatter.
#[tauri::command]
pub async fn generate_goal_tasks(
    vault_id: String,
    goal_id: String,
    model_id: String,
    title: String,
    domain: Option<String>,
    deadline: Option<String>,
    app_state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    // Gather sibling goals in the same domain for context
    let sibling_context = {
        let vaults = app_state
            .vaults
            .lock()
            .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
        let vault = vaults
            .get(&vault_id)
            .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

        let mut siblings = Vec::new();
        for gid in vault.list_goals().unwrap_or_default() {
            if gid == goal_id {
                continue;
            }
            if let Ok((fm, _)) = vault.read_goal(&gid) {
                let g_domain = fm
                    .get("type")
                    .and_then(|v| v.as_str())
                    .or_else(|| {
                        fm.get("tags")
                            .and_then(|v| v.as_sequence())
                            .and_then(|s| s.first())
                            .and_then(|v| v.as_str())
                    })
                    .unwrap_or("");
                // Include goals from the same domain
                if domain
                    .as_deref()
                    .is_some_and(|d| d.eq_ignore_ascii_case(g_domain))
                {
                    let g_title = fm
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if !g_title.is_empty() {
                        siblings.push(g_title);
                    }
                }
            }
        }
        siblings
    };

    let system_prompt = r#"You are a goal planning assistant. Given a goal, generate 3-5 concrete, actionable tasks that would help achieve it. Each task should be completable in one day.

Return ONLY a JSON array of task title strings. Example:
["Research competitor pricing models", "Draft initial feature list", "Set up project tracking board"]

Rules:
- Tasks must be specific and actionable, not vague
- Each task should be achievable in a single focused work session
- Order tasks by logical sequence (what should be done first)
- Consider the goal's domain and any sibling goals for context
- Do NOT include task IDs or metadata — just title strings"#;

    let mut user_prompt = format!("Goal: {}", title.trim());
    if let Some(ref d) = domain {
        user_prompt.push_str(&format!("\nDomain: {}", d.trim()));
    }
    if let Some(ref dl) = deadline {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        user_prompt.push_str(&format!("\nDeadline: {} (today is {})", dl.trim(), today));
    }
    if !sibling_context.is_empty() {
        user_prompt.push_str("\n\nOther goals in this domain:");
        for s in &sibling_context {
            user_prompt.push_str(&format!("\n- {s}"));
        }
    }

    let raw = call_llm(
        &model_id,
        system_prompt,
        &user_prompt,
        500,
        Some(&app_state),
    )
    .await?;
    let json_str = extract_json(&raw);

    let task_titles: Vec<String> = serde_json::from_str(json_str)
        .map(|arr: Vec<String>| {
            arr.into_iter()
                .map(|s| sanitize_llm_text(&s, 200))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();

    if task_titles.is_empty() {
        return Ok(Vec::new());
    }

    // Persist tasks to goal frontmatter
    {
        let vaults = app_state
            .vaults
            .lock()
            .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
        let vault = vaults
            .get(&vault_id)
            .ok_or_else(|| AppError::vault_not_open(&vault_id))?;

        let (mut fm, body) = vault.read_goal(&goal_id)?;
        let mut task_seq = fm
            .get("tasks")
            .and_then(|v| v.as_sequence().cloned())
            .unwrap_or_default();

        for title in &task_titles {
            let task_id = format!(
                "task_{}",
                uuid::Uuid::new_v4().to_string().replace('-', "")[..8].to_string()
            );
            let mut map = serde_yaml::Mapping::new();
            map.insert("id".into(), serde_yaml::Value::String(task_id));
            map.insert("title".into(), serde_yaml::Value::String(title.clone()));
            map.insert(
                "status".into(),
                serde_yaml::Value::String("todo".to_string()),
            );
            task_seq.push(serde_yaml::Value::Mapping(map));
        }

        fm.insert("tasks".into(), serde_yaml::Value::Sequence(task_seq));
        vault.write_goal(&goal_id, &fm, &body)?;
    }

    Ok(task_titles)
}

#[tauri::command]
pub async fn daily_loop_chat_reprioritize(
    vault_id: String,
    plan_id: String,
    model_id: String,
    #[allow(unused_variables)] message: String, // user message already stored by send_chat; kept for Tauri command signature
    app_state: State<'_, AppState>,
) -> Result<ChatReprioritizeResponse, AppError> {
    // Gather goals and tasks from vault (Domains panel context)
    let (goals, tasks) = gather_vault_context(&vault_id, &app_state)?;

    // Get current plan + chat history (user message already stored by send_chat IPC)
    let (current_plan, chat_context) = with_db(&vault_id, &app_state, |db| {
        let plan = Some(db.get_plan_by_id(&plan_id)?);

        let history = db.get_chat_history(&plan_id)?;
        let outcomes = db.get_outcomes_for_plan(&plan_id)?;

        // Build chat context string with today's date, goals, plan, and history
        let today = chrono::Local::now().format("%Y-%m-%d (%A)").to_string();
        let mut ctx = format!("## Today's Date\n{today}\n\n## User's Goals (Domains)\n");
        for (gid, title, domain) in &goals {
            let domain_label = domain.as_deref().unwrap_or("Uncategorized");
            ctx.push_str(&format!("- [{}] {} (id: {})\n", domain_label, title, gid));
        }
        ctx.push('\n');

        // Include task details so the AI knows what task IDs mean
        if !tasks.is_empty() {
            ctx.push_str("## Available Tasks\n");
            for (tid, title, goal_title, due_date, deferral_count, parent_id, has_subtasks) in
                &tasks
            {
                let goal_ref = goal_title.as_deref().unwrap_or("unlinked");
                let due = due_date.as_deref().unwrap_or("none");
                let parent_note = parent_id
                    .as_ref()
                    .map(|p| format!(", subtask of: {p}"))
                    .unwrap_or_default();
                let subtask_note = if *has_subtasks { ", has subtasks" } else { "" };
                ctx.push_str(&format!(
                    "- {} (id: {}, goal: {}, due: {}, deferrals: {}{}{})\n",
                    title, tid, goal_ref, due, deferral_count, parent_note, subtask_note
                ));
            }
            ctx.push('\n');
        }

        ctx.push_str("## Current Plan\n");
        ctx.push_str(&format!(
            "Outcomes: {}\n",
            outcomes
                .iter()
                .map(|o| o.title.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
        ctx.push_str(&format!(
            "Task order: {}\n\n",
            plan.as_ref()
                .map(|p| p.task_order.join(", "))
                .unwrap_or_default()
        ));
        ctx.push_str("## Chat History\n");
        for msg in &history {
            ctx.push_str(&format!("{}: {}\n", msg.role.as_str(), msg.content));
        }

        Ok((plan, ctx))
    })?;

    // Call LLM
    let raw = call_llm(
        &model_id,
        CHAT_REPRIORITIZE_SYSTEM_PROMPT,
        &chat_context,
        1500,
        Some(&app_state),
    )
    .await?;
    let json_str = extract_json(&raw);

    let parsed: Value = serde_json::from_str(json_str)
        .unwrap_or_else(|_| json!({"message": sanitize_llm_text(&raw, 2000), "plan_update": null}));

    let ai_response_text = sanitize_llm_text(
        parsed
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("I've noted your request."),
        2000,
    );

    let plan_update = parsed.get("plan_update").filter(|v| !v.is_null());
    log::info!(
        "[CHAT] AI response: plan_update present={}, raw={}",
        plan_update.is_some(),
        plan_update
            .map(|v| v.to_string())
            .unwrap_or_else(|| "null".into())
    );

    // Store AI response and optionally update plan
    let (ai_msg, plan_updated, updated_plan, chat_task_titles, new_chat_tasks) =
        with_db(&vault_id, &app_state, |db| {
            let ai_msg = db.add_chat_message(&plan_id, ChatRole::Ai, &ai_response_text)?;

            let mut new_task_titles: std::collections::HashMap<String, String> =
                std::collections::HashMap::new();
            let mut new_chat_tasks: Vec<(String, String, String, Option<String>)> = Vec::new();

            if let Some(update) = plan_update {
                // Parse action type (add, remove, reorder, replace). Default to "reorder" for backward compat.
                let action = update
                    .get("action")
                    .and_then(Value::as_str)
                    .unwrap_or("reorder");

                // Parse tasks array — supports both "tasks" (new) and "ordered_tasks" (legacy)
                let tasks_arr = update
                    .get("tasks")
                    .and_then(Value::as_array)
                    .or_else(|| update.get("ordered_tasks").and_then(Value::as_array));

                let mut parsed_ids: Vec<String> = Vec::new();
                // Track tasks scheduled for the future so they're excluded from today's plan
                let mut future_scheduled_ids: std::collections::HashSet<String> =
                    std::collections::HashSet::new();
                let today = chrono::Local::now().format("%Y-%m-%d").to_string();
                if let Some(arr) = tasks_arr {
                    for item in arr {
                        if let Some(s) = item.as_str() {
                            parsed_ids.push(sanitize_task_id(s));
                        } else if item.is_object() {
                            let id = sanitize_task_id(
                                item.get("id").and_then(Value::as_str).unwrap_or(""),
                            );
                            let title = sanitize_llm_text(
                                item.get("title").and_then(Value::as_str).unwrap_or(""),
                                200,
                            );
                            let goal_id = sanitize_task_id(
                                item.get("goal_id").and_then(Value::as_str).unwrap_or(""),
                            );
                            let scheduled_date = item
                                .get("scheduled_date")
                                .and_then(Value::as_str)
                                .filter(|s| {
                                    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
                                })
                                .map(|s| s.to_string());
                            if !id.is_empty() {
                                // Check if task is scheduled for a future date
                                if let Some(ref sd) = scheduled_date {
                                    if sd.as_str() > today.as_str() {
                                        future_scheduled_ids.insert(id.clone());
                                    }
                                }
                                if !title.is_empty() {
                                    new_task_titles.insert(id.clone(), title.clone());
                                    if !goal_id.is_empty() {
                                        new_chat_tasks.push((
                                            id.clone(),
                                            title,
                                            goal_id,
                                            scheduled_date,
                                        ));
                                    }
                                }
                                parsed_ids.push(id);
                            }
                        }
                    }
                }

                log::info!(
                    "[CHAT] action={}, parsed {} task IDs, {} titles",
                    action,
                    parsed_ids.len(),
                    new_task_titles.len()
                );

                // Get the current task order so we can merge
                let current_order = current_plan
                    .as_ref()
                    .map(|p| p.task_order.clone())
                    .unwrap_or_default();

                // Apply the action
                let final_order = match action {
                    "add" => {
                        // Append new tasks to the existing order (skip duplicates)
                        let mut order = current_order.clone();
                        for id in &parsed_ids {
                            if !order.contains(id) {
                                order.push(id.clone());
                            }
                        }
                        order
                    }
                    "remove" => {
                        // Remove specified tasks from the existing order
                        let remove_set: std::collections::HashSet<&str> =
                            parsed_ids.iter().map(|s| s.as_str()).collect();
                        current_order
                            .into_iter()
                            .filter(|id: &String| !remove_set.contains(id.as_str()))
                            .collect::<Vec<String>>()
                    }
                    "reorder" | "replace" => {
                        // Full replacement of task order
                        if parsed_ids.is_empty() {
                            current_order
                        } else {
                            parsed_ids.clone()
                        }
                    }
                    _ => {
                        log::warn!("[CHAT] Unknown action '{}', treating as reorder", action);
                        if parsed_ids.is_empty() {
                            current_order
                        } else {
                            parsed_ids.clone()
                        }
                    }
                };

                // Remove future-scheduled tasks from today's plan order
                let final_order: Vec<String> = final_order
                    .into_iter()
                    .filter(|id| !future_scheduled_ids.contains(id))
                    .collect();

                // Always persist new task titles (even if order didn't change,
                // future-scheduled tasks still need their titles stored)
                if !new_task_titles.is_empty() {
                    db.merge_task_titles(&plan_id, &new_task_titles)?;
                }

                if final_order
                    != current_plan
                        .as_ref()
                        .map(|p| p.task_order.clone())
                        .unwrap_or_default()
                {
                    let plan = db.update_plan(&plan_id, None, Some(final_order.clone()))?;
                    db.create_revision(
                        &plan_id,
                        plan.top_3_outcome_ids.clone(),
                        final_order,
                        RevisionTrigger::Chat,
                    )?;
                    // Re-read plan to get merged titles
                    let plan = db.get_plan_by_id(&plan_id)?;
                    return Ok((ai_msg, true, Some(plan), new_task_titles, new_chat_tasks));
                }
            }

            // Even when plan order didn't change, return new tasks so they get
            // persisted to vault files (e.g. future-scheduled tasks from chat)
            Ok((ai_msg, false, None, new_task_titles, new_chat_tasks))
        })?;

    // Persist any brand-new AI-generated tasks into goal files (outside DB closure)
    if !new_chat_tasks.is_empty() {
        let existing_task_ids: std::collections::HashSet<String> = {
            let (_, tasks) = gather_vault_context(&vault_id, &app_state)?;
            tasks.iter().map(|(tid, ..)| tid.clone()).collect()
        };
        let truly_new: Vec<&(String, String, String, Option<String>)> = new_chat_tasks
            .iter()
            .filter(|(tid, ..)| !existing_task_ids.contains(tid))
            .collect();

        if !truly_new.is_empty() {
            // Group by goal_id: (tid, title, scheduled_date)
            let mut by_goal: std::collections::HashMap<
                String,
                Vec<(String, String, Option<String>)>,
            > = std::collections::HashMap::new();
            for (tid, title, gid, scheduled_date) in truly_new {
                by_goal.entry(gid.clone()).or_default().push((
                    tid.clone(),
                    title.clone(),
                    scheduled_date.clone(),
                ));
            }

            let vaults = app_state
                .vaults
                .lock()
                .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
            if let Some(vault) = vaults.get(&vault_id) {
                for (gid, new_goal_tasks) in &by_goal {
                    if let Ok((mut fm, body)) = vault.read_goal(gid) {
                        let mut task_seq = fm
                            .get("tasks")
                            .and_then(|v| v.as_sequence().cloned())
                            .unwrap_or_default();
                        for (tid, title, scheduled_date) in new_goal_tasks {
                            let mut map = serde_yaml::Mapping::new();
                            map.insert("id".into(), serde_yaml::Value::String(tid.clone()));
                            map.insert("title".into(), serde_yaml::Value::String(title.clone()));
                            map.insert(
                                "status".into(),
                                serde_yaml::Value::String("todo".to_string()),
                            );
                            if let Some(sd) = scheduled_date {
                                map.insert(
                                    "scheduled_date".into(),
                                    serde_yaml::Value::String(sd.clone()),
                                );
                            }
                            task_seq.push(serde_yaml::Value::Mapping(map));
                        }
                        fm.insert("tasks".into(), serde_yaml::Value::Sequence(task_seq));
                        vault.write_goal(gid, &fm, &body).map_err(|e| {
                            log::error!("Failed to persist chat AI tasks to goal {gid}: {e}");
                            AppError::new(
                                ErrorCode::UnknownError,
                                format!(
                                    "Chat tasks created but vault write failed for goal {gid}: {e}"
                                ),
                            )
                        })?;
                    }
                }
            }
        }
    }

    Ok(ChatReprioritizeResponse {
        ai_message: ai_msg,
        plan_updated,
        updated_plan,
        task_titles: chat_task_titles,
    })
}

#[tauri::command]
pub async fn daily_loop_generate_summary(
    vault_id: String,
    model_id: String,
    date: String,
    app_state: State<'_, AppState>,
) -> Result<String, AppError> {
    let date_parsed = date
        .parse::<NaiveDate>()
        .map_err(|_| AppError::validation_error(format!("Invalid date: {date}")))?;

    // Gather today's plan data for summary context
    let summary_context = with_db(&vault_id, &app_state, |db| {
        let plan = db.get_plan_by_date(date_parsed)?;
        let check_in = db.get_check_in(date_parsed)?;

        let mut ctx = format!("Date: {date}\n\n");

        if let Some(p) = &plan {
            let outcomes = db.get_outcomes_for_plan(&p.id)?;
            ctx.push_str("## Today's Outcomes\n");
            for o in &outcomes {
                ctx.push_str(&format!("- {}\n", o.title));
            }
            ctx.push_str(&format!("\n## Planned tasks: {}\n", p.task_order.len()));
        }

        if let Some(ci) = &check_in {
            ctx.push_str(&format!(
                "## Completed: {} tasks\n",
                ci.completed_task_ids.len()
            ));
            if let Some(notes) = &ci.notes {
                ctx.push_str(&format!("## User notes: {notes}\n"));
            }
        }

        Ok(ctx)
    })?;

    let summary = call_llm_text(
        &model_id,
        CHECK_IN_SUMMARY_PROMPT,
        &summary_context,
        500,
        Some(&app_state),
    )
    .await?;
    Ok(summary.trim().to_string())
}
