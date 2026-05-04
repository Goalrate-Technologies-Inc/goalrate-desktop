//! Assistant-powered Agenda commands
//!
//! Handles Agenda generation, chat reprioritization, and check-in summaries
//! through GoalRate hosted AI in production and direct providers in local development.

use chrono::{Duration, NaiveDate, NaiveTime, Timelike};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use tauri::State;

use agenda::{
    build_context, ChatRole, RevisionTrigger, CHAT_REPRIORITIZE_SYSTEM_PROMPT,
    CHECK_IN_SUMMARY_PROMPT, DAILY_PLAN_SYSTEM_PROMPT,
};

use crate::commands::agenda::{
    apply_memory_limits_to_explicit_schedule_for_date, apply_memory_to_generated_schedule_for_date,
    build_scheduled_tasks, derive_eisenhower_quadrant_for_task_title,
    is_pending_agenda_task_for_scheduled_date, memory_agenda_targets_for_date,
    memory_prompt_context, normalize_agenda_time_label, read_agenda_overlay,
    task_quadrants_from_vault, task_specific_agenda_date, title_inferred_eisenhower_quadrant,
    with_db, write_agenda_markdown_for_plan, AGENDA_DBS,
};
use crate::commands::goals::{
    list_goal_frontmatter_tasks_from_manager, validate_goal_frontmatter_tasks_for_write,
    GoalFrontmatterTask,
};
use crate::commands::memory::{
    apply_assistant_memory_update, AssistantMemoryUpdate, MemoryImportantDay, MemoryTimeWindow,
};
use crate::commands::vault::AppState;
use crate::error::{AppError, ErrorCode};
use crate::types::eisenhower_color_token;

const ANTHROPIC_MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION: &str = "2023-06-01";
const OPENAI_CHAT_URL: &str = "https://api.openai.com/v1/chat/completions";
const GOALRATE_HOSTED_AI_URL: &str = "https://api.goalrate.com/api/desktop/ai/completions";
const HOSTED_AI_PRIMARY_ROUTE_MODEL_ID: &str = "goalrate::agenda-balanced";
const HOSTED_AI_BACKFILL_ROUTE_MODEL_ID: &str = "goalrate::agenda-economy";
const AI_OVERLOADED_STATUS_CODE: u16 = 529;
const AI_OVERLOADED_RETRY_DELAY_MS: u64 = 2_000;

fn truthy_env(name: &str) -> bool {
    std::env::var(name)
        .map(|value| matches!(value.trim(), "1" | "true" | "TRUE" | "True"))
        .unwrap_or(false)
}

fn configured_hosted_ai_url() -> Option<String> {
    std::env::var("GOALRATE_HOSTED_AI_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn hosted_ai_required() -> bool {
    configured_hosted_ai_url().is_some()
        || option_env!("GOALRATE_REQUIRE_HOSTED_AI")
            .map(|value| matches!(value.trim(), "1" | "true" | "TRUE" | "True"))
            .unwrap_or(false)
        || truthy_env("GOALRATE_REQUIRE_HOSTED_AI")
        || !cfg!(debug_assertions)
}

const CHAT_REPRIORITIZE_REPAIR_SYSTEM_PROMPT: &str = r#"You repair GoalRate Assistant chat adjustment responses.

The previous response did not include a usable plan_update, but the latest user request was already classified as an Agenda-change request. Infer the intended Agenda adjustment from context and return corrected JSON with a concrete plan_update.

Respond with ONLY valid JSON:
{
  "message": "Short user-facing confirmation",
  "plan_update": {
    "action": "add" | "remove" | "reorder" | "replace" | "regenerate" | "reschedule" | "update_schedule",
    "top_3_outcomes": [
      {"title": "Outcome title", "linked_task_ids": ["task_id_1"]}
    ],
    "tasks": [
      {"id": "task_id_1", "title": "Task title", "goal_id": "goal_id", "scheduled_date": null}
    ],
    "scheduled_tasks": [
      {
        "id": "scheduled_task_id_1",
        "task_id": "task_id_1",
        "title": "Task title",
        "start_time": "9:00 AM",
        "duration_minutes": 30,
        "estimate_source": "ai",
        "eisenhower_quadrant": "do"
      }
    ]
  }
}

Rules:
- Use exact existing task IDs from context when changing existing tasks.
- For new concrete tasks, create sanitized task IDs like "task_short_slug".
- For timing changes, dependency fixes, or multi-step routines, include scheduled_tasks with 12-hour am/pm start times.
- For full reorder/regenerate/replace, include the full visible task list and schedule.
- If Memory Planning Context includes Task capacity today, scheduled_tasks duration_minutes must not add up to more than that capacity.
- Default to making the user's requested change when context makes a reasonable update possible.
- Only push back when the visible schedule cannot fit the requested work inside the user's time constraints, the day would need to start earlier, or required tasks are mutually impossible. In that case, return the closest executable plan_update and say what does not fit.
- Do not return null plan_update. If the request cannot be fully satisfied, still return the closest executable plan_update and explain the constraint in the message."#;

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

fn hosted_ai_url() -> Option<String> {
    configured_hosted_ai_url()
        .or_else(|| hosted_ai_required().then(|| GOALRATE_HOSTED_AI_URL.to_string()))
}

fn hosted_ai_route_model_id(requested_model_id: &str) -> String {
    let trimmed = requested_model_id.trim();
    if trimmed.starts_with("goalrate::") {
        trimmed.to_string()
    } else {
        HOSTED_AI_PRIMARY_ROUTE_MODEL_ID.to_string()
    }
}

fn hosted_ai_backfill_model_id(primary_model_id: &str) -> Option<&'static str> {
    (primary_model_id != HOSTED_AI_BACKFILL_ROUTE_MODEL_ID)
        .then_some(HOSTED_AI_BACKFILL_ROUTE_MODEL_ID)
}

fn hosted_ai_model_unavailable(status: reqwest::StatusCode, body: &str) -> bool {
    let body = body.to_ascii_lowercase();
    let mentions_model = body.contains("model");
    let mentions_unavailable = body.contains("unavailable")
        || body.contains("not available")
        || body.contains("unsupported")
        || body.contains("not_found")
        || body.contains("not found");

    matches!(
        status.as_u16(),
        400 | 404 | 409 | 422 | 424 | 503 | AI_OVERLOADED_STATUS_CODE
    ) && mentions_model
        && mentions_unavailable
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
    pub plan: agenda::DailyPlan,
    pub outcomes: Vec<agenda::Outcome>,
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
    pub ai_message: agenda::ChatMessage,
    pub plan_updated: bool,
    pub updated_plan: Option<agenda::DailyPlan>,
    /// Task titles from AI-generated tasks in the plan update
    pub task_titles: std::collections::HashMap<String, String>,
}

// ── LLM Call Helpers ───────────────────────────────────────────

fn should_retry_ai_response(status: reqwest::StatusCode, attempt: usize) -> bool {
    attempt == 0 && status.as_u16() == AI_OVERLOADED_STATUS_CODE
}

async fn send_ai_request_with_overload_retry<F>(
    provider: &str,
    mut build_request: F,
) -> Result<reqwest::Response, AppError>
where
    F: FnMut() -> reqwest::RequestBuilder,
{
    for attempt in 0..=1 {
        let response = build_request().send().await.map_err(|e| {
            AppError::new(
                ErrorCode::NetworkError,
                format!("{provider} request failed: {e}"),
            )
        })?;

        if should_retry_ai_response(response.status(), attempt) {
            log::warn!(
                "[AI] {provider} returned {}; retrying once after {}ms",
                response.status(),
                AI_OVERLOADED_RETRY_DELAY_MS
            );
            tokio::time::sleep(std::time::Duration::from_millis(
                AI_OVERLOADED_RETRY_DELAY_MS,
            ))
            .await;
            continue;
        }

        return Ok(response);
    }

    unreachable!("AI retry loop always returns after the final attempt")
}

async fn call_anthropic(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
) -> Result<String, AppError> {
    let client = reqwest::Client::new();
    let response = send_ai_request_with_overload_retry("Anthropic", || {
        client
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
    })
    .await?;

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
    let response = send_ai_request_with_overload_retry("OpenAI", || {
        client
            .post(OPENAI_CHAT_URL)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("Content-Type", "application/json")
            .json(&body)
    })
    .await?;

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

async fn call_goalrate_hosted_ai(
    url: &str,
    model_id: &str,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
    json_mode: bool,
) -> Result<String, AppError> {
    let tokens = super::auth::get_tokens().await?.ok_or_else(|| {
        AppError::auth_error(
            "Sign in to use GoalRate hosted AI. Plus entitlements are checked by your GoalRate account.",
        )
    })?;
    if tokens.expires_at <= chrono::Utc::now().timestamp_millis() {
        return Err(AppError::auth_error(
            "Your GoalRate session has expired. Sign in again to use hosted AI.",
        ));
    }

    let client = reqwest::Client::new();
    let primary_model_id = hosted_ai_route_model_id(model_id);
    let response = send_goalrate_hosted_ai_request(
        &client,
        url,
        &tokens.access_token,
        &primary_model_id,
        system_prompt,
        user_prompt,
        max_tokens,
        json_mode,
    )
    .await?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        if hosted_ai_model_unavailable(status, &body) {
            if let Some(backfill_model_id) = hosted_ai_backfill_model_id(&primary_model_id) {
                log::warn!(
                    "[AI] Hosted model route {} was unavailable; retrying with {}",
                    primary_model_id,
                    backfill_model_id
                );
                let backfill_response = send_goalrate_hosted_ai_request(
                    &client,
                    url,
                    &tokens.access_token,
                    backfill_model_id,
                    system_prompt,
                    user_prompt,
                    max_tokens,
                    json_mode,
                )
                .await?;
                let backfill_status = backfill_response.status();
                let backfill_body = backfill_response.text().await.unwrap_or_default();
                if backfill_status.is_success() {
                    return parse_goalrate_hosted_ai_response(&backfill_body);
                }
                return Err(AppError::new(
                    ErrorCode::NetworkError,
                    format!("GoalRate hosted AI error ({backfill_status}): {backfill_body}"),
                ));
            }
        }

        return Err(AppError::new(
            ErrorCode::NetworkError,
            format!("GoalRate hosted AI error ({status}): {body}"),
        ));
    }

    parse_goalrate_hosted_ai_response(&body)
}

async fn send_goalrate_hosted_ai_request(
    client: &reqwest::Client,
    url: &str,
    access_token: &str,
    model_id: &str,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
    json_mode: bool,
) -> Result<reqwest::Response, AppError> {
    send_ai_request_with_overload_retry("GoalRate AI", || {
        client
            .post(url)
            .header("Authorization", format!("Bearer {access_token}"))
            .json(&json!({
                "modelId": model_id,
                "systemPrompt": system_prompt,
                "userPrompt": user_prompt,
                "maxTokens": max_tokens,
                "jsonMode": json_mode,
                "client": "goalrate-desktop",
            }))
    })
    .await
}

fn parse_goalrate_hosted_ai_response(body: &str) -> Result<String, AppError> {
    let payload: Value = serde_json::from_str(body)
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Parse error: {e}")))?;
    payload
        .get("content")
        .or_else(|| payload.get("text"))
        .or_else(|| payload.get("message"))
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .ok_or_else(|| {
            AppError::new(
                ErrorCode::UnknownError,
                "GoalRate hosted AI returned an empty response.",
            )
        })
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
    // 1. Hosted AI path for production and explicit hosted development runs.
    if let Some(url) = hosted_ai_url() {
        log::info!("[AI] Routing request through GoalRate hosted AI");
        return call_goalrate_hosted_ai(
            &url,
            model_id,
            system_prompt,
            user_prompt,
            max_tokens,
            json_mode,
        )
        .await;
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

    // 4. Real direct-provider API call for development/direct builds.
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

    // 6. Store in cache
    if let Some(state) = app_state {
        if let Ok(mut cache) = state.ai_cache.lock() {
            cache.put(key, response.clone());
        }
    }

    Ok(response)
}

fn strip_code_fence_language(content: &str) -> &str {
    let trimmed = content.trim();
    let Some((first_line, rest)) = trimmed.split_once('\n') else {
        return trimmed;
    };
    if first_line.trim().eq_ignore_ascii_case("json") {
        rest.trim()
    } else {
        trimmed
    }
}

fn extract_balanced_json(text: &str) -> Option<&str> {
    let mut start = None;
    let mut depth = 0_i32;
    let mut in_string = false;
    let mut escaped = false;

    for (index, ch) in text.char_indices() {
        if start.is_none() {
            if ch == '{' {
                start = Some(index);
                depth = 1;
            }
            continue;
        }

        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    let end = index + ch.len_utf8();
                    return Some(text[start.unwrap()..end].trim());
                }
            }
            _ => {}
        }
    }

    None
}

/// Extract JSON from LLM response (handles markdown code blocks and prose wrappers).
fn extract_json(text: &str) -> &str {
    let trimmed = text.trim();
    if let Some(start) = trimmed.find("```") {
        let after = &trimmed[start + 3..];
        if let Some(end) = after.find("```") {
            let fenced = strip_code_fence_language(&after[..end]);
            return extract_balanced_json(fenced).unwrap_or(fenced);
        }
    }
    extract_balanced_json(trimmed).unwrap_or(trimmed)
}

fn strip_protocol_json_for_message(text: &str) -> String {
    let without_fence = text.split("```").next().unwrap_or(text).trim();
    let without_object = without_fence
        .split('{')
        .next()
        .unwrap_or(without_fence)
        .trim();
    let cleaned = sanitize_llm_text(without_object, 2000);
    if cleaned.is_empty() {
        "I’m working on that Agenda change.".to_string()
    } else {
        cleaned
    }
}

// ── Tauri Commands ─────────────────────────────────────────────

type VaultGoalContext = (String, String, Option<String>);
type VaultTaskContext = (
    String,
    String,
    Option<String>,
    Option<String>,
    i32,
    Option<String>,
    bool,
    String,
);

#[derive(Debug, Default)]
struct ParsedOrderedTasks {
    ordered_task_ids: Vec<String>,
    task_titles: std::collections::HashMap<String, String>,
    new_tasks: Vec<(String, String, String)>,
    recurring_flags: std::collections::HashMap<String, String>,
}

fn legacy_priority_to_eisenhower(priority: Option<&str>) -> String {
    match priority.unwrap_or("medium").to_ascii_lowercase().as_str() {
        "critical" | "high" => "do".to_string(),
        "medium" | "low" => "schedule".to_string(),
        _ => "schedule".to_string(),
    }
}

fn eisenhower_sort_rank(quadrant: &str) -> u8 {
    match quadrant {
        "do" => 0,
        "schedule" => 1,
        "delegate" => 2,
        "delete" => 3,
        _ => 1,
    }
}

fn vault_task_title_lookup(
    tasks: &[VaultTaskContext],
) -> std::collections::HashMap<String, String> {
    tasks
        .iter()
        .filter_map(|(id, title, ..)| {
            let title = title.trim();
            if id.trim().is_empty() || title.is_empty() {
                None
            } else {
                Some((id.clone(), title.to_string()))
            }
        })
        .collect()
}

fn append_available_tasks_to_order(
    ordered_task_ids: &mut Vec<String>,
    task_titles: &mut std::collections::HashMap<String, String>,
    tasks: &[VaultTaskContext],
) {
    let mut ranked = tasks.to_vec();
    ranked.sort_by(|a, b| {
        eisenhower_sort_rank(&a.7)
            .cmp(&eisenhower_sort_rank(&b.7))
            .then_with(|| {
                a.3.as_deref()
                    .unwrap_or("9999-12-31")
                    .cmp(b.3.as_deref().unwrap_or("9999-12-31"))
            })
            .then_with(|| b.4.cmp(&a.4))
    });

    let mut seen: std::collections::HashSet<String> = ordered_task_ids.iter().cloned().collect();
    for (task_id, title, ..) in ranked {
        if seen.insert(task_id.clone()) {
            task_titles.entry(task_id.clone()).or_insert(title);
            ordered_task_ids.push(task_id);
        }
    }
}

fn known_task_title(
    task_id: &str,
    task_titles: &std::collections::HashMap<String, String>,
    vault_task_titles: &std::collections::HashMap<String, String>,
) -> Option<String> {
    task_titles
        .get(task_id)
        .or_else(|| vault_task_titles.get(task_id))
        .map(|title| title.trim())
        .filter(|title| !title.is_empty())
        .map(str::to_string)
}

fn generated_task_id_label(task_id: &str) -> String {
    task_id.trim_start_matches("task_").replace('_', " ")
}

fn scheduled_task_title_needs_replacement(title: &str, task_id: &str) -> bool {
    let title = title.trim();
    title.is_empty() || title == task_id || title == generated_task_id_label(task_id)
}

fn apply_known_titles_to_scheduled_tasks(
    scheduled_tasks: &mut [agenda::ScheduledTask],
    task_titles: &std::collections::HashMap<String, String>,
    vault_task_titles: &std::collections::HashMap<String, String>,
) {
    for task in scheduled_tasks {
        if scheduled_task_title_needs_replacement(&task.title, &task.task_id) {
            if let Some(title) = known_task_title(&task.task_id, task_titles, vault_task_titles) {
                task.title = title;
            }
        }
    }
}

fn apply_derived_quadrants_to_scheduled_tasks(
    scheduled_tasks: &mut [agenda::ScheduledTask],
    task_quadrants: &std::collections::HashMap<String, String>,
) {
    for task in scheduled_tasks {
        if let Some(quadrant) = title_inferred_eisenhower_quadrant(&task.title)
            .or_else(|| task_quadrants.get(&task.task_id).cloned())
        {
            task.eisenhower_quadrant = Some(quadrant.clone());
        }
    }
}

fn parse_ordered_tasks_from_ai(
    parsed: &Value,
    vault_task_titles: &std::collections::HashMap<String, String>,
) -> ParsedOrderedTasks {
    let mut parsed_tasks = ParsedOrderedTasks::default();

    let Some(arr) = parsed.get("ordered_tasks").and_then(Value::as_array) else {
        return parsed_tasks;
    };

    for item in arr {
        if let Some(s) = item.as_str() {
            let id = sanitize_task_id(s);
            if id.is_empty() {
                continue;
            }
            if let Some(title) = vault_task_titles.get(&id) {
                parsed_tasks.task_titles.insert(id.clone(), title.clone());
            }
            parsed_tasks.ordered_task_ids.push(id);
        } else if item.is_object() {
            let id = sanitize_task_id(item.get("id").and_then(Value::as_str).unwrap_or(""));
            let mut title =
                sanitize_llm_text(item.get("title").and_then(Value::as_str).unwrap_or(""), 200);
            let goal_id =
                sanitize_task_id(item.get("goal_id").and_then(Value::as_str).unwrap_or(""));
            // Accept both string ("daily") and bool (true→"daily", false→"none") for backwards compat.
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

            if id.is_empty() {
                continue;
            }
            if title.is_empty() {
                if let Some(existing_title) = vault_task_titles.get(&id) {
                    title = existing_title.clone();
                }
            }
            if !title.is_empty() {
                parsed_tasks.task_titles.insert(id.clone(), title.clone());
                // If the AI generated a new task with a goal_id, track it for persistence.
                if !goal_id.is_empty() {
                    parsed_tasks.new_tasks.push((id.clone(), title, goal_id));
                }
            }
            if let Some(r) = recurring {
                parsed_tasks.recurring_flags.insert(id.clone(), r);
            }
            parsed_tasks.ordered_task_ids.push(id);
        }
    }

    parsed_tasks
}

/// Gather goals and tasks from vault for context assembly
fn gather_vault_context(
    vault_id: &str,
    app_state: &AppState,
    date: NaiveDate,
) -> Result<(Vec<VaultGoalContext>, Vec<VaultTaskContext>), AppError> {
    let task_quadrants = task_quadrants_from_vault(vault_id, app_state, date)?;
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
            // Domain: spec-shaped files use `type: goal` plus `domain`.
            // Older files may still use `type` as the domain value.
            let type_value = fm.get("type").and_then(|v| v.as_str());
            let domain = fm
                .get("domain")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| {
                    type_value
                        .filter(|value| !matches!(*value, "goal" | "objective"))
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

    let mut collected_tasks: Vec<(String, String, String, GoalFrontmatterTask)> = Vec::new();
    for (gid, gtitle, _domain) in &goals {
        let goal_priority = vault
            .read_goal(gid)
            .ok()
            .and_then(|(fm, _body)| {
                fm.get("priority")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "medium".to_string());

        let goal_tasks = match list_goal_frontmatter_tasks_from_manager(vault, gid) {
            Ok(tasks) => tasks,
            Err(error) => {
                log::warn!("Failed to load goal task frontmatter for '{gid}': {error}");
                continue;
            }
        };
        collected_tasks.extend(
            goal_tasks
                .into_iter()
                .map(|task| (gtitle.clone(), goal_priority.clone(), gid.clone(), task)),
        );
    }

    let scheduled_dates_by_id: std::collections::HashMap<String, String> = collected_tasks
        .iter()
        .filter_map(|(_, _, _, task)| {
            task_specific_agenda_date(task)
                .map(|scheduled_date| (task.id.clone(), scheduled_date.to_string()))
        })
        .collect();
    let effective_scheduled_date = |task: &GoalFrontmatterTask| {
        task_specific_agenda_date(task)
            .map(str::to_string)
            .or_else(|| {
                task.parent_id
                    .as_deref()
                    .and_then(|parent_id| scheduled_dates_by_id.get(parent_id).cloned())
            })
    };

    let parent_ids_with_children: std::collections::HashSet<String> = collected_tasks
        .iter()
        .filter(|(_, _, _, task)| {
            let scheduled_date = effective_scheduled_date(task);
            is_pending_agenda_task_for_scheduled_date(task, date, scheduled_date.as_deref())
        })
        .filter_map(|(_, _, _, task)| task.parent_id.clone())
        .collect();

    let mut tasks = Vec::new();
    for (gtitle, goal_priority, _gid, task) in collected_tasks {
        let scheduled_date = effective_scheduled_date(&task);
        if !is_pending_agenda_task_for_scheduled_date(&task, date, scheduled_date.as_deref())
            || parent_ids_with_children.contains(&task.id)
        {
            continue;
        }

        let deferral_count = {
            let dbs = AGENDA_DBS.lock().ok();
            dbs.as_ref()
                .and_then(|d| d.get(vault_id))
                .and_then(|db| db.get_deferral_count(&task.id).ok())
                .unwrap_or(0)
        };
        let has_subtasks = parent_ids_with_children.contains(&task.id);
        let task_quadrant = task_quadrants.get(&task.id).cloned().unwrap_or_else(|| {
            derive_eisenhower_quadrant_for_task_title(
                &task.title,
                Some(&goal_priority),
                task.due_date.as_deref(),
                scheduled_date.as_deref(),
                date,
            )
        });
        let due_date = task.due_date.or_else(|| scheduled_date.clone());

        tasks.push((
            task.id,
            task.title,
            Some(gtitle),
            due_date,
            deferral_count,
            task.parent_id,
            has_subtasks,
            task_quadrant,
        ));
    }

    Ok((goals, tasks))
}

fn active_goal_tasks_with_effective_scheduled_dates(
    vault_id: &str,
    app_state: &AppState,
) -> Result<Vec<(GoalFrontmatterTask, Option<String>)>, AppError> {
    let vaults = app_state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let vault = vaults
        .get(vault_id)
        .ok_or_else(|| AppError::vault_not_open(vault_id))?;

    let mut all_tasks = Vec::new();
    for gid in vault.list_goals().unwrap_or_default() {
        let Ok((fm, _body)) = vault.read_goal(&gid) else {
            continue;
        };
        let status = fm
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("active");
        if matches!(status, "archived" | "completed" | "abandoned") {
            continue;
        }

        let goal_tasks = match list_goal_frontmatter_tasks_from_manager(vault, &gid) {
            Ok(tasks) => tasks,
            Err(error) => {
                log::warn!("Failed to load goal task frontmatter for '{gid}': {error}");
                continue;
            }
        };
        all_tasks.extend(goal_tasks);
    }

    let scheduled_dates_by_id: std::collections::HashMap<String, String> = all_tasks
        .iter()
        .filter_map(|task| {
            task_specific_agenda_date(task)
                .map(|scheduled_date| (task.id.clone(), scheduled_date.to_string()))
        })
        .collect();

    Ok(all_tasks
        .into_iter()
        .map(|task| {
            let effective_scheduled_date = task_specific_agenda_date(&task)
                .map(str::to_string)
                .or_else(|| {
                    task.parent_id
                        .as_deref()
                        .and_then(|parent_id| scheduled_dates_by_id.get(parent_id).cloned())
                });
            (task, effective_scheduled_date)
        })
        .collect())
}

fn task_specific_dates_from_vault(
    vault_id: &str,
    app_state: &AppState,
) -> Result<std::collections::HashMap<String, String>, AppError> {
    Ok(
        active_goal_tasks_with_effective_scheduled_dates(vault_id, app_state)?
            .into_iter()
            .filter_map(|(task, scheduled_date)| scheduled_date.map(|date| (task.id, date)))
            .collect(),
    )
}

fn required_agenda_tasks_for_date(
    vault_id: &str,
    app_state: &AppState,
    date: NaiveDate,
) -> Result<Vec<(String, String)>, AppError> {
    let tasks = active_goal_tasks_with_effective_scheduled_dates(vault_id, app_state)?;
    let parent_ids_with_children: std::collections::HashSet<String> = tasks
        .iter()
        .filter(|(task, scheduled_date)| {
            is_pending_agenda_task_for_scheduled_date(task, date, scheduled_date.as_deref())
        })
        .filter_map(|(task, _)| task.parent_id.clone())
        .collect();

    let date_text = date.to_string();
    Ok(tasks
        .into_iter()
        .filter(|(task, scheduled_date)| {
            scheduled_date.as_deref() == Some(date_text.as_str())
                && is_pending_agenda_task_for_scheduled_date(task, date, scheduled_date.as_deref())
                && !parent_ids_with_children.contains(&task.id)
        })
        .map(|(task, _)| (task.id, task.title))
        .collect())
}

fn heuristic_daily_plan_payload(tasks: &[VaultTaskContext]) -> Value {
    let mut ranked = tasks.to_vec();
    ranked.sort_by(|a, b| {
        eisenhower_sort_rank(&a.7)
            .cmp(&eisenhower_sort_rank(&b.7))
            .then_with(|| {
                a.3.as_deref()
                    .unwrap_or("9999-12-31")
                    .cmp(b.3.as_deref().unwrap_or("9999-12-31"))
            })
            .then_with(|| b.4.cmp(&a.4))
    });
    let ranked: Vec<_> = ranked.into_iter().take(8).collect();

    let ordered_tasks: Vec<Value> = ranked
        .iter()
        .map(|(id, title, goal_title, .., quadrant)| {
            json!({
                "id": id,
                "title": title,
                "goal_title": goal_title,
                "eisenhower_quadrant": quadrant,
            })
        })
        .collect();
    let top_3_outcomes: Vec<Value> = ranked
        .iter()
        .take(3)
        .map(|(id, title, ..)| {
            json!({
                "title": title,
                "linked_task_ids": [id],
            })
        })
        .collect();

    json!({
        "top_3_outcomes": top_3_outcomes,
        "ordered_tasks": ordered_tasks,
        "daily_insight": "AI was unavailable, so GoalRate built a heuristic plan from existing tasks.",
        "pattern_note": "",
        "deferrals_confrontation": []
    })
}

async fn fresh_agenda_regeneration(
    vault_id: &str,
    app_state: &AppState,
    model_id: &str,
    current_plan: &agenda::DailyPlan,
    goals: &[VaultGoalContext],
    tasks: &[VaultTaskContext],
    latest_user_request: &str,
) -> Result<FreshAgendaRegeneration, AppError> {
    let date = current_plan.date;
    let vault_task_titles = vault_task_title_lookup(tasks);
    let task_specific_dates = task_specific_dates_from_vault(vault_id, app_state)?;
    let required_agenda_tasks = required_agenda_tasks_for_date(vault_id, app_state, date)?;
    let memory_targets = memory_agenda_targets_for_date(vault_id, app_state, date)?;
    let agenda_date_text = date.to_string();

    let context = with_db(vault_id, app_state, |db| build_context(db, goals, tasks))?;
    let generated_at = chrono::Local::now().to_rfc3339();
    let mut user_prompt = context.to_user_prompt_for_date(date);
    user_prompt.push_str("\n\n## Agenda Generation Time\n");
    user_prompt.push_str(&generated_at);
    user_prompt.push('\n');
    if let Some(memory_context) = memory_prompt_context(vault_id, app_state, date)? {
        user_prompt.push_str("\n\n");
        user_prompt.push_str(&memory_context);
    }
    user_prompt.push_str("\n\n## Regeneration Request\n");
    user_prompt.push_str(latest_user_request.trim());
    user_prompt.push_str(
        "\nTreat this exactly like a fresh Agenda generation for this date and replace today's visible Agenda.",
    );

    let parsed = match call_llm(
        model_id,
        DAILY_PLAN_SYSTEM_PROMPT,
        &user_prompt,
        2000,
        Some(app_state),
    )
    .await
    {
        Ok(raw_response) => {
            let json_str = extract_json(&raw_response);
            match serde_json::from_str(json_str) {
                Ok(parsed) => parsed,
                Err(err) => {
                    log::warn!(
                        "AI regeneration response was not valid JSON; using heuristic plan: {err}"
                    );
                    heuristic_daily_plan_payload(tasks)
                }
            }
        }
        Err(err) => {
            log::warn!("AI regeneration unavailable; using heuristic plan: {err}");
            heuristic_daily_plan_payload(tasks)
        }
    };

    let ParsedOrderedTasks {
        mut ordered_task_ids,
        mut task_titles,
        new_tasks,
        ..
    } = parse_ordered_tasks_from_ai(&parsed, &vault_task_titles);

    ordered_task_ids.retain(|task_id| {
        task_specific_dates
            .get(task_id)
            .map_or(true, |scheduled_date| scheduled_date == &agenda_date_text)
    });
    for task_id in &ordered_task_ids {
        if let Some(title) = vault_task_titles.get(task_id) {
            task_titles
                .entry(task_id.clone())
                .or_insert_with(|| title.clone());
        }
    }
    for (task_id, title) in &required_agenda_tasks {
        task_titles
            .entry(task_id.clone())
            .or_insert_with(|| title.clone());
        if !ordered_task_ids.contains(task_id) {
            ordered_task_ids.push(task_id.clone());
        }
    }
    if memory_targets.has_any_target() {
        append_available_tasks_to_order(&mut ordered_task_ids, &mut task_titles, tasks);
    }

    let mut plan = current_plan.clone();
    plan.generated_at = Some(generated_at.clone());
    plan.task_order = ordered_task_ids;
    plan.scheduled_tasks.clear();
    plan.task_titles.extend(task_titles.clone());

    let task_quadrants = task_quadrants_from_vault(vault_id, app_state, date)?;
    let mut scheduled_tasks = parse_ai_scheduled_tasks(&parsed);
    apply_known_titles_to_scheduled_tasks(&mut scheduled_tasks, &task_titles, &vault_task_titles);
    apply_derived_quadrants_to_scheduled_tasks(&mut scheduled_tasks, &task_quadrants);
    scheduled_tasks.retain(|task| {
        task_specific_dates
            .get(&task.task_id)
            .map_or(true, |scheduled_date| scheduled_date == &agenda_date_text)
    });
    if !scheduled_tasks.is_empty()
        && required_agenda_tasks
            .iter()
            .any(|(task_id, _)| !scheduled_tasks.iter().any(|task| task.task_id == *task_id))
    {
        scheduled_tasks.clear();
    }
    if scheduled_tasks.is_empty() {
        scheduled_tasks = build_scheduled_tasks(&plan, &generated_at, &task_quadrants);
    }
    scheduled_tasks = apply_memory_to_generated_schedule_for_date(
        vault_id,
        app_state,
        date,
        &plan,
        scheduled_tasks,
        &generated_at,
        &task_quadrants,
    )?;
    for task in &scheduled_tasks {
        plan.task_titles
            .insert(task.task_id.clone(), task.title.clone());
        task_titles.insert(task.task_id.clone(), task.title.clone());
    }
    plan.task_order = scheduled_tasks
        .iter()
        .map(|task| task.task_id.clone())
        .collect();

    Ok(FreshAgendaRegeneration {
        generated_at,
        task_order: plan.task_order,
        task_titles,
        scheduled_tasks,
        outcome_specs: parse_chat_outcome_updates(&parsed),
        new_tasks: new_tasks
            .into_iter()
            .map(|(task_id, title, goal_id)| (task_id, title, goal_id, None))
            .collect(),
    })
}

fn parse_ai_scheduled_tasks(parsed: &Value) -> Vec<agenda::ScheduledTask> {
    parsed
        .get("scheduled_tasks")
        .or_else(|| parsed.get("scheduledTasks"))
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let task_id = item
                        .get("task_id")
                        .or_else(|| item.get("taskId"))
                        .and_then(Value::as_str)?
                        .to_string();
                    let title = item
                        .get("title")
                        .and_then(Value::as_str)
                        .unwrap_or(&task_id)
                        .to_string();
                    let start_time = item
                        .get("start_time")
                        .or_else(|| item.get("startTime"))
                        .and_then(Value::as_str)?
                        .to_string();
                    let duration_minutes = item
                        .get("duration_minutes")
                        .or_else(|| item.get("durationMinutes"))
                        .and_then(Value::as_i64)
                        .unwrap_or(30) as i32;
                    Some(agenda::ScheduledTask {
                        id: item
                            .get("id")
                            .and_then(Value::as_str)
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| format!("scheduled_{task_id}")),
                        task_id,
                        title,
                        start_time: normalize_agenda_time_label(&start_time),
                        duration_minutes,
                        estimate_source: item
                            .get("estimate_source")
                            .or_else(|| item.get("estimateSource"))
                            .and_then(Value::as_str)
                            .map(|s| s.to_string()),
                        eisenhower_quadrant: item
                            .get("eisenhower_quadrant")
                            .or_else(|| item.get("eisenhowerQuadrant"))
                            .and_then(Value::as_str)
                            .map(|s| s.to_string()),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OutcomeSpec {
    title: String,
    linked_task_ids: Vec<String>,
}

#[derive(Debug, Clone)]
struct FreshAgendaRegeneration {
    generated_at: String,
    task_order: Vec<String>,
    task_titles: std::collections::HashMap<String, String>,
    scheduled_tasks: Vec<agenda::ScheduledTask>,
    outcome_specs: Vec<OutcomeSpec>,
    new_tasks: Vec<(String, String, String, Option<String>)>,
}

fn parse_chat_outcome_updates(parsed: &Value) -> Vec<OutcomeSpec> {
    parsed
        .get("top_3_outcomes")
        .or_else(|| parsed.get("top3Outcomes"))
        .or_else(|| parsed.get("outcomes"))
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let title = sanitize_llm_text(
                        item.get("title").and_then(Value::as_str).unwrap_or(""),
                        200,
                    );
                    if title.is_empty() {
                        return None;
                    }

                    let linked_task_ids = item
                        .get("linked_task_ids")
                        .or_else(|| item.get("linkedTaskIds"))
                        .or_else(|| item.get("task_ids"))
                        .or_else(|| item.get("taskIds"))
                        .and_then(Value::as_array)
                        .map(|ids| {
                            ids.iter()
                                .filter_map(Value::as_str)
                                .map(sanitize_task_id)
                                .filter(|id| !id.is_empty())
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();

                    Some(OutcomeSpec {
                        title,
                        linked_task_ids,
                    })
                })
                .take(3)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_plan_update_task_ids(update: &Value) -> Vec<String> {
    update
        .get("tasks")
        .and_then(Value::as_array)
        .or_else(|| update.get("ordered_tasks").and_then(Value::as_array))
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    if let Some(id) = item.as_str() {
                        Some(sanitize_task_id(id))
                    } else if item.is_object() {
                        Some(sanitize_task_id(
                            item.get("id").and_then(Value::as_str).unwrap_or(""),
                        ))
                    } else {
                        None
                    }
                })
                .filter(|id| !id.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn plan_update_reorder_changes_visible_order(
    update: &Value,
    current_plan: &agenda::DailyPlan,
) -> bool {
    if update.get("action").and_then(Value::as_str) != Some("reorder") {
        return true;
    }

    let current_order = current_plan.task_order.clone();
    let scheduled_updates = parse_ai_scheduled_tasks(update);
    if let Some(schedule_order) =
        scheduled_update_order_for_action("reorder", &current_order, &scheduled_updates)
    {
        return schedule_order != current_order;
    }

    let mut parsed_ids = parse_plan_update_task_ids(update);
    if parsed_ids.is_empty() && !scheduled_updates.is_empty() {
        parsed_ids = scheduled_updates
            .iter()
            .map(|task| task.task_id.clone())
            .collect();
    }

    merge_partial_reorder(&current_order, &parsed_ids) != current_order
}

fn visible_schedule_task_ids(plan: &agenda::DailyPlan) -> Vec<String> {
    let source: Vec<String> = if plan.scheduled_tasks.is_empty() {
        plan.task_order.clone()
    } else {
        plan.scheduled_tasks
            .iter()
            .map(|task| task.task_id.clone())
            .collect()
    };

    let mut seen = std::collections::HashSet::new();
    source
        .into_iter()
        .filter(|task_id| !task_id.starts_with("memory_"))
        .filter(|task_id| seen.insert(task_id.clone()))
        .collect()
}

fn outcome_title_for_task_id(plan: &agenda::DailyPlan, task_id: &str) -> String {
    plan.scheduled_tasks
        .iter()
        .find(|task| task.task_id == task_id)
        .map(|task| task.title.trim().to_string())
        .filter(|title| !title.is_empty())
        .or_else(|| {
            plan.task_titles
                .get(task_id)
                .map(|title| title.trim().to_string())
                .filter(|title| !title.is_empty())
        })
        .unwrap_or_else(|| {
            let mut label = task_id.trim_start_matches("task_").replace('_', " ");
            if let Some(first) = label.get_mut(0..1) {
                first.make_ascii_uppercase();
            }
            label
        })
}

fn outcomes_in_plan_order(
    plan: &agenda::DailyPlan,
    outcomes: &[agenda::Outcome],
) -> Vec<agenda::Outcome> {
    let mut remaining = outcomes.to_vec();
    let mut ordered = Vec::new();

    for outcome_id in &plan.top_3_outcome_ids {
        if let Some(index) = remaining
            .iter()
            .position(|outcome| outcome.id == *outcome_id)
        {
            ordered.push(remaining.remove(index));
        }
    }

    ordered.extend(remaining);
    ordered
}

fn desired_outcome_specs_for_schedule(
    plan: &agenda::DailyPlan,
    existing_outcomes: &[agenda::Outcome],
    requested_outcomes: &[OutcomeSpec],
) -> Vec<OutcomeSpec> {
    let visible_task_ids = visible_schedule_task_ids(plan);
    let visible_task_id_set: std::collections::HashSet<String> =
        visible_task_ids.iter().cloned().collect();
    let ordered_existing = outcomes_in_plan_order(plan, existing_outcomes);
    let mut specs = Vec::new();
    let mut represented_task_ids = std::collections::HashSet::new();

    let mut push_spec = |title: String, linked_task_ids: Vec<String>| {
        if specs.len() >= 3 {
            return;
        }

        let mut seen = std::collections::HashSet::new();
        let linked_task_ids: Vec<String> = linked_task_ids
            .into_iter()
            .map(|id| sanitize_task_id(&id))
            .filter(|id| {
                !id.is_empty()
                    && visible_task_id_set.contains(id)
                    && !represented_task_ids.contains(id)
                    && seen.insert(id.clone())
            })
            .collect();

        if title.trim().is_empty() || linked_task_ids.is_empty() {
            return;
        }

        represented_task_ids.extend(linked_task_ids.iter().cloned());
        specs.push(OutcomeSpec {
            title: title.trim().to_string(),
            linked_task_ids,
        });
    };

    for requested in requested_outcomes {
        push_spec(requested.title.clone(), requested.linked_task_ids.clone());
    }

    for outcome in ordered_existing {
        push_spec(outcome.title, outcome.linked_task_ids);
    }

    for task_id in visible_task_ids {
        push_spec(outcome_title_for_task_id(plan, &task_id), vec![task_id]);
    }

    specs
}

fn sync_outcomes_for_schedule(
    db: &agenda::AgendaDb,
    plan: &agenda::DailyPlan,
    requested_outcomes: &[OutcomeSpec],
) -> agenda::AgendaResult<(agenda::DailyPlan, Vec<agenda::Outcome>)> {
    let existing_outcomes = db.get_outcomes_for_plan(&plan.id)?;
    let desired_specs =
        desired_outcome_specs_for_schedule(plan, &existing_outcomes, requested_outcomes);
    let ordered_existing = outcomes_in_plan_order(plan, &existing_outcomes);
    let mut used_existing_ids = std::collections::HashSet::new();
    let mut synced_outcomes = Vec::new();

    for (index, spec) in desired_specs.iter().enumerate() {
        if let Some(existing) = ordered_existing.get(index) {
            used_existing_ids.insert(existing.id.clone());
            let outcome = if existing.title == spec.title
                && existing.linked_task_ids == spec.linked_task_ids
            {
                existing.clone()
            } else {
                db.update_outcome(
                    &existing.id,
                    Some(spec.title.as_str()),
                    Some(spec.linked_task_ids.clone()),
                )?
            };
            synced_outcomes.push(outcome);
        } else {
            synced_outcomes.push(db.create_outcome(
                &plan.id,
                &spec.title,
                spec.linked_task_ids.clone(),
                true,
            )?);
        }
    }

    for outcome in existing_outcomes {
        if !used_existing_ids.contains(&outcome.id)
            && !synced_outcomes.iter().any(|synced| synced.id == outcome.id)
        {
            db.delete_outcome(&outcome.id)?;
        }
    }

    let outcome_ids: Vec<String> = synced_outcomes
        .iter()
        .map(|outcome| outcome.id.clone())
        .collect();
    let db_plan = db.update_plan(
        &plan.id,
        Some(outcome_ids.clone()),
        Some(plan.task_order.clone()),
    )?;

    let mut reconciled_plan = plan.clone();
    reconciled_plan.top_3_outcome_ids = outcome_ids.clone();
    reconciled_plan.updated_at = db_plan.updated_at;
    db.create_revision(
        &plan.id,
        outcome_ids,
        reconciled_plan.task_order.clone(),
        RevisionTrigger::Chat,
    )?;

    Ok((reconciled_plan, synced_outcomes))
}

fn scheduled_updates_cover_order(updates: &[agenda::ScheduledTask], order: &[String]) -> bool {
    if order.is_empty() {
        return false;
    }
    let update_ids: std::collections::HashSet<&str> =
        updates.iter().map(|task| task.task_id.as_str()).collect();
    order.iter().all(|id| update_ids.contains(id.as_str()))
}

fn action_requires_visible_agenda_change(action: &str) -> bool {
    !matches!(
        action,
        "outcomes" | "update_outcomes" | "update_top_outcomes"
    )
}

fn scheduled_update_order_for_action(
    action: &str,
    current_order: &[String],
    updates: &[agenda::ScheduledTask],
) -> Option<Vec<String>> {
    if updates.is_empty() {
        return None;
    }

    let order: Vec<String> = updates.iter().map(|task| task.task_id.clone()).collect();
    match action {
        "replace" | "regenerate" => Some(order),
        "reorder" if scheduled_updates_cover_order(updates, current_order) => Some(order),
        _ => None,
    }
}

fn merge_partial_reorder(current_order: &[String], parsed_ids: &[String]) -> Vec<String> {
    if parsed_ids.is_empty() {
        return current_order.to_vec();
    }

    let mut seen = std::collections::HashSet::new();
    let ordered_ids: Vec<String> = parsed_ids
        .iter()
        .filter(|id| seen.insert((*id).clone()))
        .cloned()
        .collect();
    if ordered_ids.len() >= current_order.len() {
        return ordered_ids;
    }

    let ordered_set: std::collections::HashSet<&str> =
        ordered_ids.iter().map(|id| id.as_str()).collect();
    let insert_at = current_order
        .iter()
        .position(|id| ordered_set.contains(id.as_str()))
        .unwrap_or(current_order.len());
    let mut merged: Vec<String> = current_order
        .iter()
        .filter(|id| !ordered_set.contains(id.as_str()))
        .cloned()
        .collect();
    let insert_at = insert_at.min(merged.len());
    merged.splice(insert_at..insert_at, ordered_ids);
    merged
}

fn merge_schedule_update_order(current_order: &[String], parsed_ids: &[String]) -> Vec<String> {
    let parsed_set: std::collections::HashSet<&str> =
        parsed_ids.iter().map(|id| id.as_str()).collect();
    let current_set: std::collections::HashSet<&str> =
        current_order.iter().map(|id| id.as_str()).collect();
    if !parsed_ids.is_empty()
        && parsed_ids.len() == current_order.len()
        && parsed_set == current_set
    {
        return parsed_ids.to_vec();
    }

    let mut order = current_order.to_vec();
    for id in parsed_ids {
        if !order.contains(id) {
            order.push(id.clone());
        }
    }
    order
}

fn scheduled_task_order_changed(
    scheduled: Option<&[agenda::ScheduledTask]>,
    current: &[agenda::ScheduledTask],
) -> bool {
    let Some(scheduled) = scheduled else {
        return false;
    };
    scheduled
        .iter()
        .map(|task| task.task_id.as_str())
        .ne(current.iter().map(|task| task.task_id.as_str()))
}

fn remove_task_ids_once(current_order: &[String], parsed_ids: &[String]) -> Vec<String> {
    if parsed_ids.is_empty() {
        return current_order.to_vec();
    }

    let mut remaining_removals = parsed_ids.to_vec();
    current_order
        .iter()
        .filter_map(|id| {
            if let Some(index) = remaining_removals
                .iter()
                .position(|remove_id| remove_id == id)
            {
                remaining_removals.remove(index);
                None
            } else {
                Some(id.clone())
            }
        })
        .collect()
}

fn normalized_target_key(text: &str) -> String {
    let trimmed = text
        .trim()
        .trim_start_matches("scheduled_")
        .trim_start_matches("task_");
    normalized_word_tokens(trimmed).join("_")
}

fn compact_target_key(text: &str) -> String {
    text.trim()
        .trim_start_matches("scheduled_")
        .trim_start_matches("task_")
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn removal_target_matches(
    task: &agenda::ScheduledTask,
    target_id: &str,
    target_title: Option<&str>,
) -> bool {
    let task_id_key = normalized_target_key(&task.task_id);
    let task_title_key = normalized_target_key(&task.title);
    let task_id_compact = compact_target_key(&task.task_id);
    let task_title_compact = compact_target_key(&task.title);

    if !target_id.trim().is_empty() {
        let target_key = normalized_target_key(target_id);
        let target_compact = compact_target_key(target_id);
        if task.task_id == target_id
            || task.id == target_id
            || task_id_key == target_key
            || task_title_key == target_key
            || task_id_compact == target_compact
            || task_title_compact == target_compact
        {
            return true;
        }
    }

    if let Some(title) = target_title.filter(|title| !title.trim().is_empty()) {
        let target_key = normalized_target_key(title);
        let target_compact = compact_target_key(title);
        return task_id_key == target_key
            || task_title_key == target_key
            || task_id_compact == target_compact
            || task_title_compact == target_compact;
    }

    false
}

fn message_targets_second_occurrence(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("second")
        || lower.contains("2nd")
        || lower.contains("again")
        || lower.contains("later")
}

fn remove_scheduled_tasks_once(
    current: &[agenda::ScheduledTask],
    targets: &[(String, Option<String>)],
    message: &str,
) -> Option<Vec<agenda::ScheduledTask>> {
    if current.is_empty() || targets.is_empty() {
        return None;
    }

    let wants_second = message_targets_second_occurrence(message);
    let mut scheduled = current.to_vec();
    let mut removed_any = false;

    for (target_id, target_title) in targets {
        let matching_indexes: Vec<usize> = scheduled
            .iter()
            .enumerate()
            .filter_map(|(index, task)| {
                removal_target_matches(task, target_id, target_title.as_deref()).then_some(index)
            })
            .collect();
        if matching_indexes.is_empty() {
            continue;
        }

        let remove_index = if wants_second && matching_indexes.len() > 1 {
            matching_indexes[1]
        } else {
            matching_indexes[0]
        };
        scheduled.remove(remove_index);
        removed_any = true;
    }

    removed_any.then_some(scheduled)
}

fn filter_existing_schedule_to_order(
    current: &[agenda::ScheduledTask],
    final_order: &[String],
) -> Option<Vec<agenda::ScheduledTask>> {
    if current.is_empty() {
        return None;
    }

    let mut remaining = current.to_vec();
    let mut filtered = Vec::new();
    for id in final_order {
        let index = remaining.iter().position(|task| task.task_id == *id)?;
        filtered.push(remaining.remove(index));
    }

    Some(filtered)
}

fn action_has_required_visible_effect(
    action: &str,
    order_changed: bool,
    schedule_changed: bool,
    schedule_order_changed: bool,
    visible_title_changed: bool,
) -> bool {
    match action {
        "reorder" => order_changed || schedule_order_changed,
        "add" | "remove" => order_changed || schedule_changed,
        "replace" | "regenerate" | "reschedule" | "update" | "update_schedule" => {
            order_changed || schedule_changed || visible_title_changed
        }
        "outcomes" | "update_outcomes" | "update_top_outcomes" => visible_title_changed,
        _ => order_changed || schedule_changed || visible_title_changed,
    }
}

fn structured_agenda_update_message(action: &str) -> Option<&'static str> {
    match action {
        "add" => Some("I added that to your Agenda."),
        "remove" => Some("I removed that from your Agenda."),
        "reorder" => Some("I reordered your Agenda."),
        "replace" | "regenerate" => Some("I rebuilt your Agenda."),
        "reschedule" | "update" | "update_schedule" => Some("I updated your Agenda schedule."),
        _ if action_requires_visible_agenda_change(action) => Some("I updated your Agenda."),
        _ => None,
    }
}

fn normalized_word_tokens(text: &str) -> Vec<String> {
    text.split(|ch: char| !ch.is_ascii_alphanumeric())
        .map(str::to_ascii_lowercase)
        .filter(|token| {
            token.len() > 2
                && !matches!(
                    token.as_str(),
                    "the"
                        | "and"
                        | "for"
                        | "with"
                        | "that"
                        | "this"
                        | "then"
                        | "they"
                        | "them"
                        | "have"
                        | "been"
                        | "yet"
                        | "why"
                        | "does"
                        | "did"
                        | "current"
                        | "schedule"
                        | "agenda"
                        | "start"
                        | "starts"
                        | "started"
                        | "wouldn"
                        | "wouldnt"
                        | "couldn"
                        | "couldnt"
                        | "can"
                        | "cant"
                        | "cannot"
                        | "not"
                )
        })
        .collect()
}

fn quoted_phrases(text: &str) -> Vec<String> {
    let mut phrases = Vec::new();
    let mut start: Option<usize> = None;
    let mut quote_char = '\0';

    for (index, ch) in text.char_indices() {
        let is_quote = matches!(ch, '"' | '\'' | '“' | '”' | '‘' | '’');
        if !is_quote {
            continue;
        }

        if let Some(start_index) = start {
            let phrase = text[start_index..index].trim();
            if !phrase.is_empty() {
                phrases.push(phrase.to_string());
            }
            start = None;
        } else {
            start = Some(index + ch.len_utf8());
            quote_char = ch;
        }

        if matches!((quote_char, ch), ('“', '”') | ('‘', '’')) {
            quote_char = '\0';
        }
    }

    phrases
}

fn title_matches_phrase(title: &str, phrase: &str) -> bool {
    let title = title.to_ascii_lowercase();
    let phrase = phrase.to_ascii_lowercase();
    title.contains(&phrase) || phrase.contains(&title)
}

fn find_dependency_subject_index(
    scheduled: &[agenda::ScheduledTask],
    message: &str,
) -> Option<usize> {
    for phrase in quoted_phrases(message) {
        if let Some(index) = scheduled
            .iter()
            .position(|task| title_matches_phrase(&task.title, &phrase))
        {
            return Some(index);
        }
    }

    let lower = message.to_ascii_lowercase();
    if let Some((index, _)) = scheduled
        .iter()
        .enumerate()
        .filter_map(|(index, task)| {
            lower
                .find(&task.title.to_ascii_lowercase())
                .map(|pos| (index, pos))
        })
        .min_by_key(|(_, pos)| *pos)
    {
        return Some(index);
    }

    let message_tokens: std::collections::HashSet<String> =
        normalized_word_tokens(message).into_iter().collect();
    scheduled
        .iter()
        .enumerate()
        .filter_map(|(index, task)| {
            let matched = normalized_word_tokens(&task.title)
                .into_iter()
                .filter(|token| message_tokens.contains(token))
                .count();
            if matched >= 2 {
                Some((index, matched))
            } else {
                None
            }
        })
        .max_by_key(|(_, matched)| *matched)
        .map(|(index, _)| index)
}

fn find_dependency_prerequisite_index(
    scheduled: &[agenda::ScheduledTask],
    dependent_index: usize,
    message: &str,
) -> Option<usize> {
    let message_tokens: std::collections::HashSet<String> =
        normalized_word_tokens(message).into_iter().collect();
    let dependent_tokens: std::collections::HashSet<String> =
        normalized_word_tokens(&scheduled[dependent_index].title)
            .into_iter()
            .collect();
    let dependent_sequence_rank = routine_sequence_rank(&scheduled[dependent_index].title, message);

    scheduled
        .iter()
        .enumerate()
        .filter(|(index, _)| *index != dependent_index)
        .filter_map(|(index, task)| {
            if let (Some(candidate_rank), Some(dependent_rank)) = (
                routine_sequence_rank(&task.title, message),
                dependent_sequence_rank,
            ) {
                if candidate_rank >= dependent_rank {
                    return None;
                }
            }

            let task_tokens: std::collections::HashSet<String> =
                normalized_word_tokens(&task.title).into_iter().collect();
            let shared_subject = task_tokens.intersection(&dependent_tokens).count();
            let mentioned_tokens = task_tokens.intersection(&message_tokens).count();
            let prerequisite_tokens = task_tokens
                .iter()
                .filter(|token| {
                    !dependent_tokens.contains(*token) && message_tokens.contains(*token)
                })
                .count();

            let score = (if index > dependent_index { 8 } else { 0 })
                + (shared_subject * 3)
                + (mentioned_tokens * 2)
                + (prerequisite_tokens * 5);

            if score >= 10 {
                Some((index, score))
            } else {
                None
            }
        })
        .max_by_key(|(_, score)| *score)
        .map(|(index, _)| index)
}

fn dependency_reorder_from_message(
    current_plan: &agenda::DailyPlan,
    message: &str,
) -> Option<agenda::DailyPlan> {
    if current_plan.scheduled_tasks.len() < 2 {
        return None;
    }

    let lower = message.to_ascii_lowercase();
    if morning_routine_titles_after_breakfast(message).is_some() {
        return None;
    }
    let is_dependency_correction = [
        "can't",
        "can’t",
        "cannot",
        "couldn't",
        "couldn’t",
        "wouldn't",
        "wouldn’t",
        "not yet",
        "hasn't",
        "hasn’t",
        "haven't",
        "haven’t",
        "before",
        "until",
    ]
    .iter()
    .any(|phrase| lower.contains(phrase));
    if !is_dependency_correction {
        return None;
    }

    let dependent_index = find_dependency_subject_index(&current_plan.scheduled_tasks, message)?;
    let prerequisite_index = find_dependency_prerequisite_index(
        &current_plan.scheduled_tasks,
        dependent_index,
        message,
    )?;
    if prerequisite_index < dependent_index {
        return None;
    }

    let mut scheduled = current_plan.scheduled_tasks.clone();
    let prerequisite = scheduled.remove(prerequisite_index);
    let insert_index = dependent_index.min(scheduled.len());
    scheduled.insert(insert_index, prerequisite);

    if !scheduled_task_order_changed(Some(&scheduled), &current_plan.scheduled_tasks) {
        return None;
    }

    let time_slots: Vec<String> = current_plan
        .scheduled_tasks
        .iter()
        .map(|task| task.start_time.clone())
        .collect();
    for (index, task) in scheduled.iter_mut().enumerate() {
        if let Some(start_time) = time_slots.get(index) {
            task.start_time = start_time.clone();
        }
    }

    let mut plan = current_plan.clone();
    plan.scheduled_tasks = scheduled;
    plan.task_order = plan
        .scheduled_tasks
        .iter()
        .map(|task| task.task_id.clone())
        .collect();
    for task in &plan.scheduled_tasks {
        plan.task_titles
            .insert(task.task_id.clone(), task.title.clone());
    }
    Some(plan)
}

fn time_from_meridiem_parts(hour: u32, minute: u32, meridiem: &str) -> Option<NaiveTime> {
    if !(1..=12).contains(&hour) || minute > 59 {
        return None;
    }
    let mut h = hour;
    if meridiem == "am" && h == 12 {
        h = 0;
    } else if meridiem == "pm" && h != 12 {
        h += 12;
    }
    NaiveTime::from_hms_opt(h, minute, 0)
}

fn extract_meridiem_time_with_span(lower: &str) -> Option<(NaiveTime, std::ops::Range<usize>)> {
    for meridiem in ["am", "pm"] {
        let mut search_start = 0;
        while let Some(offset) = lower[search_start..].find(meridiem) {
            let meridiem_start = search_start + offset;
            let meridiem_end = meridiem_start + meridiem.len();
            let before = lower[..meridiem_start].trim_end();
            let numeric_end = before.len();
            let mut numeric_start = numeric_end;

            while numeric_start > 0 {
                let Some((prev_index, ch)) = before[..numeric_start].char_indices().last() else {
                    break;
                };
                if ch.is_ascii_digit() || ch == ':' {
                    numeric_start = prev_index;
                } else {
                    break;
                }
            }

            if numeric_start < numeric_end {
                let raw_time = &before[numeric_start..numeric_end];
                let (hour_raw, minute_raw) = raw_time.split_once(':').unwrap_or((raw_time, "0"));
                if let (Ok(hour), Ok(minute)) = (hour_raw.parse::<u32>(), minute_raw.parse::<u32>())
                {
                    if let Some(time) = time_from_meridiem_parts(hour, minute, meridiem) {
                        return Some((time, numeric_start..meridiem_end));
                    }
                }
            }

            search_start = meridiem_end;
        }
    }
    None
}

fn extract_meridiem_time(lower: &str) -> Option<NaiveTime> {
    extract_meridiem_time_with_span(lower).map(|(time, _)| time)
}

fn trim_schedule_instruction_phrase(phrase: &str) -> String {
    phrase
        .trim()
        .trim_start_matches("to ")
        .trim_start_matches("be ")
        .trim_start_matches("be to ")
        .trim_matches(|ch: char| ch == '.' || ch == '!' || ch == '?' || ch == ',' || ch == ';')
        .trim()
        .to_string()
}

fn trim_instruction_sentence(phrase: &str) -> &str {
    phrase
        .split(['.', '!', '?', '\n'])
        .next()
        .unwrap_or(phrase)
        .trim()
}

fn extract_first_task_instruction(message: &str) -> Option<(NaiveTime, String)> {
    let lower = message.to_ascii_lowercase();
    if !(lower.contains("first task") || lower.contains("start with")) {
        return None;
    }

    let target_time = extract_meridiem_time(&lower)?;
    let anchor = lower
        .rfind("first task")
        .or_else(|| lower.rfind("start with"))?;
    let tail = &lower[anchor..];
    let phrase_start = tail
        .find("should be")
        .map(|index| anchor + index + "should be".len())
        .or_else(|| {
            tail.find("needs to be")
                .map(|index| anchor + index + "needs to be".len())
        })
        .or_else(|| {
            tail.find("has to be")
                .map(|index| anchor + index + "has to be".len())
        })
        .or_else(|| {
            tail.find("is to")
                .map(|index| anchor + index + "is to".len())
        })
        .or_else(|| tail.find(" is ").map(|index| anchor + index + " is ".len()))
        .or_else(|| {
            tail.find("start with")
                .map(|index| anchor + index + "start with".len())
        })?;
    let phrase =
        trim_schedule_instruction_phrase(trim_instruction_sentence(&message[phrase_start..]));
    if phrase.is_empty() {
        None
    } else {
        Some((target_time, phrase))
    }
}

fn token_stage(token: &str) -> Option<&'static str> {
    match token {
        "wash" | "washer" | "washed" | "washing" => Some("wash"),
        "dry" | "dryer" | "move" => Some("dry"),
        "fold" | "folding" => Some("fold"),
        _ => None,
    }
}

fn ordinal_step_clauses(message: &str) -> Vec<(usize, std::collections::HashSet<String>)> {
    let lower = message.to_ascii_lowercase();
    let mut markers = Vec::new();
    for (label, rank) in [
        ("first task", 0_usize),
        ("first step", 0),
        ("first", 0),
        ("second task", 1),
        ("second step", 1),
        ("second", 1),
        ("third task", 2),
        ("third step", 2),
        ("third", 2),
    ] {
        let mut search_start = 0;
        while let Some(offset) = lower[search_start..].find(label) {
            let start = search_start + offset;
            markers.push((start, start + label.len(), rank));
            search_start = start + label.len();
        }
    }
    markers.sort_by_key(|(start, _, _)| *start);
    markers.dedup_by_key(|(start, _, _)| *start);

    markers
        .iter()
        .enumerate()
        .filter_map(|(index, (_, content_start, rank))| {
            let content_end = markers
                .get(index + 1)
                .map(|(next_start, _, _)| *next_start)
                .unwrap_or(lower.len());
            let clause = trim_instruction_sentence(&lower[*content_start..content_end]);
            let tokens: std::collections::HashSet<String> =
                normalized_word_tokens(clause).into_iter().collect();
            if tokens.is_empty() {
                None
            } else {
                Some((*rank, tokens))
            }
        })
        .collect()
}

fn routine_sequence_rank(title: &str, message: &str) -> Option<usize> {
    let title_tokens: std::collections::HashSet<String> =
        normalized_word_tokens(title).into_iter().collect();
    if title_tokens.is_empty() {
        return None;
    }

    ordinal_step_clauses(message)
        .into_iter()
        .filter_map(|(rank, clause_tokens)| {
            let shared_words = title_tokens.intersection(&clause_tokens).count();
            let stage_match = title_tokens.iter().any(|title_token| {
                token_stage(title_token).is_some_and(|title_stage| {
                    clause_tokens
                        .iter()
                        .any(|clause_token| token_stage(clause_token) == Some(title_stage))
                })
            });
            let score = (shared_words * 2) + usize::from(stage_match) * 6;
            if score >= 4 {
                Some((rank, score))
            } else {
                None
            }
        })
        .max_by_key(|(_, score)| *score)
        .map(|(rank, _)| rank)
}

fn matching_task_score(
    task: &agenda::ScheduledTask,
    phrase_tokens: &std::collections::HashSet<String>,
    context_tokens: &std::collections::HashSet<String>,
) -> usize {
    let task_tokens: std::collections::HashSet<String> =
        normalized_word_tokens(&task.title).into_iter().collect();
    let phrase_match = task_tokens.intersection(phrase_tokens).count();
    let context_match = task_tokens.intersection(context_tokens).count();
    (phrase_match * 4) + (context_match * 3)
}

fn instruction_required_stage(phrase: &str) -> Option<&'static str> {
    normalized_word_tokens(phrase)
        .iter()
        .find_map(|token| token_stage(token))
}

fn find_schedule_task_matching_instruction(
    scheduled: &[agenda::ScheduledTask],
    phrase: &str,
    context_index: usize,
) -> Option<usize> {
    let phrase_tokens: std::collections::HashSet<String> =
        normalized_word_tokens(phrase).into_iter().collect();
    if phrase_tokens.is_empty() {
        return None;
    }
    let context_tokens: std::collections::HashSet<String> = scheduled
        .get(context_index)
        .map(|task| normalized_word_tokens(&task.title).into_iter().collect())
        .unwrap_or_default();

    scheduled
        .iter()
        .enumerate()
        .filter_map(|(index, task)| {
            if let Some(required_stage) = instruction_required_stage(phrase) {
                let has_stage = normalized_word_tokens(&task.title)
                    .iter()
                    .any(|token| token_stage(token) == Some(required_stage));
                if !has_stage {
                    return None;
                }
            }
            let score = matching_task_score(task, &phrase_tokens, &context_tokens);
            if score >= 8 {
                Some((index, score))
            } else {
                None
            }
        })
        .max_by_key(|(index, score)| (*score, std::cmp::Reverse(*index)))
        .map(|(index, _)| index)
}

fn routine_subject_tokens(title: &str) -> std::collections::HashSet<String> {
    normalized_word_tokens(title)
        .into_iter()
        .filter(|token| {
            token_stage(token).is_none()
                && !matches!(
                    token.as_str(),
                    "put" | "away" | "into" | "from" | "load" | "loads" | "clothes" | "laundry"
                )
        })
        .collect()
}

fn routine_rows_share_subject(left: &agenda::ScheduledTask, right: &agenda::ScheduledTask) -> bool {
    let left_subject = routine_subject_tokens(&left.title);
    let right_subject = routine_subject_tokens(&right.title);
    if left_subject.is_empty() || right_subject.is_empty() {
        return false;
    }
    left_subject.intersection(&right_subject).next().is_some()
}

fn reorder_related_rows_by_user_sequence(
    mut scheduled: Vec<agenda::ScheduledTask>,
    context_index: usize,
    message: &str,
) -> Vec<agenda::ScheduledTask> {
    if ordinal_step_clauses(message).is_empty() || context_index >= scheduled.len() {
        return scheduled;
    }

    let context_task = scheduled[context_index].clone();
    let mut related: Vec<(usize, agenda::ScheduledTask, usize)> = scheduled
        .iter()
        .cloned()
        .enumerate()
        .filter_map(|(index, task)| {
            if !routine_rows_share_subject(&task, &context_task) && index != context_index {
                return None;
            }
            routine_sequence_rank(&task.title, message).map(|rank| (index, task, rank))
        })
        .collect();
    if related.len() < 2 {
        return scheduled;
    }

    related.sort_by_key(|(index, _, rank)| (*rank, *index));
    let related_indexes: std::collections::HashSet<usize> =
        related.iter().map(|(index, _, _)| *index).collect();
    let insert_at = related_indexes
        .iter()
        .min()
        .copied()
        .unwrap_or(context_index);
    let ordered_related: Vec<agenda::ScheduledTask> =
        related.into_iter().map(|(_, task, _)| task).collect();
    scheduled = scheduled
        .into_iter()
        .enumerate()
        .filter_map(|(index, task)| {
            if related_indexes.contains(&index) {
                None
            } else {
                Some(task)
            }
        })
        .collect();
    scheduled.splice(insert_at..insert_at, ordered_related);
    scheduled
}

fn instruction_task_title(phrase: &str, context_title: &str) -> String {
    let mut title = trim_schedule_instruction_phrase(phrase);
    let subject_tokens = routine_subject_tokens(context_title);
    if let Some(subject) = subject_tokens.iter().next() {
        let lower = title.to_ascii_lowercase();
        let title_subjects = routine_subject_tokens(&title);
        if lower.contains("clothes") && title_subjects.is_empty() && !lower.contains(subject) {
            title = title.replacen("clothes", &format!("{subject} clothes"), 1);
        }
    }
    capitalize_task_title(&title)
}

fn instruction_task_id(title: &str, existing: &[agenda::ScheduledTask]) -> String {
    let slug = normalized_word_tokens(title).join("_");
    let base = sanitize_task_id(&format!("task_{slug}"));
    let mut id = base.clone();
    let existing_ids: std::collections::HashSet<&str> =
        existing.iter().map(|task| task.task_id.as_str()).collect();
    let mut suffix = 2;
    while existing_ids.contains(id.as_str()) {
        id = sanitize_task_id(&format!("{base}_{suffix}"));
        suffix += 1;
    }
    id
}

fn capitalize_task_title(title: &str) -> String {
    let mut chars = title.trim().chars();
    match chars.next() {
        Some(first) => format!("{}{}", first.to_uppercase(), chars.collect::<String>()),
        None => "Agenda task".to_string(),
    }
}

fn number_before(text: &str, end_index: usize) -> Option<i64> {
    let prefix = text.get(..end_index)?;
    let mut digits = String::new();
    let mut seen_digit = false;
    for ch in prefix.chars().rev() {
        if ch.is_ascii_digit() {
            digits.insert(0, ch);
            seen_digit = true;
        } else if seen_digit {
            break;
        }
    }
    digits.parse().ok()
}

fn task_duration_minutes_from_clause(clause: &str) -> Option<i32> {
    let lower = clause.to_ascii_lowercase();
    for marker in ["minute task", "minutes task", "min task"] {
        if let Some(index) = lower.rfind(marker) {
            return number_before(&lower, index).map(|minutes| minutes as i32);
        }
    }
    None
}

fn relative_offset_minutes_from_clause(clause: &str) -> Option<i64> {
    let lower = clause.to_ascii_lowercase();
    for marker in [
        "minutes later",
        "minute later",
        "minutes after",
        "minute after",
    ] {
        if let Some(index) = lower.find(marker) {
            return number_before(&lower, index);
        }
    }
    None
}

fn explicit_schedule_clauses(message: &str) -> Vec<&str> {
    message
        .split(['.', '\n'])
        .map(str::trim)
        .filter(|clause| !clause.is_empty())
        .collect()
}

fn truncate_title_suffix(title: &str) -> &str {
    let lower = title.to_ascii_lowercase();
    let mut end = title.len();
    for marker in [" as a ", " as an ", " as "] {
        if let Some(index) = lower.find(marker) {
            end = end.min(index);
        }
    }
    title[..end].trim()
}

fn title_from_schedule_clause(clause: &str) -> Option<String> {
    let lower = clause.to_ascii_lowercase();
    let start = lower
        .rfind("task to")
        .map(|index| index + "task to".len())
        .or_else(|| {
            lower
                .rfind("should be to")
                .map(|index| index + "should be to".len())
        })
        .or_else(|| lower.rfind("is to").map(|index| index + "is to".len()))
        .or_else(|| {
            lower
                .rfind("start with")
                .map(|index| index + "start with".len())
        })?;
    let title = trim_schedule_instruction_phrase(truncate_title_suffix(&clause[start..]));
    if title.is_empty() {
        None
    } else {
        Some(capitalize_task_title(&title))
    }
}

fn existing_task_for_title(
    title: &str,
    existing: &[agenda::ScheduledTask],
) -> Option<agenda::ScheduledTask> {
    existing
        .iter()
        .find(|task| task.title.eq_ignore_ascii_case(title))
        .cloned()
        .or_else(|| {
            existing
                .iter()
                .find(|task| title_matches_phrase(&task.title, title))
                .cloned()
        })
}

fn scheduled_task_for_instruction(
    title: String,
    start_time: NaiveTime,
    duration_minutes: i32,
    existing: &[agenda::ScheduledTask],
) -> agenda::ScheduledTask {
    if let Some(mut task) = existing_task_for_title(&title, existing) {
        task.title = title;
        task.start_time = format_schedule_time(start_time);
        task.duration_minutes = duration_minutes;
        if let Some(quadrant) = title_inferred_eisenhower_quadrant(&task.title) {
            task.eisenhower_quadrant = Some(quadrant);
        }
        return task;
    }

    let task_id = instruction_task_id(&title, existing);
    let eisenhower_quadrant =
        title_inferred_eisenhower_quadrant(&title).unwrap_or_else(|| "do".to_string());
    agenda::ScheduledTask {
        id: format!("scheduled_{task_id}"),
        task_id,
        title,
        start_time: format_schedule_time(start_time),
        duration_minutes,
        estimate_source: Some("ai".to_string()),
        eisenhower_quadrant: Some(eisenhower_quadrant),
    }
}

fn explicit_schedule_rows_from_message(
    current_plan: &agenda::DailyPlan,
    message: &str,
) -> Option<Vec<agenda::ScheduledTask>> {
    let start_time = extract_meridiem_time(&message.to_ascii_lowercase())?;
    let clauses = explicit_schedule_clauses(message);
    let first_instruction_index = clauses.iter().position(|clause| {
        let lower = clause.to_ascii_lowercase();
        lower.contains("first task") || lower.contains("start with")
    })?;

    let mut rows = Vec::new();
    let mut previous_start = start_time;
    let mut previous_end = start_time;

    for clause in clauses.into_iter().skip(first_instruction_index) {
        let Some(title) = title_from_schedule_clause(clause) else {
            continue;
        };
        let duration_minutes = task_duration_minutes_from_clause(clause)
            .unwrap_or(5)
            .max(5);
        let row_start = if rows.is_empty() {
            start_time
        } else if let Some(offset_minutes) = relative_offset_minutes_from_clause(clause) {
            previous_start + Duration::minutes(offset_minutes)
        } else {
            previous_end
        };
        let row = scheduled_task_for_instruction(
            title,
            row_start,
            duration_minutes,
            &current_plan.scheduled_tasks,
        );
        previous_start = row_start;
        previous_end = row_start + Duration::minutes(duration_minutes.into());
        rows.push(row);
    }

    if rows.len() >= 2 {
        Some(rows)
    } else {
        None
    }
}

fn explicit_rows_related_to_generated(
    task: &agenda::ScheduledTask,
    generated_subjects: &std::collections::HashSet<String>,
) -> bool {
    let task_subjects = routine_subject_tokens(&task.title);
    task_subjects
        .iter()
        .any(|subject| generated_subjects.contains(subject))
}

fn explicit_schedule_instruction_update(
    current_plan: &agenda::DailyPlan,
    message: &str,
) -> Option<agenda::DailyPlan> {
    let generated_rows = explicit_schedule_rows_from_message(current_plan, message)?;
    let generated_subjects: std::collections::HashSet<String> = generated_rows
        .iter()
        .flat_map(|task| routine_subject_tokens(&task.title))
        .collect();
    if generated_subjects.is_empty() {
        return None;
    }

    let generated_start = generated_rows
        .first()
        .and_then(|generated| parse_schedule_time(&generated.start_time));
    let insert_at = current_plan
        .scheduled_tasks
        .iter()
        .position(|task| parse_schedule_time(&task.start_time) == generated_start)
        .unwrap_or(0);
    let mut scheduled: Vec<agenda::ScheduledTask> = current_plan
        .scheduled_tasks
        .iter()
        .filter(|task| !explicit_rows_related_to_generated(task, &generated_subjects))
        .cloned()
        .collect();
    let insert_at = insert_at.min(scheduled.len());
    scheduled.splice(insert_at..insert_at, generated_rows);

    let mut previous_end = None;
    for task in &mut scheduled {
        if let Some(end) = previous_end {
            let starts_before_previous_end =
                parse_schedule_time(&task.start_time).map_or(true, |start| start < end);
            if starts_before_previous_end {
                task.start_time = format_schedule_time(end);
            }
        }
        previous_end = scheduled_task_end(task);
    }

    if !scheduled_task_order_changed(Some(&scheduled), &current_plan.scheduled_tasks) {
        return None;
    }

    let mut plan = current_plan.clone();
    plan.scheduled_tasks = scheduled;
    plan.task_order = plan
        .scheduled_tasks
        .iter()
        .map(|task| task.task_id.clone())
        .collect();
    for task in &plan.scheduled_tasks {
        plan.task_titles
            .insert(task.task_id.clone(), task.title.clone());
    }
    Some(plan)
}

fn first_task_instruction_update(
    current_plan: &agenda::DailyPlan,
    message: &str,
) -> Option<agenda::DailyPlan> {
    let (target_time, phrase) = extract_first_task_instruction(message)?;
    if current_plan.scheduled_tasks.is_empty() {
        return None;
    }

    let slot_index = current_plan
        .scheduled_tasks
        .iter()
        .position(|task| parse_schedule_time(&task.start_time) == Some(target_time))
        .unwrap_or(0);
    let task_index =
        find_schedule_task_matching_instruction(&current_plan.scheduled_tasks, &phrase, slot_index);
    let mut scheduled = current_plan.scheduled_tasks.clone();
    let moved = if let Some(task_index) = task_index {
        if task_index == slot_index {
            return None;
        }
        scheduled.remove(task_index)
    } else {
        let context_task = current_plan.scheduled_tasks.get(slot_index)?;
        let title = instruction_task_title(&phrase, &context_task.title);
        let task_id = instruction_task_id(&title, &current_plan.scheduled_tasks);
        agenda::ScheduledTask {
            id: format!("scheduled_{task_id}"),
            task_id,
            title,
            start_time: context_task.start_time.clone(),
            duration_minutes: 5,
            estimate_source: Some("ai".to_string()),
            eisenhower_quadrant: context_task.eisenhower_quadrant.clone(),
        }
    };
    let insert_at = slot_index.min(scheduled.len());
    scheduled.insert(insert_at, moved);
    scheduled = reorder_related_rows_by_user_sequence(scheduled, insert_at, message);

    let time_slots: Vec<String> = current_plan
        .scheduled_tasks
        .iter()
        .map(|task| task.start_time.clone())
        .collect();
    let mut previous_end = None;
    for (index, task) in scheduled.iter_mut().enumerate() {
        if let Some(start_time) = time_slots.get(index) {
            task.start_time = start_time.clone();
        } else if let Some(end) = previous_end {
            task.start_time = format_schedule_time(end);
        }
        previous_end = scheduled_task_end(task);
    }

    let mut plan = current_plan.clone();
    plan.scheduled_tasks = scheduled;
    plan.task_order = plan
        .scheduled_tasks
        .iter()
        .map(|task| task.task_id.clone())
        .collect();
    for task in &plan.scheduled_tasks {
        plan.task_titles
            .insert(task.task_id.clone(), task.title.clone());
    }
    Some(plan)
}

fn message_requests_between_task_insertion(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    (lower.contains("between") || lower.contains("gap"))
        && (lower.contains("task")
            || lower.contains("agenda")
            || lower.contains("schedule")
            || lower.contains("washer")
            || lower.contains("dryer"))
        && (lower.contains("add")
            || lower.contains("put")
            || lower.contains("let's")
            || lower.contains("let’s")
            || lower.contains("maybe"))
}

fn insertion_phrase_from_message(message: &str) -> Option<String> {
    let lower = message.to_ascii_lowercase();
    for marker in ["maybe ", "perhaps ", "add ", "put "] {
        if let Some(index) = lower.rfind(marker) {
            let start = index + marker.len();
            let phrase = message.get(start..)?;
            let phrase = phrase
                .split(['?', '.', '!', ',', '\n'])
                .next()
                .unwrap_or(phrase)
                .trim();
            if !phrase.is_empty()
                && !phrase.eq_ignore_ascii_case("another task")
                && !phrase.eq_ignore_ascii_case("a task")
            {
                return Some(capitalize_task_title(phrase));
            }
        }
    }
    None
}

fn insertion_task_from_message(
    message: &str,
    candidates: &[VaultTaskContext],
    current: &[agenda::ScheduledTask],
) -> Option<(String, String, Option<String>)> {
    let phrase = insertion_phrase_from_message(message)?;
    let phrase_tokens: std::collections::HashSet<String> =
        normalized_word_tokens(&phrase).into_iter().collect();
    if phrase_tokens.is_empty() {
        return None;
    }

    let mut best: Option<(usize, String, String, Option<String>)> = None;
    for (task_id, title, .., quadrant) in candidates {
        let title_tokens: std::collections::HashSet<String> =
            normalized_word_tokens(title).into_iter().collect();
        let overlap = phrase_tokens
            .iter()
            .filter(|token| title_tokens.contains(*token))
            .count();
        if overlap == 0 {
            continue;
        }
        let score = overlap
            + usize::from(
                phrase.to_ascii_lowercase().contains("breakfast")
                    && title.to_ascii_lowercase().contains("breakfast"),
            );
        if best
            .as_ref()
            .map_or(true, |(best_score, ..)| score > *best_score)
        {
            best = Some((
                score,
                task_id.clone(),
                title.clone(),
                Some(quadrant.clone()),
            ));
        }
    }

    best.map(|(_, task_id, title, quadrant)| (task_id, title, quadrant))
        .or_else(|| {
            let title = if phrase_tokens.contains("breakfast") {
                "Eat breakfast".to_string()
            } else {
                phrase
            };
            let task_id = instruction_task_id(&title, current);
            Some((task_id, title, None))
        })
}

fn message_laundry_subject(message: &str) -> Option<&'static str> {
    let lower = message.to_ascii_lowercase();
    ["dark", "light", "white"]
        .into_iter()
        .find(|subject| lower.contains(subject))
}

fn schedule_title_matches_subject(title: &str, subject: Option<&str>) -> bool {
    let lower = title.to_ascii_lowercase();
    subject.map_or(true, |subject| lower.contains(subject))
}

fn between_laundry_anchor_indexes(
    current: &[agenda::ScheduledTask],
    message: &str,
) -> Option<(usize, usize)> {
    let subject = message_laundry_subject(message);
    for start_index in 0..current.len() {
        let start_title = current[start_index].title.to_ascii_lowercase();
        if !schedule_title_matches_subject(&start_title, subject) || !start_title.contains("washer")
        {
            continue;
        }
        for (end_index, row) in current.iter().enumerate().skip(start_index + 1) {
            let end_title = row.title.to_ascii_lowercase();
            if schedule_title_matches_subject(&end_title, subject) && end_title.contains("dryer") {
                return Some((start_index, end_index));
            }
        }
    }
    None
}

fn insert_between_agenda_tasks_update(
    current_plan: &agenda::DailyPlan,
    message: &str,
    candidates: &[VaultTaskContext],
) -> Option<(agenda::DailyPlan, String)> {
    if !message_requests_between_task_insertion(message) || current_plan.scheduled_tasks.is_empty()
    {
        return None;
    }

    let mut scheduled = current_plan.scheduled_tasks.clone();
    normalize_scheduled_tasks(&mut scheduled);

    let (start_index, end_index) = between_laundry_anchor_indexes(&scheduled, message)?;
    let (task_id, title, quadrant) =
        insertion_task_from_message(message, candidates, &current_plan.scheduled_tasks)?;
    if scheduled[start_index + 1..end_index]
        .iter()
        .any(|task| task.task_id == task_id || task.title.eq_ignore_ascii_case(&title))
    {
        return None;
    }

    if let Some(duration) = task_duration_minutes_from_clause(message) {
        scheduled[start_index].duration_minutes = duration.max(5);
    }

    let insert_start = scheduled_task_end(&scheduled[start_index])?;
    let next_start = parse_schedule_time(&scheduled[end_index].start_time)?;
    if insert_start >= next_start {
        return None;
    }
    let duration_minutes = next_start
        .signed_duration_since(insert_start)
        .num_minutes()
        .max(5) as i32;
    let inserted = agenda::ScheduledTask {
        id: format!("scheduled_{task_id}"),
        task_id,
        title: title.clone(),
        start_time: format_schedule_time(insert_start),
        duration_minutes,
        estimate_source: Some("ai".to_string()),
        eisenhower_quadrant: quadrant
            .or_else(|| scheduled[start_index].eisenhower_quadrant.clone()),
    };

    scheduled.insert(end_index, inserted);
    normalize_scheduled_tasks(&mut scheduled);
    if scheduled_tasks_equivalent(&scheduled, &current_plan.scheduled_tasks) {
        return None;
    }

    let mut plan = current_plan.clone();
    plan.scheduled_tasks = scheduled;
    plan.task_order = plan
        .scheduled_tasks
        .iter()
        .map(|task| task.task_id.clone())
        .collect();
    for task in &plan.scheduled_tasks {
        plan.task_titles
            .insert(task.task_id.clone(), task.title.clone());
    }
    Some((plan, title))
}

fn morning_routine_titles_after_breakfast(message: &str) -> Option<Vec<String>> {
    let lower = message.to_ascii_lowercase();
    if !(lower.contains("after eat breakfast")
        || lower.contains("after eating breakfast")
        || lower.contains("after breakfast"))
    {
        return None;
    }

    let mut titles = Vec::new();
    for (needle, title) in [
        ("shower", "Shower"),
        ("get dressed", "Get dressed"),
        ("brush teeth", "Brush teeth"),
        ("do hair", "Do hair"),
    ] {
        if lower.contains(needle) {
            titles.push(title.to_string());
        }
    }

    (titles.len() >= 2).then_some(titles)
}

fn scheduled_title_matches_routine_title(task_title: &str, routine_title: &str) -> bool {
    if task_title.eq_ignore_ascii_case(routine_title)
        || title_matches_phrase(task_title, routine_title)
    {
        return true;
    }

    let task_tokens: std::collections::HashSet<String> =
        normalized_word_tokens(task_title).into_iter().collect();
    let routine_tokens: std::collections::HashSet<String> =
        normalized_word_tokens(routine_title).into_iter().collect();
    !routine_tokens.is_empty() && routine_tokens.is_subset(&task_tokens)
}

fn is_requested_morning_routine_row(
    task: &agenda::ScheduledTask,
    routine_titles: &[String],
) -> bool {
    routine_titles
        .iter()
        .any(|title| scheduled_title_matches_routine_title(&task.title, title))
}

fn breakfast_duration_minutes_from_message(message: &str) -> Option<i32> {
    let lower = message.to_ascii_lowercase();
    if !(lower.contains("breakfast") && lower.contains("take")) {
        return None;
    }

    for marker in ["minutes", "minute", "min"] {
        if let Some(index) = lower.find(marker) {
            return number_before(&lower, index).map(|minutes| minutes as i32);
        }
    }
    None
}

fn apply_breakfast_duration_hint(
    scheduled: &mut [agenda::ScheduledTask],
    duration_minutes: i32,
) -> bool {
    let mut changed = false;
    for task in scheduled {
        if task.title.to_ascii_lowercase().contains("breakfast")
            && task.duration_minutes != duration_minutes
        {
            task.duration_minutes = duration_minutes;
            changed = true;
        }
    }
    changed
}

fn breakfast_duration_update(
    current_plan: &agenda::DailyPlan,
    message: &str,
) -> Option<agenda::DailyPlan> {
    let duration_minutes = breakfast_duration_minutes_from_message(message)?.max(5);
    if current_plan.scheduled_tasks.is_empty() {
        return None;
    }

    let mut scheduled = current_plan.scheduled_tasks.clone();
    normalize_scheduled_tasks(&mut scheduled);
    if !apply_breakfast_duration_hint(&mut scheduled, duration_minutes) {
        return None;
    }
    normalize_scheduled_tasks(&mut scheduled);

    let mut plan = current_plan.clone();
    plan.scheduled_tasks = scheduled;
    plan.task_order = plan
        .scheduled_tasks
        .iter()
        .map(|task| task.task_id.clone())
        .collect();
    for task in &plan.scheduled_tasks {
        plan.task_titles
            .insert(task.task_id.clone(), task.title.clone());
    }
    Some(plan)
}

fn insert_morning_routine_after_breakfast_update(
    current_plan: &agenda::DailyPlan,
    message: &str,
    duration_context: &str,
) -> Option<agenda::DailyPlan> {
    let titles = morning_routine_titles_after_breakfast(message)?;
    if current_plan.scheduled_tasks.is_empty() {
        return None;
    }

    let mut scheduled = current_plan.scheduled_tasks.clone();
    normalize_scheduled_tasks(&mut scheduled);
    if let Some(duration_minutes) = breakfast_duration_minutes_from_message(message)
        .or_else(|| breakfast_duration_minutes_from_message(duration_context))
        .map(|minutes| minutes.max(5))
    {
        apply_breakfast_duration_hint(&mut scheduled, duration_minutes);
    }
    normalize_scheduled_tasks(&mut scheduled);
    let breakfast_index = scheduled
        .iter()
        .position(|task| task.title.to_ascii_lowercase().contains("breakfast"))?;
    let breakfast_end = scheduled_task_end(&scheduled[breakfast_index])?;

    let duration_per_task = 5_i64;
    let required_minutes = duration_per_task * titles.len() as i64;
    let mut next_start = None;
    for task in scheduled.iter().skip(breakfast_index + 1) {
        if is_requested_morning_routine_row(task, &titles) {
            continue;
        }
        let start = parse_schedule_time(&task.start_time)?;
        if start < breakfast_end {
            return None;
        }
        next_start = Some(start);
        break;
    }
    let next_start =
        next_start.unwrap_or_else(|| breakfast_end + Duration::minutes(required_minutes));

    let available_minutes = next_start
        .signed_duration_since(breakfast_end)
        .num_minutes();
    if available_minutes < required_minutes {
        return None;
    }

    let breakfast_task_id = scheduled[breakfast_index].task_id.clone();
    scheduled = scheduled
        .into_iter()
        .enumerate()
        .filter_map(|(index, task)| {
            if index != breakfast_index && is_requested_morning_routine_row(&task, &titles) {
                None
            } else {
                Some(task)
            }
        })
        .collect();
    let breakfast_index = scheduled
        .iter()
        .position(|task| task.task_id == breakfast_task_id)
        .or_else(|| {
            scheduled
                .iter()
                .position(|task| task.title.to_ascii_lowercase().contains("breakfast"))
        })?;

    let mut cursor = breakfast_end;
    let mut rows = Vec::new();
    for title in titles {
        let row = scheduled_task_for_instruction(
            title,
            cursor,
            duration_per_task as i32,
            &current_plan.scheduled_tasks,
        );
        rows.push(row);
        cursor += Duration::minutes(duration_per_task);
    }

    scheduled.splice(breakfast_index + 1..breakfast_index + 1, rows);
    normalize_scheduled_tasks(&mut scheduled);
    if scheduled_tasks_equivalent(&scheduled, &current_plan.scheduled_tasks) {
        return None;
    }

    let mut plan = current_plan.clone();
    plan.scheduled_tasks = scheduled;
    plan.task_order = plan
        .scheduled_tasks
        .iter()
        .map(|task| task.task_id.clone())
        .collect();
    for task in &plan.scheduled_tasks {
        plan.task_titles
            .insert(task.task_id.clone(), task.title.clone());
    }
    Some(plan)
}

fn fixed_time_commitment_title(message: &str) -> Option<(NaiveTime, String)> {
    let lower = message.to_ascii_lowercase();
    if lower.contains("free time")
        || lower.contains("anything scheduled before")
        || lower.contains("nothing scheduled before")
        || lower.contains("day will start")
        || lower.contains("day should start")
    {
        return None;
    }

    let (start_time, time_span) = extract_meridiem_time_with_span(&lower)?;
    let markers = [
        "i need to ",
        "i have to ",
        "i've got to ",
        "i’ve got to ",
        "ive got to ",
        "we need to ",
        "we have to ",
        "need to ",
        "have to ",
        "must ",
    ];
    let (marker_start, marker_len) = markers
        .iter()
        .filter_map(|marker| {
            lower[..time_span.start]
                .rfind(marker)
                .map(|index| (index, marker.len()))
        })
        .max_by_key(|(index, _)| *index)?;
    let title_start = marker_start + marker_len;
    let title_end = [" at ", " by ", " around ", " before "]
        .iter()
        .filter_map(|marker| lower[title_start..time_span.start].rfind(marker))
        .map(|index| title_start + index)
        .max()
        .unwrap_or(time_span.start);
    let title = trim_schedule_instruction_phrase(&message[title_start..title_end]);
    let title_lower = title.to_ascii_lowercase();
    if title.is_empty()
        || title_lower == "time"
        || title_lower.starts_with("time ")
        || (title_lower.contains("day") && title_lower.contains("start"))
    {
        return None;
    }

    Some((start_time, capitalize_task_title(&title)))
}

fn strip_direct_agenda_task_prefix(title: &str) -> &str {
    let prefixes = [
        "a task for ",
        "task for ",
        "a task to ",
        "task to ",
        "an agenda item for ",
        "agenda item for ",
        "an item for ",
        "item for ",
    ];
    let lower = title.to_ascii_lowercase();
    prefixes
        .iter()
        .find_map(|prefix| lower.starts_with(prefix).then(|| &title[prefix.len()..]))
        .unwrap_or(title)
}

fn truncate_direct_agenda_task_suffix(title: &str) -> &str {
    let lower = title.to_ascii_lowercase();
    let mut end = title.len();
    for marker in [
        " to my agenda",
        " to the agenda",
        " on my agenda",
        " on the agenda",
        " in my agenda",
        " in the agenda",
    ] {
        if let Some(index) = lower.find(marker) {
            end = end.min(index);
        }
    }
    let mut truncated = title[..end].trim();
    for suffix in [" for", " at", " by", " around", " before"] {
        if truncated.to_ascii_lowercase().trim_end().ends_with(suffix) {
            truncated = truncated[..truncated.len() - suffix.len()].trim();
            break;
        }
    }
    truncated
}

fn direct_agenda_task_title(message: &str) -> Option<(NaiveTime, String)> {
    let lower = message.to_ascii_lowercase();
    if lower.contains("free time")
        || lower.contains("anything scheduled before")
        || lower.contains("nothing scheduled before")
        || lower.contains("day will start")
        || lower.contains("day should start")
    {
        return None;
    }

    let has_direct_add_intent = ["add", "schedule", "put"]
        .iter()
        .any(|phrase| lower.contains(phrase));
    let targets_agenda = ["agenda", "schedule", "task", "item"]
        .iter()
        .any(|phrase| lower.contains(phrase));
    if !has_direct_add_intent || !targets_agenda {
        return None;
    }

    let (start_time, time_span) = extract_meridiem_time_with_span(&lower)?;
    let before_time_lower = lower.get(..time_span.start)?;
    let before_time = message.get(..time_span.start)?;
    let markers = [
        "add an agenda item for ",
        "add agenda item for ",
        "add an item for ",
        "add item for ",
        "add a task for ",
        "add task for ",
        "add a task to ",
        "add task to ",
        "add ",
        "schedule ",
        "put ",
    ];
    let (marker_start, marker_len) = markers
        .iter()
        .filter_map(|marker| {
            before_time_lower
                .rfind(marker)
                .map(|index| (index, marker.len()))
        })
        .max_by_key(|(index, _)| *index)?;

    let raw_title = before_time.get(marker_start + marker_len..)?;
    let raw_title = strip_direct_agenda_task_prefix(raw_title);
    let raw_title = truncate_direct_agenda_task_suffix(raw_title);
    let title = trim_schedule_instruction_phrase(raw_title);
    let title_lower = title.to_ascii_lowercase();
    if title.is_empty()
        || matches!(
            title_lower.as_str(),
            "task" | "agenda task" | "agenda item" | "item" | "schedule"
        )
        || (title_lower.contains("goal") && !lower.contains("agenda"))
    {
        return None;
    }

    Some((start_time, capitalize_task_title(&title)))
}

fn direct_agenda_task_update(
    current_plan: &agenda::DailyPlan,
    message: &str,
) -> Option<agenda::DailyPlan> {
    let (start_time, title) = direct_agenda_task_title(message)?;
    let row = scheduled_task_for_instruction(title, start_time, 30, &current_plan.scheduled_tasks);
    insert_fixed_time_row(current_plan, row)
}

fn fixed_time_commitment_duration_minutes(title: &str) -> i32 {
    let lower = title.to_ascii_lowercase();
    if lower.contains("school") || lower.contains("drop off") || lower.contains("pickup") {
        30
    } else if lower.contains("doctor")
        || lower.contains("dentist")
        || lower.contains("appointment")
        || lower.contains("meeting")
    {
        60
    } else {
        30
    }
}

fn insert_fixed_time_row(
    current_plan: &agenda::DailyPlan,
    row: agenda::ScheduledTask,
) -> Option<agenda::DailyPlan> {
    let fixed_start = parse_schedule_time(&row.start_time)?;
    let fixed_end = scheduled_task_end(&row)?;
    let mut scheduled: Vec<agenda::ScheduledTask> = current_plan
        .scheduled_tasks
        .iter()
        .filter(|task| {
            task.task_id != row.task_id && !task.title.eq_ignore_ascii_case(row.title.as_str())
        })
        .cloned()
        .collect();
    sort_scheduled_tasks(&mut scheduled);

    let mut before = Vec::new();
    let mut after = Vec::new();
    for task in scheduled {
        if scheduled_task_end(&task).is_some_and(|end| end <= fixed_start) {
            before.push(task);
        } else {
            after.push(task);
        }
    }

    let mut combined = before;
    combined.push(row);
    combined.extend(after);

    let mut cursor = None;
    for task in &mut combined {
        let current_start = parse_schedule_time(&task.start_time).unwrap_or(fixed_end);
        if let Some(previous_end) = cursor {
            if current_start < previous_end {
                task.start_time = format_schedule_time(previous_end);
            }
        }
        cursor = scheduled_task_end(task);
    }

    normalize_scheduled_tasks(&mut combined);
    if scheduled_tasks_equivalent(&combined, &current_plan.scheduled_tasks) {
        return None;
    }

    let mut plan = current_plan.clone();
    plan.scheduled_tasks = combined;
    plan.task_order = plan
        .scheduled_tasks
        .iter()
        .map(|task| task.task_id.clone())
        .collect();
    for task in &plan.scheduled_tasks {
        plan.task_titles
            .insert(task.task_id.clone(), task.title.clone());
    }
    Some(plan)
}

fn fixed_time_commitment_update(
    current_plan: &agenda::DailyPlan,
    message: &str,
) -> Option<agenda::DailyPlan> {
    let (start_time, title) = fixed_time_commitment_title(message)?;
    let duration_minutes = fixed_time_commitment_duration_minutes(&title);
    let row = scheduled_task_for_instruction(
        title,
        start_time,
        duration_minutes,
        &current_plan.scheduled_tasks,
    );
    insert_fixed_time_row(current_plan, row)
}

fn reorder_existing_schedule(
    current: &[agenda::ScheduledTask],
    final_order: &[String],
) -> Option<Vec<agenda::ScheduledTask>> {
    reorder_schedule_with_partial_updates(current, final_order, &[])
}

fn reorder_schedule_with_partial_updates(
    current: &[agenda::ScheduledTask],
    final_order: &[String],
    updates: &[agenda::ScheduledTask],
) -> Option<Vec<agenda::ScheduledTask>> {
    if current.is_empty() || final_order.is_empty() {
        return None;
    }

    let mut current_by_id: std::collections::HashMap<&str, &agenda::ScheduledTask> = current
        .iter()
        .map(|task| (task.task_id.as_str(), task))
        .collect();
    let mut updates_by_id: std::collections::HashMap<&str, &agenda::ScheduledTask> = updates
        .iter()
        .map(|task| (task.task_id.as_str(), task))
        .collect();
    let reordered: Vec<agenda::ScheduledTask> = final_order
        .iter()
        .enumerate()
        .filter_map(|(index, id)| {
            let mut task = updates_by_id
                .remove(id.as_str())
                .or_else(|| current_by_id.remove(id.as_str()))?
                .clone();
            if let Some(slot) = current.get(index) {
                task.start_time = slot.start_time.clone();
            }
            Some(task)
        })
        .collect();

    if reordered.is_empty() {
        None
    } else {
        Some(reordered)
    }
}

fn is_regenerate_agenda_request(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    let asks_for_regeneration = [
        "regenerate",
        "re-generate",
        "refresh",
        "rebuild",
        "redo",
        "start over",
        "start fresh",
        "make a new",
        "new agenda",
        "new plan",
    ]
    .iter()
    .any(|phrase| lower.contains(phrase));
    let targets_agenda = ["agenda", "plan", "schedule", "task", "tasks"]
        .iter()
        .any(|word| lower.contains(word));

    asks_for_regeneration && targets_agenda
}

fn message_contains_meridiem_time(lower: &str) -> bool {
    (1..=12).any(|hour| {
        ["am", "pm"].iter().any(|meridiem| {
            lower.contains(&format!("{hour}{meridiem}"))
                || lower.contains(&format!("{hour} {meridiem}"))
        })
    })
}

fn message_requests_roadmap_goal_change(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    let targets_roadmap = ["goal", "goals", "roadmap", "domain", "domains"]
        .iter()
        .any(|phrase| lower.contains(phrase));
    let asks_change = [
        "add",
        "create",
        "new",
        "edit",
        "update",
        "change",
        "rename",
        "move",
        "deadline",
        "success metric",
        "priority",
        "mark",
    ]
    .iter()
    .any(|phrase| lower.contains(phrase));

    targets_roadmap && asks_change
}

fn message_has_explicit_agenda_target(lower: &str) -> bool {
    [
        "agenda",
        "today",
        "schedule",
        "this morning",
        "afternoon",
        "evening",
    ]
    .iter()
    .any(|phrase| lower.contains(phrase))
        || message_contains_meridiem_time(lower)
}

fn message_requests_agenda_change(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    if message_requests_roadmap_goal_change(message) && !message_has_explicit_agenda_target(&lower)
    {
        return false;
    }

    let trimmed = lower.trim_start();
    let direct_agenda_followup = message_is_direct_agenda_followup(message);
    let asks_explanation = trimmed.starts_with("why ")
        || trimmed.starts_with("what ")
        || trimmed.starts_with("when ")
        || trimmed.starts_with("how ")
        || lower.contains("explain")
        || lower.contains("why did")
        || lower.contains("why is");
    let explicit_change_command = [
        "please",
        "can you",
        "could you",
        "add",
        "remove",
        "move",
        "reorder",
        "reschedule",
        "defer",
        "break down",
        "breakdown",
        "subtask",
        "regenerate",
        "refresh",
        "rebuild",
        "redo",
        "reprioritize",
        "replace",
        "update",
        "change",
        "should be",
        "should have tasks",
        "need time",
        "we need",
        "i need",
        "let's",
        "let’s",
        "put another task",
        "in between",
        "do it",
        "do it now",
    ]
    .iter()
    .any(|phrase| lower.contains(phrase));
    let corrective_constraint = [
        "can't",
        "can’t",
        "cant",
        "cannot",
        "couldn't",
        "couldn’t",
        "could not",
        "wouldn't",
        "wouldn’t",
        "would not",
        "won't be able",
        "won’t be able",
        "doesn't work",
        "doesn’t work",
        "does not work",
        "not enough time",
        "too much",
        "won't fit",
        "won’t fit",
        "can't fit",
        "can’t fit",
        "needs to happen",
        "has to happen",
        "must happen",
    ]
    .iter()
    .any(|phrase| lower.contains(phrase))
        && [
            " if ",
            " before ",
            " after ",
            " until ",
            " unless ",
            " not yet",
            "haven't",
            "haven’t",
            "hasn't",
            "hasn’t",
            "earlier",
            "later",
            "fit",
        ]
        .iter()
        .any(|phrase| lower.contains(phrase));
    if asks_explanation && !explicit_change_command && !corrective_constraint {
        return false;
    }
    let strong_change_intent = [
        "add",
        "remove",
        "move",
        "reorder",
        "reschedule",
        "schedule",
        "defer",
        "break down",
        "breakdown",
        "subtask",
        "regenerate",
        "refresh",
        "rebuild",
        "redo",
        "reprioritize",
        "prioritize",
        "replace",
        "update",
        "change",
        "make a new",
        "should be",
        "should have tasks",
        "need time",
        "we need",
        "i need",
        "let's",
        "let’s",
        "put another task",
        "in between",
        "please",
        "do it",
        "do it now",
    ]
    .iter()
    .any(|phrase| lower.contains(phrase));
    let likely_agenda_target = [
        "agenda",
        "plan",
        "schedule",
        "task",
        "tasks",
        "today",
        "day",
        "morning",
        "afternoon",
        "evening",
        "routine",
        "chore",
    ]
    .iter()
    .any(|phrase| lower.contains(phrase));
    let mentions_time = message_contains_meridiem_time(&lower);

    direct_agenda_followup
        || (strong_change_intent && (likely_agenda_target || mentions_time))
        || corrective_constraint
}

fn message_is_direct_agenda_followup(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    let normalized_command = lower
        .trim_start()
        .trim_matches(|ch: char| ch.is_ascii_whitespace() || ch == '.' || ch == '!' || ch == '?');
    matches!(normalized_command, "reorder it" | "do it" | "do it now")
}

#[derive(Debug, Clone, Default)]
struct ChatPlanningAdjustments {
    earliest_start: Option<NaiveTime>,
    latest_work_end: Option<NaiveTime>,
}

impl ChatPlanningAdjustments {
    fn has_actionable_change(&self) -> bool {
        self.earliest_start.is_some() || self.latest_work_end.is_some()
    }
}

fn time_from_meridiem(hour: u32, meridiem: &str) -> Option<NaiveTime> {
    time_from_meridiem_parts(hour, 0, meridiem)
}

fn extract_day_end_time(lower: &str) -> Option<NaiveTime> {
    if !(lower.contains("end") || lower.contains("done for the day")) {
        return None;
    }

    for hour in 1..=12 {
        for meridiem in ["am", "pm"] {
            let compact = format!("{hour}{meridiem}");
            let spaced = format!("{hour} {meridiem}");
            if lower.contains(&compact) || lower.contains(&spaced) {
                return time_from_meridiem(hour, meridiem);
            }
        }
    }
    None
}

fn extract_day_start_time(lower: &str) -> Option<NaiveTime> {
    let mentions_day_start = (lower.contains("day") && lower.contains("start"))
        || lower.contains("scheduled before")
        || lower.contains("anything scheduled before")
        || lower.contains("nothing scheduled before")
        || lower.contains("shouldn't be anything scheduled before")
        || lower.contains("shouldnt be anything scheduled before")
        || lower.contains("should not be anything scheduled before");
    if !mentions_day_start {
        return None;
    }

    for hour in 1..=12 {
        for meridiem in ["am", "pm"] {
            let compact = format!("{hour}{meridiem}");
            let spaced = format!("{hour} {meridiem}");
            if lower.contains(&compact) || lower.contains(&spaced) {
                return time_from_meridiem(hour, meridiem);
            }
        }
    }
    None
}

fn extract_free_time_minutes(lower: &str) -> Option<i64> {
    if !lower.contains("free time") {
        return None;
    }

    for (label, minutes) in [
        ("1", 60),
        ("one", 60),
        ("2", 120),
        ("two", 120),
        ("3", 180),
        ("three", 180),
        ("4", 240),
        ("four", 240),
    ] {
        if lower.contains(&format!("{label} hour")) {
            return Some(minutes);
        }
    }
    None
}

fn chat_planning_adjustments(message: &str, _plan_date: NaiveDate) -> ChatPlanningAdjustments {
    let lower = message.to_ascii_lowercase();
    let mut adjustments = ChatPlanningAdjustments {
        earliest_start: extract_day_start_time(&lower),
        ..Default::default()
    };

    if let Some(end_time) = extract_day_end_time(&lower) {
        let free_minutes = extract_free_time_minutes(&lower).unwrap_or(0);
        let latest_work_end = end_time
            .overflowing_add_signed(Duration::minutes(-free_minutes))
            .0;
        adjustments.latest_work_end = Some(latest_work_end);
    }

    adjustments
}

fn regenerated_task_order(tasks: &[VaultTaskContext], current_order: &[String]) -> Vec<String> {
    let mut ranked = tasks.to_vec();
    ranked.sort_by(|a, b| {
        eisenhower_sort_rank(&a.7)
            .cmp(&eisenhower_sort_rank(&b.7))
            .then_with(|| {
                a.3.as_deref()
                    .unwrap_or("9999-12-31")
                    .cmp(b.3.as_deref().unwrap_or("9999-12-31"))
            })
            .then_with(|| b.4.cmp(&a.4))
    });

    let order: Vec<String> = ranked
        .into_iter()
        .take(8)
        .map(|(task_id, ..)| task_id)
        .collect();
    if order.is_empty() {
        current_order.to_vec()
    } else {
        order
    }
}

fn task_titles_for_order(
    tasks: &[VaultTaskContext],
    current_plan: &agenda::DailyPlan,
    order: &[String],
) -> std::collections::HashMap<String, String> {
    let title_by_id: std::collections::HashMap<&str, &str> = tasks
        .iter()
        .map(|(task_id, title, ..)| (task_id.as_str(), title.as_str()))
        .collect();

    order
        .iter()
        .filter_map(|task_id| {
            title_by_id
                .get(task_id.as_str())
                .map(|title| (task_id.clone(), (*title).to_string()))
                .or_else(|| {
                    current_plan
                        .task_titles
                        .get(task_id)
                        .map(|title| (task_id.clone(), title.clone()))
                })
        })
        .collect()
}

fn parse_schedule_time(raw: &str) -> Option<NaiveTime> {
    let trimmed = raw.trim();
    NaiveTime::parse_from_str(trimmed, "%I:%M %p")
        .or_else(|_| NaiveTime::parse_from_str(trimmed, "%H:%M"))
        .ok()
}

fn format_schedule_time(time: NaiveTime) -> String {
    time.format("%I:%M %p")
        .to_string()
        .trim_start_matches('0')
        .to_string()
}

fn scheduled_task_end(task: &agenda::ScheduledTask) -> Option<NaiveTime> {
    parse_schedule_time(&task.start_time)
        .map(|start| start + Duration::minutes(task.duration_minutes.max(5).into()))
}

fn scheduled_task_starts_before(task: &agenda::ScheduledTask, cutoff: NaiveTime) -> bool {
    let Some(start) = parse_schedule_time(&task.start_time) else {
        return true;
    };
    let Some(end) = scheduled_task_end(task) else {
        return true;
    };
    start < cutoff && end <= cutoff
}

fn sort_scheduled_tasks(tasks: &mut [agenda::ScheduledTask]) {
    tasks.sort_by_key(|task| parse_schedule_time(&task.start_time).unwrap_or(NaiveTime::MIN));
}

fn normalize_scheduled_tasks(tasks: &mut Vec<agenda::ScheduledTask>) {
    sort_scheduled_tasks(tasks);
    let mut seen_task_ids = std::collections::HashSet::new();
    tasks.retain(|task| task.task_id.is_empty() || seen_task_ids.insert(task.task_id.clone()));
}

fn shift_schedule_not_before(
    tasks: &mut [agenda::ScheduledTask],
    earliest_start: NaiveTime,
) -> bool {
    if tasks.is_empty() {
        return false;
    }

    sort_scheduled_tasks(tasks);
    let mut cursor = earliest_start;
    let mut changed = false;

    for task in tasks.iter_mut() {
        let current_start = parse_schedule_time(&task.start_time).unwrap_or(cursor);
        let adjusted_start = if current_start < cursor {
            cursor
        } else {
            current_start
        };
        if adjusted_start != current_start {
            task.start_time = format_schedule_time(adjusted_start);
            changed = true;
        }

        cursor = adjusted_start
            .overflowing_add_signed(Duration::minutes(i64::from(task.duration_minutes.max(5))))
            .0;
    }

    changed
}

fn next_visible_agenda_minute_after(time: NaiveTime) -> NaiveTime {
    time.with_second(0)
        .and_then(|time| time.with_nanosecond(0))
        .unwrap_or(time)
        .overflowing_add_signed(Duration::minutes(1))
        .0
}

fn is_memory_schedule_row(task: &agenda::ScheduledTask) -> bool {
    task.estimate_source.as_deref() == Some("memory") || task.task_id.starts_with("memory_")
}

fn next_start_avoiding_fixed_rows(
    mut cursor: NaiveTime,
    duration_minutes: i32,
    fixed_rows: &[(NaiveTime, NaiveTime)],
) -> NaiveTime {
    loop {
        let end = cursor
            .overflowing_add_signed(Duration::minutes(i64::from(duration_minutes.max(5))))
            .0;
        let Some((_, fixed_end)) = fixed_rows
            .iter()
            .find(|(fixed_start, fixed_end)| cursor < *fixed_end && end > *fixed_start)
        else {
            return cursor;
        };
        cursor = *fixed_end;
    }
}

fn align_regenerated_schedule_after_start(
    plan: &mut agenda::DailyPlan,
    earliest_start: NaiveTime,
) -> bool {
    let original = plan.scheduled_tasks.clone();
    let mut fixed_rows = Vec::new();
    let mut adjusted = Vec::new();
    let mut flexible_rows = Vec::new();

    for task in plan.scheduled_tasks.drain(..) {
        if is_memory_schedule_row(&task) {
            if let (Some(start), Some(end)) = (
                parse_schedule_time(&task.start_time),
                scheduled_task_end(&task),
            ) {
                if start >= earliest_start {
                    fixed_rows.push((start, end));
                    adjusted.push(task);
                }
            } else {
                adjusted.push(task);
            }
        } else {
            flexible_rows.push(task);
        }
    }

    fixed_rows.sort_by_key(|(start, _)| *start);
    flexible_rows
        .sort_by_key(|task| parse_schedule_time(&task.start_time).unwrap_or(earliest_start));

    let mut cursor = earliest_start;
    for mut task in flexible_rows {
        let duration = task.duration_minutes.max(5);
        let current_start = parse_schedule_time(&task.start_time).unwrap_or(cursor);
        let desired_start = if current_start < cursor {
            cursor
        } else {
            current_start
        };
        let adjusted_start = next_start_avoiding_fixed_rows(desired_start, duration, &fixed_rows);
        task.start_time = format_schedule_time(adjusted_start);
        cursor = adjusted_start
            .overflowing_add_signed(Duration::minutes(i64::from(duration)))
            .0;
        adjusted.push(task);
    }
    sort_scheduled_tasks(&mut adjusted);

    if scheduled_tasks_equivalent(&adjusted, &original) {
        plan.scheduled_tasks = original;
        return false;
    }

    plan.scheduled_tasks = adjusted;
    plan.task_order = plan
        .scheduled_tasks
        .iter()
        .map(|task| task.task_id.clone())
        .collect();
    for task in &plan.scheduled_tasks {
        plan.task_titles
            .insert(task.task_id.clone(), task.title.clone());
    }
    true
}

fn align_today_regenerated_schedule_after_now(plan: &mut agenda::DailyPlan) -> bool {
    let now = chrono::Local::now();
    if plan.date != now.date_naive() {
        return false;
    }

    align_regenerated_schedule_after_start(plan, next_visible_agenda_minute_after(now.time()))
}

fn apply_chat_planning_adjustments(
    current_plan: &agenda::DailyPlan,
    adjustments: &ChatPlanningAdjustments,
    generated_at: &str,
    task_quadrants: &std::collections::HashMap<String, String>,
) -> Option<agenda::DailyPlan> {
    if !adjustments.has_actionable_change() {
        return None;
    }

    let mut plan = current_plan.clone();
    let mut scheduled = if plan.scheduled_tasks.is_empty() {
        build_scheduled_tasks(&plan, generated_at, task_quadrants)
    } else {
        plan.scheduled_tasks.clone()
    };
    let original = scheduled.clone();

    if let Some(cutoff) = adjustments.latest_work_end {
        scheduled.retain(|task| scheduled_task_starts_before(task, cutoff));
    }
    if let Some(earliest_start) = adjustments.earliest_start {
        shift_schedule_not_before(&mut scheduled, earliest_start);
    }
    if let Some(cutoff) = adjustments.latest_work_end {
        scheduled.retain(|task| scheduled_task_starts_before(task, cutoff));
    }
    sort_scheduled_tasks(&mut scheduled);

    if scheduled_tasks_equivalent(&scheduled, &original) {
        return None;
    }

    plan.scheduled_tasks = scheduled;
    plan.task_order = plan
        .scheduled_tasks
        .iter()
        .map(|task| task.task_id.clone())
        .collect();
    for task in &plan.scheduled_tasks {
        plan.task_titles
            .insert(task.task_id.clone(), task.title.clone());
    }
    plan.generated_at = Some(generated_at.to_string());
    Some(plan)
}

fn merge_chat_schedule_updates(
    current: &[agenda::ScheduledTask],
    final_order: &[String],
    updates: Vec<agenda::ScheduledTask>,
    action: &str,
) -> Vec<agenda::ScheduledTask> {
    if updates.is_empty() {
        return Vec::new();
    }

    let update_order: Vec<String> = updates.iter().map(|task| task.task_id.clone()).collect();
    let mut updates_by_id: std::collections::HashMap<String, agenda::ScheduledTask> = updates
        .into_iter()
        .map(|task| (task.task_id.clone(), task))
        .collect();
    let updates_cover_final = !final_order.is_empty()
        && final_order
            .iter()
            .all(|id| updates_by_id.contains_key(id.as_str()));

    if updates_cover_final
        && matches!(
            action,
            "reorder" | "replace" | "regenerate" | "reschedule" | "update" | "update_schedule"
        )
    {
        return final_order
            .iter()
            .filter_map(|id| updates_by_id.remove(id.as_str()))
            .collect();
    }

    let current_by_id: std::collections::HashMap<&str, &agenda::ScheduledTask> = current
        .iter()
        .map(|task| (task.task_id.as_str(), task))
        .collect();
    let mut merged = Vec::new();

    for id in final_order {
        if let Some(update) = updates_by_id.remove(id.as_str()) {
            merged.push(update);
        } else if let Some(existing) = current_by_id.get(id.as_str()) {
            merged.push((*existing).clone());
        }
    }

    if action == "add" || final_order.is_empty() {
        for id in &update_order {
            if let Some(update) = updates_by_id.remove(id.as_str()) {
                if !merged.iter().any(|task| task.task_id == update.task_id) {
                    merged.push(update);
                }
            }
        }
    }

    if merged.is_empty() {
        for id in &update_order {
            if let Some(update) = updates_by_id.remove(id.as_str()) {
                merged.push(update);
            }
        }
    }

    merged
}

fn scheduled_tasks_equivalent(a: &[agenda::ScheduledTask], b: &[agenda::ScheduledTask]) -> bool {
    a.len() == b.len()
        && a.iter().zip(b).all(|(left, right)| {
            left.task_id == right.task_id
                && left.title == right.title
                && left.start_time == right.start_time
                && left.duration_minutes == right.duration_minutes
                && left.estimate_source == right.estimate_source
                && left.eisenhower_quadrant == right.eisenhower_quadrant
        })
}

fn append_memory_response_note(response_text: String, note: Option<&str>) -> String {
    let Some(note) = note else {
        return response_text;
    };
    let trimmed = response_text.trim();
    if trimmed.is_empty() || trimmed == note {
        return note.to_string();
    }
    if trimmed.contains(note) {
        return trimmed.to_string();
    }

    format!("{trimmed} {note}")
}

fn write_assistant_goal_mutation(
    vault: &vault_core::VaultManager,
    goal_id: &str,
    frontmatter: &markdown_parser::Frontmatter,
    body: &str,
    action: &str,
) -> vault_core::VaultResult<()> {
    vault.write_goal_with_audit(goal_id, frontmatter, body, "assistant", action)
}

fn set_goal_task_value_scheduled_date(
    value: &mut serde_yaml::Value,
    task_id: &str,
    scheduled_date: &str,
) -> bool {
    if value.get("id").and_then(|v| v.as_str()) == Some(task_id) {
        if let Some(map) = value.as_mapping_mut() {
            map.insert(
                "scheduled_date".into(),
                serde_yaml::Value::String(scheduled_date.to_string()),
            );
            map.remove("scheduledDate");
            map.remove("scheduled_for");
            map.remove("scheduledFor");
        }
        return true;
    }

    value
        .get_mut("subtasks")
        .and_then(|v| v.as_sequence_mut())
        .is_some_and(|subtasks| {
            subtasks
                .iter_mut()
                .any(|subtask| set_goal_task_value_scheduled_date(subtask, task_id, scheduled_date))
        })
}

fn apply_assistant_task_scheduled_dates(
    vault_id: &str,
    app_state: &AppState,
    updates: &[(String, Option<String>, String)],
) -> Result<usize, AppError> {
    if updates.is_empty() {
        return Ok(0);
    }

    let vaults = app_state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let vault = vaults
        .get(vault_id)
        .ok_or_else(|| AppError::vault_not_open(vault_id))?;
    let mut changed = 0;

    for (task_id, maybe_goal_id, scheduled_date) in updates {
        let mut goal_ids = vault.list_goals().unwrap_or_default();
        if let Some(goal_id) = maybe_goal_id
            .as_deref()
            .filter(|goal_id| !goal_id.trim().is_empty())
        {
            goal_ids.retain(|existing| existing != goal_id);
            goal_ids.insert(0, goal_id.to_string());
        }

        for goal_id in goal_ids {
            let Ok((mut fm, body)) = vault.read_goal(&goal_id) else {
                continue;
            };
            let Some(task_seq) = fm.get_mut("tasks").and_then(|v| v.as_sequence_mut()) else {
                continue;
            };
            let found = task_seq
                .iter_mut()
                .any(|task| set_goal_task_value_scheduled_date(task, task_id, scheduled_date));
            if !found {
                continue;
            }

            validate_goal_frontmatter_tasks_for_write(vault, &goal_id, &fm)?;
            write_assistant_goal_mutation(
                vault,
                &goal_id,
                &fm,
                &body,
                "assistant_schedule_task_for_specific_date",
            )
            .map_err(|error| AppError::new(ErrorCode::UnknownError, error.to_string()))?;
            changed += 1;
            break;
        }
    }

    Ok(changed)
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct AssistantRoadmapUpdate {
    goals_to_add: Vec<AssistantGoalCreate>,
    goals_to_edit: Vec<AssistantGoalEdit>,
    tasks_to_add: Vec<AssistantTaskAdd>,
    tasks_to_edit: Vec<AssistantTaskEdit>,
}

impl AssistantRoadmapUpdate {
    fn is_empty(&self) -> bool {
        self.goals_to_add.is_empty()
            && self.goals_to_edit.is_empty()
            && self.tasks_to_add.is_empty()
            && self.tasks_to_edit.is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AssistantGoalCreate {
    requested_id: Option<String>,
    title: String,
    domain: Option<String>,
    deadline: Option<String>,
    success_metric: Option<String>,
    priority: Option<String>,
    eisenhower_quadrant: Option<String>,
    notes: Option<String>,
    tasks: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AssistantGoalEdit {
    goal_id: String,
    title: Option<String>,
    domain: Option<String>,
    deadline: Option<String>,
    success_metric: Option<String>,
    priority: Option<String>,
    eisenhower_quadrant: Option<String>,
    status: Option<String>,
    notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AssistantTaskAdd {
    requested_id: Option<String>,
    goal_id: String,
    parent_task_id: Option<String>,
    title: String,
    status: Option<String>,
    due_date: Option<String>,
    scheduled_date: Option<String>,
    recurring: Option<String>,
    priority: Option<String>,
    eisenhower_quadrant: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AssistantTaskEdit {
    task_id: String,
    goal_id: Option<String>,
    title: Option<String>,
    status: Option<String>,
    due_date: Option<String>,
    scheduled_date: Option<String>,
    recurring: Option<String>,
    priority: Option<String>,
    eisenhower_quadrant: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct AssistantRoadmapMutationResult {
    goals_added: usize,
    goals_edited: usize,
    tasks_added: usize,
    tasks_edited: usize,
}

impl AssistantRoadmapMutationResult {
    fn changed(&self) -> bool {
        self.goals_added > 0
            || self.goals_edited > 0
            || self.tasks_added > 0
            || self.tasks_edited > 0
    }

    fn response_message(&self) -> &'static str {
        let added = self.goals_added + self.tasks_added;
        let edited = self.goals_edited + self.tasks_edited;
        match (added, edited) {
            (0, 0) => "I checked the Roadmap, but there was nothing to change.",
            (1, 0) if self.goals_added == 1 => "I added that Goal to your Roadmap.",
            (1, 0) => "I added that Task to your Roadmap.",
            (_, 0) => "I added those Roadmap items.",
            (0, 1) if self.goals_edited == 1 => "I updated that Goal in your Roadmap.",
            (0, 1) => "I updated that Task in your Roadmap.",
            (0, _) => "I updated those Roadmap items.",
            _ => "I updated your Roadmap.",
        }
    }
}

fn normalized_json_text(value: &Value, keys: &[&str], max_len: usize) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key))
        .and_then(Value::as_str)
        .and_then(|raw| {
            let text = sanitize_llm_text(raw, max_len);
            let lower = text.to_ascii_lowercase();
            if text.is_empty()
                || matches!(
                    lower.as_str(),
                    "null" | "none" | "n/a" | "na" | "unknown" | "not specified"
                )
            {
                None
            } else {
                Some(text)
            }
        })
}

fn normalized_json_date(value: &Value, keys: &[&str]) -> Option<String> {
    normalized_json_text(value, keys, 32)
        .filter(|date| chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok())
}

fn normalized_json_f64(value: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|key| {
        let value = value.get(*key)?;
        let parsed = value.as_f64().or_else(|| {
            value
                .as_str()
                .and_then(|raw| raw.trim().parse::<f64>().ok())
        })?;
        parsed.is_finite().then_some(parsed.max(0.0))
    })
}

fn normalized_json_u32(value: &Value, keys: &[&str]) -> Option<u32> {
    normalized_json_f64(value, keys).map(|value| value.round().max(0.0) as u32)
}

fn normalized_json_bool(value: &Value, keys: &[&str]) -> Option<bool> {
    keys.iter().find_map(|key| value.get(*key)?.as_bool())
}

fn normalized_json_string_array(value: &Value, keys: &[&str], max_len: usize) -> Vec<String> {
    keys.iter()
        .find_map(|key| value.get(*key))
        .map(|items| {
            let values: Vec<&Value> = if let Some(array) = items.as_array() {
                array.iter().collect()
            } else {
                vec![items]
            };

            values
                .into_iter()
                .filter_map(|item| {
                    item.as_str()
                        .map(|raw| sanitize_llm_text(raw, max_len))
                        .or_else(|| {
                            normalized_json_text(item, &["value", "text", "label"], max_len)
                        })
                })
                .filter(|item| !item.is_empty())
                .take(20)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_memory_important_days(value: &Value, keys: &[&str]) -> Vec<MemoryImportantDay> {
    keys.iter()
        .find_map(|key| value.get(*key))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let label = normalized_json_text(item, &["label", "name"], 120)?;
                    let date = normalized_json_date(item, &["date"])?;
                    Some(MemoryImportantDay {
                        label,
                        date,
                        recurrence: normalized_json_text(item, &["recurrence", "repeat"], 32),
                        notes: normalized_json_text(item, &["notes", "note"], 300),
                    })
                })
                .take(20)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_memory_days(value: &Value) -> Vec<String> {
    value
        .get("days")
        .or_else(|| value.get("day"))
        .map(|items| {
            let values: Vec<&Value> = if let Some(array) = items.as_array() {
                array.iter().collect()
            } else {
                vec![items]
            };
            values
                .into_iter()
                .filter_map(|item| item.as_str().map(|raw| sanitize_llm_text(raw, 32)))
                .filter(|day| !day.is_empty())
                .take(10)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_memory_time_windows(value: &Value, keys: &[&str]) -> Vec<MemoryTimeWindow> {
    keys.iter()
        .find_map(|key| value.get(*key))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let label = normalized_json_text(item, &["label", "name"], 120)?;
                    let start_time = normalized_json_text(item, &["start_time", "startTime"], 32)?;
                    let end_time = normalized_json_text(item, &["end_time", "endTime"], 32)?;
                    Some(MemoryTimeWindow {
                        label,
                        start_time: normalize_agenda_time_label(&start_time),
                        end_time: normalize_agenda_time_label(&end_time),
                        days: parse_memory_days(item),
                    })
                })
                .take(20)
                .collect()
        })
        .unwrap_or_default()
}

fn normalized_goal_priority(value: &Value, keys: &[&str]) -> Option<String> {
    normalized_json_text(value, keys, 32).and_then(|priority| {
        match priority.to_ascii_lowercase().as_str() {
            "critical" | "high" | "medium" | "low" => Some(priority.to_ascii_lowercase()),
            _ => None,
        }
    })
}

fn normalized_eisenhower_quadrant(value: &Value, keys: &[&str]) -> Option<String> {
    normalized_json_text(value, keys, 32).and_then(|quadrant| {
        match quadrant.to_ascii_lowercase().as_str() {
            "do" | "schedule" | "delegate" | "delete" => Some(quadrant.to_ascii_lowercase()),
            _ => None,
        }
    })
}

fn normalized_goal_status(value: &Value, keys: &[&str]) -> Option<String> {
    normalized_json_text(value, keys, 32).and_then(|status| {
        match status.to_ascii_lowercase().as_str() {
            "created" | "active" | "paused" | "completed" => Some(status.to_ascii_lowercase()),
            "done" => Some("completed".to_string()),
            _ => None,
        }
    })
}

fn normalized_task_status(value: &Value, keys: &[&str]) -> Option<String> {
    normalized_json_text(value, keys, 32).and_then(|status| {
        match status.to_ascii_lowercase().as_str() {
            "todo" | "pending" | "in_progress" | "deferred" | "blocked" | "completed" => {
                Some(status.to_ascii_lowercase())
            }
            "done" => Some("completed".to_string()),
            _ => None,
        }
    })
}

fn normalized_task_recurrence(value: &Value, keys: &[&str]) -> Option<String> {
    normalized_json_text(value, keys, 32).and_then(|recurrence| {
        match recurrence.to_ascii_lowercase().as_str() {
            "daily" | "weekdays" | "weekly" | "monthly" | "yearly" => {
                Some(recurrence.to_ascii_lowercase())
            }
            _ => None,
        }
    })
}

fn parse_assistant_goal_task_titles(value: &Value) -> Vec<String> {
    value
        .get("tasks")
        .or_else(|| value.get("initial_tasks"))
        .or_else(|| value.get("initialTasks"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    if let Some(title) = item.as_str() {
                        Some(sanitize_llm_text(title, 200))
                    } else {
                        normalized_json_text(item, &["title"], 200)
                    }
                })
                .filter(|title| !title.is_empty())
                .take(10)
                .collect()
        })
        .unwrap_or_default()
}

fn parse_assistant_goal_create(value: &Value) -> Option<AssistantGoalCreate> {
    let title = normalized_json_text(value, &["title", "name"], 200)?;
    let requested_id = normalized_json_text(value, &["id", "goal_id", "goalId"], 96)
        .map(|id| sanitize_task_id(&id))
        .filter(|id| !id.is_empty());

    Some(AssistantGoalCreate {
        requested_id,
        title,
        domain: normalized_json_text(value, &["domain", "goal_type", "goalType"], 120),
        deadline: normalized_json_date(value, &["deadline", "due_date", "dueDate"]),
        success_metric: normalized_json_text(
            value,
            &["success_metric", "successMetric", "metric"],
            500,
        ),
        priority: normalized_goal_priority(value, &["priority"]),
        eisenhower_quadrant: normalized_eisenhower_quadrant(
            value,
            &["eisenhower_quadrant", "eisenhowerQuadrant"],
        ),
        notes: normalized_json_text(value, &["notes", "body", "description"], 4000),
        tasks: parse_assistant_goal_task_titles(value),
    })
}

fn parse_assistant_goal_edit(value: &Value) -> Option<AssistantGoalEdit> {
    let goal_id = normalized_json_text(value, &["goal_id", "goalId", "id"], 96)
        .map(|id| sanitize_task_id(&id))
        .filter(|id| !id.is_empty())?;

    Some(AssistantGoalEdit {
        goal_id,
        title: normalized_json_text(value, &["title", "name"], 200),
        domain: normalized_json_text(value, &["domain", "goal_type", "goalType"], 120),
        deadline: normalized_json_date(value, &["deadline", "due_date", "dueDate"]),
        success_metric: normalized_json_text(
            value,
            &["success_metric", "successMetric", "metric"],
            500,
        ),
        priority: normalized_goal_priority(value, &["priority"]),
        eisenhower_quadrant: normalized_eisenhower_quadrant(
            value,
            &["eisenhower_quadrant", "eisenhowerQuadrant"],
        ),
        status: normalized_goal_status(value, &["status", "lifecycle"]),
        notes: normalized_json_text(value, &["notes", "body", "description"], 4000),
    })
}

fn parse_assistant_task_add(value: &Value) -> Option<AssistantTaskAdd> {
    let goal_id = normalized_json_text(value, &["goal_id", "goalId"], 96)
        .map(|id| sanitize_task_id(&id))
        .filter(|id| !id.is_empty())?;
    let title = normalized_json_text(value, &["title", "name"], 200)?;
    let requested_id = normalized_json_text(value, &["id", "task_id", "taskId"], 96)
        .map(|id| sanitize_task_id(&id))
        .filter(|id| !id.is_empty());
    let parent_task_id = normalized_json_text(
        value,
        &["parent_task_id", "parentTaskId", "parent_id", "parentId"],
        96,
    )
    .map(|id| sanitize_task_id(&id))
    .filter(|id| !id.is_empty());

    Some(AssistantTaskAdd {
        requested_id,
        goal_id,
        parent_task_id,
        title,
        status: normalized_task_status(value, &["status"]),
        due_date: normalized_json_date(value, &["due_date", "dueDate"]),
        scheduled_date: normalized_json_date(
            value,
            &[
                "scheduled_date",
                "scheduledDate",
                "scheduled_for",
                "scheduledFor",
            ],
        ),
        recurring: normalized_task_recurrence(value, &["recurring", "recurrence"]),
        priority: normalized_goal_priority(value, &["priority"]),
        eisenhower_quadrant: normalized_eisenhower_quadrant(
            value,
            &["eisenhower_quadrant", "eisenhowerQuadrant"],
        ),
    })
}

fn parse_assistant_task_edit(value: &Value) -> Option<AssistantTaskEdit> {
    let task_id = normalized_json_text(value, &["task_id", "taskId", "id"], 96)
        .map(|id| sanitize_task_id(&id))
        .filter(|id| !id.is_empty())?;
    let goal_id = normalized_json_text(value, &["goal_id", "goalId"], 96)
        .map(|id| sanitize_task_id(&id))
        .filter(|id| !id.is_empty());

    Some(AssistantTaskEdit {
        task_id,
        goal_id,
        title: normalized_json_text(value, &["title", "name"], 200),
        status: normalized_task_status(value, &["status"]),
        due_date: normalized_json_date(value, &["due_date", "dueDate"]),
        scheduled_date: normalized_json_date(
            value,
            &[
                "scheduled_date",
                "scheduledDate",
                "scheduled_for",
                "scheduledFor",
            ],
        ),
        recurring: normalized_task_recurrence(value, &["recurring", "recurrence"]),
        priority: normalized_goal_priority(value, &["priority"]),
        eisenhower_quadrant: normalized_eisenhower_quadrant(
            value,
            &["eisenhower_quadrant", "eisenhowerQuadrant"],
        ),
    })
}

fn parse_assistant_roadmap_update(parsed: &Value) -> AssistantRoadmapUpdate {
    let Some(update) = parsed
        .get("roadmap_update")
        .or_else(|| parsed.get("roadmapUpdate"))
        .filter(|value| value.is_object())
    else {
        return AssistantRoadmapUpdate::default();
    };

    let goals_to_add = update
        .get("goals_to_add")
        .or_else(|| update.get("goalsToAdd"))
        .or_else(|| update.get("add_goals"))
        .or_else(|| update.get("goals"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(parse_assistant_goal_create)
                .collect()
        })
        .unwrap_or_default();

    let goals_to_edit = update
        .get("goals_to_edit")
        .or_else(|| update.get("goalsToEdit"))
        .or_else(|| update.get("edit_goals"))
        .or_else(|| update.get("updates"))
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(parse_assistant_goal_edit).collect())
        .unwrap_or_default();

    let tasks_to_add = update
        .get("tasks_to_add")
        .or_else(|| update.get("tasksToAdd"))
        .or_else(|| update.get("add_tasks"))
        .or_else(|| update.get("addTasks"))
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(parse_assistant_task_add).collect())
        .unwrap_or_default();

    let tasks_to_edit = update
        .get("tasks_to_edit")
        .or_else(|| update.get("tasksToEdit"))
        .or_else(|| update.get("edit_tasks"))
        .or_else(|| update.get("editTasks"))
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(parse_assistant_task_edit).collect())
        .unwrap_or_default();

    AssistantRoadmapUpdate {
        goals_to_add,
        goals_to_edit,
        tasks_to_add,
        tasks_to_edit,
    }
}

fn parse_assistant_memory_update(parsed: &Value) -> AssistantMemoryUpdate {
    let Some(update) = parsed
        .get("memory_update")
        .or_else(|| parsed.get("memoryUpdate"))
        .filter(|value| value.is_object())
    else {
        return AssistantMemoryUpdate::default();
    };

    AssistantMemoryUpdate {
        reason: normalized_json_text(update, &["reason", "source"], 240),
        sensitive: normalized_json_bool(update, &["sensitive", "requires_confirmation"])
            .unwrap_or(false),
        confirmed_by_user: normalized_json_bool(
            update,
            &["confirmed_by_user", "confirmedByUser", "user_confirmed"],
        )
        .unwrap_or(false),
        user_name: normalized_json_text(update, &["user_name", "userName", "name"], 120),
        age: normalized_json_u32(update, &["age"]),
        important_days_to_add: parse_memory_important_days(
            update,
            &[
                "important_days_to_add",
                "importantDaysToAdd",
                "important_days",
                "importantDays",
            ],
        ),
        likes_to_add: normalized_json_string_array(
            update,
            &["likes_to_add", "likesToAdd", "preferences_to_add", "likes"],
            300,
        ),
        dislikes_to_add: normalized_json_string_array(
            update,
            &[
                "dislikes_to_add",
                "dislikesToAdd",
                "poor_fit_work_to_add",
                "dislikes",
            ],
            300,
        ),
        limitations_to_add: normalized_json_string_array(
            update,
            &[
                "limitations_to_add",
                "limitationsToAdd",
                "constraints_to_add",
                "limitations",
            ],
            500,
        ),
        meal_windows_to_add: parse_memory_time_windows(
            update,
            &[
                "meal_windows_to_add",
                "mealWindowsToAdd",
                "meal_windows",
                "mealWindows",
            ],
        ),
        snack_windows_to_add: parse_memory_time_windows(
            update,
            &[
                "snack_windows_to_add",
                "snackWindowsToAdd",
                "snack_windows",
                "snackWindows",
            ],
        ),
        exercise_minutes_needed: normalized_json_u32(
            update,
            &["exercise_minutes_needed", "exerciseMinutesNeeded"],
        ),
        socialization_minutes_needed: normalized_json_u32(
            update,
            &["socialization_minutes_needed", "socializationMinutesNeeded"],
        ),
        self_care_minutes_needed: normalized_json_u32(
            update,
            &["self_care_minutes_needed", "selfCareMinutesNeeded"],
        ),
        task_capacity_hours_per_day: normalized_json_f64(
            update,
            &["task_capacity_hours_per_day", "taskCapacityHoursPerDay"],
        ),
        sleep_hours_needed: normalized_json_f64(
            update,
            &["sleep_hours_needed", "sleepHoursNeeded"],
        ),
        downtime_hours_needed: normalized_json_f64(
            update,
            &["downtime_hours_needed", "downtimeHoursNeeded"],
        ),
        notes_to_add: normalized_json_string_array(
            update,
            &["notes_to_add", "notesToAdd", "memory_notes", "notes"],
            500,
        ),
    }
}

fn strip_memory_directive(message: &str) -> Option<String> {
    let trimmed = message.trim();
    let prefixes = [
        "please remember that ",
        "please remember ",
        "remember that ",
        "remember, ",
        "remember: ",
        "remember ",
        "can you remember that ",
        "could you remember that ",
        "save to memory that ",
        "save this to memory: ",
        "save that ",
        "save this ",
        "please save that ",
        "add to memory that ",
        "keep in mind that ",
        "note that ",
        "make a note that ",
        "don't forget that ",
        "do not forget that ",
    ];

    prefixes.iter().find_map(|prefix| {
        let head = trimmed.get(..prefix.len())?;
        if head.eq_ignore_ascii_case(prefix) {
            clean_memory_detail(trimmed.get(prefix.len()..)?)
        } else {
            None
        }
    })
}

fn clean_memory_detail(value: &str) -> Option<String> {
    let trimmed = sanitize_llm_text(value, 500)
        .trim_matches(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | ':' | '-'))
        .trim_end_matches(|c: char| matches!(c, '.' | '?' | '!'))
        .trim()
        .to_string();
    let detail = trimmed
        .strip_prefix("that ")
        .or_else(|| trimmed.strip_prefix("That "))
        .unwrap_or(trimmed.as_str())
        .trim()
        .to_string();

    if detail.is_empty() {
        None
    } else {
        Some(detail)
    }
}

fn contains_any(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}

fn user_message_requests_memory_removal(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    contains_any(
        &lower,
        &[
            "forget this",
            "forget that",
            "forget what",
            "remove from memory",
            "delete from memory",
            "don't remember",
            "dont remember",
            "do not remember",
        ],
    ) && !contains_any(&lower, &["don't forget", "do not forget"])
}

fn memory_detail_contains_secret(detail: &str) -> bool {
    contains_any(
        &detail.to_ascii_lowercase(),
        &[
            "api key",
            "apikey",
            "password",
            "passcode",
            "oauth",
            "secret",
            "token",
            "private key",
            "recovery phrase",
        ],
    )
}

fn parse_number_token(value: &str) -> Option<f64> {
    let cleaned = value.trim_matches(|c: char| !c.is_ascii_digit() && c != '.');
    if cleaned.is_empty() {
        return None;
    }
    cleaned
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
}

fn number_before_phrase(lower: &str, phrase: &str) -> Option<f64> {
    let index = lower.find(phrase)?;
    lower[..index]
        .split_whitespace()
        .rev()
        .find_map(parse_number_token)
}

fn number_after_phrase(lower: &str, phrase: &str) -> Option<f64> {
    let index = lower.find(phrase)? + phrase.len();
    lower[index..]
        .split_whitespace()
        .find_map(parse_number_token)
}

fn first_number_before_any(lower: &str, phrases: &[&str]) -> Option<f64> {
    phrases
        .iter()
        .find_map(|phrase| number_before_phrase(lower, phrase))
}

fn first_number_after_any(lower: &str, phrases: &[&str]) -> Option<f64> {
    phrases
        .iter()
        .find_map(|phrase| number_after_phrase(lower, phrase))
}

fn parse_minutes_for_need(lower: &str, need: &str) -> Option<u32> {
    let before_phrases = [
        format!("minutes of {need}"),
        format!("minute of {need}"),
        format!("mins of {need}"),
        format!("min of {need}"),
    ];
    before_phrases
        .iter()
        .find_map(|phrase| number_before_phrase(lower, phrase))
        .or_else(|| number_after_phrase(lower, need))
        .map(|value| value.round().max(0.0) as u32)
}

fn memory_detail_requires_confirmation(detail: &str) -> bool {
    contains_any(
        &detail.to_ascii_lowercase(),
        &[
            "birthday",
            "anniversary",
            "age",
            "years old",
            "health",
            "medical",
            "medication",
            "therapy",
            "sleep",
            "exercise",
            "self-care",
            "self care",
            "socialization",
            "limitation",
            "limitations",
            "can't",
            "cannot",
            "avoid",
        ],
    )
}

fn apply_memory_detail_to_update(
    update: &mut AssistantMemoryUpdate,
    detail: &str,
    explicit_memory_request: bool,
) {
    let lower = detail.to_ascii_lowercase();
    if lower.contains("sleep") {
        update.sleep_hours_needed = first_number_before_any(
            &lower,
            &[
                "hours of sleep",
                "hour of sleep",
                "hrs of sleep",
                "hr of sleep",
            ],
        )
        .or_else(|| first_number_after_any(&lower, &["sleep"]));
    }
    if contains_any(
        &lower,
        &["task capacity", "capacity", "available work hours"],
    ) {
        update.task_capacity_hours_per_day = first_number_before_any(
            &lower,
            &["hours per day", "hours/day", "hrs per day", "hrs/day"],
        )
        .or_else(|| first_number_after_any(&lower, &["task capacity", "capacity"]));
    }
    if lower.contains("exercise") {
        update.exercise_minutes_needed = parse_minutes_for_need(&lower, "exercise");
    }
    if contains_any(&lower, &["socialization", "social time"]) {
        update.socialization_minutes_needed = parse_minutes_for_need(&lower, "socialization")
            .or_else(|| parse_minutes_for_need(&lower, "social time"));
    }
    if contains_any(&lower, &["self-care", "self care"]) {
        update.self_care_minutes_needed = parse_minutes_for_need(&lower, "self-care")
            .or_else(|| parse_minutes_for_need(&lower, "self care"));
    }

    if contains_any(
        &lower,
        &[
            "i prefer",
            "prefer to",
            "i like",
            "i work best",
            "works best for me",
            "best before",
            "best after",
        ],
    ) {
        update.likes_to_add.push(detail.to_string());
    } else if contains_any(
        &lower,
        &[
            "i don't like",
            "i dont like",
            "i do not like",
            "i dislike",
            "prefer not",
        ],
    ) {
        update.dislikes_to_add.push(detail.to_string());
    } else if contains_any(
        &lower,
        &[
            "i can't",
            "i cant",
            "i cannot",
            "need to avoid",
            "avoid ",
            "limitation",
        ],
    ) {
        update.limitations_to_add.push(detail.to_string());
    } else if explicit_memory_request
        && update.sleep_hours_needed.is_none()
        && update.task_capacity_hours_per_day.is_none()
        && update.exercise_minutes_needed.is_none()
        && update.socialization_minutes_needed.is_none()
        && update.self_care_minutes_needed.is_none()
    {
        update.notes_to_add.push(detail.to_string());
    }
}

fn fallback_memory_update_from_chat_message(message: &str) -> AssistantMemoryUpdate {
    if user_message_requests_memory_removal(message) {
        return AssistantMemoryUpdate::default();
    }

    let explicit_detail = strip_memory_directive(message);
    let detail = explicit_detail
        .as_deref()
        .and_then(clean_memory_detail)
        .or_else(|| clean_memory_detail(message));
    let Some(detail) = detail else {
        return AssistantMemoryUpdate::default();
    };
    if memory_detail_contains_secret(&detail) {
        return AssistantMemoryUpdate::default();
    }

    let explicit_memory_request = explicit_detail.is_some();
    let mut update = AssistantMemoryUpdate {
        reason: Some("user said this in chat".to_string()),
        confirmed_by_user: explicit_memory_request,
        sensitive: memory_detail_requires_confirmation(&detail),
        ..AssistantMemoryUpdate::default()
    };
    apply_memory_detail_to_update(&mut update, &detail, explicit_memory_request);

    update
}

fn goal_title_slug(title: &str) -> String {
    let mut slug = String::new();
    let mut pending_separator = false;
    for ch in title.chars() {
        if ch.is_ascii_alphanumeric() {
            if pending_separator && !slug.is_empty() {
                slug.push('_');
            }
            slug.push(ch.to_ascii_lowercase());
            pending_separator = false;
        } else {
            pending_separator = true;
        }
        if slug.len() >= 48 {
            break;
        }
    }

    if slug.is_empty() {
        "untitled_goal".to_string()
    } else {
        slug.trim_matches('_').to_string()
    }
}

fn goal_id_exists(vault: &vault_core::VaultManager, goal_id: &str) -> bool {
    vault.goal_markdown_path(goal_id).ok().flatten().is_some()
}

fn unique_assistant_goal_id(
    vault: &vault_core::VaultManager,
    requested_id: Option<&str>,
    title: &str,
) -> String {
    let base = requested_id
        .map(sanitize_task_id)
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| format!("goal_{}", goal_title_slug(title)));
    let base = if base.starts_with("goal_") {
        base
    } else {
        format!("goal_{base}")
    };
    let base = sanitize_task_id(&base);

    for index in 0..100 {
        let candidate = if index == 0 {
            base.clone()
        } else {
            sanitize_task_id(&format!("{base}_{index}"))
        };
        if !candidate.is_empty() && !goal_id_exists(vault, &candidate) {
            return candidate;
        }
    }

    format!(
        "goal_{}",
        &uuid::Uuid::new_v4().to_string().replace('-', "")[..12]
    )
}

fn set_frontmatter_string(
    frontmatter: &mut markdown_parser::Frontmatter,
    key: &str,
    value: String,
) -> bool {
    if frontmatter.get(key).and_then(|v| v.as_str()) == Some(value.as_str()) {
        return false;
    }
    frontmatter.insert(key.to_string(), serde_yaml::Value::String(value));
    true
}

fn assistant_task_frontmatter(task_id: String, title: String, goal_id: &str) -> serde_yaml::Value {
    let mut map = serde_yaml::Mapping::new();
    map.insert("id".into(), serde_yaml::Value::String(task_id));
    map.insert("title".into(), serde_yaml::Value::String(title));
    map.insert(
        "status".into(),
        serde_yaml::Value::String("todo".to_string()),
    );
    map.insert(
        "parent_goal_id".into(),
        serde_yaml::Value::String(goal_id.to_string()),
    );
    serde_yaml::Value::Mapping(map)
}

fn task_value_id(value: &serde_yaml::Value) -> Option<&str> {
    value.get("id").and_then(|v| v.as_str())
}

fn task_value_contains_id(value: &serde_yaml::Value, task_id: &str) -> bool {
    if task_value_id(value) == Some(task_id) {
        return true;
    }

    value
        .get("subtasks")
        .and_then(|v| v.as_sequence())
        .is_some_and(|subtasks| {
            subtasks
                .iter()
                .any(|subtask| task_value_contains_id(subtask, task_id))
        })
}

fn goal_frontmatter_contains_task_id(fm: &markdown_parser::Frontmatter, task_id: &str) -> bool {
    fm.get("tasks")
        .and_then(|v| v.as_sequence())
        .is_some_and(|tasks| {
            tasks
                .iter()
                .any(|task| task_value_contains_id(task, task_id))
        })
}

fn unique_assistant_task_id(
    fm: &markdown_parser::Frontmatter,
    requested_id: Option<&str>,
    title: &str,
    is_subtask: bool,
) -> String {
    let prefix = if is_subtask { "sub_" } else { "task_" };
    let base = requested_id
        .map(sanitize_task_id)
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| format!("{prefix}{}", goal_title_slug(title)));
    let base = if base.starts_with("task_") || base.starts_with("sub_") {
        base
    } else {
        format!("{prefix}{base}")
    };
    let base = sanitize_task_id(&base);

    for index in 0..100 {
        let candidate = if index == 0 {
            base.clone()
        } else {
            sanitize_task_id(&format!("{base}_{index}"))
        };
        if !candidate.is_empty() && !goal_frontmatter_contains_task_id(fm, &candidate) {
            return candidate;
        }
    }

    format!(
        "{prefix}{}",
        &uuid::Uuid::new_v4().to_string().replace('-', "")[..12]
    )
}

fn task_mapping_set_string(map: &mut serde_yaml::Mapping, key: &str, value: String) -> bool {
    if map
        .get(serde_yaml::Value::String(key.to_string()))
        .and_then(|value| value.as_str())
        == Some(value.as_str())
    {
        return false;
    }
    map.insert(key.into(), serde_yaml::Value::String(value));
    true
}

fn task_mapping_set_status(map: &mut serde_yaml::Mapping, status: String) -> bool {
    let mut changed = task_mapping_set_string(map, "status", status.clone());
    if status == "completed" {
        if !map.contains_key("completed_at") && !map.contains_key("completedAt") {
            map.insert(
                "completed_at".into(),
                serde_yaml::Value::String(chrono::Utc::now().to_rfc3339()),
            );
            changed = true;
        }
    } else {
        changed |= map.remove("completed_at").is_some();
        changed |= map.remove("completedAt").is_some();
    }
    changed
}

fn task_mapping_set_due_date(map: &mut serde_yaml::Mapping, due_date: String) -> bool {
    let mut changed = task_mapping_set_string(map, "due_date", due_date);
    changed |= map.remove("dueDate").is_some();
    changed
}

fn task_mapping_set_scheduled_date(map: &mut serde_yaml::Mapping, scheduled_date: String) -> bool {
    let mut changed = task_mapping_set_string(map, "scheduled_date", scheduled_date);
    changed |= map.remove("scheduledDate").is_some();
    changed |= map.remove("scheduled_for").is_some();
    changed |= map.remove("scheduledFor").is_some();
    changed
}

fn assistant_roadmap_task_frontmatter(
    task_id: String,
    task: &AssistantTaskAdd,
) -> serde_yaml::Value {
    let mut map = serde_yaml::Mapping::new();
    map.insert("id".into(), serde_yaml::Value::String(task_id));
    map.insert(
        "title".into(),
        serde_yaml::Value::String(task.title.clone()),
    );
    map.insert(
        "status".into(),
        serde_yaml::Value::String(task.status.clone().unwrap_or_else(|| "todo".to_string())),
    );
    if let Some(parent_task_id) = &task.parent_task_id {
        map.insert(
            "parent_id".into(),
            serde_yaml::Value::String(parent_task_id.clone()),
        );
    } else {
        map.insert(
            "parent_goal_id".into(),
            serde_yaml::Value::String(task.goal_id.clone()),
        );
    }
    if let Some(due_date) = &task.due_date {
        map.insert(
            "due_date".into(),
            serde_yaml::Value::String(due_date.clone()),
        );
    }
    if let Some(scheduled_date) = &task.scheduled_date {
        map.insert(
            "scheduled_date".into(),
            serde_yaml::Value::String(scheduled_date.clone()),
        );
    }
    if let Some(recurring) = &task.recurring {
        map.insert(
            "recurring".into(),
            serde_yaml::Value::String(recurring.clone()),
        );
    }
    if let Some(priority) = &task.priority {
        map.insert(
            "priority".into(),
            serde_yaml::Value::String(priority.clone()),
        );
    }
    if let Some(quadrant) = &task.eisenhower_quadrant {
        map.insert(
            "eisenhower_quadrant".into(),
            serde_yaml::Value::String(quadrant.clone()),
        );
        map.insert(
            "priority_color".into(),
            serde_yaml::Value::String(eisenhower_color_token(quadrant).to_string()),
        );
    }

    serde_yaml::Value::Mapping(map)
}

fn add_subtask_to_task_value(
    value: &mut serde_yaml::Value,
    parent_task_id: &str,
    subtask: serde_yaml::Value,
) -> bool {
    if task_value_id(value) == Some(parent_task_id) {
        if let Some(map) = value.as_mapping_mut() {
            if !map.contains_key("subtasks") {
                map.insert("subtasks".into(), serde_yaml::Value::Sequence(Vec::new()));
            }
            if let Some(subtasks) = map.get_mut("subtasks").and_then(|v| v.as_sequence_mut()) {
                subtasks.push(subtask);
                return true;
            }
        }
        return false;
    }

    value
        .get_mut("subtasks")
        .and_then(|v| v.as_sequence_mut())
        .is_some_and(|subtasks| {
            subtasks.iter_mut().any(|existing| {
                add_subtask_to_task_value(existing, parent_task_id, subtask.clone())
            })
        })
}

fn apply_assistant_task_add_to_goal(
    fm: &mut markdown_parser::Frontmatter,
    task: &AssistantTaskAdd,
) -> Result<(), AppError> {
    let task_id = unique_assistant_task_id(
        fm,
        task.requested_id.as_deref(),
        &task.title,
        task.parent_task_id.is_some(),
    );
    let task_value = assistant_roadmap_task_frontmatter(task_id, task);

    if !fm.contains_key("tasks") {
        fm.insert("tasks".into(), serde_yaml::Value::Sequence(Vec::new()));
    }
    let Some(task_seq) = fm
        .get_mut("tasks")
        .and_then(|value| value.as_sequence_mut())
    else {
        return Err(AppError::validation_error(
            "Goal tasks frontmatter must be a list before Assistant can add a Task",
        ));
    };

    if let Some(parent_task_id) = &task.parent_task_id {
        if task_seq
            .iter_mut()
            .any(|existing| add_subtask_to_task_value(existing, parent_task_id, task_value.clone()))
        {
            return Ok(());
        }
        return Err(AppError::item_not_found("Task", parent_task_id));
    }

    task_seq.push(task_value);
    Ok(())
}

fn apply_assistant_task_edit_to_mapping(
    map: &mut serde_yaml::Mapping,
    task: &AssistantTaskEdit,
) -> bool {
    let mut changed = false;
    if let Some(title) = &task.title {
        changed |= task_mapping_set_string(map, "title", title.clone());
    }
    if let Some(status) = &task.status {
        changed |= task_mapping_set_status(map, status.clone());
    }
    if let Some(due_date) = &task.due_date {
        changed |= task_mapping_set_due_date(map, due_date.clone());
    }
    if let Some(scheduled_date) = &task.scheduled_date {
        changed |= task_mapping_set_scheduled_date(map, scheduled_date.clone());
    }
    if let Some(recurring) = &task.recurring {
        changed |= task_mapping_set_string(map, "recurring", recurring.clone());
        changed |= map.remove("recurrence").is_some();
    }
    if let Some(priority) = &task.priority {
        changed |= task_mapping_set_string(map, "priority", priority.clone());
    }
    if let Some(quadrant) = &task.eisenhower_quadrant {
        changed |= task_mapping_set_string(map, "eisenhower_quadrant", quadrant.clone());
        changed |= task_mapping_set_string(
            map,
            "priority_color",
            eisenhower_color_token(quadrant).to_string(),
        );
    }
    changed
}

fn apply_assistant_task_edit_to_value(
    value: &mut serde_yaml::Value,
    task: &AssistantTaskEdit,
) -> (bool, bool) {
    if task_value_id(value) == Some(task.task_id.as_str()) {
        let changed = value
            .as_mapping_mut()
            .is_some_and(|map| apply_assistant_task_edit_to_mapping(map, task));
        return (true, changed);
    }

    let Some(subtasks) = value.get_mut("subtasks").and_then(|v| v.as_sequence_mut()) else {
        return (false, false);
    };
    for subtask in subtasks {
        let (found, changed) = apply_assistant_task_edit_to_value(subtask, task);
        if found {
            return (true, changed);
        }
    }
    (false, false)
}

fn create_assistant_goal(
    vault: &vault_core::VaultManager,
    goal: &AssistantGoalCreate,
) -> Result<(), AppError> {
    let goal_id = unique_assistant_goal_id(vault, goal.requested_id.as_deref(), &goal.title);
    let now = chrono::Utc::now().to_rfc3339();
    let domain = goal
        .domain
        .clone()
        .unwrap_or_else(|| "Personal".to_string());
    let priority = goal.priority.clone().unwrap_or_else(|| {
        if goal.eisenhower_quadrant.as_deref() == Some("do") {
            "high".to_string()
        } else {
            "medium".to_string()
        }
    });
    let quadrant = goal
        .eisenhower_quadrant
        .clone()
        .unwrap_or_else(|| legacy_priority_to_eisenhower(Some(&priority)));

    let mut frontmatter = markdown_parser::Frontmatter::new();
    frontmatter.insert("id".into(), serde_yaml::Value::String(goal_id.clone()));
    frontmatter.insert("type".into(), serde_yaml::Value::String("goal".to_string()));
    frontmatter.insert(
        "title".into(),
        serde_yaml::Value::String(goal.title.clone()),
    );
    frontmatter.insert("domain".into(), serde_yaml::Value::String(domain.clone()));
    frontmatter.insert(
        "status".into(),
        serde_yaml::Value::String("active".to_string()),
    );
    frontmatter.insert(
        "lifecycle".into(),
        serde_yaml::Value::String("active".to_string()),
    );
    frontmatter.insert(
        "visibility".into(),
        serde_yaml::Value::String("private".to_string()),
    );
    frontmatter.insert(
        "owner".into(),
        serde_yaml::Value::String("local_user".to_string()),
    );
    frontmatter.insert(
        "collaborators".into(),
        serde_yaml::Value::Sequence(Vec::new()),
    );
    frontmatter.insert("priority".into(), serde_yaml::Value::String(priority));
    frontmatter.insert(
        "eisenhower_quadrant".into(),
        serde_yaml::Value::String(quadrant.clone()),
    );
    frontmatter.insert(
        "priority_color".into(),
        serde_yaml::Value::String(eisenhower_color_token(&quadrant).to_string()),
    );
    if let Some(deadline) = &goal.deadline {
        frontmatter.insert(
            "deadline".into(),
            serde_yaml::Value::String(deadline.clone()),
        );
    }
    if let Some(success_metric) = &goal.success_metric {
        frontmatter.insert(
            "success_metric".into(),
            serde_yaml::Value::String(success_metric.clone()),
        );
    }
    frontmatter.insert(
        "tags".into(),
        serde_yaml::Value::Sequence(vec![serde_yaml::Value::String(domain)]),
    );
    frontmatter.insert("created".into(), serde_yaml::Value::String(now.clone()));
    frontmatter.insert("updated".into(), serde_yaml::Value::String(now));

    if !goal.tasks.is_empty() {
        let tasks = goal
            .tasks
            .iter()
            .map(|title| {
                assistant_task_frontmatter(
                    format!(
                        "task_{}",
                        &uuid::Uuid::new_v4().to_string().replace('-', "")[..8]
                    ),
                    title.clone(),
                    &goal_id,
                )
            })
            .collect();
        frontmatter.insert("tasks".into(), serde_yaml::Value::Sequence(tasks));
    }

    write_assistant_goal_mutation(
        vault,
        &goal_id,
        &frontmatter,
        goal.notes.as_deref().unwrap_or(""),
        "assistant_chat_add_goal",
    )?;

    Ok(())
}

fn edit_assistant_goal(
    vault: &vault_core::VaultManager,
    goal: &AssistantGoalEdit,
) -> Result<bool, AppError> {
    let (mut frontmatter, mut body) = vault.read_goal(&goal.goal_id)?;
    let mut changed = false;

    if let Some(title) = &goal.title {
        changed |= set_frontmatter_string(&mut frontmatter, "title", title.clone());
    }
    if let Some(domain) = &goal.domain {
        changed |= set_frontmatter_string(&mut frontmatter, "type", "goal".to_string());
        changed |= set_frontmatter_string(&mut frontmatter, "domain", domain.clone());
    }
    if let Some(deadline) = &goal.deadline {
        changed |= set_frontmatter_string(&mut frontmatter, "deadline", deadline.clone());
    }
    if let Some(success_metric) = &goal.success_metric {
        changed |=
            set_frontmatter_string(&mut frontmatter, "success_metric", success_metric.clone());
    }
    if let Some(priority) = &goal.priority {
        changed |= set_frontmatter_string(&mut frontmatter, "priority", priority.clone());
    }
    if let Some(quadrant) = &goal.eisenhower_quadrant {
        changed |=
            set_frontmatter_string(&mut frontmatter, "eisenhower_quadrant", quadrant.clone());
        changed |= set_frontmatter_string(
            &mut frontmatter,
            "priority_color",
            eisenhower_color_token(quadrant).to_string(),
        );
    }
    if let Some(status) = &goal.status {
        changed |= set_frontmatter_string(&mut frontmatter, "status", status.clone());
        changed |= set_frontmatter_string(&mut frontmatter, "lifecycle", status.clone());
    }
    if let Some(notes) = &goal.notes {
        if body.trim() != notes.trim() {
            body = notes.clone();
            changed = true;
        }
    }

    if !changed {
        return Ok(false);
    }

    frontmatter.insert(
        "updated".into(),
        serde_yaml::Value::String(chrono::Utc::now().to_rfc3339()),
    );
    write_assistant_goal_mutation(
        vault,
        &goal.goal_id,
        &frontmatter,
        &body,
        "assistant_chat_edit_goal",
    )?;

    Ok(true)
}

fn add_assistant_task(
    vault: &vault_core::VaultManager,
    task: &AssistantTaskAdd,
) -> Result<bool, AppError> {
    let (mut frontmatter, body) = vault.read_goal(&task.goal_id)?;
    apply_assistant_task_add_to_goal(&mut frontmatter, task)?;
    frontmatter.insert(
        "updated".into(),
        serde_yaml::Value::String(chrono::Utc::now().to_rfc3339()),
    );
    validate_goal_frontmatter_tasks_for_write(vault, &task.goal_id, &frontmatter)?;
    write_assistant_goal_mutation(
        vault,
        &task.goal_id,
        &frontmatter,
        &body,
        "assistant_chat_add_roadmap_task",
    )?;

    Ok(true)
}

fn edit_assistant_task(
    vault: &vault_core::VaultManager,
    task: &AssistantTaskEdit,
) -> Result<bool, AppError> {
    let mut goal_ids = vault.list_goals().unwrap_or_default();
    if let Some(goal_id) = task
        .goal_id
        .as_deref()
        .filter(|goal_id| !goal_id.trim().is_empty())
    {
        goal_ids.retain(|existing| existing != goal_id);
        goal_ids.insert(0, goal_id.to_string());
    }

    for goal_id in goal_ids {
        let Ok((mut frontmatter, body)) = vault.read_goal(&goal_id) else {
            continue;
        };
        let Some(task_seq) = frontmatter
            .get_mut("tasks")
            .and_then(|value| value.as_sequence_mut())
        else {
            continue;
        };

        let mut found = false;
        let mut changed = false;
        for value in task_seq {
            let (task_found, task_changed) = apply_assistant_task_edit_to_value(value, task);
            if task_found {
                found = true;
                changed = task_changed;
                break;
            }
        }
        if !found {
            continue;
        }
        if !changed {
            return Ok(false);
        }

        frontmatter.insert(
            "updated".into(),
            serde_yaml::Value::String(chrono::Utc::now().to_rfc3339()),
        );
        validate_goal_frontmatter_tasks_for_write(vault, &goal_id, &frontmatter)?;
        write_assistant_goal_mutation(
            vault,
            &goal_id,
            &frontmatter,
            &body,
            "assistant_chat_edit_roadmap_task",
        )?;
        return Ok(true);
    }

    Ok(false)
}

fn apply_assistant_roadmap_update(
    vault_id: &str,
    app_state: &AppState,
    update: &AssistantRoadmapUpdate,
) -> Result<AssistantRoadmapMutationResult, AppError> {
    if update.is_empty() {
        return Ok(AssistantRoadmapMutationResult::default());
    }

    let vaults = app_state
        .vaults
        .lock()
        .map_err(|e| AppError::new(ErrorCode::UnknownError, format!("Lock error: {e}")))?;
    let vault = vaults
        .get(vault_id)
        .ok_or_else(|| AppError::vault_not_open(vault_id))?;
    let mut result = AssistantRoadmapMutationResult::default();

    for goal in &update.goals_to_add {
        create_assistant_goal(vault, goal)?;
        result.goals_added += 1;
    }

    for goal in &update.goals_to_edit {
        if edit_assistant_goal(vault, goal)? {
            result.goals_edited += 1;
        }
    }

    for task in &update.tasks_to_add {
        if add_assistant_task(vault, task)? {
            result.tasks_added += 1;
        }
    }

    for task in &update.tasks_to_edit {
        if edit_assistant_task(vault, task)? {
            result.tasks_edited += 1;
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scheduled(task_id: &str, start_time: &str, duration_minutes: i32) -> agenda::ScheduledTask {
        agenda::ScheduledTask {
            id: format!("scheduled_{task_id}"),
            task_id: task_id.to_string(),
            title: task_id.trim_start_matches("task_").replace('_', " "),
            start_time: start_time.to_string(),
            duration_minutes,
            estimate_source: Some("ai".to_string()),
            eisenhower_quadrant: Some("do".to_string()),
        }
    }

    fn outcome(id: &str, title: &str, linked_task_ids: &[&str]) -> agenda::Outcome {
        agenda::Outcome {
            id: id.to_string(),
            daily_plan_id: "plan_today".to_string(),
            title: title.to_string(),
            linked_task_ids: linked_task_ids.iter().map(|id| id.to_string()).collect(),
            created_at: NaiveDate::from_ymd_opt(2026, 4, 26)
                .unwrap()
                .and_hms_opt(9, 0, 0)
                .unwrap(),
            ai_generated: true,
        }
    }

    #[test]
    fn ai_overload_retry_only_applies_to_first_529_response() {
        let overloaded = reqwest::StatusCode::from_u16(AI_OVERLOADED_STATUS_CODE).unwrap();

        assert!(should_retry_ai_response(overloaded, 0));
        assert!(!should_retry_ai_response(overloaded, 1));
        assert!(!should_retry_ai_response(
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            0
        ));
        assert!(!should_retry_ai_response(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            0
        ));
    }

    #[test]
    fn hosted_ai_reroutes_provider_models_to_goalrate_fair_use_route() {
        assert_eq!(
            hosted_ai_route_model_id("anthropic::claude-sonnet-4-5-20250929"),
            HOSTED_AI_PRIMARY_ROUTE_MODEL_ID
        );
        assert_eq!(
            hosted_ai_route_model_id("openai::gpt-5.4"),
            HOSTED_AI_PRIMARY_ROUTE_MODEL_ID
        );
    }

    #[test]
    fn hosted_ai_preserves_goalrate_route_model_ids() {
        assert_eq!(
            hosted_ai_route_model_id("goalrate::agenda-high-quality"),
            "goalrate::agenda-high-quality"
        );
    }

    #[test]
    fn hosted_ai_uses_backfill_for_unavailable_models_without_bypassing_limits() {
        assert!(hosted_ai_model_unavailable(
            reqwest::StatusCode::UNPROCESSABLE_ENTITY,
            r#"{"message":"model goalrate::agenda-balanced is unavailable"}"#,
        ));
        assert!(!hosted_ai_model_unavailable(
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            r#"{"message":"fair-use limit reached"}"#,
        ));
        assert_eq!(
            hosted_ai_backfill_model_id(HOSTED_AI_PRIMARY_ROUTE_MODEL_ID),
            Some(HOSTED_AI_BACKFILL_ROUTE_MODEL_ID)
        );
        assert_eq!(
            hosted_ai_backfill_model_id(HOSTED_AI_BACKFILL_ROUTE_MODEL_ID),
            None
        );
    }

    #[test]
    fn generated_plan_response_includes_visible_task_titles() {
        let parsed: Value = serde_json::from_str(
            r#"{
              "ordered_tasks": [
                {"id": "task_1", "title": "Finish core feature implementation", "goal_id": "goal_mock_launch", "recurring": "none"},
                {"id": "task_2", "title": "Run acceptance checks", "goal_id": "goal_mock_launch", "recurring": "none"},
                {"id": "task_3", "title": "Review open pull requests", "goal_id": "goal_mock_review", "recurring": "none"},
                {"id": "task_4", "title": "Assemble sprint demo notes", "goal_id": "goal_mock_demo", "recurring": "none"}
              ]
            }"#,
        )
        .unwrap();
        let ordered = parse_ordered_tasks_from_ai(&parsed, &std::collections::HashMap::new());

        assert_eq!(
            ordered.ordered_task_ids,
            vec![
                "task_1".to_string(),
                "task_2".to_string(),
                "task_3".to_string(),
                "task_4".to_string()
            ]
        );
        assert_eq!(
            ordered.task_titles.get("task_1").map(String::as_str),
            Some("Finish core feature implementation")
        );
        assert_eq!(
            ordered.task_titles.get("task_4").map(String::as_str),
            Some("Assemble sprint demo notes")
        );
    }

    #[test]
    fn id_only_plan_responses_use_vault_titles_for_visible_rows() {
        let tasks = vec![(
            "task_alpha".to_string(),
            "Alpha task from Roadmap".to_string(),
            Some("Launch".to_string()),
            None,
            0,
            None,
            false,
            "do".to_string(),
        )];
        let vault_titles = vault_task_title_lookup(&tasks);
        let parsed = json!({
            "ordered_tasks": ["task_alpha"],
            "scheduled_tasks": [
                {
                    "task_id": "task_alpha",
                    "title": "alpha",
                    "start_time": "9:00 AM",
                    "duration_minutes": 30
                }
            ]
        });

        let ordered = parse_ordered_tasks_from_ai(&parsed, &vault_titles);
        let mut scheduled_tasks = parse_ai_scheduled_tasks(&parsed);
        apply_known_titles_to_scheduled_tasks(
            &mut scheduled_tasks,
            &ordered.task_titles,
            &vault_titles,
        );

        assert_eq!(
            ordered.task_titles.get("task_alpha").map(String::as_str),
            Some("Alpha task from Roadmap")
        );
        assert_eq!(scheduled_tasks[0].title, "Alpha task from Roadmap");
    }

    #[test]
    fn gather_vault_context_logs_invalid_goal_task_rows_and_uses_subtasks() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-assistant-context-invalid-task-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Assistant Context Invalid Task Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();
        let error_log_path = manager.structure().error_log.clone();

        let mut valid_subtask = serde_yaml::Mapping::new();
        valid_subtask.insert(
            serde_yaml::Value::String("id".to_string()),
            serde_yaml::Value::String("task_child".to_string()),
        );
        valid_subtask.insert(
            serde_yaml::Value::String("title".to_string()),
            serde_yaml::Value::String("Do first child action".to_string()),
        );
        valid_subtask.insert(
            serde_yaml::Value::String("status".to_string()),
            serde_yaml::Value::String("todo".to_string()),
        );

        let mut invalid_subtask = serde_yaml::Mapping::new();
        invalid_subtask.insert(
            serde_yaml::Value::String("id".to_string()),
            serde_yaml::Value::String("task_invalid_child".to_string()),
        );
        invalid_subtask.insert(
            serde_yaml::Value::String("status".to_string()),
            serde_yaml::Value::String("todo".to_string()),
        );

        let mut parent_task = serde_yaml::Mapping::new();
        parent_task.insert(
            serde_yaml::Value::String("id".to_string()),
            serde_yaml::Value::String("task_parent".to_string()),
        );
        parent_task.insert(
            serde_yaml::Value::String("title".to_string()),
            serde_yaml::Value::String("Parent task".to_string()),
        );
        parent_task.insert(
            serde_yaml::Value::String("status".to_string()),
            serde_yaml::Value::String("todo".to_string()),
        );
        parent_task.insert(
            serde_yaml::Value::String("subtasks".to_string()),
            serde_yaml::Value::Sequence(vec![
                serde_yaml::Value::Mapping(valid_subtask),
                serde_yaml::Value::Mapping(invalid_subtask),
            ]),
        );

        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert(
            "id".into(),
            serde_yaml::Value::String("goal_context".to_string()),
        );
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Context Goal".to_string()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("goal".to_string()));
        frontmatter.insert(
            "status".into(),
            serde_yaml::Value::String("active".to_string()),
        );
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(parent_task)]),
        );
        manager
            .write_goal("goal_context", &frontmatter, "Context notes")
            .unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let (_goals, tasks) = gather_vault_context(
            &vault_id,
            &app_state,
            NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
        )
        .unwrap();
        let task_ids: Vec<_> = tasks.iter().map(|task| task.0.as_str()).collect();

        assert!(task_ids.contains(&"task_child"));
        assert!(!task_ids.contains(&"task_parent"));
        assert!(!task_ids.contains(&"task_invalid_child"));
        let child = tasks
            .iter()
            .find(|task| task.0 == "task_child")
            .expect("valid subtask should be available to the Assistant");
        assert_eq!(child.5.as_deref(), Some("task_parent"));

        let error_log = std::fs::read_to_string(error_log_path).unwrap();
        assert!(error_log.contains("goals/goal_context.md"));
        assert!(error_log.contains("tasks[0].subtasks[1].title"));

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn gather_vault_context_limits_specific_day_tasks_to_that_agenda_date() {
        let vault_root = std::env::temp_dir().join(format!(
            "goalrate-assistant-specific-day-context-{}",
            uuid::Uuid::new_v4()
        ));
        let manager = vault_core::VaultManager::create(
            "Assistant Specific Day Context Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let task = |id: &str, title: &str, scheduled_date: Option<&str>| {
            let mut map = serde_yaml::Mapping::new();
            map.insert("id".into(), serde_yaml::Value::String(id.to_string()));
            map.insert("title".into(), serde_yaml::Value::String(title.to_string()));
            map.insert(
                "status".into(),
                serde_yaml::Value::String("todo".to_string()),
            );
            if let Some(date) = scheduled_date {
                map.insert(
                    "scheduled_date".into(),
                    serde_yaml::Value::String(date.to_string()),
                );
            }
            serde_yaml::Value::Mapping(map)
        };

        let mut child = serde_yaml::Mapping::new();
        child.insert(
            serde_yaml::Value::String("id".to_string()),
            serde_yaml::Value::String("subtask_exact_child".to_string()),
        );
        child.insert(
            serde_yaml::Value::String("title".to_string()),
            serde_yaml::Value::String("Exact child task".to_string()),
        );
        child.insert(
            serde_yaml::Value::String("status".to_string()),
            serde_yaml::Value::String("todo".to_string()),
        );
        let mut parent = serde_yaml::Mapping::new();
        parent.insert(
            serde_yaml::Value::String("id".to_string()),
            serde_yaml::Value::String("task_parent_exact".to_string()),
        );
        parent.insert(
            serde_yaml::Value::String("title".to_string()),
            serde_yaml::Value::String("Exact parent task".to_string()),
        );
        parent.insert(
            serde_yaml::Value::String("status".to_string()),
            serde_yaml::Value::String("todo".to_string()),
        );
        parent.insert(
            serde_yaml::Value::String("scheduled_date".to_string()),
            serde_yaml::Value::String("2026-04-27".to_string()),
        );
        parent.insert(
            serde_yaml::Value::String("subtasks".to_string()),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(child)]),
        );

        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert(
            "id".into(),
            serde_yaml::Value::String("goal_specific_context".to_string()),
        );
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Specific Context Goal".to_string()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("goal".to_string()));
        frontmatter.insert(
            "status".into(),
            serde_yaml::Value::String("active".to_string()),
        );
        frontmatter.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![
                task("task_flexible", "Flexible task", None),
                task("task_today", "Today only task", Some("2026-04-27")),
                task("task_other_day", "Other day task", Some("2026-04-28")),
                serde_yaml::Value::Mapping(parent),
            ]),
        );
        manager
            .write_goal(
                "goal_specific_context",
                &frontmatter,
                "Specific context notes",
            )
            .unwrap();

        let app_state = crate::commands::vault::AppState::default();
        let vault_id = format!("vault_{}", uuid::Uuid::new_v4().simple());
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert(vault_id.clone(), manager);

        let (_goals, exact_day_tasks) = gather_vault_context(
            &vault_id,
            &app_state,
            NaiveDate::from_ymd_opt(2026, 4, 27).unwrap(),
        )
        .unwrap();
        let exact_day_ids: Vec<_> = exact_day_tasks.iter().map(|task| task.0.as_str()).collect();

        assert!(exact_day_ids.contains(&"task_flexible"));
        assert!(exact_day_ids.contains(&"task_today"));
        assert!(exact_day_ids.contains(&"subtask_exact_child"));
        assert!(!exact_day_ids.contains(&"task_parent_exact"));
        assert!(!exact_day_ids.contains(&"task_other_day"));

        let (_goals, following_day_tasks) = gather_vault_context(
            &vault_id,
            &app_state,
            NaiveDate::from_ymd_opt(2026, 4, 28).unwrap(),
        )
        .unwrap();
        let following_day_ids: Vec<_> = following_day_tasks
            .iter()
            .map(|task| task.0.as_str())
            .collect();

        assert!(following_day_ids.contains(&"task_other_day"));
        assert!(!following_day_ids.contains(&"task_today"));
        assert!(!following_day_ids.contains(&"subtask_exact_child"));

        AGENDA_DBS.lock().unwrap().remove(&vault_id);
        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn merge_chat_schedule_updates_applies_single_reschedule_without_losing_other_rows() {
        let current = vec![
            scheduled("task_alpha", "9:00 AM", 30),
            scheduled("task_beta", "9:30 AM", 30),
        ];
        let update = vec![scheduled("task_beta", "2:00 PM", 45)];
        let order = vec!["task_alpha".to_string(), "task_beta".to_string()];

        let merged = merge_chat_schedule_updates(&current, &order, update, "reschedule");

        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].task_id, "task_alpha");
        assert_eq!(merged[0].start_time, "9:00 AM");
        assert_eq!(merged[1].task_id, "task_beta");
        assert_eq!(merged[1].start_time, "2:00 PM");
        assert_eq!(merged[1].duration_minutes, 45);
    }

    #[test]
    fn reorder_existing_schedule_assigns_existing_time_slots_without_schedule_payload() {
        let current = vec![
            scheduled("task_alpha", "9:00 AM", 30),
            scheduled("task_beta", "10:00 AM", 30),
            scheduled("task_gamma", "11:00 AM", 30),
        ];
        let order = vec![
            "task_beta".to_string(),
            "task_alpha".to_string(),
            "task_gamma".to_string(),
        ];

        let reordered = reorder_existing_schedule(&current, &order).unwrap();

        assert_eq!(
            reordered
                .iter()
                .map(|task| (task.task_id.as_str(), task.start_time.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("task_beta", "9:00 AM"),
                ("task_alpha", "10:00 AM"),
                ("task_gamma", "11:00 AM")
            ]
        );
    }

    #[test]
    fn reorder_schedule_with_partial_updates_still_rebuilds_visible_schedule() {
        let current = vec![
            scheduled("task_alpha", "9:00 AM", 30),
            scheduled("task_beta", "10:00 AM", 30),
            scheduled("task_gamma", "11:00 AM", 30),
        ];
        let mut beta_update = scheduled("task_beta", "2:00 PM", 45);
        beta_update.title = "Updated beta".into();
        let order = vec![
            "task_beta".to_string(),
            "task_alpha".to_string(),
            "task_gamma".to_string(),
        ];

        let reordered = reorder_schedule_with_partial_updates(&current, &order, &[beta_update])
            .expect("partial reorder should still produce visible rows");

        assert_eq!(
            reordered
                .iter()
                .map(|task| {
                    (
                        task.task_id.as_str(),
                        task.title.as_str(),
                        task.start_time.as_str(),
                    )
                })
                .collect::<Vec<_>>(),
            vec![
                ("task_beta", "Updated beta", "9:00 AM"),
                ("task_alpha", "alpha", "10:00 AM"),
                ("task_gamma", "gamma", "11:00 AM")
            ]
        );
    }

    #[test]
    fn agenda_actions_require_a_visible_agenda_change() {
        assert!(action_requires_visible_agenda_change("reorder"));
        assert!(action_requires_visible_agenda_change("reschedule"));
        assert!(action_requires_visible_agenda_change("add"));
        assert!(action_requires_visible_agenda_change("unexpected_action"));
        assert!(!action_requires_visible_agenda_change("update_outcomes"));
    }

    #[test]
    fn reorder_action_requires_actual_order_change() {
        assert!(!action_has_required_visible_effect(
            "reorder", false, false, false, true
        ));
        assert!(!action_has_required_visible_effect(
            "reorder", false, true, false, false
        ));
        assert!(action_has_required_visible_effect(
            "reorder", true, false, false, false
        ));
        assert!(action_has_required_visible_effect(
            "reorder", false, true, true, false
        ));
    }

    #[test]
    fn structured_reorder_uses_deterministic_success_copy() {
        assert_eq!(
            structured_agenda_update_message("reorder"),
            Some("I reordered your Agenda.")
        );
    }

    #[test]
    fn remove_action_removes_only_one_duplicate_task_id() {
        let current_order = vec![
            "task_laundry".to_string(),
            "task_laundry".to_string(),
            "task_breakfast".to_string(),
        ];

        let updated = remove_task_ids_once(&current_order, &["task_laundry".to_string()]);

        assert_eq!(
            updated,
            vec!["task_laundry".to_string(), "task_breakfast".to_string()]
        );
    }

    #[test]
    fn remove_action_can_target_second_duplicate_schedule_row() {
        let mut first = scheduled("task_laundry", "9:00 AM", 5);
        first.id = "scheduled_laundry_first".into();
        first.title = "Put clothes in the washer".into();
        let mut second = scheduled("task_laundry", "9:05 AM", 5);
        second.id = "scheduled_laundry_second".into();
        second.title = "Put clothes in the washer".into();
        let mut breakfast = scheduled("task_breakfast", "9:10 AM", 20);
        breakfast.title = "Eat breakfast".into();

        let updated = remove_scheduled_tasks_once(
            &[first, second, breakfast],
            &[("task_laundry".to_string(), Some("Put clothes in the washer".to_string()))],
            "At 9am you have Put clothes in the washer and then 5 minutes later Put clothes in the washer again. You can remove the second one.",
        )
        .expect("duplicate row should be removed");

        assert_eq!(
            updated
                .iter()
                .map(|task| (task.id.as_str(), task.start_time.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("scheduled_laundry_first", "9:00 AM"),
                ("scheduled_task_breakfast", "9:10 AM")
            ]
        );
    }

    #[test]
    fn between_task_request_inserts_visible_schedule_row() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 4, 26)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let mut washer = scheduled("task_put_dark_clothes_in_washer", "9:00 AM", 45);
        washer.title = "Put dark clothes in the washer".into();
        let mut dryer = scheduled("task_move_dark_clothes_to_dryer", "9:45 AM", 45);
        dryer.title = "Move dark clothes to the dryer".into();
        let mut light = scheduled("task_put_light_clothes_in_washer", "10:30 AM", 45);
        light.title = "Put light clothes in the washer".into();
        let mut afternoon = scheduled("task_fold_light_clothes", "1:30 PM", 45);
        afternoon.title = "Fold and put away light clothes".into();
        let plan = agenda::DailyPlan {
            id: "plan_today".into(),
            date: NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
            top_3_outcome_ids: Vec::new(),
            task_order: vec![
                "task_put_dark_clothes_in_washer".into(),
                "task_move_dark_clothes_to_dryer".into(),
                "task_put_light_clothes_in_washer".into(),
                "task_fold_light_clothes".into(),
            ],
            task_titles: std::collections::HashMap::new(),
            completed_task_ids: Vec::new(),
            generated_at: Some("2026-04-26T09:00:00-07:00".into()),
            scheduled_tasks: vec![washer, afternoon, dryer, light],
            locked_at: None,
            created_at: now,
            updated_at: now,
        };
        let candidates = vec![(
            "task_eat_breakfast_with_eleanor".to_string(),
            "Eat breakfast with Eleanor".to_string(),
            Some("Health".to_string()),
            None,
            0,
            None,
            false,
            "do".to_string(),
        )];

        let (adjusted, title) = insert_between_agenda_tasks_update(
            &plan,
            "Put dark clothes in the washer is a 5 minute task, but the next laundry task should be 45 minutes later. So, let’s put another task in between those laundry tasks. Maybe Eat breakfast?",
            &candidates,
        )
        .expect("between-task request should create a visible Agenda row");

        assert_eq!(title, "Eat breakfast with Eleanor");
        assert_eq!(
            adjusted
                .scheduled_tasks
                .iter()
                .map(|task| {
                    (
                        task.title.as_str(),
                        task.start_time.as_str(),
                        task.duration_minutes,
                    )
                })
                .collect::<Vec<_>>(),
            vec![
                ("Put dark clothes in the washer", "9:00 AM", 5),
                ("Eat breakfast with Eleanor", "9:05 AM", 40),
                ("Move dark clothes to the dryer", "9:45 AM", 45),
                ("Put light clothes in the washer", "10:30 AM", 45),
                ("Fold and put away light clothes", "1:30 PM", 45)
            ]
        );
    }

    #[test]
    fn morning_routine_request_inserts_rows_after_breakfast() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 4, 26)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let mut washer = scheduled("task_put_dark_clothes_in_washer", "9:00 AM", 5);
        washer.title = "Put dark clothes in the washer".into();
        let mut breakfast = scheduled("task_eat_breakfast_with_eleanor", "9:05 AM", 20);
        breakfast.title = "Eat breakfast with Eleanor".into();
        let mut dryer = scheduled("task_move_dark_clothes_to_dryer", "9:45 AM", 45);
        dryer.title = "Move dark clothes to the dryer".into();
        let plan = agenda::DailyPlan {
            id: "plan_today".into(),
            date: NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
            top_3_outcome_ids: Vec::new(),
            task_order: vec![
                "task_put_dark_clothes_in_washer".into(),
                "task_eat_breakfast_with_eleanor".into(),
                "task_move_dark_clothes_to_dryer".into(),
            ],
            task_titles: std::collections::HashMap::new(),
            completed_task_ids: Vec::new(),
            generated_at: Some("2026-04-26T09:00:00-07:00".into()),
            scheduled_tasks: vec![washer, breakfast, dryer],
            locked_at: None,
            created_at: now,
            updated_at: now,
        };

        let adjusted = insert_morning_routine_after_breakfast_update(
            &plan,
            "Would need to shower before doing hair. Put shower after eat breakfast. Then get dressed, brush teeth, do hair.",
            "",
        )
        .expect("morning routine rows should fit after breakfast");

        assert_eq!(
            adjusted
                .scheduled_tasks
                .iter()
                .map(|task| (task.title.as_str(), task.start_time.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("Put dark clothes in the washer", "9:00 AM"),
                ("Eat breakfast with Eleanor", "9:05 AM"),
                ("Shower", "9:25 AM"),
                ("Get dressed", "9:30 AM"),
                ("Brush teeth", "9:35 AM"),
                ("Do hair", "9:40 AM"),
                ("Move dark clothes to the dryer", "9:45 AM")
            ]
        );
    }

    #[test]
    fn morning_routine_uses_recent_breakfast_duration_hint_and_dedupes() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 4, 26)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let mut washer = scheduled("task_put_dark_clothes_in_washer", "9:00 AM", 5);
        washer.title = "Put dark clothes in the washer".into();
        let mut breakfast = scheduled("task_eat_breakfast_with_eleanor", "9:05 AM", 40);
        breakfast.title = "Eat breakfast with Eleanor".into();
        let mut duplicate_breakfast = scheduled("task_eat_breakfast_with_eleanor", "4:00 PM", 30);
        duplicate_breakfast.title = "Eat breakfast with Eleanor".into();
        let mut dryer = scheduled("task_move_dark_clothes_to_dryer", "9:45 AM", 45);
        dryer.title = "Move dark clothes to the dryer".into();
        let plan = agenda::DailyPlan {
            id: "plan_today".into(),
            date: NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
            top_3_outcome_ids: Vec::new(),
            task_order: vec![
                "task_put_dark_clothes_in_washer".into(),
                "task_eat_breakfast_with_eleanor".into(),
                "task_eat_breakfast_with_eleanor".into(),
                "task_move_dark_clothes_to_dryer".into(),
            ],
            task_titles: std::collections::HashMap::new(),
            completed_task_ids: Vec::new(),
            generated_at: Some("2026-04-26T09:00:00-07:00".into()),
            scheduled_tasks: vec![washer, duplicate_breakfast, breakfast, dryer],
            locked_at: None,
            created_at: now,
            updated_at: now,
        };

        let adjusted = insert_morning_routine_after_breakfast_update(
            &plan,
            "Would need to shower before doing hair. Put shower after eat breakfast. Then get dressed, brush teeth, do hair.",
            "Eating breakfast should take 20 minutes.",
        )
        .expect("recent duration hint should make the routine fit");

        assert_eq!(
            adjusted
                .scheduled_tasks
                .iter()
                .map(|task| {
                    (
                        task.title.as_str(),
                        task.start_time.as_str(),
                        task.duration_minutes,
                    )
                })
                .collect::<Vec<_>>(),
            vec![
                ("Put dark clothes in the washer", "9:00 AM", 5),
                ("Eat breakfast with Eleanor", "9:05 AM", 20),
                ("Shower", "9:25 AM", 5),
                ("Get dressed", "9:30 AM", 5),
                ("Brush teeth", "9:35 AM", 5),
                ("Do hair", "9:40 AM", 5),
                ("Move dark clothes to the dryer", "9:45 AM", 45)
            ]
        );
    }

    #[test]
    fn morning_routine_moves_overlapping_existing_steps_after_breakfast() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 4, 26)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let mut washer = scheduled("task_put_dark_clothes_in_washer", "9:00 AM", 5);
        washer.title = "Put dark clothes in the washer".into();
        let mut breakfast = scheduled("task_eat_breakfast_with_eleanor", "9:05 AM", 40);
        breakfast.title = "Eat breakfast with Eleanor".into();
        let mut brush_teeth = scheduled("task_brush_teeth", "9:30 AM", 5);
        brush_teeth.title = "Brush teeth".into();
        let mut do_hair = scheduled("task_do_hair", "9:45 AM", 15);
        do_hair.title = "Do hair".into();
        let mut dryer = scheduled("task_move_dark_clothes_to_dryer", "10:30 AM", 45);
        dryer.title = "Move dark clothes to the dryer".into();
        let plan = agenda::DailyPlan {
            id: "plan_today".into(),
            date: NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
            top_3_outcome_ids: Vec::new(),
            task_order: vec![
                "task_put_dark_clothes_in_washer".into(),
                "task_eat_breakfast_with_eleanor".into(),
                "task_brush_teeth".into(),
                "task_do_hair".into(),
                "task_move_dark_clothes_to_dryer".into(),
            ],
            task_titles: std::collections::HashMap::new(),
            completed_task_ids: Vec::new(),
            generated_at: Some("2026-04-26T09:00:00-07:00".into()),
            scheduled_tasks: vec![washer, breakfast, brush_teeth, do_hair, dryer],
            locked_at: None,
            created_at: now,
            updated_at: now,
        };

        let adjusted = insert_morning_routine_after_breakfast_update(
            &plan,
            "Would need to shower before doing hair. Put shower after eat breakfast. Then get dressed, brush teeth, do hair.",
            "",
        )
        .expect("morning routine should move existing dependent rows after breakfast");

        assert_eq!(
            adjusted
                .scheduled_tasks
                .iter()
                .map(|task| (task.title.as_str(), task.start_time.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("Put dark clothes in the washer", "9:00 AM"),
                ("Eat breakfast with Eleanor", "9:05 AM"),
                ("Shower", "9:45 AM"),
                ("Get dressed", "9:50 AM"),
                ("Brush teeth", "9:55 AM"),
                ("Do hair", "10:00 AM"),
                ("Move dark clothes to the dryer", "10:30 AM")
            ]
        );
    }

    #[test]
    fn breakfast_duration_update_changes_existing_row_and_dedupes() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 4, 26)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let mut breakfast = scheduled("task_eat_breakfast_with_eleanor", "9:05 AM", 40);
        breakfast.title = "Eat breakfast with Eleanor".into();
        let mut duplicate_breakfast = scheduled("task_eat_breakfast_with_eleanor", "4:00 PM", 30);
        duplicate_breakfast.title = "Eat breakfast with Eleanor".into();
        let plan = agenda::DailyPlan {
            id: "plan_today".into(),
            date: NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
            top_3_outcome_ids: Vec::new(),
            task_order: vec![
                "task_eat_breakfast_with_eleanor".into(),
                "task_eat_breakfast_with_eleanor".into(),
            ],
            task_titles: std::collections::HashMap::new(),
            completed_task_ids: Vec::new(),
            generated_at: Some("2026-04-26T09:00:00-07:00".into()),
            scheduled_tasks: vec![duplicate_breakfast, breakfast],
            locked_at: None,
            created_at: now,
            updated_at: now,
        };

        let adjusted = breakfast_duration_update(&plan, "Eating breakfast should take 20 minutes.")
            .expect("breakfast duration should update");

        assert_eq!(adjusted.scheduled_tasks.len(), 1);
        assert_eq!(adjusted.scheduled_tasks[0].start_time, "9:05 AM");
        assert_eq!(adjusted.scheduled_tasks[0].duration_minutes, 20);
    }

    #[test]
    fn routine_request_does_not_match_between_task_insert() {
        assert!(!message_requests_between_task_insertion(
            "Would need to shower before doing hair. Put shower after eat breakfast. Then get dressed, brush teeth, do hair."
        ));
        assert!(!message_is_direct_agenda_followup(
            "Would need to shower before doing hair. Put shower after eat breakfast. Then get dressed, brush teeth, do hair."
        ));
    }

    #[test]
    fn agenda_markdown_write_preserves_reordered_schedule_order() {
        let vault_root =
            std::env::temp_dir().join(format!("goalrate-agenda-reorder-{}", uuid::Uuid::new_v4()));
        let manager = vault_core::VaultManager::create(
            "Agenda Reorder Test",
            &vault_root,
            vault_core::VaultType::Private,
        )
        .unwrap();
        let app_state = crate::commands::vault::AppState::default();
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert("vault_test".to_string(), manager);
        let now = NaiveDate::from_ymd_opt(2026, 4, 26)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let plan = agenda::DailyPlan {
            id: "plan_today".into(),
            date: NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
            top_3_outcome_ids: Vec::new(),
            task_order: vec!["task_beta".into(), "task_alpha".into()],
            task_titles: std::collections::HashMap::new(),
            completed_task_ids: Vec::new(),
            generated_at: Some("2026-04-26T09:00:00-07:00".into()),
            scheduled_tasks: vec![
                scheduled("task_beta", "9:00 AM", 30),
                scheduled("task_alpha", "9:30 AM", 30),
            ],
            locked_at: None,
            created_at: now,
            updated_at: now,
        };

        let written =
            write_agenda_markdown_for_plan("vault_test", &app_state, plan, &[], "ai", None)
                .unwrap();
        let overlay = read_agenda_overlay("vault_test", &app_state, written).unwrap();

        assert_eq!(
            overlay
                .scheduled_tasks
                .iter()
                .map(|task| task.task_id.as_str())
                .collect::<Vec<_>>(),
            vec!["task_beta", "task_alpha"]
        );

        let markdown = std::fs::read_to_string(vault_root.join("agenda/2026-04-26.md")).unwrap();
        assert!(
            markdown.find("task_beta").unwrap() < markdown.find("task_alpha").unwrap(),
            "agenda markdown should persist the reordered visible schedule"
        );

        std::fs::remove_dir_all(vault_root).ok();
    }

    #[test]
    fn assistant_goal_mutation_writes_assistant_snapshot_history() {
        let temp = tempfile::TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = vault_core::VaultManager::create(
            "Assistant Audit Test",
            &vault_path,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let mut frontmatter = markdown_parser::Frontmatter::new();
        frontmatter.insert(
            "id".into(),
            serde_yaml::Value::String("goal_assistant".to_string()),
        );
        frontmatter.insert(
            "title".into(),
            serde_yaml::Value::String("Assistant Goal".to_string()),
        );
        frontmatter.insert("type".into(), serde_yaml::Value::String("goal".to_string()));
        frontmatter.insert(
            "status".into(),
            serde_yaml::Value::String("active".to_string()),
        );

        manager
            .write_goal("goal_assistant", &frontmatter, "Original notes")
            .unwrap();

        let (mut updated_frontmatter, body) = manager.read_goal("goal_assistant").unwrap();
        let mut generated_task = serde_yaml::Mapping::new();
        generated_task.insert(
            serde_yaml::Value::String("id".to_string()),
            serde_yaml::Value::String("task_generated".to_string()),
        );
        generated_task.insert(
            serde_yaml::Value::String("title".to_string()),
            serde_yaml::Value::String("Generated task".to_string()),
        );
        generated_task.insert(
            serde_yaml::Value::String("status".to_string()),
            serde_yaml::Value::String("pending".to_string()),
        );
        updated_frontmatter.insert(
            "task_sequence".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(generated_task)]),
        );

        write_assistant_goal_mutation(
            &manager,
            "goal_assistant",
            &updated_frontmatter,
            &body,
            "assistant_generate_goal_tasks",
        )
        .unwrap();

        let mutation_log = std::fs::read_to_string(&manager.structure().mutation_log).unwrap();
        assert!(mutation_log.contains("- Actor: assistant"));
        assert!(mutation_log.contains("- Action: assistant_generate_goal_tasks"));
        assert!(mutation_log.contains("- File: `goals/goal_assistant.md`"));
        assert!(mutation_log.contains("- Entity: `goal_assistant`"));
        assert!(mutation_log.contains("- Snapshot: `system/snapshots/"));

        let history = manager.list_snapshot_history().unwrap();
        assert_eq!(history[0].target_path, "goals/goal_assistant.md");
        assert_eq!(history[0].actor, "assistant");
        assert_eq!(history[0].action, "assistant_generate_goal_tasks");
    }

    #[test]
    fn parses_assistant_roadmap_update_goal_adds_and_edits() {
        let parsed = json!({
            "message": "I'll update the Roadmap.",
            "plan_update": null,
            "roadmap_update": {
                "goals_to_add": [
                    {
                        "id": "goal_write_book",
                        "title": "Write the first draft",
                        "domain": "Creative",
                        "deadline": "2026-06-01",
                        "success_metric": "Complete 10 chapters",
                        "priority": "high",
                        "tasks": [
                            {"title": "Outline chapter one"},
                            "Draft opening scene"
                        ]
                    }
                ],
                "goals_to_edit": [
                    {
                        "goal_id": "goal_launch",
                        "title": "Launch private beta",
                        "status": "active",
                        "eisenhower_quadrant": "do"
                    }
                ],
                "tasks_to_add": [
                    {
                        "goal_id": "goal_launch",
                        "title": "Write launch checklist",
                        "scheduled_date": "2026-04-28"
                    }
                ],
                "tasks_to_edit": [
                    {
                        "task_id": "task_existing",
                        "title": "Existing task renamed",
                        "eisenhower_quadrant": "schedule"
                    }
                ]
            }
        });

        let update = parse_assistant_roadmap_update(&parsed);

        assert_eq!(update.goals_to_add.len(), 1);
        assert_eq!(
            update.goals_to_add[0].requested_id.as_deref(),
            Some("goal_write_book")
        );
        assert_eq!(update.goals_to_add[0].tasks.len(), 2);
        assert_eq!(update.goals_to_edit.len(), 1);
        assert_eq!(update.goals_to_edit[0].goal_id, "goal_launch");
        assert_eq!(
            update.goals_to_edit[0].eisenhower_quadrant.as_deref(),
            Some("do")
        );
        assert_eq!(update.tasks_to_add.len(), 1);
        assert_eq!(
            update.tasks_to_add[0].scheduled_date.as_deref(),
            Some("2026-04-28")
        );
        assert_eq!(update.tasks_to_edit.len(), 1);
        assert_eq!(update.tasks_to_edit[0].task_id, "task_existing");
        assert_eq!(
            update.tasks_to_edit[0].eisenhower_quadrant.as_deref(),
            Some("schedule")
        );
    }

    #[test]
    fn parses_assistant_memory_update_from_chat_json() {
        let parsed = json!({
            "message": "I'll remember that.",
            "plan_update": null,
            "memory_update": {
                "reason": "user said this in chat",
                "likes_to_add": ["focused work before noon"],
                "notes_to_add": ["Batch admin work after lunch"],
                "meal_windows_to_add": [
                    {
                        "label": "Lunch",
                        "start_time": "12:00 PM",
                        "end_time": "1:00 PM",
                        "days": ["weekdays"]
                    }
                ],
                "task_capacity_hours_per_day": 5
            }
        });

        let update = parse_assistant_memory_update(&parsed);

        assert_eq!(update.reason.as_deref(), Some("user said this in chat"));
        assert_eq!(update.likes_to_add, vec!["focused work before noon"]);
        assert_eq!(update.notes_to_add, vec!["Batch admin work after lunch"]);
        assert_eq!(update.meal_windows_to_add.len(), 1);
        assert_eq!(update.meal_windows_to_add[0].label, "Lunch");
        assert_eq!(update.task_capacity_hours_per_day, Some(5.0));
    }

    #[test]
    fn fallback_memory_update_captures_explicit_remember_note() {
        let update = fallback_memory_update_from_chat_message(
            "Remember that reviewing email drains my focus after 4 PM.",
        );

        assert_eq!(update.reason.as_deref(), Some("user said this in chat"));
        assert!(update.confirmed_by_user);
        assert_eq!(
            update.notes_to_add,
            vec!["reviewing email drains my focus after 4 PM"]
        );
    }

    #[test]
    fn fallback_memory_update_captures_planning_preference() {
        let update = fallback_memory_update_from_chat_message("I prefer focused work before noon.");

        assert!(!update.confirmed_by_user);
        assert_eq!(
            update.likes_to_add,
            vec!["I prefer focused work before noon"]
        );
    }

    #[test]
    fn fallback_memory_update_marks_explicit_sleep_need_confirmed() {
        let update =
            fallback_memory_update_from_chat_message("Remember that I need 8 hours of sleep.");

        assert!(update.confirmed_by_user);
        assert!(update.sensitive);
        assert_eq!(update.sleep_hours_needed, Some(8.0));
    }

    #[test]
    fn fallback_memory_update_ignores_secrets() {
        let update =
            fallback_memory_update_from_chat_message("Remember that my API key is sk-test.");

        assert!(update.is_empty());
    }

    #[test]
    fn assistant_roadmap_update_creates_and_edits_goals_with_assistant_audit() {
        let temp = tempfile::TempDir::new().unwrap();
        let vault_path = temp.path().join("vault");
        let manager = vault_core::VaultManager::create(
            "Assistant Roadmap Test",
            &vault_path,
            vault_core::VaultType::Private,
        )
        .unwrap();

        let mut existing = markdown_parser::Frontmatter::new();
        existing.insert(
            "id".into(),
            serde_yaml::Value::String("goal_launch".to_string()),
        );
        existing.insert(
            "title".into(),
            serde_yaml::Value::String("Launch MVP".to_string()),
        );
        existing.insert("type".into(), serde_yaml::Value::String("goal".to_string()));
        existing.insert(
            "domain".into(),
            serde_yaml::Value::String("Startup".to_string()),
        );
        existing.insert(
            "status".into(),
            serde_yaml::Value::String("active".to_string()),
        );
        let mut task = serde_yaml::Mapping::new();
        task.insert(
            "id".into(),
            serde_yaml::Value::String("task_existing".to_string()),
        );
        task.insert(
            "title".into(),
            serde_yaml::Value::String("Existing task".to_string()),
        );
        task.insert(
            "status".into(),
            serde_yaml::Value::String("todo".to_string()),
        );
        existing.insert(
            "tasks".into(),
            serde_yaml::Value::Sequence(vec![serde_yaml::Value::Mapping(task)]),
        );
        manager
            .write_goal("goal_launch", &existing, "Original notes")
            .unwrap();

        let app_state = crate::commands::vault::AppState::default();
        app_state
            .vaults
            .lock()
            .unwrap()
            .insert("vault_test".to_string(), manager);

        let update = AssistantRoadmapUpdate {
            goals_to_add: vec![AssistantGoalCreate {
                requested_id: Some("goal_write_book".to_string()),
                title: "Write the first draft".to_string(),
                domain: Some("Creative".to_string()),
                deadline: Some("2026-06-01".to_string()),
                success_metric: Some("Complete 10 chapters".to_string()),
                priority: Some("high".to_string()),
                eisenhower_quadrant: None,
                notes: Some("Draft notes".to_string()),
                tasks: vec!["Outline chapter one".to_string()],
            }],
            goals_to_edit: vec![AssistantGoalEdit {
                goal_id: "goal_launch".to_string(),
                title: Some("Launch private beta".to_string()),
                domain: Some("Business".to_string()),
                deadline: Some("2026-05-15".to_string()),
                success_metric: Some("Invite 20 beta users".to_string()),
                priority: None,
                eisenhower_quadrant: Some("do".to_string()),
                status: Some("active".to_string()),
                notes: Some("Updated notes".to_string()),
            }],
            tasks_to_add: vec![AssistantTaskAdd {
                requested_id: Some("sub_checklist".to_string()),
                goal_id: "goal_launch".to_string(),
                parent_task_id: Some("task_existing".to_string()),
                title: "Write launch checklist".to_string(),
                status: None,
                due_date: Some("2026-05-01".to_string()),
                scheduled_date: None,
                recurring: None,
                priority: None,
                eisenhower_quadrant: Some("schedule".to_string()),
            }],
            tasks_to_edit: vec![AssistantTaskEdit {
                task_id: "task_existing".to_string(),
                goal_id: Some("goal_launch".to_string()),
                title: Some("Existing task renamed".to_string()),
                status: Some("blocked".to_string()),
                due_date: None,
                scheduled_date: Some("2026-04-28".to_string()),
                recurring: None,
                priority: Some("high".to_string()),
                eisenhower_quadrant: Some("do".to_string()),
            }],
        };

        let result = apply_assistant_roadmap_update("vault_test", &app_state, &update).unwrap();

        assert_eq!(result.goals_added, 1);
        assert_eq!(result.goals_edited, 1);
        assert_eq!(result.tasks_added, 1);
        assert_eq!(result.tasks_edited, 1);

        let vaults = app_state.vaults.lock().unwrap();
        let vault = vaults.get("vault_test").unwrap();
        let (created_fm, created_body) = vault.read_goal("goal_write_book").unwrap();
        assert_eq!(
            created_fm.get("title").and_then(|value| value.as_str()),
            Some("Write the first draft")
        );
        assert_eq!(
            created_fm
                .get("success_metric")
                .and_then(|value| value.as_str()),
            Some("Complete 10 chapters")
        );
        assert_eq!(created_body, "Draft notes");
        assert_eq!(
            created_fm
                .get("tasks")
                .and_then(|value| value.as_sequence())
                .map(Vec::len),
            Some(1)
        );

        let (edited_fm, edited_body) = vault.read_goal("goal_launch").unwrap();
        assert_eq!(
            edited_fm.get("title").and_then(|value| value.as_str()),
            Some("Launch private beta")
        );
        assert_eq!(
            edited_fm.get("domain").and_then(|value| value.as_str()),
            Some("Business")
        );
        assert_eq!(
            edited_fm
                .get("eisenhower_quadrant")
                .and_then(|value| value.as_str()),
            Some("do")
        );
        assert_eq!(
            edited_fm
                .get("tasks")
                .and_then(|value| value.as_sequence())
                .and_then(|tasks| tasks.first())
                .and_then(|task| task.get("id"))
                .and_then(|value| value.as_str()),
            Some("task_existing")
        );
        let edited_task = edited_fm
            .get("tasks")
            .and_then(|value| value.as_sequence())
            .and_then(|tasks| tasks.first())
            .unwrap();
        assert_eq!(
            edited_task.get("title").and_then(|value| value.as_str()),
            Some("Existing task renamed")
        );
        assert_eq!(
            edited_task
                .get("scheduled_date")
                .and_then(|value| value.as_str()),
            Some("2026-04-28")
        );
        assert_eq!(
            edited_task
                .get("subtasks")
                .and_then(|value| value.as_sequence())
                .and_then(|subtasks| subtasks.first())
                .and_then(|subtask| subtask.get("id"))
                .and_then(|value| value.as_str()),
            Some("sub_checklist")
        );
        assert_eq!(edited_body, "Updated notes");

        let mutation_log = std::fs::read_to_string(&vault.structure().mutation_log).unwrap();
        assert!(mutation_log.contains("- Actor: assistant"));
        assert!(mutation_log.contains("- Action: assistant_chat_add_goal"));
        assert!(mutation_log.contains("- Action: assistant_chat_edit_goal"));
        assert!(mutation_log.contains("- Action: assistant_chat_add_roadmap_task"));
        assert!(mutation_log.contains("- Action: assistant_chat_edit_roadmap_task"));
    }

    #[test]
    fn full_scheduled_tasks_order_wins_for_reorder_actions() {
        let current_order = vec![
            "task_alpha".to_string(),
            "task_beta".to_string(),
            "task_gamma".to_string(),
        ];
        let updates = vec![
            scheduled("task_beta", "9:00 AM", 30),
            scheduled("task_alpha", "9:30 AM", 30),
            scheduled("task_gamma", "10:00 AM", 30),
        ];

        let order = scheduled_update_order_for_action("reorder", &current_order, &updates)
            .expect("full schedule should define reorder order");

        assert_eq!(
            order,
            vec![
                "task_beta".to_string(),
                "task_alpha".to_string(),
                "task_gamma".to_string()
            ]
        );
    }

    #[test]
    fn partial_reorder_preserves_unmentioned_agenda_rows() {
        let current_order = vec![
            "task_gamma".to_string(),
            "task_beta".to_string(),
            "task_alpha".to_string(),
            "task_delta".to_string(),
        ];
        let parsed_ids = vec!["task_alpha".to_string(), "task_beta".to_string()];

        let merged = merge_partial_reorder(&current_order, &parsed_ids);

        assert_eq!(
            merged,
            vec![
                "task_gamma".to_string(),
                "task_alpha".to_string(),
                "task_beta".to_string(),
                "task_delta".to_string()
            ]
        );
    }

    #[test]
    fn schedule_update_order_keeps_new_fixed_time_rows() {
        let current_order = vec!["task_focus".to_string(), "task_admin".to_string()];
        let parsed_ids = vec!["task_take_daughter_to_school".to_string()];

        let merged = merge_schedule_update_order(&current_order, &parsed_ids);

        assert_eq!(
            merged,
            vec![
                "task_focus".to_string(),
                "task_admin".to_string(),
                "task_take_daughter_to_school".to_string()
            ]
        );
    }

    #[test]
    fn schedule_update_order_allows_full_existing_row_reorder() {
        let current_order = vec!["task_focus".to_string(), "task_admin".to_string()];
        let parsed_ids = vec!["task_admin".to_string(), "task_focus".to_string()];

        let merged = merge_schedule_update_order(&current_order, &parsed_ids);

        assert_eq!(
            merged,
            vec!["task_admin".to_string(), "task_focus".to_string()]
        );
    }

    #[test]
    fn ineffective_reorder_update_is_detected_before_success_copy() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 4, 26)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let plan = agenda::DailyPlan {
            id: "plan_today".into(),
            date: NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
            top_3_outcome_ids: Vec::new(),
            task_order: vec!["task_alpha".into(), "task_beta".into()],
            task_titles: std::collections::HashMap::new(),
            completed_task_ids: Vec::new(),
            generated_at: Some("2026-04-26T09:00:00-07:00".into()),
            scheduled_tasks: vec![
                scheduled("task_alpha", "9:00 AM", 30),
                scheduled("task_beta", "9:30 AM", 30),
            ],
            locked_at: None,
            created_at: now,
            updated_at: now,
        };
        let ineffective = json!({
            "action": "reorder",
            "tasks": ["task_alpha", "task_beta"],
            "top_3_outcomes": [{"title": "Alpha", "linked_task_ids": ["task_alpha"]}]
        });
        let effective = json!({
            "action": "reorder",
            "tasks": ["task_beta", "task_alpha"]
        });

        assert!(!plan_update_reorder_changes_visible_order(
            &ineffective,
            &plan
        ));
        assert!(plan_update_reorder_changes_visible_order(&effective, &plan));
    }

    #[test]
    fn dependency_question_reorders_existing_schedule_rows() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 4, 26)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let mut move_to_dryer = scheduled("task_move_white_to_dryer", "9:00 AM", 5);
        move_to_dryer.title = "Move white clothes to dryer".into();
        let mut fold = scheduled("task_fold_white_clothes", "9:05 AM", 15);
        fold.title = "Fold and put away white clothes".into();
        let mut washer = scheduled("task_put_white_in_washer", "9:20 AM", 5);
        washer.title = "Put white clothes in washer".into();
        let plan = agenda::DailyPlan {
            id: "plan_today".into(),
            date: NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
            top_3_outcome_ids: Vec::new(),
            task_order: vec![
                "task_move_white_to_dryer".into(),
                "task_fold_white_clothes".into(),
                "task_put_white_in_washer".into(),
            ],
            task_titles: std::collections::HashMap::new(),
            completed_task_ids: Vec::new(),
            generated_at: Some("2026-04-26T09:00:00-07:00".into()),
            scheduled_tasks: vec![move_to_dryer, fold, washer],
            locked_at: None,
            created_at: now,
            updated_at: now,
        };

        let adjusted = dependency_reorder_from_message(
            &plan,
            "Why does the current schedule start with “Move white clothes to dryer” at 9am? The clothes wouldn’t have been in the washer yet.",
        )
        .expect("dependency correction should reorder existing rows");

        assert_eq!(
            adjusted
                .scheduled_tasks
                .iter()
                .map(|task| (task.title.as_str(), task.start_time.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("Put white clothes in washer", "9:00 AM"),
                ("Move white clothes to dryer", "9:05 AM"),
                ("Fold and put away white clothes", "9:20 AM")
            ]
        );
    }

    #[test]
    fn first_task_instruction_moves_matching_existing_row_to_time_slot() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 4, 26)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let mut move_light = scheduled("task_move_light_to_dryer", "9:00 AM", 5);
        move_light.title = "Move light clothes to dryer".into();
        let mut move_white = scheduled("task_move_white_to_dryer", "9:05 AM", 5);
        move_white.title = "Move white clothes to dryer".into();
        let mut put_light = scheduled("task_put_light_in_washer", "9:20 AM", 5);
        put_light.title = "Put light clothes in washer".into();
        let mut fold_white = scheduled("task_fold_white_clothes", "9:50 AM", 15);
        fold_white.title = "Fold and put away white clothes".into();
        let plan = agenda::DailyPlan {
            id: "plan_today".into(),
            date: NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
            top_3_outcome_ids: Vec::new(),
            task_order: vec![
                "task_move_light_to_dryer".into(),
                "task_move_white_to_dryer".into(),
                "task_put_light_in_washer".into(),
                "task_fold_white_clothes".into(),
            ],
            task_titles: std::collections::HashMap::new(),
            completed_task_ids: Vec::new(),
            generated_at: Some("2026-04-26T09:00:00-07:00".into()),
            scheduled_tasks: vec![move_light, move_white, put_light, fold_white],
            locked_at: None,
            created_at: now,
            updated_at: now,
        };

        let adjusted = first_task_instruction_update(
            &plan,
            "The first task at 9am should be to put clothes in the washer.",
        )
        .expect("explicit first-task instruction should move an existing matching row");

        assert_eq!(
            adjusted
                .scheduled_tasks
                .iter()
                .map(|task| (task.title.as_str(), task.start_time.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("Put light clothes in washer", "9:00 AM"),
                ("Move light clothes to dryer", "9:05 AM"),
                ("Move white clothes to dryer", "9:20 AM"),
                ("Fold and put away white clothes", "9:50 AM")
            ]
        );
    }

    #[test]
    fn explicit_schedule_instruction_creates_missing_prerequisites_without_reversing_sequence() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 4, 26)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let mut fold_light = scheduled("task_fold_light_clothes", "9:00 AM", 15);
        fold_light.title = "Fold and put away light clothes".into();
        let mut move_light = scheduled("task_move_light_to_dryer", "9:05 AM", 5);
        move_light.title = "Move light clothes to dryer".into();
        let mut move_white = scheduled("task_move_white_to_dryer", "9:20 AM", 5);
        move_white.title = "Move white clothes to dryer".into();
        let plan = agenda::DailyPlan {
            id: "plan_today".into(),
            date: NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
            top_3_outcome_ids: Vec::new(),
            task_order: vec![
                "task_fold_light_clothes".into(),
                "task_move_light_to_dryer".into(),
                "task_move_white_to_dryer".into(),
            ],
            task_titles: std::collections::HashMap::new(),
            completed_task_ids: Vec::new(),
            generated_at: Some("2026-04-26T09:00:00-07:00".into()),
            scheduled_tasks: vec![fold_light, move_light, move_white],
            locked_at: None,
            created_at: now,
            updated_at: now,
        };

        let adjusted = explicit_schedule_instruction_update(
            &plan,
            "The first task at 9am should be to put dark clothes in the washer as a 5 minute task. 45 minutes later, there should be a 5 minute task to move dark clothes to the dryer. Immediately after that task should be another 5 minute task to put light clothes in the washer. 45 minutes after that should be a 20 minute task to fold and put away dark clothes. Then, a 5 minute task to move light clothes to the dryer. Then a 5 minute task to put white clothes in the washer. 45 minutes after that should be a 20 minute task to fold and put away light clothes. Then a 5 minute task to move white clothes to the dryer. 45 minutes after that should be a 20 minute task to fold and put away white clothes.",
        )
        .expect("explicit schedule instruction should create missing prerequisites");

        assert_eq!(
            adjusted
                .scheduled_tasks
                .iter()
                .take(9)
                .map(|task| (task.title.as_str(), task.start_time.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("Put dark clothes in the washer", "9:00 AM"),
                ("Move dark clothes to the dryer", "9:45 AM"),
                ("Put light clothes in the washer", "9:50 AM"),
                ("Fold and put away dark clothes", "10:35 AM"),
                ("Move light clothes to the dryer", "10:55 AM"),
                ("Put white clothes in the washer", "11:00 AM"),
                ("Fold and put away light clothes", "11:45 AM"),
                ("Move white clothes to the dryer", "12:05 PM"),
                ("Fold and put away white clothes", "12:50 PM")
            ]
        );
        assert!(adjusted
            .scheduled_tasks
            .iter()
            .all(|task| !task.title.to_ascii_lowercase().contains("dark light")));
    }

    #[test]
    fn extract_json_handles_prose_wrapped_fenced_json() {
        let raw = r#"You're right. I've updated it.
```json
{
  "message": "Done",
  "plan_update": {"action": "reorder", "tasks": ["task_beta", "task_alpha"]}
}
```"#;

        let parsed: Value = serde_json::from_str(extract_json(raw)).unwrap();

        assert_eq!(parsed["message"], "Done");
        assert_eq!(parsed["plan_update"]["action"], "reorder");
    }

    #[test]
    fn strip_protocol_json_for_message_removes_fenced_payload() {
        let raw = r#"I've reordered your Agenda.
```json
{"message":"Done","plan_update":{"action":"reorder"}}
```"#;

        assert_eq!(
            strip_protocol_json_for_message(raw),
            "I've reordered your Agenda."
        );
    }

    #[test]
    fn regenerate_request_detection_matches_task_refresh_language() {
        assert!(is_regenerate_agenda_request("Regenerate my tasks"));
        assert!(is_regenerate_agenda_request(
            "Please rebuild today's Agenda"
        ));
        assert!(!is_regenerate_agenda_request("Move this task to 2 PM"));
        assert!(!is_regenerate_agenda_request("Regenerate the API token"));
    }

    #[test]
    fn agenda_change_intent_detection_avoids_explanation_only_questions() {
        assert!(message_requests_agenda_change(
            "Please move the review to 2 PM"
        ));
        assert!(message_requests_agenda_change(
            "I should have tasks for preparing the quarterly review"
        ));
        assert!(message_requests_agenda_change(
            "I can't send the report if the draft is not done yet."
        ));
        assert!(message_requests_agenda_change(
            "The prep task needs to happen before the review."
        ));
        assert!(message_requests_agenda_change(
            "Why does the current schedule start with “Move white clothes to dryer” at 9am? The clothes wouldn’t have been in the washer yet."
        ));
        assert!(message_requests_agenda_change("Reorder it."));
        assert!(message_requests_agenda_change("Do it now!"));
        assert!(message_requests_agenda_change(
            "The first task at 9am should be to put clothes in the washer."
        ));
        assert!(message_requests_agenda_change(
            "Break this task down into subtasks"
        ));
        assert!(message_requests_agenda_change(
            "So, let’s put another task in between those laundry tasks. Maybe Eat breakfast?"
        ));
        assert!(!message_requests_agenda_change(
            "Add a goal to run a marathon with a few starter tasks"
        ));
        assert!(message_requests_agenda_change(
            "Add a goal to run a marathon and put the first task on today's Agenda"
        ));
        assert!(!message_requests_agenda_change(
            "Why is the review scheduled at 10 AM?"
        ));
        assert!(!message_requests_agenda_change("Explain today's plan"));
    }

    #[test]
    fn repair_prompt_requires_concrete_agenda_update() {
        assert!(CHAT_REPRIORITIZE_REPAIR_SYSTEM_PROMPT.contains("Do not return null plan_update"));
        assert!(!CHAT_REPRIORITIZE_REPAIR_SYSTEM_PROMPT.contains("\"plan_update\": null"));
    }

    #[test]
    fn regenerated_task_order_ranks_available_tasks() {
        let tasks = vec![
            (
                "task_schedule".into(),
                "Steady work".into(),
                Some("Goal".into()),
                Some("2026-05-01".into()),
                0,
                None,
                false,
                "schedule".into(),
            ),
            (
                "task_do".into(),
                "Urgent work".into(),
                Some("Goal".into()),
                Some("2026-05-10".into()),
                0,
                None,
                false,
                "do".into(),
            ),
        ];

        let order = regenerated_task_order(&tasks, &[]);

        assert_eq!(order, vec!["task_do", "task_schedule"]);
    }

    #[test]
    fn regenerated_schedule_aligns_first_task_after_current_time() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 4, 26)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let mut plan = agenda::DailyPlan {
            id: "plan_today".into(),
            date: NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
            top_3_outcome_ids: Vec::new(),
            task_order: vec!["task_alpha".into(), "task_beta".into()],
            task_titles: std::collections::HashMap::new(),
            completed_task_ids: Vec::new(),
            generated_at: Some("2026-04-26T11:55:21-07:00".into()),
            scheduled_tasks: vec![
                scheduled("memory_breakfast_0800", "8:00 AM", 30),
                scheduled("task_alpha", "12:15 AM", 45),
                scheduled("task_beta", "1:00 AM", 45),
                scheduled("memory_lunch_1200", "12:00 PM", 60),
            ],
            locked_at: None,
            created_at: now,
            updated_at: now,
        };
        plan.scheduled_tasks[0].estimate_source = Some("memory".into());
        plan.scheduled_tasks[3].estimate_source = Some("memory".into());

        let changed = align_regenerated_schedule_after_start(
            &mut plan,
            NaiveTime::from_hms_opt(11, 56, 0).unwrap(),
        );

        assert!(changed);
        assert_eq!(
            plan.scheduled_tasks
                .iter()
                .map(|task| (task.task_id.as_str(), task.start_time.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("memory_lunch_1200", "12:00 PM"),
                ("task_alpha", "1:00 PM"),
                ("task_beta", "1:45 PM"),
            ]
        );
        assert_eq!(
            plan.task_order,
            vec!["memory_lunch_1200", "task_alpha", "task_beta"]
        );
    }

    #[test]
    fn regenerated_schedule_keeps_future_memory_rows_at_exact_times() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 4, 26)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let mut plan = agenda::DailyPlan {
            id: "plan_today".into(),
            date: NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
            top_3_outcome_ids: Vec::new(),
            task_order: vec!["task_alpha".into(), "memory_lunch_1200".into()],
            task_titles: std::collections::HashMap::new(),
            completed_task_ids: Vec::new(),
            generated_at: Some("2026-04-26T11:45:00-07:00".into()),
            scheduled_tasks: vec![
                scheduled("task_alpha", "1:00 PM", 45),
                scheduled("memory_lunch_1200", "12:00 PM", 60),
            ],
            locked_at: None,
            created_at: now,
            updated_at: now,
        };
        plan.scheduled_tasks[1].estimate_source = Some("memory".into());

        let changed = align_regenerated_schedule_after_start(
            &mut plan,
            NaiveTime::from_hms_opt(11, 46, 0).unwrap(),
        );

        assert!(changed);
        assert_eq!(
            plan.scheduled_tasks
                .iter()
                .map(|task| (task.task_id.as_str(), task.start_time.as_str()))
                .collect::<Vec<_>>(),
            vec![("memory_lunch_1200", "12:00 PM"), ("task_alpha", "1:00 PM"),]
        );
    }

    #[test]
    fn next_visible_agenda_minute_is_after_the_current_minute() {
        let current = NaiveTime::from_hms_opt(11, 55, 21).unwrap();

        assert_eq!(
            next_visible_agenda_minute_after(current),
            NaiveTime::from_hms_opt(11, 56, 0).unwrap()
        );
    }

    #[test]
    fn outcome_specs_are_reconciled_to_updated_schedule() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 4, 26)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let mut plan = agenda::DailyPlan {
            id: "plan_today".into(),
            date: NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
            top_3_outcome_ids: vec!["out_old".into(), "out_launch".into()],
            task_order: vec!["task_launch_review".into(), "task_daily_exercise".into()],
            task_titles: std::collections::HashMap::new(),
            completed_task_ids: Vec::new(),
            generated_at: Some("2026-04-26T09:00:00-07:00".into()),
            scheduled_tasks: vec![
                scheduled("task_launch_review", "10:00 AM", 60),
                scheduled("task_daily_exercise", "7:30 PM", 30),
            ],
            locked_at: None,
            created_at: now,
            updated_at: now,
        };
        plan.scheduled_tasks[0].title = "Review launch plan".into();
        plan.scheduled_tasks[1].title = "Daily exercise".into();
        let existing = vec![
            outcome("out_old", "Review archived task", &["task_old"]),
            outcome("out_launch", "Review launch plan", &["task_launch_review"]),
        ];

        let specs = desired_outcome_specs_for_schedule(&plan, &existing, &[]);

        assert_eq!(specs.len(), 2);
        assert_eq!(specs[0].title, "Review launch plan");
        assert_eq!(
            specs[0].linked_task_ids,
            vec!["task_launch_review".to_string()]
        );
        assert_eq!(specs[1].title, "Daily exercise");
        assert_eq!(
            specs[1].linked_task_ids,
            vec!["task_daily_exercise".to_string()]
        );
    }

    #[test]
    fn planning_adjustments_detect_user_constraints() {
        let message =
            "My day will end at 10 pm. I like to have 2 hours of free time at the end of the day.";
        let date = NaiveDate::from_ymd_opt(2026, 4, 26).unwrap();

        let adjustments = chat_planning_adjustments(message, date);

        assert_eq!(
            adjustments.latest_work_end,
            Some(NaiveTime::from_hms_opt(20, 0, 0).unwrap())
        );
    }

    #[test]
    fn planning_adjustments_detect_day_start_constraint() {
        let message =
            "My day will start at 9 am. So there shouldn't be anything scheduled before that time.";
        let date = NaiveDate::from_ymd_opt(2026, 4, 26).unwrap();

        let adjustments = chat_planning_adjustments(message, date);

        assert_eq!(
            adjustments.earliest_start,
            Some(NaiveTime::from_hms_opt(9, 0, 0).unwrap())
        );
    }

    #[test]
    fn meridiem_time_parser_handles_minutes() {
        let time = extract_meridiem_time("i need to take my daughter to school at 8:30 am")
            .expect("time with minutes should parse");

        assert_eq!(time, NaiveTime::from_hms_opt(8, 30, 0).unwrap());
    }

    #[test]
    fn fixed_time_commitment_update_adds_school_dropoff_at_exact_time() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 4, 26)
            .unwrap()
            .and_hms_opt(8, 0, 0)
            .unwrap();
        let mut breakfast = scheduled("task_breakfast", "8:15 AM", 30);
        breakfast.title = "Eat breakfast".into();
        let mut focus = scheduled("task_focus", "9:00 AM", 60);
        focus.title = "Focus block".into();
        let plan = agenda::DailyPlan {
            id: "plan_today".into(),
            date: NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
            top_3_outcome_ids: Vec::new(),
            task_order: vec!["task_breakfast".into(), "task_focus".into()],
            task_titles: std::collections::HashMap::new(),
            completed_task_ids: Vec::new(),
            generated_at: Some("2026-04-26T08:00:00-07:00".into()),
            scheduled_tasks: vec![breakfast, focus],
            locked_at: None,
            created_at: now,
            updated_at: now,
        };

        let adjusted =
            fixed_time_commitment_update(&plan, "I need to take my daughter to school at 8:30 AM.")
                .expect("fixed-time commitment should become an Agenda row");

        assert_eq!(
            adjusted
                .scheduled_tasks
                .iter()
                .map(|task| (task.title.as_str(), task.start_time.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("Take my daughter to school", "8:30 AM"),
                ("Eat breakfast", "9:00 AM"),
                ("Focus block", "9:30 AM")
            ]
        );
    }

    #[test]
    fn direct_agenda_task_update_adds_breakfast_at_requested_time() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 4, 30)
            .unwrap()
            .and_hms_opt(8, 34, 0)
            .unwrap();
        let mut lunch = scheduled("task_lunch", "12:00 PM", 60);
        lunch.title = "Lunch".into();
        let mut snack = scheduled("task_snack", "3:45 PM", 30);
        snack.title = "Snack".into();
        let mut dinner = scheduled("task_dinner", "7:30 PM", 60);
        dinner.title = "Dinner".into();
        let plan = agenda::DailyPlan {
            id: "plan_today".into(),
            date: NaiveDate::from_ymd_opt(2026, 4, 30).unwrap(),
            top_3_outcome_ids: Vec::new(),
            task_order: vec![
                "task_lunch".into(),
                "task_snack".into(),
                "task_dinner".into(),
            ],
            task_titles: std::collections::HashMap::new(),
            completed_task_ids: Vec::new(),
            generated_at: Some("2026-04-30T08:34:00-07:00".into()),
            scheduled_tasks: vec![lunch, snack, dinner],
            locked_at: None,
            created_at: now,
            updated_at: now,
        };

        let adjusted = direct_agenda_task_update(
            &plan,
            "Add a task for Eat Breakfast to my Agenda for 8:45 AM.",
        )
        .expect("direct Agenda task add should create a visible row");

        assert_eq!(
            adjusted
                .scheduled_tasks
                .iter()
                .map(|task| (task.title.as_str(), task.start_time.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("Eat Breakfast", "8:45 AM"),
                ("Lunch", "12:00 PM"),
                ("Snack", "3:45 PM"),
                ("Dinner", "7:30 PM")
            ]
        );
        assert_eq!(
            adjusted.task_order.first().map(String::as_str),
            Some("task_eat_breakfast")
        );
        assert_eq!(
            adjusted
                .task_titles
                .get("task_eat_breakfast")
                .map(String::as_str),
            Some("Eat Breakfast")
        );
    }

    #[test]
    fn direct_agenda_task_update_marks_outsourced_repair_as_delegate() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 4, 30)
            .unwrap()
            .and_hms_opt(8, 53, 0)
            .unwrap();
        let mut dinner = scheduled("task_dinner", "7:30 PM", 60);
        dinner.title = "Dinner".into();
        let plan = agenda::DailyPlan {
            id: "plan_today".into(),
            date: NaiveDate::from_ymd_opt(2026, 4, 30).unwrap(),
            top_3_outcome_ids: Vec::new(),
            task_order: vec!["task_dinner".into()],
            task_titles: std::collections::HashMap::new(),
            completed_task_ids: Vec::new(),
            generated_at: Some("2026-04-30T08:53:00-07:00".into()),
            scheduled_tasks: vec![dinner],
            locked_at: None,
            created_at: now,
            updated_at: now,
        };

        let adjusted = direct_agenda_task_update(
            &plan,
            "Add a task for Get kitchen sink fixed to my Agenda for 10:40 PM.",
        )
        .expect("direct Agenda task add should create a visible row");
        let repair_task = adjusted
            .scheduled_tasks
            .iter()
            .find(|task| task.title == "Get kitchen sink fixed")
            .expect("repair task should be scheduled");

        assert_eq!(repair_task.start_time, "10:40 PM");
        assert_eq!(repair_task.eisenhower_quadrant.as_deref(), Some("delegate"));
    }

    #[test]
    fn planning_adjustments_shift_schedule_to_day_start() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 4, 26)
            .unwrap()
            .and_hms_opt(8, 0, 0)
            .unwrap();
        let plan = agenda::DailyPlan {
            id: "plan_today".into(),
            date: NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
            top_3_outcome_ids: Vec::new(),
            task_order: vec![
                "task_shower".into(),
                "task_breakfast".into(),
                "task_work".into(),
            ],
            task_titles: std::collections::HashMap::new(),
            completed_task_ids: Vec::new(),
            generated_at: Some("2026-04-26T08:00:00-07:00".into()),
            scheduled_tasks: vec![
                scheduled("task_shower", "8:00 AM", 30),
                scheduled("task_breakfast", "8:20 AM", 20),
                scheduled("task_work", "9:30 AM", 30),
            ],
            locked_at: None,
            created_at: now,
            updated_at: now,
        };
        let adjustments = ChatPlanningAdjustments {
            earliest_start: Some(NaiveTime::from_hms_opt(9, 0, 0).unwrap()),
            ..ChatPlanningAdjustments::default()
        };

        let adjusted = apply_chat_planning_adjustments(
            &plan,
            &adjustments,
            "2026-04-26T09:00:00-07:00",
            &std::collections::HashMap::new(),
        )
        .unwrap();

        assert!(adjusted
            .scheduled_tasks
            .iter()
            .all(|task| parse_schedule_time(&task.start_time)
                >= Some(NaiveTime::from_hms_opt(9, 0, 0).unwrap())));
        assert_eq!(
            adjusted
                .scheduled_tasks
                .iter()
                .map(|task| (task.task_id.as_str(), task.start_time.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("task_shower", "9:00 AM"),
                ("task_breakfast", "9:30 AM"),
                ("task_work", "9:50 AM")
            ]
        );
    }

    #[test]
    fn planning_adjustments_apply_day_end_constraint_to_visible_schedule() {
        let now = chrono::NaiveDate::from_ymd_opt(2026, 4, 26)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let mut plan = agenda::DailyPlan {
            id: "plan_today".into(),
            date: NaiveDate::from_ymd_opt(2026, 4, 26).unwrap(),
            top_3_outcome_ids: Vec::new(),
            task_order: vec!["task_morning".into(), "task_late_admin".into()],
            task_titles: std::collections::HashMap::new(),
            completed_task_ids: Vec::new(),
            generated_at: Some("2026-04-26T09:00:00-07:00".into()),
            scheduled_tasks: vec![
                scheduled("task_morning", "9:00 AM", 30),
                scheduled("task_late_admin", "8:30 PM", 30),
            ],
            locked_at: None,
            created_at: now,
            updated_at: now,
        };
        plan.scheduled_tasks[0].title = "Morning task".into();
        plan.scheduled_tasks[1].title = "Late admin".into();

        let adjustments = ChatPlanningAdjustments {
            latest_work_end: Some(NaiveTime::from_hms_opt(20, 0, 0).unwrap()),
            ..ChatPlanningAdjustments::default()
        };

        let adjusted = apply_chat_planning_adjustments(
            &plan,
            &adjustments,
            "2026-04-26T09:00:00-07:00",
            &std::collections::HashMap::new(),
        )
        .unwrap();

        assert!(!adjusted.task_order.contains(&"task_late_admin".to_string()));
        assert_eq!(adjusted.task_order, vec!["task_morning".to_string()]);
    }
}

#[tauri::command]
pub async fn agenda_generate_plan(
    vault_id: String,
    model_id: String,
    date: String,
    app_state: State<'_, AppState>,
) -> Result<GeneratedPlanResponse, AppError> {
    super::subscriptions::require_ai_entitlement().await?;

    let date_parsed = date
        .parse::<NaiveDate>()
        .map_err(|_| AppError::validation_error(format!("Invalid date: {date}")))?;

    // Gather context from vault
    let (goals, tasks) = gather_vault_context(&vault_id, &app_state, date_parsed)?;
    let memory_targets = memory_agenda_targets_for_date(&vault_id, &app_state, date_parsed)?;
    let vault_task_titles = vault_task_title_lookup(&tasks);
    let task_specific_dates = task_specific_dates_from_vault(&vault_id, &app_state)?;
    let required_agenda_tasks = required_agenda_tasks_for_date(&vault_id, &app_state, date_parsed)?;
    let agenda_date_text = date_parsed.to_string();

    // Build context payload from DB
    let context = with_db(&vault_id, &app_state, |db| {
        build_context(db, &goals, &tasks)
    })?;

    let generated_at = chrono::Local::now().to_rfc3339();
    let mut user_prompt = context.to_user_prompt_for_date(date_parsed);
    user_prompt.push_str("\n\n## Agenda Generation Time\n");
    user_prompt.push_str(&generated_at);
    user_prompt.push('\n');
    if let Some(memory_context) = memory_prompt_context(&vault_id, &app_state, date_parsed)? {
        user_prompt.push_str("\n\n");
        user_prompt.push_str(&memory_context);
    }

    // Call LLM, falling back to a deterministic local plan if AI is unavailable.
    let (parsed, used_ai) = match call_llm(
        &model_id,
        DAILY_PLAN_SYSTEM_PROMPT,
        &user_prompt,
        2000,
        Some(&app_state),
    )
    .await
    {
        Ok(raw_response) => {
            let json_str = extract_json(&raw_response);
            match serde_json::from_str(json_str) {
                Ok(parsed) => (parsed, true),
                Err(e) => {
                    log::warn!("AI plan response was not valid JSON; using heuristic plan: {e}");
                    (heuristic_daily_plan_payload(&tasks), false)
                }
            }
        }
        Err(err) => {
            log::warn!("AI plan generation unavailable; using heuristic plan: {err}");
            (heuristic_daily_plan_payload(&tasks), false)
        }
    };

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

    // Parse ordered_tasks — supports both object format and plain string format.
    // Plain ID lists are common from older prompts; fill titles from Roadmap context
    // so the persisted Agenda never degrades task_1 into a visible "1" row.
    let ParsedOrderedTasks {
        mut ordered_task_ids,
        mut task_titles,
        new_tasks,
        recurring_flags,
    } = parse_ordered_tasks_from_ai(&parsed, &vault_task_titles);
    ordered_task_ids.retain(|task_id| {
        task_specific_dates
            .get(task_id)
            .map_or(true, |scheduled_date| scheduled_date == &agenda_date_text)
    });
    for task_id in &ordered_task_ids {
        if let Some(title) = vault_task_titles.get(task_id) {
            task_titles
                .entry(task_id.clone())
                .or_insert_with(|| title.clone());
        }
    }
    for (task_id, title) in &required_agenda_tasks {
        task_titles
            .entry(task_id.clone())
            .or_insert_with(|| title.clone());
        if !ordered_task_ids.contains(task_id) {
            ordered_task_ids.push(task_id.clone());
        }
    }
    if memory_targets.has_any_target() {
        append_available_tasks_to_order(&mut ordered_task_ids, &mut task_titles, &tasks);
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
    let mut ai_scheduled_tasks = parse_ai_scheduled_tasks(&parsed);
    apply_known_titles_to_scheduled_tasks(
        &mut ai_scheduled_tasks,
        &task_titles,
        &vault_task_titles,
    );
    ai_scheduled_tasks.retain(|task| {
        task_specific_dates
            .get(&task.task_id)
            .map_or(true, |scheduled_date| scheduled_date == &agenda_date_text)
    });

    // Persist to DB
    let (mut plan, outcomes) = with_db(&vault_id, &app_state, |db| {
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

    if !ai_scheduled_tasks.is_empty()
        && required_agenda_tasks.iter().any(|(task_id, _)| {
            !ai_scheduled_tasks
                .iter()
                .any(|task| task.task_id == *task_id)
        })
    {
        ai_scheduled_tasks.clear();
    }

    if !ai_scheduled_tasks.is_empty() {
        for task in &ai_scheduled_tasks {
            task_titles.insert(task.task_id.clone(), task.title.clone());
        }
        let task_quadrants = task_quadrants_from_vault(&vault_id, &app_state, date_parsed)?;
        apply_derived_quadrants_to_scheduled_tasks(&mut ai_scheduled_tasks, &task_quadrants);
        let adjusted_scheduled_tasks = apply_memory_to_generated_schedule_for_date(
            &vault_id,
            &app_state,
            date_parsed,
            &plan,
            ai_scheduled_tasks,
            &generated_at,
            &task_quadrants,
        )?;
        plan.task_order = adjusted_scheduled_tasks
            .iter()
            .map(|task| task.task_id.clone())
            .collect();
        plan.scheduled_tasks = adjusted_scheduled_tasks;
    }
    plan.generated_at = Some(generated_at);

    // Persist AI-generated tasks into goal files so they survive across days
    // and appear in future context assembly.
    if !new_tasks.is_empty() {
        let existing_task_ids: std::collections::HashSet<String> =
            active_goal_tasks_with_effective_scheduled_dates(&vault_id, &app_state)?
                .into_iter()
                .map(|(task, _)| task.id)
                .collect();
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
                            map.insert(
                                "parent_goal_id".into(),
                                serde_yaml::Value::String(gid.clone()),
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
                        write_assistant_goal_mutation(
                            vault,
                            gid,
                            &fm,
                            &body,
                            "assistant_generate_plan_tasks",
                        )
                        .map_err(|e| {
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
                                if let Err(e) = write_assistant_goal_mutation(
                                    vault,
                                    gid,
                                    &fm,
                                    &body,
                                    "assistant_update_recurring_flags",
                                ) {
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
                        if let Err(e) = write_assistant_goal_mutation(
                            vault,
                            gid,
                            &fm,
                            &body,
                            "assistant_generate_subtasks",
                        ) {
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

    plan = write_agenda_markdown_for_plan(
        &vault_id,
        &app_state,
        plan,
        &outcomes,
        if used_ai { "ai" } else { "heuristic" },
        if used_ai {
            Some(model_id.as_str())
        } else {
            None
        },
    )?;
    plan = with_db(&vault_id, &app_state, |db| {
        db.sync_plan_index_from_markdown(&plan)
    })?;

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
    super::subscriptions::require_ai_entitlement().await?;

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
    super::subscriptions::require_ai_entitlement().await?;

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
                let type_value = fm.get("type").and_then(|v| v.as_str());
                let g_domain = fm
                    .get("domain")
                    .and_then(|v| v.as_str())
                    .or_else(|| type_value.filter(|value| !matches!(*value, "goal" | "objective")))
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
                &uuid::Uuid::new_v4().to_string().replace('-', "")[..8]
            );
            let mut map = serde_yaml::Mapping::new();
            map.insert("id".into(), serde_yaml::Value::String(task_id));
            map.insert("title".into(), serde_yaml::Value::String(title.clone()));
            map.insert(
                "status".into(),
                serde_yaml::Value::String("todo".to_string()),
            );
            map.insert(
                "parent_goal_id".into(),
                serde_yaml::Value::String(goal_id.clone()),
            );
            task_seq.push(serde_yaml::Value::Mapping(map));
        }

        fm.insert("tasks".into(), serde_yaml::Value::Sequence(task_seq));
        write_assistant_goal_mutation(
            vault,
            &goal_id,
            &fm,
            &body,
            "assistant_generate_goal_tasks",
        )?;
    }

    Ok(task_titles)
}

#[tauri::command]
pub async fn agenda_chat_reprioritize(
    vault_id: String,
    plan_id: String,
    model_id: String,
    message: String, // user message already stored by send_chat IPC
    app_state: State<'_, AppState>,
) -> Result<ChatReprioritizeResponse, AppError> {
    super::subscriptions::require_ai_entitlement().await?;

    // Get current plan + chat history (user message already stored by send_chat IPC).
    // The markdown Agenda is the visible source of truth, so overlay it before
    // asking the Assistant to make changes.
    let (db_plan, history, outcomes) = with_db(&vault_id, &app_state, |db| {
        Ok((
            db.get_plan_by_id(&plan_id)?,
            db.get_chat_history(&plan_id)?,
            db.get_outcomes_for_plan(&plan_id)?,
        ))
    })?;
    let current_plan = read_agenda_overlay(&vault_id, &app_state, db_plan)?;
    let plan_date = current_plan.date;

    // Gather goals and tasks from vault (Roadmap context) for this Agenda date.
    let (goals, tasks) = gather_vault_context(&vault_id, &app_state, plan_date)?;

    let today = plan_date.format("%Y-%m-%d (%A)").to_string();
    let mut chat_context = format!("## Today's Date\n{today}\n\n## User's Roadmap Goals\n");
    for (gid, title, domain) in &goals {
        let domain_label = domain.as_deref().unwrap_or("Uncategorized");
        chat_context.push_str(&format!("- [{}] {} (id: {})\n", domain_label, title, gid));
    }
    chat_context.push('\n');

    // Include task details so the AI knows what task IDs mean.
    if !tasks.is_empty() {
        chat_context.push_str("## Available Tasks\n");
        for (tid, title, goal_title, due_date, deferral_count, parent_id, has_subtasks, quadrant) in
            &tasks
        {
            let goal_ref = goal_title.as_deref().unwrap_or("unlinked");
            let due = due_date.as_deref().unwrap_or("none");
            let parent_note = parent_id
                .as_ref()
                .map(|p| format!(", subtask of: {p}"))
                .unwrap_or_default();
            let subtask_note = if *has_subtasks { ", has subtasks" } else { "" };
            chat_context.push_str(&format!(
                "- {} (id: {}, goal: {}, due: {}, deferrals: {}, Eisenhower: {}{}{})\n",
                title, tid, goal_ref, due, deferral_count, quadrant, parent_note, subtask_note
            ));
        }
        chat_context.push('\n');
    }

    chat_context.push_str("## Current Plan\n");
    chat_context.push_str("Outcomes:\n");
    if outcomes.is_empty() {
        chat_context.push_str("- none\n");
    } else {
        for outcome in &outcomes {
            chat_context.push_str(&format!(
                "- {} (id: {}, linked_task_ids: {})\n",
                outcome.title,
                outcome.id,
                outcome.linked_task_ids.join(", ")
            ));
        }
    }
    chat_context.push_str(&format!(
        "Task order: {}\n",
        current_plan.task_order.join(", ")
    ));
    if !current_plan.scheduled_tasks.is_empty() {
        chat_context.push_str("Current Agenda schedule:\n");
        for task in &current_plan.scheduled_tasks {
            chat_context.push_str(&format!(
                "- {} {} (task_id: {}, duration: {} min)\n",
                task.start_time, task.title, task.task_id, task.duration_minutes
            ));
        }
    }
    chat_context.push('\n');
    chat_context.push_str("## Chat History\n");
    for msg in &history {
        chat_context.push_str(&format!("{}: {}\n", msg.role.as_str(), msg.content));
    }
    let mut recent_user_messages: Vec<String> = history
        .iter()
        .rev()
        .filter(|msg| matches!(msg.role, ChatRole::User))
        .take(4)
        .map(|msg| msg.content.clone())
        .collect();
    recent_user_messages.reverse();
    if recent_user_messages.last() != Some(&message) {
        recent_user_messages.push(message.clone());
    }
    let deterministic_agenda_context_message = recent_user_messages.join("\n");

    if let Some(memory_context) = memory_prompt_context(&vault_id, &app_state, plan_date)? {
        chat_context.push_str("\n\n");
        chat_context.push_str(&memory_context);
    }

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

    let mut parsed: Value = serde_json::from_str(json_str).unwrap_or_else(
        |_| json!({"message": strip_protocol_json_for_message(&raw), "plan_update": null}),
    );
    let original_memory_update_value = parsed
        .get("memory_update")
        .or_else(|| parsed.get("memoryUpdate"))
        .cloned();

    let requested_regeneration = is_regenerate_agenda_request(&message);
    let chat_adjustments = chat_planning_adjustments(&message, plan_date);
    let deterministic_update_needed =
        requested_regeneration || chat_adjustments.has_actionable_change();
    let actionable_update_requested =
        deterministic_update_needed || message_requests_agenda_change(&message);

    let original_ai_response_text = strip_protocol_json_for_message(
        parsed
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("I've noted your request."),
    );
    let mut attempted_plan_update_repair = false;
    if parsed.get("plan_update").filter(|v| !v.is_null()).is_none()
        && actionable_update_requested
        && !requested_regeneration
    {
        attempted_plan_update_repair = true;
        let repair_context = format!(
            "{chat_context}\n\n## Latest User Request\n{message}\n\n## Previous Assistant Response Missing A Saved Update\n{original_ai_response_text}\n\nReturn corrected JSON now."
        );
        match call_llm(
            &model_id,
            CHAT_REPRIORITIZE_REPAIR_SYSTEM_PROMPT,
            &repair_context,
            1800,
            Some(&app_state),
        )
        .await
        {
            Ok(repair_raw) => {
                let repair_json = extract_json(&repair_raw);
                match serde_json::from_str::<Value>(repair_json) {
                    Ok(repaired)
                        if repaired
                            .get("plan_update")
                            .filter(|v| !v.is_null())
                            .is_some() =>
                    {
                        parsed = repaired;
                    }
                    Ok(_) => {
                        log::warn!("[CHAT] Repair pass did not return a concrete plan_update");
                    }
                    Err(err) => {
                        log::warn!("[CHAT] Repair pass returned invalid JSON: {err}");
                    }
                }
            }
            Err(err) => {
                log::warn!("[CHAT] Repair pass failed: {err}");
            }
        }
    }

    if let Some(update) = parsed.get("plan_update").filter(|v| !v.is_null()) {
        if !plan_update_reorder_changes_visible_order(update, &current_plan) {
            attempted_plan_update_repair = true;
            let previous_response_text = strip_protocol_json_for_message(
                parsed
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or(original_ai_response_text.as_str()),
            );
            let repair_context = format!(
                "{chat_context}\n\n## Latest User Request\n{message}\n\n## Previous Assistant Response With Ineffective Reorder\n{previous_response_text}\n\nThe previous plan_update used action \"reorder\", but it would leave the visible Agenda order unchanged. Return corrected JSON now. The corrected plan_update must move at least one visible scheduled row to a different position, preserve unrelated Agenda rows, and include tasks or scheduled_tasks in the new visible order."
            );
            match call_llm(
                &model_id,
                CHAT_REPRIORITIZE_REPAIR_SYSTEM_PROMPT,
                &repair_context,
                1800,
                Some(&app_state),
            )
            .await
            {
                Ok(repair_raw) => {
                    let repair_json = extract_json(&repair_raw);
                    match serde_json::from_str::<Value>(repair_json) {
                        Ok(repaired)
                            if repaired
                                .get("plan_update")
                                .filter(|v| !v.is_null())
                                .is_some_and(|update| {
                                    plan_update_reorder_changes_visible_order(update, &current_plan)
                                }) =>
                        {
                            parsed = repaired;
                        }
                        Ok(_) => {
                            log::warn!(
                                "[CHAT] Repair pass did not return an effective Agenda reorder"
                            );
                        }
                        Err(err) => {
                            log::warn!("[CHAT] Reorder repair pass returned invalid JSON: {err}");
                        }
                    }
                }
                Err(err) => {
                    log::warn!("[CHAT] Reorder repair pass failed: {err}");
                }
            }
        }
    }

    if parsed
        .get("memory_update")
        .or_else(|| parsed.get("memoryUpdate"))
        .is_none()
    {
        if let (Some(memory_update), Some(parsed_object)) =
            (original_memory_update_value, parsed.as_object_mut())
        {
            parsed_object.insert("memory_update".to_string(), memory_update);
        }
    }

    let ai_response_text = strip_protocol_json_for_message(
        parsed
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or(original_ai_response_text.as_str()),
    );
    let has_explicit_ai_message = parsed
        .get("message")
        .and_then(Value::as_str)
        .is_some_and(|message| !sanitize_llm_text(message, 2000).is_empty());

    let plan_update = parsed.get("plan_update").filter(|v| !v.is_null());
    let requested_update_action = plan_update
        .and_then(|update| update.get("action"))
        .and_then(Value::as_str)
        .map(|action| action.to_string());
    log::info!(
        "[CHAT] AI response: plan_update present={}, repair_attempted={}, raw={}",
        plan_update.is_some(),
        attempted_plan_update_repair,
        plan_update
            .map(|v| v.to_string())
            .unwrap_or_else(|| "null".into())
    );

    let roadmap_update = parse_assistant_roadmap_update(&parsed);
    let roadmap_mutation = apply_assistant_roadmap_update(&vault_id, &app_state, &roadmap_update)?;
    let roadmap_updated = roadmap_mutation.changed();
    let roadmap_response_fallback = roadmap_mutation.response_message().to_string();
    let mut memory_update = parse_assistant_memory_update(&parsed);
    if memory_update.is_empty() {
        memory_update = fallback_memory_update_from_chat_message(&message);
    }
    let memory_update_result =
        apply_assistant_memory_update(&vault_id, &app_state, &memory_update)?;
    let memory_response_note = memory_update_result.response_note();
    let fresh_regeneration = if requested_regeneration {
        Some(
            fresh_agenda_regeneration(
                &vault_id,
                &app_state,
                &model_id,
                &current_plan,
                &goals,
                &tasks,
                &message,
            )
            .await?,
        )
    } else {
        None
    };

    let regeneration_generated_at = chrono::Local::now().to_rfc3339();
    let task_quadrants = if deterministic_update_needed {
        Some(task_quadrants_from_vault(
            &vault_id,
            &app_state,
            current_plan.date,
        )?)
    } else {
        None
    };

    // Store AI response and optionally update plan.
    let mut task_scheduled_date_updates: Vec<(String, Option<String>, String)> = Vec::new();
    let (
        mut response_text,
        plan_updated,
        updated_plan,
        chat_task_titles,
        new_chat_tasks,
        chat_outcome_updates,
    ) = with_db(&vault_id, &app_state, |db| {
        let mut new_task_titles: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        let mut new_chat_tasks: Vec<(String, String, String, Option<String>)> = Vec::new();
        let mut outcome_updates = Vec::new();
        let mut plan_updated = false;
        let mut updated_plan = None;
        let mut applied_structured_action: Option<String> = None;
        let mut used_between_insertion_title: Option<String> = None;
        let mut used_morning_routine_insertion = false;
        let mut used_fresh_regeneration = false;
        let mut used_direct_agenda_task_add = false;

        if let Some(regeneration) = fresh_regeneration.as_ref() {
            if !regeneration.task_titles.is_empty() {
                db.merge_task_titles(&plan_id, &regeneration.task_titles)?;
                new_task_titles.extend(regeneration.task_titles.clone());
            }
            new_chat_tasks.extend(regeneration.new_tasks.clone());
            outcome_updates = regeneration.outcome_specs.clone();

            let mut plan = db.update_plan(&plan_id, None, Some(regeneration.task_order.clone()))?;
            plan.generated_at = Some(regeneration.generated_at.clone());
            plan.scheduled_tasks = regeneration.scheduled_tasks.clone();
            plan.task_titles.extend(regeneration.task_titles.clone());
            if !plan.scheduled_tasks.is_empty() {
                plan.task_order = plan
                    .scheduled_tasks
                    .iter()
                    .map(|task| task.task_id.clone())
                    .collect();
            }
            plan_updated = true;
            updated_plan = Some(plan);
            used_fresh_regeneration = true;
        }

        if !plan_updated {
            if let Some((adjusted_plan, title)) =
                insert_between_agenda_tasks_update(&current_plan, &message, &tasks).or_else(|| {
                    message_is_direct_agenda_followup(&message).then(|| {
                        insert_between_agenda_tasks_update(
                            &current_plan,
                            &deterministic_agenda_context_message,
                            &tasks,
                        )
                    })?
                })
            {
                db.merge_task_titles(&plan_id, &adjusted_plan.task_titles)?;
                let mut plan =
                    db.update_plan(&plan_id, None, Some(adjusted_plan.task_order.clone()))?;
                plan.generated_at = adjusted_plan.generated_at.clone();
                plan.scheduled_tasks = adjusted_plan.scheduled_tasks.clone();
                plan.task_titles = adjusted_plan.task_titles.clone();
                plan_updated = true;
                updated_plan = Some(plan);
                used_between_insertion_title = Some(title);
            }
        }

        let mut used_breakfast_duration_update = false;
        if !plan_updated {
            if let Some(adjusted_plan) = breakfast_duration_update(&current_plan, &message) {
                db.merge_task_titles(&plan_id, &adjusted_plan.task_titles)?;
                let mut plan =
                    db.update_plan(&plan_id, None, Some(adjusted_plan.task_order.clone()))?;
                plan.generated_at = adjusted_plan.generated_at.clone();
                plan.scheduled_tasks = adjusted_plan.scheduled_tasks.clone();
                plan.task_titles = adjusted_plan.task_titles.clone();
                plan_updated = true;
                updated_plan = Some(plan);
                used_breakfast_duration_update = true;
            }
        }

        if !plan_updated {
            if let Some(adjusted_plan) = insert_morning_routine_after_breakfast_update(
                &current_plan,
                &message,
                &deterministic_agenda_context_message,
            ) {
                db.merge_task_titles(&plan_id, &adjusted_plan.task_titles)?;
                let mut plan =
                    db.update_plan(&plan_id, None, Some(adjusted_plan.task_order.clone()))?;
                plan.generated_at = adjusted_plan.generated_at.clone();
                plan.scheduled_tasks = adjusted_plan.scheduled_tasks.clone();
                plan.task_titles = adjusted_plan.task_titles.clone();
                plan_updated = true;
                updated_plan = Some(plan);
                used_morning_routine_insertion = true;
            }
        }

        if !plan_updated {
            if let Some(adjusted_plan) = direct_agenda_task_update(&current_plan, &message) {
                db.merge_task_titles(&plan_id, &adjusted_plan.task_titles)?;
                let mut plan =
                    db.update_plan(&plan_id, None, Some(adjusted_plan.task_order.clone()))?;
                plan.generated_at = adjusted_plan.generated_at.clone();
                plan.scheduled_tasks = adjusted_plan.scheduled_tasks.clone();
                plan.task_titles = adjusted_plan.task_titles.clone();
                plan_updated = true;
                updated_plan = Some(plan);
                used_direct_agenda_task_add = true;
            }
        }

        if !plan_updated {
            if let Some(update) = plan_update {
                outcome_updates = parse_chat_outcome_updates(update);
                // Parse action type. Default to "reorder" for backward compat.
                let action = update
                    .get("action")
                    .and_then(Value::as_str)
                    .unwrap_or("reorder");
                let scheduled_updates = parse_ai_scheduled_tasks(update);
                for task in &scheduled_updates {
                    if !task.title.trim().is_empty() {
                        new_task_titles.insert(task.task_id.clone(), task.title.clone());
                    }
                }

                // Parse tasks array — supports both "tasks" (new) and "ordered_tasks" (legacy)
                let tasks_arr = update
                    .get("tasks")
                    .and_then(Value::as_array)
                    .or_else(|| update.get("ordered_tasks").and_then(Value::as_array));

                let mut parsed_ids: Vec<String> = Vec::new();
                let mut removal_targets: Vec<(String, Option<String>)> = Vec::new();
                // Track tasks bound to a different specific day so they stay off this Agenda.
                let mut off_date_scheduled_ids: std::collections::HashSet<String> =
                    std::collections::HashSet::new();
                let plan_date_text = plan_date.to_string();
                if let Some(arr) = tasks_arr {
                    for item in arr {
                        if let Some(s) = item.as_str() {
                            let id = sanitize_task_id(s);
                            if !id.is_empty() {
                                removal_targets.push((id.clone(), None));
                                parsed_ids.push(id);
                            }
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
                                removal_targets.push((
                                    id.clone(),
                                    (!title.is_empty()).then_some(title.clone()),
                                ));
                                // A scheduled_date is an exact Agenda date, not a "show on or after" date.
                                if let Some(ref sd) = scheduled_date {
                                    if sd != &plan_date_text {
                                        off_date_scheduled_ids.insert(id.clone());
                                    }
                                    task_scheduled_date_updates.push((
                                        id.clone(),
                                        (!goal_id.is_empty()).then_some(goal_id.clone()),
                                        sd.clone(),
                                    ));
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
                            } else if !title.is_empty() {
                                removal_targets.push((String::new(), Some(title)));
                            }
                        }
                    }
                }
                if parsed_ids.is_empty() && !scheduled_updates.is_empty() {
                    parsed_ids = scheduled_updates
                        .iter()
                        .map(|task| task.task_id.clone())
                        .collect();
                    removal_targets = scheduled_updates
                        .iter()
                        .map(|task| (task.task_id.clone(), Some(task.title.clone())))
                        .collect();
                }

                log::info!(
                    "[CHAT] action={}, parsed {} task IDs, {} schedule rows, {} titles",
                    action,
                    parsed_ids.len(),
                    scheduled_updates.len(),
                    new_task_titles.len()
                );

                // Get the current task order so we can merge
                let current_order = current_plan.task_order.clone();
                let mut removed_scheduled_tasks: Option<Vec<agenda::ScheduledTask>> = None;

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
                        // Remove one visible row for each requested target. This keeps duplicate
                        // Agenda rows distinguishable instead of removing every row with the same ID.
                        removed_scheduled_tasks = remove_scheduled_tasks_once(
                            &current_plan.scheduled_tasks,
                            &removal_targets,
                            &message,
                        );
                        removed_scheduled_tasks
                            .as_ref()
                            .map(|scheduled| {
                                scheduled
                                    .iter()
                                    .map(|task| task.task_id.clone())
                                    .collect::<Vec<_>>()
                            })
                            .unwrap_or_else(|| remove_task_ids_once(&current_order, &parsed_ids))
                    }
                    "reorder" => {
                        // Preserve unrelated rows if the Assistant only returned the moved subset.
                        merge_partial_reorder(&current_order, &parsed_ids)
                    }
                    "replace" | "regenerate" => {
                        // Full replacement of task order
                        if parsed_ids.is_empty() {
                            current_order.clone()
                        } else {
                            parsed_ids.clone()
                        }
                    }
                    "reschedule" | "update" | "update_schedule" => {
                        // Time/duration/title updates may include only the changed task.
                        // Keep unrelated visible rows unless the Assistant supplied a full
                        // reorder of the same rows. If the update introduces a new fixed-time
                        // row, keep it instead of dropping it because the action was mislabeled.
                        merge_schedule_update_order(&current_order, &parsed_ids)
                    }
                    _ => {
                        log::warn!("[CHAT] Unknown action '{}', treating as reorder", action);
                        if !scheduled_updates.is_empty() || parsed_ids.is_empty() {
                            current_order.clone()
                        } else {
                            parsed_ids.clone()
                        }
                    }
                };

                // Remove exact-date tasks that belong to a different Agenda date.
                let mut final_order: Vec<String> = final_order
                    .into_iter()
                    .filter(|id| !off_date_scheduled_ids.contains(id))
                    .collect();
                if let Some(schedule_order) =
                    scheduled_update_order_for_action(action, &current_order, &scheduled_updates)
                {
                    final_order = schedule_order
                        .into_iter()
                        .filter(|id| !off_date_scheduled_ids.contains(id))
                        .collect();
                }

                // Always persist new task titles (even if order didn't change,
                // off-date scheduled tasks still need their titles stored)
                if !new_task_titles.is_empty() {
                    db.merge_task_titles(&plan_id, &new_task_titles)?;
                }

                let order_changed = final_order != current_order;
                let schedule_updates_complete =
                    scheduled_updates_cover_order(&scheduled_updates, &final_order);
                let can_apply_partial_schedule =
                    matches!(action, "add" | "reschedule" | "update" | "update_schedule");
                let final_scheduled_tasks = if action == "remove" {
                    removed_scheduled_tasks.or_else(|| {
                        filter_existing_schedule_to_order(
                            &current_plan.scheduled_tasks,
                            &final_order,
                        )
                    })
                } else if matches!(action, "reorder" | "replace" | "regenerate")
                    && order_changed
                    && !schedule_updates_complete
                {
                    reorder_schedule_with_partial_updates(
                        &current_plan.scheduled_tasks,
                        &final_order,
                        &scheduled_updates,
                    )
                } else if !scheduled_updates.is_empty()
                    && (!order_changed || schedule_updates_complete || can_apply_partial_schedule)
                {
                    Some(merge_chat_schedule_updates(
                        &current_plan.scheduled_tasks,
                        &final_order,
                        scheduled_updates,
                        action,
                    ))
                } else if scheduled_updates.is_empty()
                    && order_changed
                    && matches!(action, "reorder" | "replace" | "regenerate")
                {
                    reorder_existing_schedule(&current_plan.scheduled_tasks, &final_order)
                } else {
                    None
                };
                let schedule_changed = final_scheduled_tasks.as_ref().is_some_and(|scheduled| {
                    !scheduled_tasks_equivalent(scheduled, &current_plan.scheduled_tasks)
                });
                let schedule_order_changed = scheduled_task_order_changed(
                    final_scheduled_tasks.as_deref(),
                    &current_plan.scheduled_tasks,
                );
                let visible_title_changed = new_task_titles.iter().any(|(id, title)| {
                    final_order.contains(id) && current_plan.task_titles.get(id) != Some(title)
                });
                let has_required_visible_effect = action_has_required_visible_effect(
                    action,
                    order_changed,
                    schedule_changed,
                    schedule_order_changed,
                    visible_title_changed,
                );

                if has_required_visible_effect {
                    let mut plan = db.update_plan(&plan_id, None, Some(final_order.clone()))?;
                    if let Some(scheduled_tasks) = final_scheduled_tasks {
                        plan.scheduled_tasks = scheduled_tasks;
                        plan.task_order = plan
                            .scheduled_tasks
                            .iter()
                            .map(|task| task.task_id.clone())
                            .collect();
                        for task in &plan.scheduled_tasks {
                            plan.task_titles
                                .insert(task.task_id.clone(), task.title.clone());
                        }
                    }
                    plan_updated = true;
                    updated_plan = Some(plan);
                    applied_structured_action = Some(action.to_string());
                } else if !outcome_updates.is_empty()
                    && !action_requires_visible_agenda_change(action)
                {
                    plan_updated = true;
                    updated_plan = Some(current_plan.clone());
                }
            }
        }

        let mut used_fixed_time_commitment = false;
        if !plan_updated {
            if let Some(adjusted_plan) = fixed_time_commitment_update(&current_plan, &message) {
                db.merge_task_titles(&plan_id, &adjusted_plan.task_titles)?;
                let mut plan =
                    db.update_plan(&plan_id, None, Some(adjusted_plan.task_order.clone()))?;
                plan.generated_at = adjusted_plan.generated_at.clone();
                plan.scheduled_tasks = adjusted_plan.scheduled_tasks.clone();
                plan.task_titles = adjusted_plan.task_titles.clone();
                plan_updated = true;
                updated_plan = Some(plan);
                used_fixed_time_commitment = true;
            }
        }

        let mut used_explicit_schedule_instruction = false;
        if !plan_updated {
            if let Some(adjusted_plan) =
                explicit_schedule_instruction_update(&current_plan, &message).or_else(|| {
                    explicit_schedule_instruction_update(
                        &current_plan,
                        &deterministic_agenda_context_message,
                    )
                })
            {
                db.merge_task_titles(&plan_id, &adjusted_plan.task_titles)?;
                let mut plan =
                    db.update_plan(&plan_id, None, Some(adjusted_plan.task_order.clone()))?;
                plan.generated_at = adjusted_plan.generated_at.clone();
                plan.scheduled_tasks = adjusted_plan.scheduled_tasks.clone();
                plan.task_titles = adjusted_plan.task_titles.clone();
                plan_updated = true;
                updated_plan = Some(plan);
                used_explicit_schedule_instruction = true;
            }
        }

        let mut used_first_task_instruction = false;
        if !plan_updated {
            if let Some(adjusted_plan) = first_task_instruction_update(&current_plan, &message)
                .or_else(|| {
                    first_task_instruction_update(
                        &current_plan,
                        &deterministic_agenda_context_message,
                    )
                })
            {
                db.merge_task_titles(&plan_id, &adjusted_plan.task_titles)?;
                let mut plan =
                    db.update_plan(&plan_id, None, Some(adjusted_plan.task_order.clone()))?;
                plan.generated_at = adjusted_plan.generated_at.clone();
                plan.scheduled_tasks = adjusted_plan.scheduled_tasks.clone();
                plan.task_titles = adjusted_plan.task_titles.clone();
                plan_updated = true;
                updated_plan = Some(plan);
                used_first_task_instruction = true;
            }
        }

        let mut used_dependency_reorder = false;
        if !plan_updated {
            if let Some(adjusted_plan) = dependency_reorder_from_message(
                &current_plan,
                &deterministic_agenda_context_message,
            ) {
                db.merge_task_titles(&plan_id, &adjusted_plan.task_titles)?;
                let mut plan =
                    db.update_plan(&plan_id, None, Some(adjusted_plan.task_order.clone()))?;
                plan.generated_at = adjusted_plan.generated_at.clone();
                plan.scheduled_tasks = adjusted_plan.scheduled_tasks.clone();
                plan.task_titles = adjusted_plan.task_titles.clone();
                plan_updated = true;
                updated_plan = Some(plan);
                used_dependency_reorder = true;
            }
        }

        let mut used_planning_adjustments = false;
        if !plan_updated && chat_adjustments.has_actionable_change() {
            if let Some(quadrants) = task_quadrants.as_ref() {
                if let Some(adjusted_plan) = apply_chat_planning_adjustments(
                    &current_plan,
                    &chat_adjustments,
                    &regeneration_generated_at,
                    quadrants,
                ) {
                    db.merge_task_titles(&plan_id, &adjusted_plan.task_titles)?;
                    let mut plan =
                        db.update_plan(&plan_id, None, Some(adjusted_plan.task_order.clone()))?;
                    plan.generated_at = adjusted_plan.generated_at.clone();
                    plan.scheduled_tasks = adjusted_plan.scheduled_tasks.clone();
                    plan.task_titles = adjusted_plan.task_titles.clone();
                    plan_updated = true;
                    updated_plan = Some(plan);
                    used_planning_adjustments = true;
                }
            }
        }

        let mut used_regeneration_fallback = false;
        if !plan_updated && requested_regeneration {
            let current_order = current_plan.task_order.clone();
            let regenerated_order = regenerated_task_order(&tasks, &current_order);
            if !regenerated_order.is_empty() {
                let regenerated_titles =
                    task_titles_for_order(&tasks, &current_plan, &regenerated_order);
                if !regenerated_titles.is_empty() {
                    db.merge_task_titles(&plan_id, &regenerated_titles)?;
                    new_task_titles.extend(regenerated_titles);
                }

                let mut plan = db.update_plan(&plan_id, None, Some(regenerated_order.clone()))?;
                for (task_id, title) in &new_task_titles {
                    plan.task_titles.insert(task_id.clone(), title.clone());
                }
                plan.generated_at = Some(regeneration_generated_at.clone());
                if let Some(quadrants) = task_quadrants.as_ref() {
                    plan.scheduled_tasks =
                        build_scheduled_tasks(&plan, &regeneration_generated_at, quadrants);
                    plan.task_order = plan
                        .scheduled_tasks
                        .iter()
                        .map(|task| task.task_id.clone())
                        .collect();
                }
                plan_updated = true;
                updated_plan = Some(plan);
                used_regeneration_fallback = true;
            }
        }

        let response_text = if used_fresh_regeneration {
            "I regenerated your Agenda from scratch using today's Roadmap and Memory.".to_string()
        } else if used_regeneration_fallback {
            "I regenerated your Agenda from your current Roadmap tasks.".to_string()
        } else if used_planning_adjustments && chat_adjustments.earliest_start.is_some() {
            format!(
                "I moved your Agenda to start no earlier than {}.",
                format_schedule_time(chat_adjustments.earliest_start.unwrap())
            )
        } else if used_planning_adjustments {
            "I updated your Agenda around those planning constraints.".to_string()
        } else if used_fixed_time_commitment {
            "I added that fixed-time commitment to your Agenda.".to_string()
        } else if used_explicit_schedule_instruction {
            "I updated your Agenda to match the schedule you gave.".to_string()
        } else if used_first_task_instruction {
            "I updated your Agenda so the requested task is first at that time.".to_string()
        } else if used_dependency_reorder {
            "I reordered your Agenda so the prerequisite comes before the dependent task."
                .to_string()
        } else if used_direct_agenda_task_add {
            "I added that task to your Agenda.".to_string()
        } else if let Some(title) = used_between_insertion_title.as_deref() {
            format!("I added {title} between those Agenda tasks.")
        } else if used_breakfast_duration_update {
            "I updated the breakfast duration in your Agenda.".to_string()
        } else if used_morning_routine_insertion {
            "I added those morning routine tasks after breakfast.".to_string()
        } else if let Some(message) = applied_structured_action
            .as_deref()
            .and_then(structured_agenda_update_message)
        {
            message.to_string()
        } else if !task_scheduled_date_updates.is_empty() {
            ai_response_text.clone()
        } else if roadmap_updated && !has_explicit_ai_message {
            roadmap_response_fallback.clone()
        } else if !plan_updated
            && requested_update_action
                .as_deref()
                .is_some_and(action_requires_visible_agenda_change)
        {
            "I checked the Agenda, but that update did not create a visible schedule change."
                .to_string()
        } else if !plan_updated && actionable_update_requested {
            "I checked the Agenda, but I couldn't make that schedule change.".to_string()
        } else {
            ai_response_text.clone()
        };
        let response_text = append_memory_response_note(response_text, memory_response_note);
        // Even when the visible Agenda didn't change, return new tasks so they get
        // persisted to vault files (e.g. off-date scheduled tasks from chat).
        Ok((
            response_text,
            plan_updated,
            updated_plan,
            new_task_titles,
            new_chat_tasks,
            outcome_updates,
        ))
    })?;

    apply_assistant_task_scheduled_dates(&vault_id, &app_state, &task_scheduled_date_updates)?;

    // Persist any brand-new AI-generated tasks into goal files (outside DB closure)
    if !new_chat_tasks.is_empty() {
        let existing_task_ids: std::collections::HashSet<String> =
            active_goal_tasks_with_effective_scheduled_dates(&vault_id, &app_state)?
                .into_iter()
                .map(|(task, _)| task.id)
                .collect();
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
                            map.insert(
                                "parent_goal_id".into(),
                                serde_yaml::Value::String(gid.clone()),
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
                        write_assistant_goal_mutation(
                            vault,
                            gid,
                            &fm,
                            &body,
                            "assistant_chat_add_tasks",
                        )
                        .map_err(|e| {
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

    let updated_plan = if let Some(mut plan) = updated_plan {
        let mut memory_trimmed_schedule = false;
        if !plan.scheduled_tasks.is_empty() {
            let original_scheduled_tasks = plan.scheduled_tasks.clone();
            let adjusted_scheduled_tasks = if requested_regeneration {
                let fallback_quadrants;
                let quadrants = match task_quadrants.as_ref() {
                    Some(quadrants) => quadrants,
                    None => {
                        fallback_quadrants =
                            task_quadrants_from_vault(&vault_id, &app_state, plan.date)?;
                        &fallback_quadrants
                    }
                };
                let generated_at = plan
                    .generated_at
                    .clone()
                    .unwrap_or_else(|| regeneration_generated_at.clone());
                apply_memory_to_generated_schedule_for_date(
                    &vault_id,
                    &app_state,
                    plan.date,
                    &plan,
                    original_scheduled_tasks.clone(),
                    &generated_at,
                    quadrants,
                )?
            } else {
                apply_memory_limits_to_explicit_schedule_for_date(
                    &vault_id,
                    &app_state,
                    plan.date,
                    original_scheduled_tasks.clone(),
                )?
            };
            let original_minutes: i32 = original_scheduled_tasks
                .iter()
                .map(|task| task.duration_minutes.max(0))
                .sum();
            let adjusted_minutes: i32 = adjusted_scheduled_tasks
                .iter()
                .map(|task| task.duration_minutes.max(0))
                .sum();
            memory_trimmed_schedule = adjusted_scheduled_tasks.len()
                < original_scheduled_tasks.len()
                || adjusted_minutes < original_minutes;

            if !scheduled_tasks_equivalent(&adjusted_scheduled_tasks, &original_scheduled_tasks) {
                plan.scheduled_tasks = adjusted_scheduled_tasks;
                plan.task_order = plan
                    .scheduled_tasks
                    .iter()
                    .map(|task| task.task_id.clone())
                    .collect();
                for task in &plan.scheduled_tasks {
                    plan.task_titles
                        .insert(task.task_id.clone(), task.title.clone());
                }
            }
            if requested_regeneration {
                align_today_regenerated_schedule_after_now(&mut plan);
            }
        }
        let (plan, outcomes) = with_db(&vault_id, &app_state, |db| {
            sync_outcomes_for_schedule(db, &plan, &chat_outcome_updates)
        })?;
        let written = write_agenda_markdown_for_plan(
            &vault_id,
            &app_state,
            plan,
            &outcomes,
            "ai",
            Some(model_id.as_str()),
        )?;
        let synced = with_db(&vault_id, &app_state, |db| {
            db.sync_plan_index_from_markdown(&written)
        })?;
        if memory_trimmed_schedule && !response_text.contains("task-hour capacity in Memory") {
            response_text = format!(
                "{} {}",
                response_text.trim_end(),
                "I kept the saved Agenda within the task-hour capacity in Memory, so work beyond that limit was left off."
            );
        }
        Some(synced)
    } else {
        None
    };

    let ai_msg = with_db(&vault_id, &app_state, |db| {
        db.add_chat_message(&plan_id, ChatRole::Ai, &response_text)
    })?;

    Ok(ChatReprioritizeResponse {
        ai_message: ai_msg,
        plan_updated,
        updated_plan,
        task_titles: chat_task_titles,
    })
}

#[tauri::command]
pub async fn agenda_generate_summary(
    vault_id: String,
    model_id: String,
    date: String,
    app_state: State<'_, AppState>,
) -> Result<String, AppError> {
    super::subscriptions::require_ai_entitlement().await?;

    let date_parsed = date
        .parse::<NaiveDate>()
        .map_err(|_| AppError::validation_error(format!("Invalid date: {date}")))?;

    // Gather today's Agenda data for summary context
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
