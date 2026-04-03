//! Integration commands for AI model providers (OpenAI + Anthropic only).

use keyring::Entry;
use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::State;

use crate::commands::auth::read_user_id_from_keychain;
use crate::commands::vault::AppState;
use crate::error::AppError;

const OPENAI_PROVIDER: &str = "openai";
const ANTHROPIC_PROVIDER: &str = "anthropic";
const MODEL_OPTION_SEPARATOR: &str = "::";
const MODEL_AGENT_MODE_GENERAL: &str = "general";
const MODEL_AGENT_MODE_CODING: &str = "coding";
const LOCAL_SDK_MODEL_OVERRIDE_SEPARATOR: &str = "#";
const OPENAI_AGENTS_SDK_MODEL: &str = "sdk-openai-agents";
const OPENAI_CODEX_SDK_MODEL: &str = "sdk-openai-codex";
const CLAUDE_AGENT_SDK_MODEL: &str = "sdk-claude-agent";
const OPENAI_AGENTS_PACKAGE: &str = "@openai/agents";
const OPENAI_CODEX_PACKAGE: &str = "@openai/codex-sdk";
const CLAUDE_AGENT_PACKAGE: &str = "@anthropic-ai/claude-agent-sdk";
const OPENAI_LOCAL_MODEL_OVERRIDES: [(&str, &str); 3] = [
    ("gpt-5", "GPT-5"),
    ("gpt-5-mini", "GPT-5 Mini"),
    ("gpt-4.1", "GPT-4.1"),
];
const ANTHROPIC_LOCAL_MODEL_OVERRIDES: [(&str, &str); 4] = [
    ("claude-sonnet-4-6", "Claude Sonnet 4.6"),
    ("claude-opus-4-6", "Claude Opus 4.6"),
    ("claude-sonnet-4-5-20250929", "Claude Sonnet 4.5"),
    ("claude-haiku-4-5-20251001", "Claude Haiku 4.5"),
];
const OPENAI_MODELS_URL: &str = "https://api.openai.com/v1/models";
const OPENAI_CHAT_COMPLETIONS_URL: &str = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_MODELS_URL: &str = "https://api.anthropic.com/v1/models";
const ANTHROPIC_MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION: &str = "2023-06-01";
const INTEGRATION_KEYCHAIN_SERVICE: &str = "com.goalrate.desktop.integrations";
const OPENAI_KEYCHAIN_ACCOUNT: &str = "openai_api_key";
const ANTHROPIC_KEYCHAIN_ACCOUNT: &str = "anthropic_api_key";
const INTEGRATION_DEVICE_SCOPE: &str = "device";
const ALLOW_ENV_API_KEY_FALLBACK_ENV: &str = "GOALRATE_ALLOW_ENV_API_KEYS";
const GOAL_PLANNER_CONTEXT_MAX_FILES: usize = 40;
const GOAL_PLANNER_CONTEXT_MAX_CHARS: usize = 10_000;
const GOAL_PLANNER_CONTEXT_TITLE_MAX_CHARS: usize = 100;
const GOAL_PLANNER_CONTEXT_SUMMARY_MAX_CHARS: usize = 180;

/// Resilient wrapper around `read_user_id_from_keychain` that never errors.
/// If the auth keychain is missing, corrupt, or inaccessible, returns `None`
/// so that API key operations still work using device-scoped entries.
fn try_read_user_id() -> Option<String> {
    match read_user_id_from_keychain() {
        Ok(id) => id,
        Err(e) => {
            log::debug!(
                "No user id available for key scoping (this is normal if not logged in): {}",
                e
            );
            None
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelOption {
    pub id: String,
    pub label: String,
    pub provider_id: String,
    pub provider: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderOption {
    pub id: String,
    pub label: String,
    pub connection_type: String,
    pub connected: bool,
    pub ready: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAvailableModelsResponse {
    pub models: Vec<AiModelOption>,
    pub providers: Vec<AiProviderOption>,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationGoalJourneySpecResponse {
    pub name: String,
    pub actor: Option<String>,
    pub trigger: Option<String>,
    pub steps: Option<Vec<String>>,
    pub success_criteria: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationGoalPlanResponse {
    pub title: String,
    /// AI-assessed priority: critical, high, medium, or low
    pub priority: Option<String>,
    pub milestones: Vec<String>,
    pub summary: Option<String>,
    pub goal_overview: Option<String>,
    pub scope_in: Option<Vec<String>>,
    pub scope_out: Option<Vec<String>>,
    pub user_journey_specs: Option<Vec<IntegrationGoalJourneySpecResponse>>,
    pub system_journey_specs: Option<Vec<IntegrationGoalJourneySpecResponse>>,
    pub milestone_briefs: Option<Vec<String>>,
    pub milestone_tasks: Option<Vec<Vec<String>>>,
    pub task_briefs: Option<Vec<Vec<String>>>,
    pub acceptance_criteria: Option<Vec<String>>,
    pub guardrails: Option<Vec<String>>,
    pub working_rules: Option<Vec<String>>,
    pub quality_gates: Option<Vec<String>>,
    pub definition_of_done: Option<Vec<String>>,
    pub schema: Option<String>,
    pub flows: Option<String>,
}

fn allow_env_api_key_fallback() -> bool {
    std::env::var(ALLOW_ENV_API_KEY_FALLBACK_ENV)
        .ok()
        .map(|value| value.trim().to_lowercase())
        .map(|value| value == "1" || value == "true" || value == "yes")
        .unwrap_or(false)
}

fn openai_api_key() -> Option<String> {
    match read_openai_api_key_from_keychain() {
        Ok(Some(api_key)) => Some(api_key),
        Ok(None) => {
            if allow_env_api_key_fallback() {
                openai_api_key_from_env()
            } else {
                None
            }
        }
        Err(err) => {
            log::warn!("Failed to read OpenAI API key from secure storage: {}", err);
            if allow_env_api_key_fallback() {
                openai_api_key_from_env()
            } else {
                None
            }
        }
    }
}

fn openai_api_key_from_env() -> Option<String> {
    std::env::var("GOALRATE_OPENAI_API_KEY")
        .ok()
        .or_else(|| std::env::var("OPENAI_API_KEY").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn anthropic_api_key_from_env() -> Option<String> {
    std::env::var("GOALRATE_ANTHROPIC_API_KEY")
        .ok()
        .or_else(|| std::env::var("ANTHROPIC_API_KEY").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn anthropic_api_key() -> Option<String> {
    match read_anthropic_api_key_from_keychain() {
        Ok(Some(api_key)) => Some(api_key),
        Ok(None) => {
            if allow_env_api_key_fallback() {
                anthropic_api_key_from_env()
            } else {
                None
            }
        }
        Err(err) => {
            log::warn!(
                "Failed to read Anthropic API key from secure storage: {}",
                err
            );
            if allow_env_api_key_fallback() {
                anthropic_api_key_from_env()
            } else {
                None
            }
        }
    }
}

fn openai_keychain_account(user_id: Option<&str>) -> String {
    let scope = user_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(INTEGRATION_DEVICE_SCOPE);
    format!("{OPENAI_KEYCHAIN_ACCOUNT}::{scope}")
}

fn anthropic_keychain_account(user_id: Option<&str>) -> String {
    let scope = user_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(INTEGRATION_DEVICE_SCOPE);
    format!("{ANTHROPIC_KEYCHAIN_ACCOUNT}::{scope}")
}

fn openai_keyring_entry(user_id: Option<&str>) -> Result<Entry, AppError> {
    let account = openai_keychain_account(user_id);
    Entry::new(INTEGRATION_KEYCHAIN_SERVICE, &account).map_err(|err| {
        AppError::auth_error(format!(
            "Failed to access secure storage for OpenAI key: {}",
            err
        ))
    })
}

fn anthropic_keyring_entry(user_id: Option<&str>) -> Result<Entry, AppError> {
    let account = anthropic_keychain_account(user_id);
    Entry::new(INTEGRATION_KEYCHAIN_SERVICE, &account).map_err(|err| {
        AppError::auth_error(format!(
            "Failed to access secure storage for Anthropic key: {}",
            err
        ))
    })
}

fn read_trimmed_secret(entry: &Entry) -> Result<Option<String>, AppError> {
    match entry.get_password() {
        Ok(secret) => {
            let trimmed = secret.trim();
            if trimmed.is_empty() {
                log::debug!("[API-KEY] read_trimmed_secret: got empty secret");
                Ok(None)
            } else {
                log::debug!(
                    "[API-KEY] read_trimmed_secret: got secret, len={}",
                    trimmed.len()
                );
                Ok(Some(trimmed.to_string()))
            }
        }
        Err(keyring::Error::NoEntry) => {
            log::debug!("[API-KEY] read_trimmed_secret: NoEntry");
            Ok(None)
        }
        Err(keyring::Error::NoStorageAccess(_)) => {
            log::warn!(
                "[API-KEY] read_trimmed_secret: NoStorageAccess (keychain locked or unsigned app?)"
            );
            Ok(None)
        }
        Err(err) => {
            log::warn!("[API-KEY] read_trimmed_secret: error: {} ({:?})", err, err);
            // In dev mode, keychain errors are common (unsigned binary).
            // Treat as "not found" instead of hard error so the app stays functional.
            Ok(None)
        }
    }
}

// ── Plaintext key file cleanup ──────────────────────────────────────────
// Previous versions stored keys in ~/.goalrate/api-keys/<provider> as plaintext
// fallback. These helpers clean up those files during store/delete operations.

fn api_key_file_path(provider: &str) -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".goalrate").join("api-keys").join(provider))
}

fn delete_api_key_file(provider: &str) {
    if let Some(path) = api_key_file_path(provider) {
        if path.exists() {
            let _ = std::fs::remove_file(&path);
            log::info!(
                "[API-KEY] Cleaned up legacy plaintext key file for {}",
                provider
            );
        }
    }
}

pub(crate) fn read_openai_api_key_from_keychain() -> Result<Option<String>, AppError> {
    let user_id = try_read_user_id();

    if let Some(user_id) = user_id.as_deref() {
        let user_entry = openai_keyring_entry(Some(user_id))?;
        if let Some(secret) = read_trimmed_secret(&user_entry)? {
            return Ok(Some(secret));
        }
    }

    let device_entry = openai_keyring_entry(None)?;
    read_trimmed_secret(&device_entry)
}

pub(crate) fn read_anthropic_api_key_from_keychain() -> Result<Option<String>, AppError> {
    let user_id = try_read_user_id();

    if let Some(user_id) = user_id.as_deref() {
        let user_entry = anthropic_keyring_entry(Some(user_id))?;
        if let Some(secret) = read_trimmed_secret(&user_entry)? {
            return Ok(Some(secret));
        }
    }

    let device_entry = anthropic_keyring_entry(None)?;
    read_trimmed_secret(&device_entry)
}

fn store_openai_api_key_in_keychain(api_key: &str) -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![openai_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(openai_keyring_entry(Some(user_id))?);
    }
    for entry in &entries {
        entry.set_password(api_key).map_err(|err| {
            AppError::auth_error(format!(
                "Failed to store OpenAI key in secure storage: {}",
                err
            ))
        })?;
    }
    // Clean up any legacy plaintext file
    delete_api_key_file("openai");
    Ok(())
}

fn store_anthropic_api_key_in_keychain(api_key: &str) -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![anthropic_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(anthropic_keyring_entry(Some(user_id))?);
    }
    for entry in &entries {
        entry.set_password(api_key).map_err(|err| {
            AppError::auth_error(format!(
                "Failed to store Anthropic key in secure storage: {}",
                err
            ))
        })?;
    }
    // Clean up any legacy plaintext file
    delete_api_key_file("anthropic");
    Ok(())
}

fn delete_openai_api_key_from_keychain() -> Result<(), AppError> {
    // File-based storage (no keychain prompts)
    delete_api_key_file("openai");

    // Also remove legacy keychain entries so read_openai_api_key_from_keychain()
    // doesn't fall back to the old entry and recreate the file.
    let user_id = try_read_user_id();
    if let Ok(entry) = openai_keyring_entry(None) {
        if let Err(e) = entry.delete_credential() {
            log::warn!("Failed to delete legacy keychain entry (anonymous): {e}");
        }
    }
    if let Some(uid) = user_id.as_deref() {
        if let Ok(entry) = openai_keyring_entry(Some(uid)) {
            if let Err(e) = entry.delete_credential() {
                log::warn!("Failed to delete legacy keychain entry (user {uid}): {e}");
            }
        }
    }

    Ok(())
}

fn delete_anthropic_api_key_from_keychain() -> Result<(), AppError> {
    // File-based storage (no keychain prompts)
    delete_api_key_file("anthropic");

    // Also remove legacy keychain entries so read_anthropic_api_key_from_keychain()
    // doesn't fall back to the old entry and recreate the file.
    let user_id = try_read_user_id();
    if let Ok(entry) = anthropic_keyring_entry(None) {
        let _ = entry.delete_credential();
    }
    if let Some(uid) = user_id.as_deref() {
        if let Ok(entry) = anthropic_keyring_entry(Some(uid)) {
            let _ = entry.delete_credential();
        }
    }

    Ok(())
}

/// Check which API keys are stored in the keychain.
/// Returns a JSON object with provider names mapped to booleans.
/// Individual provider errors are logged and treated as "not configured".
#[tauri::command]
pub async fn check_api_keys() -> Result<std::collections::HashMap<String, bool>, AppError> {
    let mut keys = std::collections::HashMap::new();
    keys.insert(
        "anthropic".to_string(),
        read_anthropic_api_key_from_keychain()
            .ok()
            .flatten()
            .is_some(),
    );
    keys.insert(
        "openai".to_string(),
        read_openai_api_key_from_keychain().ok().flatten().is_some(),
    );
    Ok(keys)
}

#[tauri::command]
pub async fn set_openai_api_key(api_key: String) -> Result<(), AppError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation_error(
            "Please enter your OpenAI API key",
        ));
    }
    store_openai_api_key_in_keychain(trimmed)
}

#[tauri::command]
pub async fn clear_openai_api_key() -> Result<(), AppError> {
    delete_openai_api_key_from_keychain()
}

#[tauri::command]
pub async fn set_anthropic_api_key(api_key: String) -> Result<(), AppError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation_error(
            "Please enter your Anthropic API key",
        ));
    }
    store_anthropic_api_key_in_keychain(trimmed)
}

#[tauri::command]
pub async fn clear_anthropic_api_key() -> Result<(), AppError> {
    delete_anthropic_api_key_from_keychain()
}

// ── Model option helpers ────────────────────────────────────────────────

fn compose_model_option_id(provider_id: &str, model_id: &str) -> String {
    format!("{provider_id}{MODEL_OPTION_SEPARATOR}{model_id}")
}

fn compose_coding_model_option_id(provider_id: &str, model_id: &str) -> String {
    format!(
        "{provider_id}{MODEL_OPTION_SEPARATOR}{model_id}{MODEL_OPTION_SEPARATOR}{MODEL_AGENT_MODE_CODING}"
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GoalPlanAgentMode {
    General,
    Coding,
}

impl GoalPlanAgentMode {
    fn as_str(self) -> &'static str {
        match self {
            GoalPlanAgentMode::General => MODEL_AGENT_MODE_GENERAL,
            GoalPlanAgentMode::Coding => MODEL_AGENT_MODE_CODING,
        }
    }

    fn from_str(value: &str) -> Option<Self> {
        match value.trim().to_lowercase().as_str() {
            MODEL_AGENT_MODE_GENERAL => Some(GoalPlanAgentMode::General),
            MODEL_AGENT_MODE_CODING => Some(GoalPlanAgentMode::Coding),
            _ => None,
        }
    }
}

fn provider_supports_code_agent(provider_id: &str) -> bool {
    matches!(provider_id, OPENAI_PROVIDER | ANTHROPIC_PROVIDER)
}

fn split_model_option_id(model_option_id: &str) -> (String, String, Option<GoalPlanAgentMode>) {
    if let Some((provider_id, model_id)) = model_option_id.split_once(MODEL_OPTION_SEPARATOR) {
        let provider = provider_id.trim();
        let model = model_id.trim();
        if !provider.is_empty() && !model.is_empty() {
            if let Some((base_model_id, mode)) = model.rsplit_once(MODEL_OPTION_SEPARATOR) {
                let normalized_base_model_id = base_model_id.trim();
                if !normalized_base_model_id.is_empty() {
                    if let Some(agent_mode) = GoalPlanAgentMode::from_str(mode) {
                        return (
                            provider.to_string(),
                            normalized_base_model_id.to_string(),
                            Some(agent_mode),
                        );
                    }
                }
            }
            return (provider.to_string(), model.to_string(), None);
        }
    }

    // Backward compatibility for legacy model ids from older builds.
    (
        OPENAI_PROVIDER.to_string(),
        model_option_id.trim().to_string(),
        None,
    )
}

fn to_provider_option(
    id: &str,
    label: &str,
    connection_type: &str,
    connected: bool,
    ready: bool,
    message: Option<String>,
) -> AiProviderOption {
    AiProviderOption {
        id: id.to_string(),
        label: label.to_string(),
        connection_type: connection_type.to_string(),
        connected,
        ready,
        message,
    }
}

// ── Vault context helpers ───────────────────────────────────────────────

fn is_markdown_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lower = ext.to_lowercase();
            matches!(lower.as_str(), "md" | "markdown" | "mdx")
        })
        .unwrap_or(false)
}

fn should_skip_vault_context_entry(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.starts_with('.')
        || matches!(
            lower.as_str(),
            "node_modules" | "dist" | "target" | ".git" | ".goalrate"
        )
}

fn is_internal_goal_store_stem(stem: &str) -> bool {
    if !stem.starts_with("goal_") {
        return false;
    }
    let suffix = &stem[5..];
    suffix.len() == 12 && suffix.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn is_internal_goal_store_file(path: &Path, goals_dir: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(goals_dir) else {
        return false;
    };
    let mut components = relative.components();
    let Some(std::path::Component::Normal(file_name_component)) = components.next() else {
        return false;
    };
    if components.next().is_some() {
        return false;
    }
    let file_name = file_name_component.to_string_lossy();
    let file_path = Path::new(file_name.as_ref());
    let Some(ext) = file_path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    if !ext.eq_ignore_ascii_case("md") {
        return false;
    }
    let Some(stem) = file_path.file_stem().and_then(|value| value.to_str()) else {
        return false;
    };
    is_internal_goal_store_stem(stem)
}

fn collect_markdown_files_for_vault_context(dir: &Path, files: &mut Vec<PathBuf>) {
    if !dir.exists() || !dir.is_dir() {
        return;
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) => {
            log::warn!(
                "Failed to read vault context directory '{}': {}",
                dir.display(),
                err
            );
            return;
        }
    };

    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
        let file_name = entry.file_name().to_string_lossy().to_string();
        if should_skip_vault_context_entry(&file_name) {
            continue;
        }
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            collect_markdown_files_for_vault_context(&path, files);
            continue;
        }
        if file_type.is_file() && is_markdown_extension(&path) {
            files.push(path);
        }
    }
}

fn forward_slash_relative_path(path: &Path, base: &Path) -> String {
    path.strip_prefix(base)
        .unwrap_or(path)
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(part) => Some(part.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn strip_surrounding_quotes(value: &str) -> &str {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        let first = bytes[0] as char;
        let last = bytes[trimmed.len() - 1] as char;
        if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
            return &trimmed[1..trimmed.len() - 1];
        }
    }
    trimmed
}

fn normalize_context_value(value: &str) -> String {
    strip_surrounding_quotes(value)
        .replace("\\n", " ")
        .replace("\\r", " ")
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn truncate_text_for_prompt(value: &str, max_chars: usize) -> String {
    let normalized = normalize_context_value(value);
    let char_count = normalized.chars().count();
    if char_count <= max_chars {
        return normalized;
    }
    let head: String = normalized
        .chars()
        .take(max_chars.saturating_sub(3))
        .collect::<String>()
        .trim_end()
        .to_string();
    format!("{}...", head)
}

fn extract_frontmatter_value(content: &str, key: &str) -> Option<String> {
    let mut lines = content.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }

    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            break;
        }
        let Some((candidate_key, raw_value)) = trimmed.split_once(':') else {
            continue;
        };
        if !candidate_key.trim().eq_ignore_ascii_case(key) {
            continue;
        }
        let value = normalize_context_value(raw_value);
        if !value.is_empty() {
            return Some(value);
        }
    }

    None
}

fn extract_first_heading(content: &str) -> Option<String> {
    content
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("# "))
        .map(|line| line.trim_start_matches("# ").trim().to_string())
        .filter(|line| !line.is_empty())
}

fn extract_first_content_line(content: &str) -> Option<String> {
    let mut lines = content.lines();
    let mut in_frontmatter = false;
    if let Some(first_line) = lines.next() {
        in_frontmatter = first_line.trim() == "---";
    }

    for line in lines {
        let trimmed = line.trim();
        if in_frontmatter {
            if trimmed == "---" {
                in_frontmatter = false;
            }
            continue;
        }
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let value = normalize_context_value(trimmed);
        if !value.is_empty() {
            return Some(value);
        }
    }

    None
}

fn build_goal_planner_vault_context(
    vault_id: &str,
    app_state: &State<'_, AppState>,
) -> Result<String, AppError> {
    let vault_path = {
        let vaults = app_state.vaults.lock().unwrap();
        let manager = vaults
            .get(vault_id)
            .ok_or_else(|| AppError::vault_not_open(vault_id))?;
        manager.config().path.clone()
    };

    let vault_root = PathBuf::from(&vault_path);
    let goals_dir = vault_root.join("goals");
    let tasks_dir = vault_root.join("tasks");
    let mut files = Vec::new();
    collect_markdown_files_for_vault_context(&goals_dir, &mut files);
    collect_markdown_files_for_vault_context(&tasks_dir, &mut files);
    files.sort();
    files.dedup();

    if files.is_empty() {
        return Ok(
            "Existing vault context: no goal, milestone, or task markdown files exist yet under goals/ or tasks/."
                .to_string(),
        );
    }

    let candidate_files = files
        .into_iter()
        .filter(|path| !is_internal_goal_store_file(path, &goals_dir))
        .collect::<Vec<_>>();
    if candidate_files.is_empty() {
        return Ok(
            "Existing vault context: no readable goal, milestone, or task markdown files were found."
                .to_string(),
        );
    }

    let mut lines = Vec::new();
    let mut total_chars = 0usize;
    let mut included_count = 0usize;
    for path in &candidate_files {
        if included_count >= GOAL_PLANNER_CONTEXT_MAX_FILES {
            break;
        }

        let content = match std::fs::read_to_string(path) {
            Ok(content) => content,
            Err(err) => {
                log::warn!(
                    "Failed reading vault markdown file '{}' for planner context: {}",
                    path.display(),
                    err
                );
                continue;
            }
        };

        let fallback_title = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("Untitled")
            .to_string();
        let title = extract_frontmatter_value(&content, "title")
            .or_else(|| extract_frontmatter_value(&content, "milestone_title"))
            .or_else(|| extract_frontmatter_value(&content, "task_title"))
            .or_else(|| extract_first_heading(&content))
            .unwrap_or(fallback_title);
        let summary = extract_frontmatter_value(&content, "objective")
            .or_else(|| extract_frontmatter_value(&content, "description"))
            .or_else(|| extract_frontmatter_value(&content, "summary"))
            .or_else(|| extract_first_content_line(&content))
            .unwrap_or_else(|| "No summary available.".to_string());
        let line = format!(
            "- {} | title: {} | summary: {}",
            forward_slash_relative_path(path, &vault_root),
            truncate_text_for_prompt(&title, GOAL_PLANNER_CONTEXT_TITLE_MAX_CHARS),
            truncate_text_for_prompt(&summary, GOAL_PLANNER_CONTEXT_SUMMARY_MAX_CHARS)
        );
        if total_chars + line.len() > GOAL_PLANNER_CONTEXT_MAX_CHARS && !lines.is_empty() {
            break;
        }
        total_chars += line.len() + 1;
        lines.push(line);
        included_count += 1;
    }

    if lines.is_empty() {
        return Ok(
            "Existing vault context: markdown files exist but no readable planning context was extracted."
                .to_string(),
        );
    }

    let omitted_count = candidate_files.len().saturating_sub(included_count);
    if omitted_count > 0 {
        lines.push(format!(
            "- ... {} additional markdown files omitted for brevity.",
            omitted_count
        ));
    }

    Ok(format!(
        "Existing vault context (must review before proposing new artifacts):\n{}",
        lines.join("\n")
    ))
}

fn augment_goal_brief_with_vault_context(goal_brief: &str, vault_context: &str) -> String {
    format!(
        "{goal_brief}\n\n{vault_context}\n\nPlanner constraints:\n- Read and respect the existing vault context before proposing milestones or tasks.\n- Do not duplicate existing goal, milestone, or task titles from the vault context.\n- If a similar artifact already exists, adapt or extend it with a clear delta instead of creating a duplicate."
    )
}

fn build_goal_plan_prompts(
    goal_title: Option<&str>,
    goal_brief: &str,
    deadline: Option<&str>,
    priority: Option<&str>,
    agent_mode: GoalPlanAgentMode,
) -> (String, String) {
    let system_prompt = match agent_mode {
        GoalPlanAgentMode::General =>
            "You are an expert product execution strategist. Convert a goal input into agent-ready planning artifacts. Return strict JSON only.".to_string(),
        GoalPlanAgentMode::Coding =>
            "You are an expert software delivery strategist using coding-agent workflows (for example OpenAI Codex SDK and Claude Code SDK style planning). Convert a goal input into implementation-ready artifacts. Return strict JSON only.".to_string(),
    };
    let mut user_prompt = String::new();
    if let Some(goal_title) = goal_title.map(str::trim).filter(|value| !value.is_empty()) {
        user_prompt.push_str(&format!("Goal title: {}", goal_title));
        user_prompt.push('\n');
    }
    user_prompt.push_str(&format!("Goal objective: {}", goal_brief.trim()));
    if let Some(deadline) = deadline.map(str::trim).filter(|value| !value.is_empty()) {
        user_prompt.push_str(&format!("\nGoal deadline: {}", deadline));
    }
    if let Some(priority) = priority.map(str::trim).filter(|value| !value.is_empty()) {
        user_prompt.push_str(&format!("\nGoal priority: {}", priority));
    }
    user_prompt.push_str(&format!("\nRequested agent mode: {}", agent_mode.as_str()));
    user_prompt.push_str(
        r#"

Return JSON in this exact structure:
{
  "title": "string",
  "priority": "critical|high|medium|low",
  "agentMode": "general|coding",
  "summary": "string",
  "goalOverview": "string",
  "scopeIn": ["string", "string"],
  "scopeOut": ["string", "string"],
  "userJourneySpecs": [
    {
      "name": "string",
      "actor": "string",
      "trigger": "string",
      "steps": ["string", "string"],
      "successCriteria": ["string", "string"]
    }
  ],
  "systemJourneySpecs": [
    {
      "name": "string",
      "actor": "string",
      "trigger": "string",
      "steps": ["string", "string"],
      "successCriteria": ["string", "string"]
    }
  ],
  "milestones": ["string", "string", "string"],
  "milestoneBriefs": ["string", "string", "string"],
  "milestoneTasks": [["string", "string"], ["string"]],
  "taskBriefs": [["string", "string"], ["string"]],
  "acceptanceCriteria": ["string", "string"],
  "guardrails": ["string", "string"],
  "workingRules": ["string", "string"],
  "qualityGates": ["string", "string"],
  "definitionOfDone": ["string", "string"],
  "schema": "string",
  "flows": "string"
}

Rules:
- Assess the goal's priority based on urgency, deadline proximity, impact, and scope. Use "critical" for time-sensitive blockers, "high" for important goals with near deadlines, "medium" for standard goals, and "low" for nice-to-haves or distant deadlines. If the user provided a priority, you may adjust it if your analysis strongly disagrees.
- Keep title under 90 characters.
- Keep `summary` and `goalOverview` concise and actionable.
- `scopeIn` and `scopeOut` should be short, concrete lists (2-8 items each).
- `userJourneySpecs` and `systemJourneySpecs` should each include 1-4 entries with clear actor, trigger, steps, and success criteria.
- Milestones must be concrete and outcome-oriented (3-6 items).
- `milestoneBriefs` must align by index with milestones.
- `milestoneTasks` must align by index with milestones (2-6 tasks per milestone).
- `taskBriefs` must align by index with `milestoneTasks` and be very specific: include exactly what changes, where it changes, and how completion is verified (checks/evidence).
- Avoid vague task/taskBrief wording like "do work", "improve system", or "complete tasks"; use concrete language tied to the goal.
- `acceptanceCriteria` should be measurable outcomes for completion.
- `guardrails` should describe constraints and safety boundaries.
- `workingRules` should define execution expectations for contributors/agents.
- `qualityGates` should list concrete validation checks before completion.
- `definitionOfDone` should list completion criteria beyond acceptance checks.
- This plan feeds GitHub Spec-Kit style artifacts: one goal spec markdown, one milestone spec markdown per milestone, and one task spec markdown per task.
- If the goal objective includes an "Existing vault context" section, treat it as source-of-truth inventory and avoid duplicate artifacts.
- `schema` must be YAML or JSON-like text describing relevant entities, inputs, and outputs for implementation.
- `flows` must be valid Mermaid flow text (flowchart syntax) and must not include markdown fences.
- `agentMode` should reflect whether this is a coding or general planning request.
"#,
    );
    match agent_mode {
        GoalPlanAgentMode::General => user_prompt.push_str(
            r#"
- For general mode, each `milestoneTasks` item must name a concrete non-code deliverable (decision/doc/meeting/training/process change) plus an action.
- For general mode, make milestones execution-oriented (owners, dependencies, handoffs, measurable outcomes).
- For general mode, `taskBriefs` should specify artifacts, owner touchpoints, and objective evidence for completion.
"#,
        ),
        GoalPlanAgentMode::Coding => user_prompt.push_str(
            r#"
- For coding mode, each `milestoneTasks` item must name a concrete engineering artifact (module/file/API/query/job) plus an action.
- For coding mode, make milestones implementation-oriented (files/modules, APIs, tests, rollout order).
- For coding mode, `taskBriefs` should specify code/config changes and verification evidence (tests/checks).
"#,
        ),
    }
    user_prompt.push_str("- Do not include markdown.\n");

    (system_prompt, user_prompt)
}

fn infer_goal_plan_agent_mode(
    explicit_agent_mode: Option<GoalPlanAgentMode>,
    goal_title: Option<&str>,
    goal_brief: &str,
) -> GoalPlanAgentMode {
    if let Some(mode) = explicit_agent_mode {
        return mode;
    }

    let combined = format!("{}\n{}", goal_title.unwrap_or_default(), goal_brief).to_lowercase();

    // Heuristic fallback when user/model did not explicitly request mode.
    let coding_keywords = [
        "code",
        "coding",
        "implement",
        "developer",
        "engineering",
        "bug",
        "refactor",
        "api",
        "endpoint",
        "frontend",
        "backend",
        "database",
        "schema",
        "migration",
        "typescript",
        "javascript",
        "python",
        "rust",
        "react",
        "tauri",
        "sdk",
        "repository",
        "repo",
        "test",
        "ci",
    ];

    if coding_keywords
        .iter()
        .any(|keyword| combined.contains(keyword))
    {
        GoalPlanAgentMode::Coding
    } else {
        GoalPlanAgentMode::General
    }
}

// ── Local SDK types and helpers ─────────────────────────────────────────

#[derive(Debug, Default, Clone, Copy)]
struct LocalSdkAvailability {
    openai_agents: bool,
    openai_codex: bool,
    claude_agent: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalSdkPromptPayload<'a> {
    system_prompt: &'a str,
    user_prompt: &'a str,
    model: Option<&'a str>,
}

#[derive(Debug, Deserialize)]
struct LocalSdkResponse {
    content: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone)]
struct LocalSdkExecutionContext {
    execution_dir: PathBuf,
    node_modules_dir: PathBuf,
}

fn compose_local_sdk_model_id(sdk_model_marker: &str, model_override: &str) -> String {
    format!(
        "{sdk_model_marker}{LOCAL_SDK_MODEL_OVERRIDE_SEPARATOR}{}",
        model_override.trim()
    )
}

fn normalize_local_sdk_model_override<'a>(
    model_id: &'a str,
    sdk_model_marker: &str,
) -> Option<&'a str> {
    let trimmed = model_id.trim();
    if trimmed.is_empty() {
        None
    } else if let Some((marker, override_model)) =
        trimmed.split_once(LOCAL_SDK_MODEL_OVERRIDE_SEPARATOR)
    {
        if marker.trim().eq_ignore_ascii_case(sdk_model_marker) {
            let normalized_override = override_model.trim();
            if normalized_override.is_empty() {
                None
            } else {
                Some(normalized_override)
            }
        } else {
            Some(trimmed)
        }
    } else if trimmed.eq_ignore_ascii_case(sdk_model_marker) {
        None
    } else {
        Some(trimmed)
    }
}

fn local_sdk_model_options_for_openai(availability: LocalSdkAvailability) -> Vec<AiModelOption> {
    let mut models = Vec::new();
    if availability.openai_agents {
        models.push(AiModelOption {
            id: compose_model_option_id(OPENAI_PROVIDER, OPENAI_AGENTS_SDK_MODEL),
            label: "OpenAI Agents SDK (Local Agent)".to_string(),
            provider_id: OPENAI_PROVIDER.to_string(),
            provider: Some("OpenAI".to_string()),
        });
        models.push(AiModelOption {
            id: compose_coding_model_option_id(OPENAI_PROVIDER, OPENAI_AGENTS_SDK_MODEL),
            label: "OpenAI Agents SDK (Local Code Agent)".to_string(),
            provider_id: OPENAI_PROVIDER.to_string(),
            provider: Some("OpenAI".to_string()),
        });

        for (model_override, model_label) in OPENAI_LOCAL_MODEL_OVERRIDES {
            let sdk_model_id = compose_local_sdk_model_id(OPENAI_AGENTS_SDK_MODEL, model_override);
            models.push(AiModelOption {
                id: compose_model_option_id(OPENAI_PROVIDER, &sdk_model_id),
                label: format!("OpenAI Agents SDK ({model_label})"),
                provider_id: OPENAI_PROVIDER.to_string(),
                provider: Some("OpenAI".to_string()),
            });
            models.push(AiModelOption {
                id: compose_coding_model_option_id(OPENAI_PROVIDER, &sdk_model_id),
                label: format!("OpenAI Agents SDK ({model_label}, Code Agent)"),
                provider_id: OPENAI_PROVIDER.to_string(),
                provider: Some("OpenAI".to_string()),
            });
        }
    }

    if availability.openai_codex {
        models.push(AiModelOption {
            id: compose_coding_model_option_id(OPENAI_PROVIDER, OPENAI_CODEX_SDK_MODEL),
            label: "OpenAI Codex SDK (Local Code Agent)".to_string(),
            provider_id: OPENAI_PROVIDER.to_string(),
            provider: Some("OpenAI".to_string()),
        });

        for (model_override, model_label) in OPENAI_LOCAL_MODEL_OVERRIDES {
            let sdk_model_id = compose_local_sdk_model_id(OPENAI_CODEX_SDK_MODEL, model_override);
            models.push(AiModelOption {
                id: compose_coding_model_option_id(OPENAI_PROVIDER, &sdk_model_id),
                label: format!("OpenAI Codex SDK ({model_label}, Code Agent)"),
                provider_id: OPENAI_PROVIDER.to_string(),
                provider: Some("OpenAI".to_string()),
            });
        }
    }
    models
}

fn local_sdk_model_options_for_anthropic(availability: LocalSdkAvailability) -> Vec<AiModelOption> {
    if !availability.claude_agent {
        return Vec::new();
    }

    let mut models = vec![
        AiModelOption {
            id: compose_model_option_id(ANTHROPIC_PROVIDER, CLAUDE_AGENT_SDK_MODEL),
            label: "Claude Agent SDK (Local Agent)".to_string(),
            provider_id: ANTHROPIC_PROVIDER.to_string(),
            provider: Some("Anthropic".to_string()),
        },
        AiModelOption {
            id: compose_coding_model_option_id(ANTHROPIC_PROVIDER, CLAUDE_AGENT_SDK_MODEL),
            label: "Claude Agent SDK (Local Code Agent)".to_string(),
            provider_id: ANTHROPIC_PROVIDER.to_string(),
            provider: Some("Anthropic".to_string()),
        },
    ];

    for (model_override, model_label) in ANTHROPIC_LOCAL_MODEL_OVERRIDES {
        let sdk_model_id = compose_local_sdk_model_id(CLAUDE_AGENT_SDK_MODEL, model_override);
        models.push(AiModelOption {
            id: compose_model_option_id(ANTHROPIC_PROVIDER, &sdk_model_id),
            label: format!("Claude Agent SDK ({model_label})"),
            provider_id: ANTHROPIC_PROVIDER.to_string(),
            provider: Some("Anthropic".to_string()),
        });
        models.push(AiModelOption {
            id: compose_coding_model_option_id(ANTHROPIC_PROVIDER, &sdk_model_id),
            label: format!("Claude Agent SDK ({model_label}, Code Agent)"),
            provider_id: ANTHROPIC_PROVIDER.to_string(),
            provider: Some("Anthropic".to_string()),
        });
    }

    models
}

fn local_sdk_runtime_dir() -> PathBuf {
    dirs::data_local_dir()
        .or_else(dirs::config_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("goalrate")
        .join("agent-sdks")
}

fn managed_runtime_node_modules_dir() -> PathBuf {
    local_sdk_runtime_dir().join("node_modules")
}

fn package_dir_in_node_modules(node_modules_dir: &Path, package_name: &str) -> PathBuf {
    package_name
        .split('/')
        .filter(|segment| !segment.trim().is_empty())
        .fold(node_modules_dir.to_path_buf(), |path, segment| {
            path.join(segment)
        })
}

fn configure_minimal_child_env(command: &mut Command) {
    command.env_clear();
    for key in [
        "PATH",
        "HOME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "TMPDIR",
        "TMP",
        "TEMP",
        "LANG",
        "LC_ALL",
        "SHELL",
        "SystemRoot",
        "ComSpec",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
    ] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                command.env(key, trimmed);
            }
        }
    }
    command.env("NODE_ENV", "production");
}

fn command_succeeds(mut command: Command) -> bool {
    configure_minimal_child_env(&mut command);
    command
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn run_command_stdout(mut command: Command) -> Option<String> {
    configure_minimal_child_env(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        None
    } else {
        Some(stdout)
    }
}

fn global_node_modules_dir_for(package_manager: &str) -> Option<PathBuf> {
    let mut command = Command::new(package_manager);
    command.arg("root").arg("-g");
    let path = PathBuf::from(run_command_stdout(command)?);
    if path.is_absolute() && path.is_dir() {
        Some(path)
    } else {
        None
    }
}

fn yarn_global_node_modules_dir() -> Option<PathBuf> {
    let mut command = Command::new("yarn");
    command.arg("global").arg("dir");
    let root = PathBuf::from(run_command_stdout(command)?);
    let node_modules = root.join("node_modules");
    if node_modules.is_absolute() && node_modules.is_dir() {
        Some(node_modules)
    } else {
        None
    }
}

fn trusted_node_modules_dirs() -> Vec<PathBuf> {
    let mut candidates = vec![managed_runtime_node_modules_dir()];
    if let Some(path) = global_node_modules_dir_for("npm") {
        candidates.push(path);
    }
    if let Some(path) = global_node_modules_dir_for("pnpm") {
        candidates.push(path);
    }
    if let Some(path) = yarn_global_node_modules_dir() {
        candidates.push(path);
    }

    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|path| path.is_absolute() && path.is_dir())
        .filter(|path| seen.insert(path.to_string_lossy().to_string()))
        .collect()
}

fn local_sdk_execution_context(package_name: &str) -> Option<LocalSdkExecutionContext> {
    for node_modules_dir in trusted_node_modules_dirs() {
        let package_dir = package_dir_in_node_modules(&node_modules_dir, package_name);
        if package_dir.is_dir() {
            let execution_dir = node_modules_dir
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| node_modules_dir.clone());
            return Some(LocalSdkExecutionContext {
                execution_dir,
                node_modules_dir,
            });
        }
    }
    None
}

fn detect_local_sdk_availability() -> LocalSdkAvailability {
    LocalSdkAvailability {
        openai_agents: local_sdk_execution_context(OPENAI_AGENTS_PACKAGE).is_some(),
        openai_codex: local_sdk_execution_context(OPENAI_CODEX_PACKAGE).is_some(),
        claude_agent: local_sdk_execution_context(CLAUDE_AGENT_PACKAGE).is_some(),
    }
}

fn run_node_sdk_script(
    script: &str,
    payload: &LocalSdkPromptPayload<'_>,
    package_name: &str,
) -> Result<String, AppError> {
    if !command_succeeds({
        let mut command = Command::new("node");
        command.arg("--version");
        command
    }) {
        return Err(AppError::validation_error(
            "Node.js is required to run local SDK models. Install Node.js and the SDK package on this machine.",
        ));
    }

    let payload_json = serde_json::to_string(payload).map_err(|err| {
        AppError::validation_error(format!("SDK payload serialization failed: {err}"))
    })?;

    let context = local_sdk_execution_context(package_name).ok_or_else(|| {
        AppError::validation_error(format!(
            "Local SDK package `{package_name}` was not found in trusted global locations. Install it globally (npm/pnpm) and restart Goalrate."
        ))
    })?;

    let mut command = Command::new("node");
    command
        .current_dir(&context.execution_dir)
        .arg("--input-type=module")
        .arg("-e")
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_minimal_child_env(&mut command);
    command.env(
        "NODE_PATH",
        context.node_modules_dir.to_string_lossy().to_string(),
    );
    let child = command.spawn();
    let mut child = match child {
        Ok(child) => child,
        Err(err) => {
            return Err(AppError::validation_error(format!(
                "Node runtime is required for local SDK execution: {err}"
            )))
        }
    };

    if let Some(stdin) = child.stdin.as_mut() {
        stdin.write_all(payload_json.as_bytes()).map_err(|err| {
            AppError::unknown(format!("Failed writing local SDK payload to stdin: {err}"))
        })?;
    }

    let output = child
        .wait_with_output()
        .map_err(|err| AppError::unknown(format!("Failed waiting for local SDK process: {err}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stderr.is_empty() {
            "Local SDK process failed".to_string()
        } else {
            stderr
        };
        return Err(AppError::validation_error(message));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed = serde_json::from_str::<LocalSdkResponse>(stdout.trim()).map_err(|err| {
        AppError::validation_error(format!("Failed to parse local SDK response: {err}"))
    })?;

    if let Some(error) = parsed
        .error
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
    {
        return Err(AppError::validation_error(error));
    }

    parsed
        .content
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
        .ok_or_else(|| AppError::validation_error("Local SDK returned an empty response"))
}

fn is_local_sdk_model_selection(model_id: &str, sdk_model_marker: &str) -> bool {
    let trimmed = model_id.trim();
    if trimmed.eq_ignore_ascii_case(sdk_model_marker) {
        return true;
    }

    trimmed
        .split_once(LOCAL_SDK_MODEL_OVERRIDE_SEPARATOR)
        .map(|(marker, _)| marker.trim().eq_ignore_ascii_case(sdk_model_marker))
        .unwrap_or(false)
}

// ── Model parsing ───────────────────────────────────────────────────────

fn normalize_model_label(model_id: &str) -> String {
    let cleaned = model_id
        .trim()
        .trim_end_matches(":latest")
        .replace('-', " ")
        .replace('_', " ");
    if cleaned.is_empty() {
        return "Model".to_string();
    }

    cleaned
        .split_whitespace()
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn first_non_empty_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .map(ToString::to_string)
    })
}

fn dedupe_models(models: Vec<AiModelOption>) -> Vec<AiModelOption> {
    let mut deduped = Vec::new();
    let mut seen = HashSet::new();
    for model in models {
        if model.id.trim().is_empty() {
            continue;
        }
        if seen.insert(model.id.clone()) {
            deduped.push(model);
        }
    }
    deduped
}

fn is_openai_text_model(model_id: &str) -> bool {
    let normalized = model_id.trim().to_lowercase();
    normalized.starts_with("gpt-")
        || normalized.starts_with("o1")
        || normalized.starts_with("o3")
        || normalized.starts_with("o4")
        || normalized.contains("codex")
        || normalized.starts_with("chatgpt-")
}

fn parse_openai_models(payload: &Value) -> Vec<AiModelOption> {
    let items = payload
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let models = items
        .iter()
        .filter_map(|item| {
            let id = first_non_empty_string(item, &["id"])?;
            if !is_openai_text_model(&id) {
                return None;
            }
            Some(AiModelOption {
                id: id.clone(),
                label: normalize_model_label(&id),
                provider_id: OPENAI_PROVIDER.to_string(),
                provider: Some("OpenAI".to_string()),
            })
        })
        .collect::<Vec<_>>();

    dedupe_models(models)
}

fn parse_anthropic_models(payload: &Value) -> Vec<AiModelOption> {
    let items = payload
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let models = items
        .iter()
        .filter_map(|item| {
            let id = first_non_empty_string(item, &["id"])?;
            let label = first_non_empty_string(item, &["display_name", "name"])
                .unwrap_or_else(|| normalize_model_label(&id));
            Some(AiModelOption {
                id,
                label,
                provider_id: ANTHROPIC_PROVIDER.to_string(),
                provider: Some("Anthropic".to_string()),
            })
        })
        .collect::<Vec<_>>();

    dedupe_models(models)
}

fn namespace_models_for_provider(
    provider_id: &str,
    default_provider_label: &str,
    models: Vec<AiModelOption>,
) -> Vec<AiModelOption> {
    let mut namespaced_models = Vec::new();
    for model in models {
        let raw_model_id = model.id.trim().to_string();
        if raw_model_id.is_empty() {
            continue;
        }
        let provider_label = model
            .provider
            .or_else(|| Some(default_provider_label.to_string()));
        let base_label = model.label.trim().to_string();
        let supports_code_agent = provider_supports_code_agent(provider_id);
        let general_label = if supports_code_agent {
            format!("{} (Agent)", base_label)
        } else {
            base_label.clone()
        };

        namespaced_models.push(AiModelOption {
            id: compose_model_option_id(provider_id, &raw_model_id),
            label: general_label,
            provider_id: provider_id.to_string(),
            provider: provider_label.clone(),
        });

        if supports_code_agent {
            namespaced_models.push(AiModelOption {
                id: compose_coding_model_option_id(provider_id, &raw_model_id),
                label: format!("{} (Code Agent)", base_label),
                provider_id: provider_id.to_string(),
                provider: provider_label.clone(),
            });
        }
    }

    dedupe_models(namespaced_models)
}

// ── Model fetching ──────────────────────────────────────────────────────

async fn fetch_openai_models(api_key: &str) -> Result<Vec<AiModelOption>, AppError> {
    let client = reqwest::Client::new();
    let response = client
        .get(OPENAI_MODELS_URL)
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "GoalrateDesktop")
        .send()
        .await
        .map_err(|err| {
            AppError::unknown(format!("OpenAI model catalog request failed: {}", err))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "OpenAI model catalog unavailable ({}): {}",
            status, body
        )));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| AppError::unknown(format!("OpenAI model catalog parse failed: {}", err)))?;

    Ok(namespace_models_for_provider(
        OPENAI_PROVIDER,
        "OpenAI",
        parse_openai_models(&payload),
    ))
}

async fn fetch_anthropic_models(api_key: &str) -> Result<Vec<AiModelOption>, AppError> {
    let client = reqwest::Client::new();
    let response = client
        .get(ANTHROPIC_MODELS_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_API_VERSION)
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "GoalrateDesktop")
        .send()
        .await
        .map_err(|err| {
            AppError::unknown(format!("Anthropic model catalog request failed: {}", err))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "Anthropic model catalog unavailable ({}): {}",
            status, body
        )));
    }

    let payload: Value = response.json().await.map_err(|err| {
        AppError::unknown(format!("Anthropic model catalog parse failed: {}", err))
    })?;

    Ok(namespace_models_for_provider(
        ANTHROPIC_PROVIDER,
        "Anthropic",
        parse_anthropic_models(&payload),
    ))
}

// ── Goal plan response parsing ──────────────────────────────────────────

fn normalize_milestones(payload: &Value) -> Vec<String> {
    let Some(items) = payload.as_array() else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToString::to_string)
        .take(8)
        .collect()
}

fn normalize_optional_line(value: Option<String>) -> Option<String> {
    value
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
}

fn normalize_optional_string_array(payload: &Value) -> Option<Vec<String>> {
    let Some(items) = payload.as_array() else {
        return None;
    };
    let normalized = items
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToString::to_string)
        .take(8)
        .collect::<Vec<_>>();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_optional_nested_string_array(payload: &Value) -> Option<Vec<Vec<String>>> {
    let Some(items) = payload.as_array() else {
        return None;
    };

    let mut normalized = Vec::new();
    let mut has_non_empty_entry = false;

    for item in items.iter().take(8) {
        let entry = if let Some(values) = item.as_array() {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .take(8)
                .collect::<Vec<_>>()
        } else if let Some(value) = item.as_str() {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                Vec::new()
            } else {
                vec![trimmed.to_string()]
            }
        } else {
            Vec::new()
        };

        if !entry.is_empty() {
            has_non_empty_entry = true;
        }
        normalized.push(entry);
    }

    if has_non_empty_entry {
        Some(normalized)
    } else {
        None
    }
}

fn normalize_optional_lines_from_value(payload: &Value) -> Option<Vec<String>> {
    if let Some(items) = payload.as_array() {
        let normalized = items
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .map(ToString::to_string)
            .take(12)
            .collect::<Vec<_>>();
        if normalized.is_empty() {
            None
        } else {
            Some(normalized)
        }
    } else if let Some(value) = payload.as_str() {
        let normalized = value
            .lines()
            .map(str::trim)
            .map(|entry| entry.trim_start_matches('-').trim_start_matches('*').trim())
            .filter(|entry| !entry.is_empty())
            .map(ToString::to_string)
            .take(12)
            .collect::<Vec<_>>();
        if normalized.is_empty() {
            None
        } else {
            Some(normalized)
        }
    } else {
        None
    }
}

fn normalize_optional_journey_specs(
    payload: &Value,
) -> Option<Vec<IntegrationGoalJourneySpecResponse>> {
    let Some(items) = payload.as_array() else {
        return None;
    };

    let normalized = items
        .iter()
        .take(8)
        .filter_map(|item| {
            if let Some(name) = item
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return Some(IntegrationGoalJourneySpecResponse {
                    name: name.to_string(),
                    actor: None,
                    trigger: None,
                    steps: None,
                    success_criteria: None,
                });
            }

            let name = first_non_empty_string(item, &["name", "title", "journey"]);
            let actor = first_non_empty_string(item, &["actor", "user", "role"]);
            let trigger = first_non_empty_string(item, &["trigger", "when", "event"]);
            let steps = normalize_optional_lines_from_value(
                item.get("steps")
                    .or_else(|| item.get("flow"))
                    .unwrap_or(&Value::Null),
            );
            let success_criteria = normalize_optional_lines_from_value(
                item.get("successCriteria")
                    .or_else(|| item.get("success_criteria"))
                    .or_else(|| item.get("outcomes"))
                    .unwrap_or(&Value::Null),
            );

            if name.is_none()
                && actor.is_none()
                && trigger.is_none()
                && steps.is_none()
                && success_criteria.is_none()
            {
                return None;
            }

            Some(IntegrationGoalJourneySpecResponse {
                name: name.unwrap_or_else(|| "Journey".to_string()),
                actor,
                trigger,
                steps,
                success_criteria,
            })
        })
        .collect::<Vec<_>>();

    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn parse_goal_plan_response(content: &str) -> Option<IntegrationGoalPlanResponse> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return None;
    }

    let candidate = if trimmed.starts_with('{') && trimmed.ends_with('}') {
        trimmed.to_string()
    } else {
        let start = trimmed.find('{')?;
        let end = trimmed.rfind('}')?;
        if start >= end {
            return None;
        }
        trimmed[start..=end].to_string()
    };

    let payload: Value = serde_json::from_str(&candidate).ok()?;
    let title = first_non_empty_string(&payload, &["title", "goal_title"])?;
    let priority = first_non_empty_string(&payload, &["priority"]).and_then(|p| {
        let lower = p.to_lowercase();
        match lower.as_str() {
            "critical" | "high" | "medium" | "low" => Some(lower),
            _ => None,
        }
    });
    let summary = first_non_empty_string(&payload, &["summary"]);
    let goal_overview = first_non_empty_string(&payload, &["goalOverview", "goal_overview"]);
    let scope_in = normalize_optional_lines_from_value(
        payload
            .get("scopeIn")
            .or_else(|| payload.get("scope_in"))
            .unwrap_or(&Value::Null),
    );
    let scope_out = normalize_optional_lines_from_value(
        payload
            .get("scopeOut")
            .or_else(|| payload.get("scope_out"))
            .unwrap_or(&Value::Null),
    );
    let user_journey_specs = normalize_optional_journey_specs(
        payload
            .get("userJourneySpecs")
            .or_else(|| payload.get("user_journey_specs"))
            .or_else(|| payload.get("userJourneys"))
            .or_else(|| payload.get("user_journeys"))
            .unwrap_or(&Value::Null),
    );
    let system_journey_specs = normalize_optional_journey_specs(
        payload
            .get("systemJourneySpecs")
            .or_else(|| payload.get("system_journey_specs"))
            .or_else(|| payload.get("systemJourneys"))
            .or_else(|| payload.get("system_journeys"))
            .unwrap_or(&Value::Null),
    );
    let schema = normalize_optional_line(first_non_empty_string(&payload, &["schema"]));
    let flows = normalize_optional_line(first_non_empty_string(
        &payload,
        &["flows", "flow", "mermaid"],
    ));
    let milestones = normalize_milestones(
        payload
            .get("milestones")
            .or_else(|| payload.get("steps"))
            .unwrap_or(&Value::Null),
    );
    if milestones.is_empty() {
        return None;
    }
    let milestone_briefs = normalize_optional_string_array(
        payload
            .get("milestoneBriefs")
            .or_else(|| payload.get("milestone_briefs"))
            .or_else(|| payload.get("milestone_details"))
            .unwrap_or(&Value::Null),
    );
    let milestone_tasks = normalize_optional_nested_string_array(
        payload
            .get("milestoneTasks")
            .or_else(|| payload.get("milestone_tasks"))
            .or_else(|| payload.get("tasksByMilestone"))
            .unwrap_or(&Value::Null),
    );
    let task_briefs = normalize_optional_nested_string_array(
        payload
            .get("taskBriefs")
            .or_else(|| payload.get("task_briefs"))
            .or_else(|| payload.get("taskObjectives"))
            .unwrap_or(&Value::Null),
    );
    let acceptance_criteria = normalize_optional_lines_from_value(
        payload
            .get("acceptanceCriteria")
            .or_else(|| payload.get("acceptance_criteria"))
            .unwrap_or(&Value::Null),
    );
    let guardrails = normalize_optional_lines_from_value(
        payload
            .get("guardrails")
            .or_else(|| payload.get("constraints"))
            .unwrap_or(&Value::Null),
    );
    let working_rules = normalize_optional_lines_from_value(
        payload
            .get("workingRules")
            .or_else(|| payload.get("working_rules"))
            .or_else(|| payload.get("executionRules"))
            .unwrap_or(&Value::Null),
    );
    let quality_gates = normalize_optional_lines_from_value(
        payload
            .get("qualityGates")
            .or_else(|| payload.get("quality_gates"))
            .or_else(|| payload.get("validationCommands"))
            .unwrap_or(&Value::Null),
    );
    let definition_of_done = normalize_optional_lines_from_value(
        payload
            .get("definitionOfDone")
            .or_else(|| payload.get("definition_of_done"))
            .or_else(|| payload.get("doneChecklist"))
            .unwrap_or(&Value::Null),
    );

    Some(IntegrationGoalPlanResponse {
        title,
        priority,
        milestones,
        summary,
        goal_overview,
        scope_in,
        scope_out,
        user_journey_specs,
        system_journey_specs,
        milestone_briefs,
        milestone_tasks,
        task_briefs,
        acceptance_criteria,
        guardrails,
        working_rules,
        quality_gates,
        definition_of_done,
        schema,
        flows,
    })
}

// ── Chat completion response extractors ─────────────────────────────────

fn extract_chat_content(payload: &Value) -> Option<String> {
    let content = payload
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))?;

    if let Some(text) = content.as_str() {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }
        return Some(trimmed.to_string());
    }

    let parts = content
        .as_array()
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    entry
                        .get("text")
                        .and_then(Value::as_str)
                        .or_else(|| entry.as_str())
                        .map(str::trim)
                        .filter(|text| !text.is_empty())
                        .map(ToString::to_string)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if parts.is_empty() {
        return None;
    }
    Some(parts.join("\n"))
}

fn extract_anthropic_chat_content(payload: &Value) -> Option<String> {
    let content = payload.get("content").and_then(Value::as_array)?;
    let parts = content
        .iter()
        .filter_map(|entry| {
            let text = entry.get("text").and_then(Value::as_str)?;
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .collect::<Vec<_>>();

    if parts.is_empty() {
        return None;
    }

    Some(parts.join("\n"))
}

// ── Goal plan generation with local SDKs ────────────────────────────────

async fn generate_openai_agents_goal_plan_with_local_sdk(
    model_id: &str,
    goal_title: Option<&str>,
    goal_brief: &str,
    deadline: Option<&str>,
    priority: Option<&str>,
    agent_mode: GoalPlanAgentMode,
) -> Result<IntegrationGoalPlanResponse, AppError> {
    let (system_prompt, user_prompt) =
        build_goal_plan_prompts(goal_title, goal_brief, deadline, priority, agent_mode);

    let node_script = r#"
import process from "node:process";
import { Agent, run } from "@openai/agents";

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
}

const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const modelName = typeof payload.model === "string" && payload.model.trim().length > 0
  ? payload.model.trim()
  : undefined;

const agent = new Agent({
  name: "Goal Planner",
  instructions: payload.systemPrompt,
  ...(modelName ? { model: modelName } : {}),
});

const result = await run(agent, payload.userPrompt);
const finalOutput = typeof result?.finalOutput === "string"
  ? result.finalOutput
  : JSON.stringify(result?.finalOutput ?? "");

process.stdout.write(JSON.stringify({ content: finalOutput }));
"#;

    let payload = LocalSdkPromptPayload {
        system_prompt: &system_prompt,
        user_prompt: &user_prompt,
        model: normalize_local_sdk_model_override(model_id, OPENAI_AGENTS_SDK_MODEL),
    };
    let content = run_node_sdk_script(node_script, &payload, OPENAI_AGENTS_PACKAGE)?;

    parse_goal_plan_response(&content).ok_or_else(|| {
        AppError::validation_error("OpenAI Agents SDK response was not valid goal-plan JSON")
    })
}

async fn generate_openai_codex_goal_plan_with_local_sdk(
    model_id: &str,
    goal_title: Option<&str>,
    goal_brief: &str,
    deadline: Option<&str>,
    priority: Option<&str>,
    agent_mode: GoalPlanAgentMode,
) -> Result<IntegrationGoalPlanResponse, AppError> {
    let (system_prompt, user_prompt) =
        build_goal_plan_prompts(goal_title, goal_brief, deadline, priority, agent_mode);

    let node_script = r#"
import process from "node:process";
import { Codex } from "@openai/codex-sdk";

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
}

const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const modelName = typeof payload.model === "string" && payload.model.trim().length > 0
  ? payload.model.trim()
  : undefined;

const codex = new Codex();
const thread = codex.startThread({
  ...(modelName ? { model: modelName } : {}),
  modelReasoningEffort: "high",
  sandboxMode: "workspace-write",
  approvalPolicy: "never",
});

const turn = await thread.run(`${payload.systemPrompt}\n\n${payload.userPrompt}`);
const finalOutput = typeof turn?.finalResponse === "string" ? turn.finalResponse : "";
process.stdout.write(JSON.stringify({ content: finalOutput }));
"#;

    let payload = LocalSdkPromptPayload {
        system_prompt: &system_prompt,
        user_prompt: &user_prompt,
        model: normalize_local_sdk_model_override(model_id, OPENAI_CODEX_SDK_MODEL),
    };
    let content = run_node_sdk_script(node_script, &payload, OPENAI_CODEX_PACKAGE)?;

    parse_goal_plan_response(&content).ok_or_else(|| {
        AppError::validation_error("OpenAI Codex SDK response was not valid goal-plan JSON")
    })
}

async fn generate_claude_agent_goal_plan_with_local_sdk(
    model_id: &str,
    goal_title: Option<&str>,
    goal_brief: &str,
    deadline: Option<&str>,
    priority: Option<&str>,
    agent_mode: GoalPlanAgentMode,
) -> Result<IntegrationGoalPlanResponse, AppError> {
    let (system_prompt, user_prompt) =
        build_goal_plan_prompts(goal_title, goal_brief, deadline, priority, agent_mode);

    let node_script = r#"
import process from "node:process";
import { query } from "@anthropic-ai/claude-agent-sdk";

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
}

const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const modelName = typeof payload.model === "string" && payload.model.trim().length > 0
  ? payload.model.trim()
  : undefined;

const stream = query({
  prompt: `${payload.systemPrompt}\n\n${payload.userPrompt}`,
  options: {
    ...(modelName ? { model: modelName } : {}),
    maxTurns: 8,
  },
});

let finalResult = "";
for await (const message of stream) {
  if (message?.type === "result" && message?.subtype === "success" && typeof message.result === "string") {
    finalResult = message.result;
  }
}

process.stdout.write(JSON.stringify({ content: finalResult }));
"#;

    let payload = LocalSdkPromptPayload {
        system_prompt: &system_prompt,
        user_prompt: &user_prompt,
        model: normalize_local_sdk_model_override(model_id, CLAUDE_AGENT_SDK_MODEL),
    };
    let content = run_node_sdk_script(node_script, &payload, CLAUDE_AGENT_PACKAGE)?;

    parse_goal_plan_response(&content).ok_or_else(|| {
        AppError::validation_error("Claude Agent SDK response was not valid goal-plan JSON")
    })
}

// ── Goal plan generation with API calls ─────────────────────────────────

async fn generate_openai_goal_plan(
    api_key: &str,
    model_id: &str,
    goal_title: Option<&str>,
    goal_brief: &str,
    deadline: Option<&str>,
    priority: Option<&str>,
    agent_mode: GoalPlanAgentMode,
) -> Result<IntegrationGoalPlanResponse, AppError> {
    let (system_prompt, user_prompt) =
        build_goal_plan_prompts(goal_title, goal_brief, deadline, priority, agent_mode);

    let client = reqwest::Client::new();
    let response = client
        .post(OPENAI_CHAT_COMPLETIONS_URL)
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "GoalrateDesktop")
        .json(&json!({
            "model": model_id,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.4,
            "max_tokens": 1100,
            "response_format": {
                "type": "json_object"
            }
        }))
        .send()
        .await
        .map_err(|err| AppError::unknown(format!("OpenAI request failed: {}", err)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "OpenAI request failed ({}): {}",
            status, body
        )));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| AppError::unknown(format!("OpenAI response parse failed: {}", err)))?;
    let content = extract_chat_content(&payload)
        .ok_or_else(|| AppError::validation_error("OpenAI returned an empty response"))?;

    parse_goal_plan_response(&content)
        .ok_or_else(|| AppError::validation_error("OpenAI response was not valid goal-plan JSON"))
}

async fn generate_anthropic_goal_plan(
    api_key: &str,
    model_id: &str,
    goal_title: Option<&str>,
    goal_brief: &str,
    deadline: Option<&str>,
    priority: Option<&str>,
    agent_mode: GoalPlanAgentMode,
) -> Result<IntegrationGoalPlanResponse, AppError> {
    let (system_prompt, user_prompt) =
        build_goal_plan_prompts(goal_title, goal_brief, deadline, priority, agent_mode);

    let client = reqwest::Client::new();
    let response = client
        .post(ANTHROPIC_MESSAGES_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_API_VERSION)
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "GoalrateDesktop")
        .json(&json!({
            "model": model_id,
            "max_tokens": 1100,
            "temperature": 0.4,
            "system": system_prompt,
            "messages": [
                {"role": "user", "content": user_prompt}
            ]
        }))
        .send()
        .await
        .map_err(|err| AppError::unknown(format!("Anthropic request failed: {}", err)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "Anthropic request failed ({}): {}",
            status, body
        )));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| AppError::unknown(format!("Anthropic response parse failed: {}", err)))?;
    let content = extract_anthropic_chat_content(&payload)
        .ok_or_else(|| AppError::validation_error("Anthropic returned an empty response"))?;

    parse_goal_plan_response(&content).ok_or_else(|| {
        AppError::validation_error("Anthropic response was not valid goal-plan JSON")
    })
}

// ── Tauri commands: list models ─────────────────────────────────────────

#[tauri::command]
pub async fn list_available_ai_models(
    vault_id: Option<String>,
    app_state: State<'_, AppState>,
) -> Result<AiAvailableModelsResponse, AppError> {
    let _ = vault_id;
    let _ = app_state;

    let mut providers = Vec::new();
    let mut models: Vec<AiModelOption> = Vec::new();
    let local_sdk_availability = detect_local_sdk_availability();
    let local_openai_sdk_models = local_sdk_model_options_for_openai(local_sdk_availability);
    let has_local_openai_sdk = !local_openai_sdk_models.is_empty();
    let local_anthropic_sdk_models = local_sdk_model_options_for_anthropic(local_sdk_availability);
    let has_local_anthropic_sdk = !local_anthropic_sdk_models.is_empty();

    // ── OpenAI ──
    match openai_api_key() {
        Some(api_key) => match fetch_openai_models(&api_key).await {
            Ok(openai_models) => {
                let openai_ready = !openai_models.is_empty() || has_local_openai_sdk;
                models.extend(openai_models);
                if has_local_openai_sdk {
                    models.extend(local_openai_sdk_models.clone());
                }
                providers.push(to_provider_option(
                    OPENAI_PROVIDER,
                    "OpenAI",
                    if has_local_openai_sdk {
                        "sdk_or_api_key"
                    } else {
                        "api_key"
                    },
                    true,
                    openai_ready,
                    if openai_ready {
                        None
                    } else {
                        Some(
                            "Configured, but no OpenAI models are currently available.".to_string(),
                        )
                    },
                ));
            }
            Err(err) => {
                log::warn!("OpenAI model catalog lookup failed: {}", err);
                if has_local_openai_sdk {
                    models.extend(local_openai_sdk_models.clone());
                }
                providers.push(to_provider_option(
                    OPENAI_PROVIDER,
                    "OpenAI",
                    if has_local_openai_sdk {
                        "sdk_or_api_key"
                    } else {
                        "api_key"
                    },
                    true,
                    has_local_openai_sdk,
                    if has_local_openai_sdk {
                        Some(format!(
                            "OpenAI model catalog failed ({}), but local OpenAI SDK model options are available.",
                            err.message
                        ))
                    } else {
                        Some(format!(
                            "Configured, but model catalog failed: {}",
                            err.message
                        ))
                    },
                ));
            }
        },
        None => {
            if has_local_openai_sdk {
                models.extend(local_openai_sdk_models.clone());
            }
            providers.push(to_provider_option(
                OPENAI_PROVIDER,
                "OpenAI",
                if has_local_openai_sdk {
                    "sdk_or_api_key"
                } else {
                    "api_key"
                },
                has_local_openai_sdk,
                has_local_openai_sdk,
                if has_local_openai_sdk {
                    Some(
                        "Local OpenAI SDK models detected on this machine. You can use them without adding an API key."
                            .to_string(),
                    )
                } else {
                    Some("Add your OpenAI API key to use OpenAI models.".to_string())
                },
            ));
        }
    }

    // ── Anthropic ──
    match anthropic_api_key() {
        Some(api_key) => match fetch_anthropic_models(&api_key).await {
            Ok(anthropic_models) => {
                let anthropic_ready = !anthropic_models.is_empty() || has_local_anthropic_sdk;
                models.extend(anthropic_models);
                if has_local_anthropic_sdk {
                    models.extend(local_anthropic_sdk_models.clone());
                }
                providers.push(to_provider_option(
                    ANTHROPIC_PROVIDER,
                    "Anthropic",
                    if has_local_anthropic_sdk {
                        "sdk_or_api_key"
                    } else {
                        "api_key"
                    },
                    true,
                    anthropic_ready,
                    if anthropic_ready {
                        None
                    } else {
                        Some(
                            "Configured, but no Anthropic models are currently available."
                                .to_string(),
                        )
                    },
                ));
            }
            Err(err) => {
                log::warn!("Anthropic model catalog lookup failed: {}", err);
                if has_local_anthropic_sdk {
                    models.extend(local_anthropic_sdk_models.clone());
                }
                providers.push(to_provider_option(
                    ANTHROPIC_PROVIDER,
                    "Anthropic",
                    if has_local_anthropic_sdk {
                        "sdk_or_api_key"
                    } else {
                        "api_key"
                    },
                    true,
                    has_local_anthropic_sdk,
                    if has_local_anthropic_sdk {
                        Some(format!(
                            "Anthropic model catalog failed ({}), but local Claude Agent SDK model options are available.",
                            err.message
                        ))
                    } else {
                        Some(format!(
                            "Configured, but model catalog failed: {}",
                            err.message
                        ))
                    },
                ));
            }
        },
        None => {
            if has_local_anthropic_sdk {
                models.extend(local_anthropic_sdk_models.clone());
            }
            providers.push(to_provider_option(
                ANTHROPIC_PROVIDER,
                "Anthropic",
                if has_local_anthropic_sdk {
                    "sdk_or_api_key"
                } else {
                    "api_key"
                },
                has_local_anthropic_sdk,
                has_local_anthropic_sdk,
                if has_local_anthropic_sdk {
                    Some(
                        "Local Claude Agent SDK models detected on this machine. You can use them without adding an API key."
                            .to_string(),
                    )
                } else {
                    Some("Add your Anthropic API key to use Anthropic models.".to_string())
                },
            ));
        }
    }

    let models = dedupe_models(models);
    Ok(AiAvailableModelsResponse {
        total: models.len(),
        models,
        providers,
    })
}

// ── Tauri command: generate goal plan ───────────────────────────────────

#[tauri::command]
pub async fn generate_integration_goal_plan(
    vault_id: String,
    title: Option<String>,
    model_id: String,
    goal_brief: String,
    deadline: Option<String>,
    priority: Option<String>,
    app_state: State<'_, AppState>,
) -> Result<IntegrationGoalPlanResponse, AppError> {
    let trimmed_vault_id = vault_id.trim();
    if trimmed_vault_id.is_empty() {
        return Err(AppError::validation_error(
            "Open a vault before generating an AI goal plan",
        ));
    }

    let trimmed_model_id = model_id.trim();
    if trimmed_model_id.is_empty() {
        return Err(AppError::validation_error(
            "Please choose an AI model before generating a goal",
        ));
    }

    let trimmed_goal_brief = goal_brief.trim();
    if trimmed_goal_brief.is_empty() {
        return Err(AppError::validation_error(
            "Please provide a goal brief for AI planning",
        ));
    };

    let (provider_id, provider_model_id, explicit_agent_mode) =
        split_model_option_id(trimmed_model_id);
    let sanitized_title = title.as_deref().map(str::trim);
    let sanitized_deadline = deadline.as_deref().map(str::trim);
    let sanitized_priority = priority.as_deref().map(str::trim);
    let resolved_agent_mode =
        infer_goal_plan_agent_mode(explicit_agent_mode, sanitized_title, trimmed_goal_brief);
    let vault_context = build_goal_planner_vault_context(trimmed_vault_id, &app_state)?;
    let goal_brief_with_context =
        augment_goal_brief_with_vault_context(trimmed_goal_brief, &vault_context);

    match provider_id.as_str() {
        OPENAI_PROVIDER => {
            if is_local_sdk_model_selection(&provider_model_id, OPENAI_AGENTS_SDK_MODEL) {
                return generate_openai_agents_goal_plan_with_local_sdk(
                    &provider_model_id,
                    sanitized_title,
                    &goal_brief_with_context,
                    sanitized_deadline,
                    sanitized_priority,
                    resolved_agent_mode,
                )
                .await;
            }
            if is_local_sdk_model_selection(&provider_model_id, OPENAI_CODEX_SDK_MODEL) {
                return generate_openai_codex_goal_plan_with_local_sdk(
                    &provider_model_id,
                    sanitized_title,
                    &goal_brief_with_context,
                    sanitized_deadline,
                    sanitized_priority,
                    resolved_agent_mode,
                )
                .await;
            }

            let api_key = openai_api_key().ok_or_else(|| {
                AppError::validation_error("OpenAI is not configured on this device")
            })?;
            generate_openai_goal_plan(
                &api_key,
                &provider_model_id,
                sanitized_title,
                &goal_brief_with_context,
                sanitized_deadline,
                sanitized_priority,
                resolved_agent_mode,
            )
            .await
        }
        ANTHROPIC_PROVIDER => {
            if is_local_sdk_model_selection(&provider_model_id, CLAUDE_AGENT_SDK_MODEL) {
                return generate_claude_agent_goal_plan_with_local_sdk(
                    &provider_model_id,
                    sanitized_title,
                    &goal_brief_with_context,
                    sanitized_deadline,
                    sanitized_priority,
                    resolved_agent_mode,
                )
                .await;
            }

            let api_key = anthropic_api_key().ok_or_else(|| {
                AppError::validation_error("Anthropic is not configured on this device")
            })?;
            generate_anthropic_goal_plan(
                &api_key,
                &provider_model_id,
                sanitized_title,
                &goal_brief_with_context,
                sanitized_deadline,
                sanitized_priority,
                resolved_agent_mode,
            )
            .await
        }
        _ => Err(AppError::validation_error("Unsupported AI model provider")),
    }
}

// ── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_model_option_id_parses_provider_and_model() {
        let (provider_id, model_id, mode) = split_model_option_id("openai::gpt-4o-mini");

        assert_eq!(provider_id, OPENAI_PROVIDER);
        assert_eq!(model_id, "gpt-4o-mini");
        assert_eq!(mode, None);
    }

    #[test]
    fn split_model_option_id_parses_coding_suffix() {
        let (provider_id, model_id, mode) =
            split_model_option_id("anthropic::claude-sonnet-4::coding");

        assert_eq!(provider_id, ANTHROPIC_PROVIDER);
        assert_eq!(model_id, "claude-sonnet-4");
        assert_eq!(mode, Some(GoalPlanAgentMode::Coding));
    }

    #[test]
    fn split_model_option_id_uses_legacy_openai_fallback() {
        let (provider_id, model_id, mode) = split_model_option_id("gpt-4o-mini");

        assert_eq!(provider_id, OPENAI_PROVIDER);
        assert_eq!(model_id, "gpt-4o-mini");
        assert_eq!(mode, None);
    }

    #[test]
    fn namespace_models_for_provider_adds_agent_variants_for_supported_providers() {
        let models = namespace_models_for_provider(
            OPENAI_PROVIDER,
            "OpenAI",
            vec![AiModelOption {
                id: "gpt-4o".to_string(),
                label: "GPT-4o".to_string(),
                provider_id: OPENAI_PROVIDER.to_string(),
                provider: Some("OpenAI".to_string()),
            }],
        );

        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "openai::gpt-4o");
        assert_eq!(models[0].label, "GPT-4o (Agent)");
        assert_eq!(models[1].id, "openai::gpt-4o::coding");
        assert_eq!(models[1].label, "GPT-4o (Code Agent)");
    }

    #[test]
    fn infer_goal_plan_agent_mode_prefers_explicit_mode() {
        let mode = infer_goal_plan_agent_mode(
            Some(GoalPlanAgentMode::General),
            Some("Build API"),
            "Implement endpoints and tests",
        );

        assert_eq!(mode, GoalPlanAgentMode::General);
    }

    #[test]
    fn infer_goal_plan_agent_mode_detects_coding_keywords() {
        let mode = infer_goal_plan_agent_mode(
            None,
            Some("Feature Complete"),
            "Implement backend api, frontend ui, and tests",
        );

        assert_eq!(mode, GoalPlanAgentMode::Coding);
    }

    #[test]
    fn infer_goal_plan_agent_mode_defaults_to_general_without_keywords() {
        let mode = infer_goal_plan_agent_mode(
            None,
            Some("Team Enablement"),
            "Define onboarding docs and rollout communications",
        );

        assert_eq!(mode, GoalPlanAgentMode::General);
    }

    #[test]
    fn build_goal_plan_prompts_applies_engineering_artifact_rule_only_in_coding_mode() {
        let (_, prompt) = build_goal_plan_prompts(
            Some("Feature Complete"),
            "Implement backend api and tests",
            None,
            None,
            GoalPlanAgentMode::Coding,
        );

        assert!(prompt
            .contains("concrete engineering artifact (module/file/API/query/job) plus an action"));
        assert!(prompt.contains(
            "make milestones implementation-oriented (files/modules, APIs, tests, rollout order)"
        ));
        assert!(!prompt.contains(
            "concrete non-code deliverable (decision/doc/meeting/training/process change)"
        ));
    }

    #[test]
    fn build_goal_plan_prompts_uses_general_deliverable_rule_in_general_mode() {
        let (_, prompt) = build_goal_plan_prompts(
            Some("Team Enablement"),
            "Define onboarding docs and rollout communications",
            None,
            None,
            GoalPlanAgentMode::General,
        );

        assert!(prompt.contains(
            "concrete non-code deliverable (decision/doc/meeting/training/process change) plus an action"
        ));
        assert!(prompt
            .contains("make milestones execution-oriented (owners, dependencies, handoffs, measurable outcomes)"));
        assert!(!prompt
            .contains("concrete engineering artifact (module/file/API/query/job) plus an action"));
    }

    #[test]
    fn build_goal_plan_prompts_includes_spec_kit_and_existing_context_rules() {
        let (_, prompt) = build_goal_plan_prompts(
            Some("Feature Complete"),
            "Implement backend api and tests",
            None,
            None,
            GoalPlanAgentMode::Coding,
        );

        assert!(prompt.contains("GitHub Spec-Kit style artifacts"));
        assert!(prompt.contains("Existing vault context"));
    }

    #[test]
    fn augment_goal_brief_with_vault_context_appends_constraints() {
        let result = augment_goal_brief_with_vault_context(
            "Ship feature-complete onboarding.",
            "Existing vault context: - goals/FeatureComplete.md",
        );

        assert!(result.contains("Ship feature-complete onboarding."));
        assert!(result.contains("Existing vault context: - goals/FeatureComplete.md"));
        assert!(result.contains("Planner constraints:"));
        assert!(result.contains("Do not duplicate existing goal, milestone, or task titles"));
    }

    #[test]
    fn is_local_sdk_model_selection_accepts_prefixed_override_model() {
        assert!(is_local_sdk_model_selection(
            "sdk-openai-codex",
            OPENAI_CODEX_SDK_MODEL
        ));
        assert!(is_local_sdk_model_selection(
            "sdk-openai-codex#gpt-5",
            OPENAI_CODEX_SDK_MODEL
        ));
        assert!(!is_local_sdk_model_selection(
            "gpt-5",
            OPENAI_CODEX_SDK_MODEL
        ));
    }

    #[test]
    fn normalize_local_sdk_model_override_supports_prefixed_override_model() {
        assert_eq!(
            normalize_local_sdk_model_override("sdk-openai-agents", OPENAI_AGENTS_SDK_MODEL),
            None
        );
        assert_eq!(
            normalize_local_sdk_model_override("gpt-5", OPENAI_AGENTS_SDK_MODEL),
            Some("gpt-5")
        );
        assert_eq!(
            normalize_local_sdk_model_override(
                "sdk-openai-agents#gpt-5-mini",
                OPENAI_AGENTS_SDK_MODEL
            ),
            Some("gpt-5-mini")
        );
    }

    #[test]
    fn local_sdk_model_options_include_expected_openai_markers() {
        let models = local_sdk_model_options_for_openai(LocalSdkAvailability {
            openai_agents: true,
            openai_codex: true,
            claude_agent: false,
        });
        let ids = models
            .iter()
            .map(|model| model.id.clone())
            .collect::<Vec<_>>();

        assert!(ids.iter().any(|id| id == "openai::sdk-openai-agents"));
        assert!(ids
            .iter()
            .any(|id| id == "openai::sdk-openai-agents::coding"));
        assert!(ids
            .iter()
            .any(|id| id == "openai::sdk-openai-codex::coding"));
    }

    #[test]
    fn parse_goal_plan_response_includes_milestone_tasks() {
        let content = r#"{
          "title": "Feature Complete",
          "scopeIn": ["Launch MVP", "Validate onboarding"],
          "scopeOut": ["No billing migration"],
          "userJourneySpecs": [{
            "name": "Create first goal",
            "actor": "Founder",
            "trigger": "Goal form submitted",
            "steps": ["Enter objective", "Submit form"],
            "successCriteria": ["GOALS spec is generated"]
          }],
          "milestones": ["Build X", "Ship Y"],
          "milestoneTasks": [["Create API", "Add tests"], ["Launch rollout"]],
          "taskBriefs": [["Implement API contract", "Verify behavior with tests"], ["Roll out gradually"]],
          "acceptanceCriteria": ["Docs generated for each milestone"],
          "guardrails": ["No destructive operations"],
          "workingRules": ["Update specs before coding"],
          "qualityGates": ["pnpm lint", "pnpm test"],
          "definitionOfDone": ["All milestones complete"],
          "schema": "openapi: 3.0.0",
          "flows": "flowchart TD\nA --> B"
        }"#;

        let parsed = parse_goal_plan_response(content).expect("goal plan should parse");
        assert_eq!(
            parsed.scope_in,
            Some(vec![
                "Launch MVP".to_string(),
                "Validate onboarding".to_string(),
            ])
        );
        assert_eq!(
            parsed.scope_out,
            Some(vec!["No billing migration".to_string()])
        );
        assert_eq!(
            parsed
                .user_journey_specs
                .as_ref()
                .and_then(|items| items.first())
                .map(|journey| journey.name.clone()),
            Some("Create first goal".to_string())
        );
        assert_eq!(
            parsed.milestone_tasks,
            Some(vec![
                vec!["Create API".to_string(), "Add tests".to_string()],
                vec!["Launch rollout".to_string()],
            ])
        );
        assert_eq!(
            parsed.task_briefs,
            Some(vec![
                vec![
                    "Implement API contract".to_string(),
                    "Verify behavior with tests".to_string(),
                ],
                vec!["Roll out gradually".to_string()],
            ])
        );
        assert_eq!(
            parsed.acceptance_criteria,
            Some(vec!["Docs generated for each milestone".to_string()])
        );
        assert_eq!(
            parsed.guardrails,
            Some(vec!["No destructive operations".to_string()])
        );
        assert_eq!(
            parsed.working_rules,
            Some(vec!["Update specs before coding".to_string()])
        );
        assert_eq!(
            parsed.quality_gates,
            Some(vec!["pnpm lint".to_string(), "pnpm test".to_string()])
        );
        assert_eq!(
            parsed.definition_of_done,
            Some(vec!["All milestones complete".to_string()])
        );
    }
}
