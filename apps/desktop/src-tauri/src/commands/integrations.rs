//! Integration commands for app-wide OAuth connections.

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration as StdDuration;

use chrono::{DateTime, Duration, Utc};
use keyring::Entry;
use once_cell::sync::Lazy;
use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT};
use reqwest::{StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::commands::auth::read_user_id_from_keychain;
use crate::commands::vault::AppState;
use crate::error::AppError;
use vault_core::config::IntegrationConfig;

static OAUTH_STATE: Lazy<Mutex<HashMap<String, IntegrationState>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
const GITHUB_PROVIDER: &str = "github";
const LOCAL_PROVIDER: &str = "local";
const OPENAI_PROVIDER: &str = "openai";
const ANTHROPIC_PROVIDER: &str = "anthropic";
const GEMINI_PROVIDER: &str = "gemini";
const MISTRAL_PROVIDER: &str = "mistral";
const PERPLEXITY_PROVIDER: &str = "perplexity";
const OPENROUTER_PROVIDER: &str = "openrouter";
const GROQ_PROVIDER: &str = "groq";
const AZURE_OPENAI_PROVIDER: &str = "azure-openai";
const BEDROCK_PROVIDER: &str = "bedrock";
const VERTEX_AI_PROVIDER: &str = "vertex-ai";
const TOGETHER_PROVIDER: &str = "together";
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
const GITHUB_MODELS_CATALOG_URL: &str = "https://models.github.ai/catalog/models";
const GITHUB_MODELS_INFERENCE_URL: &str = "https://models.github.ai/inference/chat/completions";
const OPENAI_MODELS_URL: &str = "https://api.openai.com/v1/models";
const OPENAI_CHAT_COMPLETIONS_URL: &str = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_MODELS_URL: &str = "https://api.anthropic.com/v1/models";
const ANTHROPIC_MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION: &str = "2023-06-01";
const GEMINI_MODELS_URL: &str = "https://generativelanguage.googleapis.com/v1beta/openai/models";
const GEMINI_CHAT_COMPLETIONS_URL: &str =
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MISTRAL_MODELS_URL: &str = "https://api.mistral.ai/v1/models";
const MISTRAL_CHAT_COMPLETIONS_URL: &str = "https://api.mistral.ai/v1/chat/completions";
const PERPLEXITY_MODELS_URL: &str = "https://api.perplexity.ai/models";
const PERPLEXITY_CHAT_COMPLETIONS_URL: &str = "https://api.perplexity.ai/chat/completions";
const OPENROUTER_MODELS_URL: &str = "https://openrouter.ai/api/v1/models";
const OPENROUTER_CHAT_COMPLETIONS_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_MODELS_URL: &str = "https://api.groq.com/openai/v1/models";
const GROQ_CHAT_COMPLETIONS_URL: &str = "https://api.groq.com/openai/v1/chat/completions";
const TOGETHER_MODELS_URL: &str = "https://api.together.xyz/v1/models";
const TOGETHER_CHAT_COMPLETIONS_URL: &str = "https://api.together.xyz/v1/chat/completions";
const AZURE_OPENAI_DEPLOYMENTS_PATH: &str = "/openai/deployments";
const AZURE_OPENAI_MODELS_PATH: &str = "/openai/models";
const AZURE_OPENAI_DEFAULT_API_VERSION: &str = "2024-10-21";
const GITHUB_DEVICE_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";
const GITHUB_DEVICE_CODE_ENDPOINT: &str = "/api/integrations/oauth/github/device-code";
const INTEGRATION_KEYCHAIN_SERVICE: &str = "com.goalrate.desktop.integrations";
const GITHUB_KEYCHAIN_ACCOUNT: &str = "github_api_key";
const OPENAI_KEYCHAIN_ACCOUNT: &str = "openai_api_key";
const ANTHROPIC_KEYCHAIN_ACCOUNT: &str = "anthropic_api_key";
const OLLAMA_KEYCHAIN_ACCOUNT: &str = "ollama_api_key";
const GEMINI_KEYCHAIN_ACCOUNT: &str = "gemini_api_key";
const MISTRAL_KEYCHAIN_ACCOUNT: &str = "mistral_api_key";
const PERPLEXITY_KEYCHAIN_ACCOUNT: &str = "perplexity_api_key";
const OPENROUTER_KEYCHAIN_ACCOUNT: &str = "openrouter_api_key";
const GROQ_KEYCHAIN_ACCOUNT: &str = "groq_api_key";
const AZURE_OPENAI_KEYCHAIN_ACCOUNT: &str = "azure_openai_api_key";
const TOGETHER_KEYCHAIN_ACCOUNT: &str = "together_api_key";
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

#[derive(Debug, Clone)]
struct IntegrationState {
    provider: String,
    device_client_id: Option<String>,
    device_code: Option<String>,
    device_poll_interval_secs: Option<u64>,
    device_expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntegrationStore {
    #[serde(default)]
    device: Vec<IntegrationConfig>,
    #[serde(default)]
    users: HashMap<String, Vec<IntegrationConfig>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationAuthResponse {
    pub authorization_url: String,
    pub state: String,
    pub verification_code: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationSummary {
    pub provider: String,
    pub connected: bool,
    pub connected_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationTask {
    pub id: String,
    pub title: String,
    pub url: Option<String>,
    pub status: Option<String>,
    pub provider: String,
    pub source: Option<String>,
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

#[derive(Debug, Clone, Deserialize)]
struct OAuthTokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    scope: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubDeviceCodeResponse {
    client_id: String,
    device_code: String,
    user_code: Option<String>,
    verification_uri: String,
    verification_uri_complete: Option<String>,
    expires_in: i64,
    interval: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubDeviceTokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    scope: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

fn redirect_uri() -> String {
    std::env::var("INTEGRATION_REDIRECT_URI")
        .unwrap_or_else(|_| "http://localhost:5174/integrations/callback".to_string())
}

fn integration_api_base_url(explicit_base_url: Option<&str>) -> String {
    let raw = explicit_base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| std::env::var("GOALRATE_API_BASE_URL").ok())
        .or_else(|| std::env::var("VITE_API_BASE_URL").ok())
        .unwrap_or_else(|| "http://localhost:8000".to_string());
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        "http://localhost:8000".to_string()
    } else {
        trimmed.to_string()
    }
}

fn github_client_id() -> Result<String, AppError> {
    let value = std::env::var("GH_INTEGRATION_CLIENT_ID").map_err(|_| {
        AppError::validation_error("Missing GH_INTEGRATION_CLIENT_ID in process environment")
    })?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation_error(
            "GH_INTEGRATION_CLIENT_ID is empty",
        ));
    }
    Ok(trimmed.to_string())
}

fn github_client_secret() -> Result<String, AppError> {
    let value = std::env::var("GH_INTEGRATION_CLIENT_SECRET").map_err(|_| {
        AppError::validation_error("Missing GH_INTEGRATION_CLIENT_SECRET in process environment")
    })?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation_error(
            "GH_INTEGRATION_CLIENT_SECRET is empty",
        ));
    }
    Ok(trimmed.to_string())
}

fn allow_env_api_key_fallback() -> bool {
    std::env::var(ALLOW_ENV_API_KEY_FALLBACK_ENV)
        .ok()
        .map(|value| value.trim().to_lowercase())
        .map(|value| value == "1" || value == "true" || value == "yes")
        .unwrap_or(false)
}

fn github_api_key() -> Option<String> {
    match read_github_api_key_from_keychain() {
        Ok(Some(api_key)) => Some(api_key),
        Ok(None) => {
            if allow_env_api_key_fallback() {
                github_api_key_from_env()
            } else {
                None
            }
        }
        Err(err) => {
            log::warn!("Failed to read GitHub API key from secure storage: {}", err);
            if allow_env_api_key_fallback() {
                github_api_key_from_env()
            } else {
                None
            }
        }
    }
}

fn github_api_key_from_env() -> Option<String> {
    std::env::var("GOALRATE_GITHUB_API_KEY")
        .ok()
        .or_else(|| std::env::var("GH_MODELS_API_KEY").ok())
        .or_else(|| std::env::var("GITHUB_TOKEN").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
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

fn ollama_api_key_from_env() -> Option<String> {
    std::env::var("GOALRATE_OLLAMA_API_KEY")
        .ok()
        .or_else(|| std::env::var("OLLAMA_API_KEY").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn gemini_api_key_from_env() -> Option<String> {
    std::env::var("GOALRATE_GEMINI_API_KEY")
        .ok()
        .or_else(|| std::env::var("GEMINI_API_KEY").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn mistral_api_key_from_env() -> Option<String> {
    std::env::var("GOALRATE_MISTRAL_API_KEY")
        .ok()
        .or_else(|| std::env::var("MISTRAL_API_KEY").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn perplexity_api_key_from_env() -> Option<String> {
    std::env::var("GOALRATE_PERPLEXITY_API_KEY")
        .ok()
        .or_else(|| std::env::var("PERPLEXITY_API_KEY").ok())
        .or_else(|| std::env::var("PPLX_API_KEY").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn openrouter_api_key_from_env() -> Option<String> {
    std::env::var("GOALRATE_OPENROUTER_API_KEY")
        .ok()
        .or_else(|| std::env::var("OPENROUTER_API_KEY").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn groq_api_key_from_env() -> Option<String> {
    std::env::var("GOALRATE_GROQ_API_KEY")
        .ok()
        .or_else(|| std::env::var("GROQ_API_KEY").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn azure_openai_api_key_from_env() -> Option<String> {
    std::env::var("GOALRATE_AZURE_OPENAI_API_KEY")
        .ok()
        .or_else(|| std::env::var("AZURE_OPENAI_API_KEY").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn together_api_key_from_env() -> Option<String> {
    std::env::var("GOALRATE_TOGETHER_API_KEY")
        .ok()
        .or_else(|| std::env::var("TOGETHER_API_KEY").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn azure_openai_endpoint() -> Option<String> {
    std::env::var("GOALRATE_AZURE_OPENAI_ENDPOINT")
        .ok()
        .or_else(|| std::env::var("AZURE_OPENAI_ENDPOINT").ok())
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
}

fn azure_openai_api_version() -> String {
    std::env::var("GOALRATE_AZURE_OPENAI_API_VERSION")
        .ok()
        .or_else(|| std::env::var("AZURE_OPENAI_API_VERSION").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| AZURE_OPENAI_DEFAULT_API_VERSION.to_string())
}

fn parse_comma_separated_env_values(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn azure_openai_deployments() -> Vec<String> {
    std::env::var("GOALRATE_AZURE_OPENAI_DEPLOYMENTS")
        .ok()
        .or_else(|| std::env::var("AZURE_OPENAI_DEPLOYMENTS").ok())
        .map(|value| parse_comma_separated_env_values(&value))
        .unwrap_or_default()
}

fn azure_openai_models_url(endpoint: &str, api_version: &str) -> String {
    format!(
        "{}/{}?api-version={}",
        endpoint.trim_end_matches('/'),
        AZURE_OPENAI_MODELS_PATH.trim_start_matches('/'),
        api_version.trim()
    )
}

fn azure_openai_deployments_url(endpoint: &str, api_version: &str) -> String {
    format!(
        "{}/{}?api-version={}",
        endpoint.trim_end_matches('/'),
        AZURE_OPENAI_DEPLOYMENTS_PATH.trim_start_matches('/'),
        api_version.trim()
    )
}

fn azure_openai_chat_completions_url(
    endpoint: &str,
    deployment_id: &str,
    api_version: &str,
) -> String {
    format!(
        "{}/openai/deployments/{}/chat/completions?api-version={}",
        endpoint.trim_end_matches('/'),
        deployment_id.trim(),
        api_version.trim()
    )
}

fn bedrock_cli_available() -> bool {
    command_succeeds({
        let mut command = Command::new("aws");
        command.arg("--version");
        command
    })
}

fn bedrock_credentials_available(region: &str) -> bool {
    command_succeeds({
        let mut command = Command::new("aws");
        command
            .arg("sts")
            .arg("get-caller-identity")
            .arg("--region")
            .arg(region)
            .arg("--output")
            .arg("json");
        command
    })
}

fn bedrock_region() -> Option<String> {
    std::env::var("GOALRATE_BEDROCK_REGION")
        .ok()
        .or_else(|| std::env::var("AWS_REGION").ok())
        .or_else(|| std::env::var("AWS_DEFAULT_REGION").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            let output = run_command_stdout({
                let mut command = Command::new("aws");
                command.arg("configure").arg("get").arg("region");
                command
            })?;
            let region = output.trim().to_string();
            if region.is_empty() || region == "(not set)" {
                None
            } else {
                Some(region)
            }
        })
}

fn gcloud_cli_available() -> bool {
    command_succeeds({
        let mut command = Command::new("gcloud");
        command.arg("--version");
        command
    })
}

fn gcloud_access_token() -> Option<String> {
    run_command_stdout({
        let mut command = Command::new("gcloud");
        command.arg("auth").arg("print-access-token");
        command
    })
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

fn vertex_ai_location() -> String {
    std::env::var("GOALRATE_VERTEX_AI_LOCATION")
        .ok()
        .or_else(|| std::env::var("GOOGLE_CLOUD_LOCATION").ok())
        .or_else(|| std::env::var("VERTEX_AI_LOCATION").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "us-central1".to_string())
}

fn vertex_ai_project_id() -> Option<String> {
    std::env::var("GOALRATE_VERTEX_AI_PROJECT_ID")
        .ok()
        .or_else(|| std::env::var("GOOGLE_CLOUD_PROJECT").ok())
        .or_else(|| std::env::var("GCLOUD_PROJECT").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            let output = run_command_stdout({
                let mut command = Command::new("gcloud");
                command.arg("config").arg("get-value").arg("project");
                command
            })?;
            let project = output
                .lines()
                .next()
                .map(str::trim)
                .unwrap_or_default()
                .to_string();
            if project.is_empty() || project == "(unset)" {
                None
            } else {
                Some(project)
            }
        })
}

fn github_keychain_account(user_id: Option<&str>) -> String {
    let scope = user_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(INTEGRATION_DEVICE_SCOPE);
    format!("{GITHUB_KEYCHAIN_ACCOUNT}::{scope}")
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

fn ollama_keychain_account(user_id: Option<&str>) -> String {
    let scope = user_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(INTEGRATION_DEVICE_SCOPE);
    format!("{OLLAMA_KEYCHAIN_ACCOUNT}::{scope}")
}

fn gemini_keychain_account(user_id: Option<&str>) -> String {
    let scope = user_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(INTEGRATION_DEVICE_SCOPE);
    format!("{GEMINI_KEYCHAIN_ACCOUNT}::{scope}")
}

fn mistral_keychain_account(user_id: Option<&str>) -> String {
    let scope = user_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(INTEGRATION_DEVICE_SCOPE);
    format!("{MISTRAL_KEYCHAIN_ACCOUNT}::{scope}")
}

fn perplexity_keychain_account(user_id: Option<&str>) -> String {
    let scope = user_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(INTEGRATION_DEVICE_SCOPE);
    format!("{PERPLEXITY_KEYCHAIN_ACCOUNT}::{scope}")
}

fn openrouter_keychain_account(user_id: Option<&str>) -> String {
    let scope = user_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(INTEGRATION_DEVICE_SCOPE);
    format!("{OPENROUTER_KEYCHAIN_ACCOUNT}::{scope}")
}

fn groq_keychain_account(user_id: Option<&str>) -> String {
    let scope = user_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(INTEGRATION_DEVICE_SCOPE);
    format!("{GROQ_KEYCHAIN_ACCOUNT}::{scope}")
}

fn azure_openai_keychain_account(user_id: Option<&str>) -> String {
    let scope = user_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(INTEGRATION_DEVICE_SCOPE);
    format!("{AZURE_OPENAI_KEYCHAIN_ACCOUNT}::{scope}")
}

fn together_keychain_account(user_id: Option<&str>) -> String {
    let scope = user_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(INTEGRATION_DEVICE_SCOPE);
    format!("{TOGETHER_KEYCHAIN_ACCOUNT}::{scope}")
}

fn ollama_keyring_entry(user_id: Option<&str>) -> Result<Entry, AppError> {
    let account = ollama_keychain_account(user_id);
    Entry::new(INTEGRATION_KEYCHAIN_SERVICE, &account).map_err(|err| {
        AppError::auth_error(format!(
            "Failed to access secure storage for Ollama key: {}",
            err
        ))
    })
}

fn gemini_keyring_entry(user_id: Option<&str>) -> Result<Entry, AppError> {
    let account = gemini_keychain_account(user_id);
    Entry::new(INTEGRATION_KEYCHAIN_SERVICE, &account).map_err(|err| {
        AppError::auth_error(format!(
            "Failed to access secure storage for Gemini key: {}",
            err
        ))
    })
}

fn mistral_keyring_entry(user_id: Option<&str>) -> Result<Entry, AppError> {
    let account = mistral_keychain_account(user_id);
    Entry::new(INTEGRATION_KEYCHAIN_SERVICE, &account).map_err(|err| {
        AppError::auth_error(format!(
            "Failed to access secure storage for Mistral key: {}",
            err
        ))
    })
}

fn perplexity_keyring_entry(user_id: Option<&str>) -> Result<Entry, AppError> {
    let account = perplexity_keychain_account(user_id);
    Entry::new(INTEGRATION_KEYCHAIN_SERVICE, &account).map_err(|err| {
        AppError::auth_error(format!(
            "Failed to access secure storage for Perplexity key: {}",
            err
        ))
    })
}

fn openrouter_keyring_entry(user_id: Option<&str>) -> Result<Entry, AppError> {
    let account = openrouter_keychain_account(user_id);
    Entry::new(INTEGRATION_KEYCHAIN_SERVICE, &account).map_err(|err| {
        AppError::auth_error(format!(
            "Failed to access secure storage for OpenRouter key: {}",
            err
        ))
    })
}

fn groq_keyring_entry(user_id: Option<&str>) -> Result<Entry, AppError> {
    let account = groq_keychain_account(user_id);
    Entry::new(INTEGRATION_KEYCHAIN_SERVICE, &account).map_err(|err| {
        AppError::auth_error(format!(
            "Failed to access secure storage for Groq key: {}",
            err
        ))
    })
}

fn azure_openai_keyring_entry(user_id: Option<&str>) -> Result<Entry, AppError> {
    let account = azure_openai_keychain_account(user_id);
    Entry::new(INTEGRATION_KEYCHAIN_SERVICE, &account).map_err(|err| {
        AppError::auth_error(format!(
            "Failed to access secure storage for Azure OpenAI key: {}",
            err
        ))
    })
}

fn together_keyring_entry(user_id: Option<&str>) -> Result<Entry, AppError> {
    let account = together_keychain_account(user_id);
    Entry::new(INTEGRATION_KEYCHAIN_SERVICE, &account).map_err(|err| {
        AppError::auth_error(format!(
            "Failed to access secure storage for Together AI key: {}",
            err
        ))
    })
}

fn github_keyring_entry(user_id: Option<&str>) -> Result<Entry, AppError> {
    let account = github_keychain_account(user_id);
    Entry::new(INTEGRATION_KEYCHAIN_SERVICE, &account).map_err(|err| {
        AppError::auth_error(format!(
            "Failed to access secure storage for GitHub key: {}",
            err
        ))
    })
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

fn read_github_api_key_from_keychain() -> Result<Option<String>, AppError> {
    let user_id = try_read_user_id();

    if let Some(user_id) = user_id.as_deref() {
        let user_entry = github_keyring_entry(Some(user_id))?;
        if let Some(secret) = read_trimmed_secret(&user_entry)? {
            return Ok(Some(secret));
        }
    }

    let device_entry = github_keyring_entry(None)?;
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

fn read_ollama_api_key_from_keychain() -> Result<Option<String>, AppError> {
    let user_id = try_read_user_id();

    if let Some(user_id) = user_id.as_deref() {
        let user_entry = ollama_keyring_entry(Some(user_id))?;
        if let Some(secret) = read_trimmed_secret(&user_entry)? {
            return Ok(Some(secret));
        }
    }

    let device_entry = ollama_keyring_entry(None)?;
    read_trimmed_secret(&device_entry)
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

fn read_gemini_api_key_from_keychain() -> Result<Option<String>, AppError> {
    let user_id = try_read_user_id();

    if let Some(user_id) = user_id.as_deref() {
        let user_entry = gemini_keyring_entry(Some(user_id))?;
        if let Some(secret) = read_trimmed_secret(&user_entry)? {
            return Ok(Some(secret));
        }
    }

    let device_entry = gemini_keyring_entry(None)?;
    read_trimmed_secret(&device_entry)
}

fn read_mistral_api_key_from_keychain() -> Result<Option<String>, AppError> {
    let user_id = try_read_user_id();

    if let Some(user_id) = user_id.as_deref() {
        let user_entry = mistral_keyring_entry(Some(user_id))?;
        if let Some(secret) = read_trimmed_secret(&user_entry)? {
            return Ok(Some(secret));
        }
    }

    let device_entry = mistral_keyring_entry(None)?;
    read_trimmed_secret(&device_entry)
}

fn read_perplexity_api_key_from_keychain() -> Result<Option<String>, AppError> {
    let user_id = try_read_user_id();

    if let Some(user_id) = user_id.as_deref() {
        let user_entry = perplexity_keyring_entry(Some(user_id))?;
        if let Some(secret) = read_trimmed_secret(&user_entry)? {
            return Ok(Some(secret));
        }
    }

    let device_entry = perplexity_keyring_entry(None)?;
    read_trimmed_secret(&device_entry)
}

fn read_openrouter_api_key_from_keychain() -> Result<Option<String>, AppError> {
    let user_id = try_read_user_id();

    if let Some(user_id) = user_id.as_deref() {
        let user_entry = openrouter_keyring_entry(Some(user_id))?;
        if let Some(secret) = read_trimmed_secret(&user_entry)? {
            return Ok(Some(secret));
        }
    }

    let device_entry = openrouter_keyring_entry(None)?;
    read_trimmed_secret(&device_entry)
}

fn read_groq_api_key_from_keychain() -> Result<Option<String>, AppError> {
    let user_id = try_read_user_id();

    if let Some(user_id) = user_id.as_deref() {
        let user_entry = groq_keyring_entry(Some(user_id))?;
        if let Some(secret) = read_trimmed_secret(&user_entry)? {
            return Ok(Some(secret));
        }
    }

    let device_entry = groq_keyring_entry(None)?;
    read_trimmed_secret(&device_entry)
}

fn read_azure_openai_api_key_from_keychain() -> Result<Option<String>, AppError> {
    let user_id = try_read_user_id();

    if let Some(user_id) = user_id.as_deref() {
        let user_entry = azure_openai_keyring_entry(Some(user_id))?;
        if let Some(secret) = read_trimmed_secret(&user_entry)? {
            return Ok(Some(secret));
        }
    }

    let device_entry = azure_openai_keyring_entry(None)?;
    read_trimmed_secret(&device_entry)
}

fn read_together_api_key_from_keychain() -> Result<Option<String>, AppError> {
    let user_id = try_read_user_id();

    if let Some(user_id) = user_id.as_deref() {
        let user_entry = together_keyring_entry(Some(user_id))?;
        if let Some(secret) = read_trimmed_secret(&user_entry)? {
            return Ok(Some(secret));
        }
    }

    let device_entry = together_keyring_entry(None)?;
    read_trimmed_secret(&device_entry)
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

fn store_github_api_key_in_keychain(api_key: &str) -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![github_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(github_keyring_entry(Some(user_id))?);
    }

    for entry in entries {
        entry.set_password(api_key).map_err(|err| {
            AppError::auth_error(format!(
                "Failed to store GitHub key in secure storage: {}",
                err
            ))
        })?;
    }

    Ok(())
}

fn store_ollama_api_key_in_keychain(api_key: &str) -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![ollama_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(ollama_keyring_entry(Some(user_id))?);
    }

    for entry in entries {
        entry.set_password(api_key).map_err(|err| {
            AppError::auth_error(format!(
                "Failed to store Ollama key in secure storage: {}",
                err
            ))
        })?;
    }

    Ok(())
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

fn store_gemini_api_key_in_keychain(api_key: &str) -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![gemini_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(gemini_keyring_entry(Some(user_id))?);
    }

    for entry in entries {
        entry.set_password(api_key).map_err(|err| {
            AppError::auth_error(format!(
                "Failed to store Gemini key in secure storage: {}",
                err
            ))
        })?;
    }

    Ok(())
}

fn store_mistral_api_key_in_keychain(api_key: &str) -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![mistral_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(mistral_keyring_entry(Some(user_id))?);
    }

    for entry in entries {
        entry.set_password(api_key).map_err(|err| {
            AppError::auth_error(format!(
                "Failed to store Mistral key in secure storage: {}",
                err
            ))
        })?;
    }

    Ok(())
}

fn store_perplexity_api_key_in_keychain(api_key: &str) -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![perplexity_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(perplexity_keyring_entry(Some(user_id))?);
    }

    for entry in entries {
        entry.set_password(api_key).map_err(|err| {
            AppError::auth_error(format!(
                "Failed to store Perplexity key in secure storage: {}",
                err
            ))
        })?;
    }

    Ok(())
}

fn store_openrouter_api_key_in_keychain(api_key: &str) -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![openrouter_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(openrouter_keyring_entry(Some(user_id))?);
    }

    for entry in entries {
        entry.set_password(api_key).map_err(|err| {
            AppError::auth_error(format!(
                "Failed to store OpenRouter key in secure storage: {}",
                err
            ))
        })?;
    }

    Ok(())
}

fn store_groq_api_key_in_keychain(api_key: &str) -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![groq_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(groq_keyring_entry(Some(user_id))?);
    }

    for entry in entries {
        entry.set_password(api_key).map_err(|err| {
            AppError::auth_error(format!(
                "Failed to store Groq key in secure storage: {}",
                err
            ))
        })?;
    }

    Ok(())
}

fn store_azure_openai_api_key_in_keychain(api_key: &str) -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![azure_openai_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(azure_openai_keyring_entry(Some(user_id))?);
    }

    for entry in entries {
        entry.set_password(api_key).map_err(|err| {
            AppError::auth_error(format!(
                "Failed to store Azure OpenAI key in secure storage: {}",
                err
            ))
        })?;
    }

    Ok(())
}

fn store_together_api_key_in_keychain(api_key: &str) -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![together_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(together_keyring_entry(Some(user_id))?);
    }

    for entry in entries {
        entry.set_password(api_key).map_err(|err| {
            AppError::auth_error(format!(
                "Failed to store Together AI key in secure storage: {}",
                err
            ))
        })?;
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

fn delete_ollama_api_key_from_keychain() -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![ollama_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(ollama_keyring_entry(Some(user_id))?);
    }

    for entry in entries {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(err) => {
                return Err(AppError::auth_error(format!(
                    "Failed to clear Ollama key from secure storage: {}",
                    err
                )));
            }
        }
    }

    Ok(())
}

fn delete_github_api_key_from_keychain() -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![github_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(github_keyring_entry(Some(user_id))?);
    }

    for entry in entries {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(err) => {
                return Err(AppError::auth_error(format!(
                    "Failed to clear GitHub key from secure storage: {}",
                    err
                )));
            }
        }
    }

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

fn delete_gemini_api_key_from_keychain() -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![gemini_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(gemini_keyring_entry(Some(user_id))?);
    }

    for entry in entries {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(err) => {
                return Err(AppError::auth_error(format!(
                    "Failed to clear Gemini key from secure storage: {}",
                    err
                )));
            }
        }
    }

    Ok(())
}

fn delete_mistral_api_key_from_keychain() -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![mistral_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(mistral_keyring_entry(Some(user_id))?);
    }

    for entry in entries {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(err) => {
                return Err(AppError::auth_error(format!(
                    "Failed to clear Mistral key from secure storage: {}",
                    err
                )));
            }
        }
    }

    Ok(())
}

fn delete_perplexity_api_key_from_keychain() -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![perplexity_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(perplexity_keyring_entry(Some(user_id))?);
    }

    for entry in entries {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(err) => {
                return Err(AppError::auth_error(format!(
                    "Failed to clear Perplexity key from secure storage: {}",
                    err
                )));
            }
        }
    }

    Ok(())
}

fn delete_openrouter_api_key_from_keychain() -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![openrouter_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(openrouter_keyring_entry(Some(user_id))?);
    }

    for entry in entries {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(err) => {
                return Err(AppError::auth_error(format!(
                    "Failed to clear OpenRouter key from secure storage: {}",
                    err
                )));
            }
        }
    }

    Ok(())
}

fn delete_groq_api_key_from_keychain() -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![groq_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(groq_keyring_entry(Some(user_id))?);
    }

    for entry in entries {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(err) => {
                return Err(AppError::auth_error(format!(
                    "Failed to clear Groq key from secure storage: {}",
                    err
                )));
            }
        }
    }

    Ok(())
}

fn delete_azure_openai_api_key_from_keychain() -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![azure_openai_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(azure_openai_keyring_entry(Some(user_id))?);
    }

    for entry in entries {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(err) => {
                return Err(AppError::auth_error(format!(
                    "Failed to clear Azure OpenAI key from secure storage: {}",
                    err
                )));
            }
        }
    }

    Ok(())
}

fn delete_together_api_key_from_keychain() -> Result<(), AppError> {
    let user_id = try_read_user_id();
    let mut entries = vec![together_keyring_entry(None)?];
    if let Some(user_id) = user_id.as_deref() {
        entries.push(together_keyring_entry(Some(user_id))?);
    }

    for entry in entries {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(err) => {
                return Err(AppError::auth_error(format!(
                    "Failed to clear Together AI key from secure storage: {}",
                    err
                )));
            }
        }
    }

    Ok(())
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

fn ollama_api_key() -> Option<String> {
    match read_ollama_api_key_from_keychain() {
        Ok(Some(api_key)) => Some(api_key),
        Ok(None) => {
            if allow_env_api_key_fallback() {
                ollama_api_key_from_env()
            } else {
                None
            }
        }
        Err(err) => {
            log::warn!("Failed to read Ollama API key from secure storage: {}", err);
            if allow_env_api_key_fallback() {
                ollama_api_key_from_env()
            } else {
                None
            }
        }
    }
}

fn gemini_api_key() -> Option<String> {
    match read_gemini_api_key_from_keychain() {
        Ok(Some(api_key)) => Some(api_key),
        Ok(None) => {
            if allow_env_api_key_fallback() {
                gemini_api_key_from_env()
            } else {
                None
            }
        }
        Err(err) => {
            log::warn!("Failed to read Gemini API key from secure storage: {}", err);
            if allow_env_api_key_fallback() {
                gemini_api_key_from_env()
            } else {
                None
            }
        }
    }
}

fn mistral_api_key() -> Option<String> {
    match read_mistral_api_key_from_keychain() {
        Ok(Some(api_key)) => Some(api_key),
        Ok(None) => {
            if allow_env_api_key_fallback() {
                mistral_api_key_from_env()
            } else {
                None
            }
        }
        Err(err) => {
            log::warn!(
                "Failed to read Mistral API key from secure storage: {}",
                err
            );
            if allow_env_api_key_fallback() {
                mistral_api_key_from_env()
            } else {
                None
            }
        }
    }
}

fn perplexity_api_key() -> Option<String> {
    match read_perplexity_api_key_from_keychain() {
        Ok(Some(api_key)) => Some(api_key),
        Ok(None) => {
            if allow_env_api_key_fallback() {
                perplexity_api_key_from_env()
            } else {
                None
            }
        }
        Err(err) => {
            log::warn!(
                "Failed to read Perplexity API key from secure storage: {}",
                err
            );
            if allow_env_api_key_fallback() {
                perplexity_api_key_from_env()
            } else {
                None
            }
        }
    }
}

fn openrouter_api_key() -> Option<String> {
    match read_openrouter_api_key_from_keychain() {
        Ok(Some(api_key)) => Some(api_key),
        Ok(None) => {
            if allow_env_api_key_fallback() {
                openrouter_api_key_from_env()
            } else {
                None
            }
        }
        Err(err) => {
            log::warn!(
                "Failed to read OpenRouter API key from secure storage: {}",
                err
            );
            if allow_env_api_key_fallback() {
                openrouter_api_key_from_env()
            } else {
                None
            }
        }
    }
}

fn groq_api_key() -> Option<String> {
    match read_groq_api_key_from_keychain() {
        Ok(Some(api_key)) => Some(api_key),
        Ok(None) => {
            if allow_env_api_key_fallback() {
                groq_api_key_from_env()
            } else {
                None
            }
        }
        Err(err) => {
            log::warn!("Failed to read Groq API key from secure storage: {}", err);
            if allow_env_api_key_fallback() {
                groq_api_key_from_env()
            } else {
                None
            }
        }
    }
}

fn azure_openai_api_key() -> Option<String> {
    match read_azure_openai_api_key_from_keychain() {
        Ok(Some(api_key)) => Some(api_key),
        Ok(None) => {
            if allow_env_api_key_fallback() {
                azure_openai_api_key_from_env()
            } else {
                None
            }
        }
        Err(err) => {
            log::warn!(
                "Failed to read Azure OpenAI API key from secure storage: {}",
                err
            );
            if allow_env_api_key_fallback() {
                azure_openai_api_key_from_env()
            } else {
                None
            }
        }
    }
}

fn together_api_key() -> Option<String> {
    match read_together_api_key_from_keychain() {
        Ok(Some(api_key)) => Some(api_key),
        Ok(None) => {
            if allow_env_api_key_fallback() {
                together_api_key_from_env()
            } else {
                None
            }
        }
        Err(err) => {
            log::warn!(
                "Failed to read Together AI API key from secure storage: {}",
                err
            );
            if allow_env_api_key_fallback() {
                together_api_key_from_env()
            } else {
                None
            }
        }
    }
}

#[tauri::command]
pub async fn set_github_api_key(api_key: String) -> Result<(), AppError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation_error(
            "Please enter your GitHub API key",
        ));
    }
    store_github_api_key_in_keychain(trimmed)
}

#[tauri::command]
pub async fn clear_github_api_key() -> Result<(), AppError> {
    delete_github_api_key_from_keychain()
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

#[tauri::command]
pub async fn set_ollama_api_key(api_key: String) -> Result<(), AppError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation_error(
            "Please enter your Ollama API key",
        ));
    }
    store_ollama_api_key_in_keychain(trimmed)
}

#[tauri::command]
pub async fn clear_ollama_api_key() -> Result<(), AppError> {
    delete_ollama_api_key_from_keychain()
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
pub async fn set_gemini_api_key(api_key: String) -> Result<(), AppError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation_error(
            "Please enter your Gemini API key",
        ));
    }
    store_gemini_api_key_in_keychain(trimmed)
}

#[tauri::command]
pub async fn clear_gemini_api_key() -> Result<(), AppError> {
    delete_gemini_api_key_from_keychain()
}

#[tauri::command]
pub async fn set_mistral_api_key(api_key: String) -> Result<(), AppError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation_error(
            "Please enter your Mistral API key",
        ));
    }
    store_mistral_api_key_in_keychain(trimmed)
}

#[tauri::command]
pub async fn clear_mistral_api_key() -> Result<(), AppError> {
    delete_mistral_api_key_from_keychain()
}

#[tauri::command]
pub async fn set_perplexity_api_key(api_key: String) -> Result<(), AppError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation_error(
            "Please enter your Perplexity API key",
        ));
    }
    store_perplexity_api_key_in_keychain(trimmed)
}

#[tauri::command]
pub async fn clear_perplexity_api_key() -> Result<(), AppError> {
    delete_perplexity_api_key_from_keychain()
}

#[tauri::command]
pub async fn set_openrouter_api_key(api_key: String) -> Result<(), AppError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation_error(
            "Please enter your OpenRouter API key",
        ));
    }
    store_openrouter_api_key_in_keychain(trimmed)
}

#[tauri::command]
pub async fn clear_openrouter_api_key() -> Result<(), AppError> {
    delete_openrouter_api_key_from_keychain()
}

#[tauri::command]
pub async fn set_groq_api_key(api_key: String) -> Result<(), AppError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation_error("Please enter your Groq API key"));
    }
    store_groq_api_key_in_keychain(trimmed)
}

#[tauri::command]
pub async fn clear_groq_api_key() -> Result<(), AppError> {
    delete_groq_api_key_from_keychain()
}

#[tauri::command]
pub async fn set_azure_openai_api_key(api_key: String) -> Result<(), AppError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation_error(
            "Please enter your Azure OpenAI API key",
        ));
    }
    store_azure_openai_api_key_in_keychain(trimmed)
}

#[tauri::command]
pub async fn clear_azure_openai_api_key() -> Result<(), AppError> {
    delete_azure_openai_api_key_from_keychain()
}

#[tauri::command]
pub async fn set_together_api_key(api_key: String) -> Result<(), AppError> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation_error(
            "Please enter your Together AI API key",
        ));
    }
    store_together_api_key_in_keychain(trimmed)
}

#[tauri::command]
pub async fn clear_together_api_key() -> Result<(), AppError> {
    delete_together_api_key_from_keychain()
}

async fn request_github_device_code(
    api_base_url: Option<&str>,
    staging_api_secret: Option<&str>,
) -> Result<GithubDeviceCodeResponse, AppError> {
    let endpoint = format!(
        "{}/{}",
        integration_api_base_url(api_base_url).trim_end_matches('/'),
        GITHUB_DEVICE_CODE_ENDPOINT.trim_start_matches('/'),
    );

    let client = reqwest::Client::new();
    let mut request = client
        .post(endpoint)
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "GoalrateDesktop");

    if let Some(secret) = staging_api_secret
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            std::env::var("STAGING_API_SECRET")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
    {
        let secret = secret.trim();
        if !secret.is_empty() {
            request = request.header("X-Staging-Secret", secret);
        }
    }

    let response = request
        .send()
        .await
        .map_err(|err| AppError::unknown(format!("GitHub device flow request failed: {}", err)))?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        let detail = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|payload| {
                payload
                    .get("detail")
                    .and_then(Value::as_str)
                    .or_else(|| payload.get("message").and_then(Value::as_str))
                    .map(str::trim)
                    .filter(|message| !message.is_empty())
                    .map(ToString::to_string)
            })
            .unwrap_or(body);
        return Err(AppError::unknown(format!(
            "GitHub device flow request failed: {}",
            detail
        )));
    }

    response
        .json::<GithubDeviceCodeResponse>()
        .await
        .map_err(|err| AppError::unknown(format!("GitHub device flow parse failed: {}", err)))
}

async fn poll_github_device_token(
    client_id: &str,
    device_code: &str,
    poll_interval_secs: u64,
    expires_at: DateTime<Utc>,
) -> Result<OAuthTokenResponse, AppError> {
    let trimmed_client_id = client_id.trim();
    if trimmed_client_id.is_empty() {
        return Err(AppError::validation_error(
            "GitHub authorization is missing a client ID.",
        ));
    }
    let token_url = provider_token_url(GITHUB_PROVIDER)?;
    let client = reqwest::Client::new();
    let mut wait_seconds = poll_interval_secs.max(1);

    loop {
        if Utc::now() >= expires_at {
            return Err(AppError::validation_error(
                "GitHub authorization timed out. Please try connecting again.",
            ));
        }

        let response = client
            .post(token_url)
            .header(ACCEPT, "application/json")
            .header(USER_AGENT, "GoalrateDesktop")
            .form(&[
                ("client_id", trimmed_client_id),
                ("device_code", device_code),
                ("grant_type", GITHUB_DEVICE_GRANT_TYPE),
            ])
            .send()
            .await
            .map_err(|err| AppError::unknown(format!("GitHub token poll failed: {}", err)))?;

        let payload = response
            .json::<GithubDeviceTokenResponse>()
            .await
            .map_err(|err| AppError::unknown(format!("GitHub token poll parse failed: {}", err)))?;

        if let Some(access_token) = payload
            .access_token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Ok(OAuthTokenResponse {
                access_token: Some(access_token.to_string()),
                refresh_token: payload.refresh_token,
                expires_in: payload.expires_in,
                scope: payload.scope,
            });
        }

        match payload.error.as_deref() {
            Some("authorization_pending") => {
                tokio::time::sleep(StdDuration::from_secs(wait_seconds)).await;
            }
            Some("slow_down") => {
                wait_seconds = (wait_seconds + 5).min(30);
                tokio::time::sleep(StdDuration::from_secs(wait_seconds)).await;
            }
            Some("access_denied") => {
                return Err(AppError::validation_error(
                    "GitHub authorization was canceled.",
                ));
            }
            Some("expired_token") => {
                return Err(AppError::validation_error(
                    "GitHub authorization expired. Please try connecting again.",
                ));
            }
            Some(error_code) => {
                let description = payload
                    .error_description
                    .unwrap_or_else(|| "Unknown GitHub OAuth device flow error".to_string());
                return Err(AppError::unknown(format!(
                    "GitHub authorization failed ({error_code}): {description}",
                )));
            }
            None => {
                return Err(AppError::unknown(
                    "GitHub authorization failed without an access token.",
                ));
            }
        }
    }
}

fn get_integration_store_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("goalrate")
        .join("integrations.json")
}

fn load_integration_store() -> Result<IntegrationStore, AppError> {
    let path = get_integration_store_path();
    if !path.exists() {
        return Ok(IntegrationStore::default());
    }

    let content = std::fs::read_to_string(&path)?;
    serde_json::from_str(&content).map_err(|err| {
        AppError::validation_error(format!("Failed to parse integrations store: {}", err))
    })
}

fn save_integration_store(store: &IntegrationStore) -> Result<(), AppError> {
    let path = get_integration_store_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(store)?;
    std::fs::write(&path, content)?;
    Ok(())
}

fn resolve_active_integrations(
    store: &mut IntegrationStore,
    user_id: Option<String>,
) -> (Vec<IntegrationConfig>, bool) {
    let mut updated = false;
    match user_id {
        Some(ref id) => {
            let entry = store.users.entry(id.clone()).or_insert_with(Vec::new);
            if entry.is_empty() && !store.device.is_empty() {
                *entry = store.device.clone();
                updated = true;
            }
            (entry.clone(), updated)
        }
        None => (store.device.clone(), updated),
    }
}

fn load_active_integrations() -> Result<Vec<IntegrationConfig>, AppError> {
    let user_id = try_read_user_id();
    let mut store = load_integration_store()?;
    let (integrations, updated) = resolve_active_integrations(&mut store, user_id);
    if updated {
        save_integration_store(&store)?;
    }
    Ok(integrations)
}

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
        GITHUB_PROVIDER.to_string(),
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

fn local_ai_base_url() -> String {
    std::env::var("GOALRATE_LOCAL_AI_BASE_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "http://127.0.0.1:11434".to_string())
}

fn build_local_url(path: &str) -> String {
    let base = local_ai_base_url();
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

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
    fn split_model_option_id_uses_legacy_github_fallback() {
        let (provider_id, model_id, mode) = split_model_option_id("gpt-4o-mini");

        assert_eq!(provider_id, GITHUB_PROVIDER);
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

fn parse_catalog_models(payload: &Value) -> Vec<AiModelOption> {
    let items = if let Some(array) = payload.as_array() {
        array.clone()
    } else if let Some(array) = payload.get("models").and_then(Value::as_array) {
        array.clone()
    } else if let Some(array) = payload.get("data").and_then(Value::as_array) {
        array.clone()
    } else {
        Vec::new()
    };

    let models = items
        .iter()
        .filter_map(|item| {
            let id = first_non_empty_string(item, &["id", "model", "name"])?;
            let label =
                first_non_empty_string(item, &["label", "name"]).unwrap_or_else(|| id.clone());
            let provider = first_non_empty_string(item, &["provider", "publisher"]);
            Some(AiModelOption {
                id,
                label,
                provider_id: GITHUB_PROVIDER.to_string(),
                provider,
            })
        })
        .collect::<Vec<_>>();

    dedupe_models(models)
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

fn is_gemini_text_model(model_id: &str) -> bool {
    let normalized = model_id.trim().to_lowercase();
    normalized.contains("gemini")
}

fn parse_gemini_models(payload: &Value) -> Vec<AiModelOption> {
    let items = payload
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let models = items
        .iter()
        .filter_map(|item| {
            let id = first_non_empty_string(item, &["id"])?;
            if !is_gemini_text_model(&id) {
                return None;
            }
            let label = first_non_empty_string(item, &["display_name", "name"])
                .unwrap_or_else(|| normalize_model_label(&id));
            Some(AiModelOption {
                id,
                label,
                provider_id: GEMINI_PROVIDER.to_string(),
                provider: Some("Gemini".to_string()),
            })
        })
        .collect::<Vec<_>>();

    dedupe_models(models)
}

fn parse_mistral_models(payload: &Value) -> Vec<AiModelOption> {
    let items = payload
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let models = items
        .iter()
        .filter_map(|item| {
            let id = first_non_empty_string(item, &["id", "name"])?;
            let label = first_non_empty_string(item, &["name"])
                .unwrap_or_else(|| normalize_model_label(&id));
            Some(AiModelOption {
                id,
                label,
                provider_id: MISTRAL_PROVIDER.to_string(),
                provider: Some("Mistral".to_string()),
            })
        })
        .collect::<Vec<_>>();

    dedupe_models(models)
}

fn default_perplexity_models() -> Vec<AiModelOption> {
    vec![
        AiModelOption {
            id: "sonar".to_string(),
            label: "Sonar".to_string(),
            provider_id: PERPLEXITY_PROVIDER.to_string(),
            provider: Some("Perplexity".to_string()),
        },
        AiModelOption {
            id: "sonar-pro".to_string(),
            label: "Sonar Pro".to_string(),
            provider_id: PERPLEXITY_PROVIDER.to_string(),
            provider: Some("Perplexity".to_string()),
        },
        AiModelOption {
            id: "sonar-reasoning".to_string(),
            label: "Sonar Reasoning".to_string(),
            provider_id: PERPLEXITY_PROVIDER.to_string(),
            provider: Some("Perplexity".to_string()),
        },
        AiModelOption {
            id: "sonar-reasoning-pro".to_string(),
            label: "Sonar Reasoning Pro".to_string(),
            provider_id: PERPLEXITY_PROVIDER.to_string(),
            provider: Some("Perplexity".to_string()),
        },
        AiModelOption {
            id: "sonar-deep-research".to_string(),
            label: "Sonar Deep Research".to_string(),
            provider_id: PERPLEXITY_PROVIDER.to_string(),
            provider: Some("Perplexity".to_string()),
        },
    ]
}

fn parse_perplexity_models(payload: &Value) -> Vec<AiModelOption> {
    let items = payload
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let models = items
        .iter()
        .filter_map(|item| {
            let id = first_non_empty_string(item, &["id"])?;
            if id.trim().is_empty() {
                return None;
            }
            let label = first_non_empty_string(item, &["name", "display_name"])
                .unwrap_or_else(|| normalize_model_label(&id));
            Some(AiModelOption {
                id,
                label,
                provider_id: PERPLEXITY_PROVIDER.to_string(),
                provider: Some("Perplexity".to_string()),
            })
        })
        .collect::<Vec<_>>();

    dedupe_models(models)
}

fn parse_openrouter_models(payload: &Value) -> Vec<AiModelOption> {
    let items = payload
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let models = items
        .iter()
        .filter_map(|item| {
            let id = first_non_empty_string(item, &["id", "model", "slug"])?;
            if id.trim().is_empty() {
                return None;
            }
            let label = first_non_empty_string(item, &["name", "display_name"])
                .unwrap_or_else(|| normalize_model_label(&id));
            Some(AiModelOption {
                id,
                label,
                provider_id: OPENROUTER_PROVIDER.to_string(),
                provider: Some("OpenRouter".to_string()),
            })
        })
        .collect::<Vec<_>>();

    dedupe_models(models)
}

fn parse_groq_models(payload: &Value) -> Vec<AiModelOption> {
    let items = payload
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let models = items
        .iter()
        .filter_map(|item| {
            let id = first_non_empty_string(item, &["id"])?;
            if id.trim().is_empty() {
                return None;
            }
            let label = first_non_empty_string(item, &["name", "display_name"])
                .unwrap_or_else(|| normalize_model_label(&id));
            Some(AiModelOption {
                id,
                label,
                provider_id: GROQ_PROVIDER.to_string(),
                provider: Some("Groq".to_string()),
            })
        })
        .collect::<Vec<_>>();

    dedupe_models(models)
}

fn parse_together_models(payload: &Value) -> Vec<AiModelOption> {
    let items = payload
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let models = items
        .iter()
        .filter_map(|item| {
            let id = first_non_empty_string(item, &["id", "name", "model"])?;
            if id.trim().is_empty() {
                return None;
            }
            let label = first_non_empty_string(item, &["display_name", "name"])
                .unwrap_or_else(|| normalize_model_label(&id));
            Some(AiModelOption {
                id,
                label,
                provider_id: TOGETHER_PROVIDER.to_string(),
                provider: Some("Together AI".to_string()),
            })
        })
        .collect::<Vec<_>>();

    dedupe_models(models)
}

fn parse_azure_openai_models(
    payload: &Value,
    fallback_deployments: &[String],
) -> Vec<AiModelOption> {
    let items = payload
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut models = items
        .iter()
        .filter_map(|item| {
            let id = first_non_empty_string(item, &["id", "model"])?;
            if id.trim().is_empty() {
                return None;
            }
            let label = first_non_empty_string(item, &["name", "display_name"])
                .unwrap_or_else(|| format!("Deployment: {id}"));
            Some(AiModelOption {
                id,
                label,
                provider_id: AZURE_OPENAI_PROVIDER.to_string(),
                provider: Some("Azure OpenAI".to_string()),
            })
        })
        .collect::<Vec<_>>();

    for deployment_id in fallback_deployments {
        let trimmed = deployment_id.trim();
        if trimmed.is_empty() {
            continue;
        }
        models.push(AiModelOption {
            id: trimmed.to_string(),
            label: format!("Deployment: {trimmed}"),
            provider_id: AZURE_OPENAI_PROVIDER.to_string(),
            provider: Some("Azure OpenAI".to_string()),
        });
    }

    dedupe_models(models)
}

fn default_bedrock_models() -> Vec<AiModelOption> {
    vec![
        AiModelOption {
            id: "amazon.nova-pro-v1:0".to_string(),
            label: "Amazon Nova Pro".to_string(),
            provider_id: BEDROCK_PROVIDER.to_string(),
            provider: Some("Amazon Bedrock".to_string()),
        },
        AiModelOption {
            id: "anthropic.claude-3-7-sonnet-20250219-v1:0".to_string(),
            label: "Claude 3.7 Sonnet".to_string(),
            provider_id: BEDROCK_PROVIDER.to_string(),
            provider: Some("Amazon Bedrock".to_string()),
        },
        AiModelOption {
            id: "meta.llama3-1-70b-instruct-v1:0".to_string(),
            label: "Llama 3.1 70B Instruct".to_string(),
            provider_id: BEDROCK_PROVIDER.to_string(),
            provider: Some("Amazon Bedrock".to_string()),
        },
    ]
}

fn parse_bedrock_models(payload: &Value) -> Vec<AiModelOption> {
    let items = payload
        .get("modelSummaries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let models = items
        .iter()
        .filter_map(|item| {
            let output_modalities = item
                .get("outputModalities")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if !output_modalities.is_empty()
                && !output_modalities
                    .iter()
                    .filter_map(Value::as_str)
                    .any(|value| value.eq_ignore_ascii_case("TEXT"))
            {
                return None;
            }

            let id = first_non_empty_string(item, &["modelId"])?;
            let label = first_non_empty_string(item, &["modelName"])
                .unwrap_or_else(|| normalize_model_label(&id));
            Some(AiModelOption {
                id,
                label,
                provider_id: BEDROCK_PROVIDER.to_string(),
                provider: Some("Amazon Bedrock".to_string()),
            })
        })
        .collect::<Vec<_>>();

    dedupe_models(models)
}

fn model_id_from_resource_name(resource_name: &str) -> Option<String> {
    resource_name
        .split('/')
        .last()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn parse_vertex_ai_models(payload: &Value) -> Vec<AiModelOption> {
    let items = payload
        .get("publisherModels")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_else(|| {
            payload
                .get("models")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
        });

    let models = items
        .iter()
        .filter_map(|item| {
            let id = first_non_empty_string(item, &["modelId", "id"]).or_else(|| {
                first_non_empty_string(item, &["name"])
                    .as_deref()
                    .and_then(model_id_from_resource_name)
            })?;
            if id.trim().is_empty() {
                return None;
            }
            let label = first_non_empty_string(item, &["displayName", "name"])
                .map(|value| {
                    if value.contains('/') {
                        normalize_model_label(&id)
                    } else {
                        value
                    }
                })
                .unwrap_or_else(|| normalize_model_label(&id));
            Some(AiModelOption {
                id,
                label,
                provider_id: VERTEX_AI_PROVIDER.to_string(),
                provider: Some("Google Vertex AI".to_string()),
            })
        })
        .collect::<Vec<_>>();

    dedupe_models(models)
}

fn default_vertex_ai_models() -> Vec<AiModelOption> {
    vec![
        AiModelOption {
            id: "gemini-2.5-pro".to_string(),
            label: "Gemini 2.5 Pro".to_string(),
            provider_id: VERTEX_AI_PROVIDER.to_string(),
            provider: Some("Google Vertex AI".to_string()),
        },
        AiModelOption {
            id: "gemini-2.5-flash".to_string(),
            label: "Gemini 2.5 Flash".to_string(),
            provider_id: VERTEX_AI_PROVIDER.to_string(),
            provider: Some("Google Vertex AI".to_string()),
        },
        AiModelOption {
            id: "gemini-2.5-flash-lite".to_string(),
            label: "Gemini 2.5 Flash Lite".to_string(),
            provider_id: VERTEX_AI_PROVIDER.to_string(),
            provider: Some("Google Vertex AI".to_string()),
        },
    ]
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

async fn fetch_github_model_catalog(access_token: &str) -> Result<Vec<AiModelOption>, AppError> {
    let client = reqwest::Client::new();
    let response = client
        .get(GITHUB_MODELS_CATALOG_URL)
        .header(AUTHORIZATION, format!("Bearer {}", access_token))
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "GoalrateDesktop")
        .send()
        .await
        .map_err(|err| {
            AppError::unknown(format!("GitHub model catalog request failed: {}", err))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "GitHub model catalog unavailable ({}): {}",
            status, body
        )));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| AppError::unknown(format!("GitHub model catalog parse failed: {}", err)))?;

    Ok(namespace_models_for_provider(
        GITHUB_PROVIDER,
        "GitHub Models",
        parse_catalog_models(&payload),
    ))
}

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

async fn fetch_gemini_models(api_key: &str) -> Result<Vec<AiModelOption>, AppError> {
    let client = reqwest::Client::new();
    let response = client
        .get(GEMINI_MODELS_URL)
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "GoalrateDesktop")
        .send()
        .await
        .map_err(|err| {
            AppError::unknown(format!("Gemini model catalog request failed: {}", err))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "Gemini model catalog unavailable ({}): {}",
            status, body
        )));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| AppError::unknown(format!("Gemini model catalog parse failed: {}", err)))?;

    Ok(namespace_models_for_provider(
        GEMINI_PROVIDER,
        "Gemini",
        parse_gemini_models(&payload),
    ))
}

async fn fetch_mistral_models(api_key: &str) -> Result<Vec<AiModelOption>, AppError> {
    let client = reqwest::Client::new();
    let response = client
        .get(MISTRAL_MODELS_URL)
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "GoalrateDesktop")
        .send()
        .await
        .map_err(|err| {
            AppError::unknown(format!("Mistral model catalog request failed: {}", err))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "Mistral model catalog unavailable ({}): {}",
            status, body
        )));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| AppError::unknown(format!("Mistral model catalog parse failed: {}", err)))?;

    Ok(namespace_models_for_provider(
        MISTRAL_PROVIDER,
        "Mistral",
        parse_mistral_models(&payload),
    ))
}

async fn fetch_perplexity_models(api_key: &str) -> Result<Vec<AiModelOption>, AppError> {
    let client = reqwest::Client::new();
    let response = client
        .get(PERPLEXITY_MODELS_URL)
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "GoalrateDesktop")
        .send()
        .await
        .map_err(|err| {
            AppError::unknown(format!("Perplexity model catalog request failed: {}", err))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if status == StatusCode::NOT_FOUND || status == StatusCode::METHOD_NOT_ALLOWED {
            return Ok(namespace_models_for_provider(
                PERPLEXITY_PROVIDER,
                "Perplexity",
                default_perplexity_models(),
            ));
        }
        return Err(AppError::validation_error(format!(
            "Perplexity model catalog unavailable ({}): {}",
            status, body
        )));
    }

    let payload: Value = response.json().await.map_err(|err| {
        AppError::unknown(format!("Perplexity model catalog parse failed: {}", err))
    })?;

    let parsed = parse_perplexity_models(&payload);
    if parsed.is_empty() {
        return Ok(namespace_models_for_provider(
            PERPLEXITY_PROVIDER,
            "Perplexity",
            default_perplexity_models(),
        ));
    }

    Ok(namespace_models_for_provider(
        PERPLEXITY_PROVIDER,
        "Perplexity",
        parsed,
    ))
}

async fn fetch_openrouter_models(api_key: &str) -> Result<Vec<AiModelOption>, AppError> {
    let client = reqwest::Client::new();
    let response = client
        .get(OPENROUTER_MODELS_URL)
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "GoalrateDesktop")
        .send()
        .await
        .map_err(|err| {
            AppError::unknown(format!("OpenRouter model catalog request failed: {}", err))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "OpenRouter model catalog unavailable ({}): {}",
            status, body
        )));
    }

    let payload: Value = response.json().await.map_err(|err| {
        AppError::unknown(format!("OpenRouter model catalog parse failed: {}", err))
    })?;

    Ok(namespace_models_for_provider(
        OPENROUTER_PROVIDER,
        "OpenRouter",
        parse_openrouter_models(&payload),
    ))
}

async fn fetch_groq_models(api_key: &str) -> Result<Vec<AiModelOption>, AppError> {
    let client = reqwest::Client::new();
    let response = client
        .get(GROQ_MODELS_URL)
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "GoalrateDesktop")
        .send()
        .await
        .map_err(|err| AppError::unknown(format!("Groq model catalog request failed: {}", err)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "Groq model catalog unavailable ({}): {}",
            status, body
        )));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| AppError::unknown(format!("Groq model catalog parse failed: {}", err)))?;

    Ok(namespace_models_for_provider(
        GROQ_PROVIDER,
        "Groq",
        parse_groq_models(&payload),
    ))
}

async fn fetch_together_models(api_key: &str) -> Result<Vec<AiModelOption>, AppError> {
    let client = reqwest::Client::new();
    let response = client
        .get(TOGETHER_MODELS_URL)
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "GoalrateDesktop")
        .send()
        .await
        .map_err(|err| {
            AppError::unknown(format!("Together AI model catalog request failed: {}", err))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "Together AI model catalog unavailable ({}): {}",
            status, body
        )));
    }

    let payload: Value = response.json().await.map_err(|err| {
        AppError::unknown(format!("Together AI model catalog parse failed: {}", err))
    })?;

    Ok(namespace_models_for_provider(
        TOGETHER_PROVIDER,
        "Together AI",
        parse_together_models(&payload),
    ))
}

async fn fetch_azure_openai_models(
    api_key: &str,
    endpoint: &str,
    api_version: &str,
    deployments: &[String],
) -> Result<Vec<AiModelOption>, AppError> {
    let client = reqwest::Client::new();
    let deployment_response = client
        .get(azure_openai_deployments_url(endpoint, api_version))
        .header("api-key", api_key)
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "GoalrateDesktop")
        .send()
        .await
        .map_err(|err| {
            AppError::unknown(format!(
                "Azure OpenAI deployment catalog request failed: {}",
                err
            ))
        })?;

    let deployment_status = deployment_response.status();
    let deployment_body = deployment_response.text().await.unwrap_or_default();
    if deployment_status.is_success() {
        let payload: Value = serde_json::from_str(&deployment_body).map_err(|err| {
            AppError::unknown(format!(
                "Azure OpenAI deployment catalog parse failed: {}",
                err
            ))
        })?;
        let parsed = parse_azure_openai_models(&payload, deployments);
        if !parsed.is_empty() {
            return Ok(namespace_models_for_provider(
                AZURE_OPENAI_PROVIDER,
                "Azure OpenAI",
                parsed,
            ));
        }
    }

    let model_response = client
        .get(azure_openai_models_url(endpoint, api_version))
        .header("api-key", api_key)
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "GoalrateDesktop")
        .send()
        .await
        .map_err(|err| {
            AppError::unknown(format!(
                "Azure OpenAI model catalog request failed: {}",
                err
            ))
        })?;

    let model_status = model_response.status();
    let model_body = model_response.text().await.unwrap_or_default();
    if model_status.is_success() {
        let payload: Value = serde_json::from_str(&model_body).map_err(|err| {
            AppError::unknown(format!("Azure OpenAI model catalog parse failed: {}", err))
        })?;
        let parsed = parse_azure_openai_models(&payload, deployments);
        if !parsed.is_empty() {
            return Ok(namespace_models_for_provider(
                AZURE_OPENAI_PROVIDER,
                "Azure OpenAI",
                parsed,
            ));
        }
    }

    if !deployments.is_empty() {
        return Ok(namespace_models_for_provider(
            AZURE_OPENAI_PROVIDER,
            "Azure OpenAI",
            parse_azure_openai_models(&Value::Null, deployments),
        ));
    }

    Err(AppError::validation_error(format!(
        "Azure OpenAI catalogs unavailable (deployments {} / models {}): {} {}",
        deployment_status, model_status, deployment_body, model_body
    )))
}

fn fetch_bedrock_models(region: &str) -> Result<Vec<AiModelOption>, AppError> {
    if !bedrock_cli_available() {
        return Err(AppError::validation_error(
            "AWS CLI is required for Amazon Bedrock integration. Install `aws` and run `aws configure`.",
        ));
    }

    let output = run_command_stdout({
        let mut command = Command::new("aws");
        command
            .arg("bedrock")
            .arg("list-foundation-models")
            .arg("--region")
            .arg(region)
            .arg("--by-output-modality")
            .arg("TEXT")
            .arg("--output")
            .arg("json");
        command
    })
    .ok_or_else(|| {
        AppError::validation_error(
            "Failed to list Bedrock models. Verify AWS credentials and Bedrock access.",
        )
    })?;

    let payload: Value = serde_json::from_str(&output)
        .map_err(|err| AppError::unknown(format!("Bedrock model catalog parse failed: {}", err)))?;
    let parsed = parse_bedrock_models(&payload);
    let models = if parsed.is_empty() {
        default_bedrock_models()
    } else {
        parsed
    };

    Ok(namespace_models_for_provider(
        BEDROCK_PROVIDER,
        "Amazon Bedrock",
        models,
    ))
}

async fn fetch_vertex_ai_models(
    access_token: &str,
    project_id: &str,
    location: &str,
) -> Result<Vec<AiModelOption>, AppError> {
    let endpoint = format!(
        "https://{}-aiplatform.googleapis.com/v1/projects/{}/locations/{}/publishers/google/models",
        location.trim(),
        project_id.trim(),
        location.trim()
    );
    let client = reqwest::Client::new();
    let response = client
        .get(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", access_token))
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "GoalrateDesktop")
        .send()
        .await
        .map_err(|err| {
            AppError::unknown(format!("Vertex AI model catalog request failed: {}", err))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "Vertex AI model catalog unavailable ({}): {}",
            status, body
        )));
    }

    let payload: Value = response.json().await.map_err(|err| {
        AppError::unknown(format!("Vertex AI model catalog parse failed: {}", err))
    })?;
    let parsed = parse_vertex_ai_models(&payload);
    let models = if parsed.is_empty() {
        default_vertex_ai_models()
    } else {
        parsed
    };

    Ok(namespace_models_for_provider(
        VERTEX_AI_PROVIDER,
        "Google Vertex AI",
        models,
    ))
}

async fn fetch_local_ollama_models(api_key: Option<&str>) -> Result<Vec<AiModelOption>, AppError> {
    let client = reqwest::Client::builder()
        .timeout(StdDuration::from_secs(4))
        .build()
        .map_err(|err| AppError::unknown(format!("Failed to create local AI client: {}", err)))?;

    let mut request = client
        .get(build_local_url("/api/tags"))
        .header(ACCEPT, "application/json");
    if let Some(api_key) = api_key.map(str::trim).filter(|value| !value.is_empty()) {
        request = request.header(AUTHORIZATION, format!("Bearer {}", api_key));
    }
    let response = request
        .send()
        .await
        .map_err(|err| AppError::unknown(format!("Local model catalog request failed: {}", err)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "Local model catalog unavailable ({}): {}",
            status, body
        )));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| AppError::unknown(format!("Local model catalog parse failed: {}", err)))?;

    let models = payload
        .get("models")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let model_id = first_non_empty_string(item, &["name", "model"])?;
                    let label = first_non_empty_string(item, &["name"])
                        .map(|value| normalize_model_label(&value))
                        .unwrap_or_else(|| normalize_model_label(&model_id));
                    Some(AiModelOption {
                        id: model_id,
                        label,
                        provider_id: LOCAL_PROVIDER.to_string(),
                        provider: Some("Local (Ollama)".to_string()),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(namespace_models_for_provider(
        LOCAL_PROVIDER,
        "Local (Ollama)",
        models,
    ))
}

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

fn extract_ollama_chat_content(payload: &Value) -> Option<String> {
    payload
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|content| !content.is_empty())
        .map(ToString::to_string)
}

fn extract_bedrock_chat_content(payload: &Value) -> Option<String> {
    let parts = payload
        .get("output")
        .and_then(|output| output.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    entry
                        .get("text")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|text| !text.is_empty())
                        .map(ToString::to_string)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

fn extract_vertex_ai_content(payload: &Value) -> Option<String> {
    let parts = payload
        .get("candidates")
        .and_then(Value::as_array)
        .and_then(|entries| entries.first())
        .and_then(|candidate| candidate.get("content"))
        .and_then(|content| content.get("parts"))
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    entry
                        .get("text")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|text| !text.is_empty())
                        .map(ToString::to_string)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
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

async fn generate_github_goal_plan(
    access_token: &str,
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
        .post(GITHUB_MODELS_INFERENCE_URL)
        .header(AUTHORIZATION, format!("Bearer {}", access_token))
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
        .map_err(|err| AppError::unknown(format!("AI generation request failed: {}", err)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "AI model request failed ({}): {}",
            status, body
        )));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| AppError::unknown(format!("AI generation parse failed: {}", err)))?;
    let content = extract_chat_content(&payload).ok_or_else(|| {
        AppError::validation_error("AI model returned an empty response. Please try another model.")
    })?;

    parse_goal_plan_response(&content).ok_or_else(|| {
        AppError::validation_error("AI response was not in the expected goal-plan format")
    })
}

fn normalize_gemini_model_id(model_id: &str) -> String {
    let trimmed = model_id.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    trimmed.trim_start_matches("models/").to_string()
}

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

async fn generate_gemini_goal_plan(
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
    let normalized_model_id = normalize_gemini_model_id(model_id);
    if normalized_model_id.is_empty() {
        return Err(AppError::validation_error("Please select a Gemini model"));
    }

    let client = reqwest::Client::new();
    let response = client
        .post(GEMINI_CHAT_COMPLETIONS_URL)
        .header(AUTHORIZATION, format!("Bearer {}", api_key))
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "GoalrateDesktop")
        .json(&json!({
            "model": normalized_model_id,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.4,
            "max_tokens": 1100
        }))
        .send()
        .await
        .map_err(|err| AppError::unknown(format!("Gemini request failed: {}", err)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "Gemini request failed ({}): {}",
            status, body
        )));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| AppError::unknown(format!("Gemini response parse failed: {}", err)))?;
    let content = extract_chat_content(&payload)
        .ok_or_else(|| AppError::validation_error("Gemini returned an empty response"))?;

    parse_goal_plan_response(&content)
        .ok_or_else(|| AppError::validation_error("Gemini response was not valid goal-plan JSON"))
}

async fn generate_mistral_goal_plan(
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
        .post(MISTRAL_CHAT_COMPLETIONS_URL)
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
            "max_tokens": 1100
        }))
        .send()
        .await
        .map_err(|err| AppError::unknown(format!("Mistral request failed: {}", err)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "Mistral request failed ({}): {}",
            status, body
        )));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| AppError::unknown(format!("Mistral response parse failed: {}", err)))?;
    let content = extract_chat_content(&payload)
        .ok_or_else(|| AppError::validation_error("Mistral returned an empty response"))?;

    parse_goal_plan_response(&content)
        .ok_or_else(|| AppError::validation_error("Mistral response was not valid goal-plan JSON"))
}

async fn generate_perplexity_goal_plan(
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
        .post(PERPLEXITY_CHAT_COMPLETIONS_URL)
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
            "max_tokens": 1100
        }))
        .send()
        .await
        .map_err(|err| AppError::unknown(format!("Perplexity request failed: {}", err)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "Perplexity request failed ({}): {}",
            status, body
        )));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| AppError::unknown(format!("Perplexity response parse failed: {}", err)))?;
    let content = extract_chat_content(&payload)
        .ok_or_else(|| AppError::validation_error("Perplexity returned an empty response"))?;

    parse_goal_plan_response(&content).ok_or_else(|| {
        AppError::validation_error("Perplexity response was not valid goal-plan JSON")
    })
}

async fn generate_openrouter_goal_plan(
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
        .post(OPENROUTER_CHAT_COMPLETIONS_URL)
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
            "response_format": { "type": "json_object" }
        }))
        .send()
        .await
        .map_err(|err| AppError::unknown(format!("OpenRouter request failed: {}", err)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "OpenRouter request failed ({}): {}",
            status, body
        )));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| AppError::unknown(format!("OpenRouter response parse failed: {}", err)))?;
    let content = extract_chat_content(&payload)
        .ok_or_else(|| AppError::validation_error("OpenRouter returned an empty response"))?;

    parse_goal_plan_response(&content).ok_or_else(|| {
        AppError::validation_error("OpenRouter response was not valid goal-plan JSON")
    })
}

async fn generate_groq_goal_plan(
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
        .post(GROQ_CHAT_COMPLETIONS_URL)
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
            "response_format": { "type": "json_object" }
        }))
        .send()
        .await
        .map_err(|err| AppError::unknown(format!("Groq request failed: {}", err)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "Groq request failed ({}): {}",
            status, body
        )));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| AppError::unknown(format!("Groq response parse failed: {}", err)))?;
    let content = extract_chat_content(&payload)
        .ok_or_else(|| AppError::validation_error("Groq returned an empty response"))?;

    parse_goal_plan_response(&content)
        .ok_or_else(|| AppError::validation_error("Groq response was not valid goal-plan JSON"))
}

async fn generate_together_goal_plan(
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
        .post(TOGETHER_CHAT_COMPLETIONS_URL)
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
            "max_tokens": 1100
        }))
        .send()
        .await
        .map_err(|err| AppError::unknown(format!("Together AI request failed: {}", err)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "Together AI request failed ({}): {}",
            status, body
        )));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| AppError::unknown(format!("Together AI response parse failed: {}", err)))?;
    let content = extract_chat_content(&payload)
        .ok_or_else(|| AppError::validation_error("Together AI returned an empty response"))?;

    parse_goal_plan_response(&content).ok_or_else(|| {
        AppError::validation_error("Together AI response was not valid goal-plan JSON")
    })
}

async fn generate_azure_openai_goal_plan(
    api_key: &str,
    endpoint: &str,
    deployment_id: &str,
    api_version: &str,
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
        .post(azure_openai_chat_completions_url(
            endpoint,
            deployment_id,
            api_version,
        ))
        .header("api-key", api_key)
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "GoalrateDesktop")
        .json(&json!({
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "temperature": 0.4,
            "max_tokens": 1100,
            "response_format": { "type": "json_object" }
        }))
        .send()
        .await
        .map_err(|err| AppError::unknown(format!("Azure OpenAI request failed: {}", err)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "Azure OpenAI request failed ({}): {}",
            status, body
        )));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| AppError::unknown(format!("Azure OpenAI response parse failed: {}", err)))?;
    let content = extract_chat_content(&payload)
        .ok_or_else(|| AppError::validation_error("Azure OpenAI returned an empty response"))?;

    parse_goal_plan_response(&content).ok_or_else(|| {
        AppError::validation_error("Azure OpenAI response was not valid goal-plan JSON")
    })
}

async fn generate_bedrock_goal_plan(
    region: &str,
    model_id: &str,
    goal_title: Option<&str>,
    goal_brief: &str,
    deadline: Option<&str>,
    priority: Option<&str>,
    agent_mode: GoalPlanAgentMode,
) -> Result<IntegrationGoalPlanResponse, AppError> {
    if !bedrock_cli_available() {
        return Err(AppError::validation_error(
            "AWS CLI is required for Bedrock generation. Install `aws` and run `aws configure`.",
        ));
    }

    let (system_prompt, user_prompt) =
        build_goal_plan_prompts(goal_title, goal_brief, deadline, priority, agent_mode);
    let messages = serde_json::to_string(&json!([
        {
            "role": "user",
            "content": [{ "text": user_prompt }]
        }
    ]))
    .map_err(|err| AppError::unknown(format!("Bedrock payload serialization failed: {}", err)))?;
    let system = serde_json::to_string(&json!([{ "text": system_prompt }])).map_err(|err| {
        AppError::unknown(format!("Bedrock payload serialization failed: {}", err))
    })?;
    let inference_config = serde_json::to_string(&json!({
        "temperature": 0.4,
        "maxTokens": 1100,
    }))
    .map_err(|err| AppError::unknown(format!("Bedrock payload serialization failed: {}", err)))?;

    let output = run_command_stdout({
        let mut command = Command::new("aws");
        command
            .arg("bedrock-runtime")
            .arg("converse")
            .arg("--region")
            .arg(region)
            .arg("--model-id")
            .arg(model_id)
            .arg("--messages")
            .arg(messages)
            .arg("--system")
            .arg(system)
            .arg("--inference-config")
            .arg(inference_config)
            .arg("--output")
            .arg("json");
        command
    })
    .ok_or_else(|| {
        AppError::validation_error(
            "Bedrock request failed. Verify AWS credentials, model access, and region.",
        )
    })?;

    let payload: Value = serde_json::from_str(&output)
        .map_err(|err| AppError::unknown(format!("Bedrock response parse failed: {}", err)))?;
    let content = extract_bedrock_chat_content(&payload)
        .ok_or_else(|| AppError::validation_error("Bedrock returned an empty response"))?;

    parse_goal_plan_response(&content)
        .ok_or_else(|| AppError::validation_error("Bedrock response was not valid goal-plan JSON"))
}

async fn generate_vertex_ai_goal_plan(
    access_token: &str,
    project_id: &str,
    location: &str,
    model_id: &str,
    goal_title: Option<&str>,
    goal_brief: &str,
    deadline: Option<&str>,
    priority: Option<&str>,
    agent_mode: GoalPlanAgentMode,
) -> Result<IntegrationGoalPlanResponse, AppError> {
    let (system_prompt, user_prompt) =
        build_goal_plan_prompts(goal_title, goal_brief, deadline, priority, agent_mode);

    let endpoint = format!(
        "https://{}-aiplatform.googleapis.com/v1/projects/{}/locations/{}/publishers/google/models/{}:generateContent",
        location.trim(),
        project_id.trim(),
        location.trim(),
        model_id.trim()
    );
    let client = reqwest::Client::new();
    let response = client
        .post(endpoint)
        .header(AUTHORIZATION, format!("Bearer {}", access_token))
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "GoalrateDesktop")
        .json(&json!({
            "systemInstruction": {
                "parts": [{ "text": system_prompt }]
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [{ "text": user_prompt }]
                }
            ],
            "generationConfig": {
                "temperature": 0.4,
                "maxOutputTokens": 1100
            }
        }))
        .send()
        .await
        .map_err(|err| AppError::unknown(format!("Vertex AI request failed: {}", err)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "Vertex AI request failed ({}): {}",
            status, body
        )));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| AppError::unknown(format!("Vertex AI response parse failed: {}", err)))?;
    let content = extract_vertex_ai_content(&payload)
        .ok_or_else(|| AppError::validation_error("Vertex AI returned an empty response"))?;

    parse_goal_plan_response(&content).ok_or_else(|| {
        AppError::validation_error("Vertex AI response was not valid goal-plan JSON")
    })
}

async fn generate_local_goal_plan(
    model_id: &str,
    goal_title: Option<&str>,
    goal_brief: &str,
    deadline: Option<&str>,
    priority: Option<&str>,
    agent_mode: GoalPlanAgentMode,
    api_key: Option<&str>,
) -> Result<IntegrationGoalPlanResponse, AppError> {
    let (system_prompt, user_prompt) =
        build_goal_plan_prompts(goal_title, goal_brief, deadline, priority, agent_mode);
    let client = reqwest::Client::builder()
        .timeout(StdDuration::from_secs(30))
        .build()
        .map_err(|err| AppError::unknown(format!("Failed to create local AI client: {}", err)))?;

    let mut request = client
        .post(build_local_url("/api/chat"))
        .header(ACCEPT, "application/json")
        .json(&json!({
            "model": model_id,
            "stream": false,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "options": {
                "temperature": 0.4
            }
        }));
    if let Some(api_key) = api_key.map(str::trim).filter(|value| !value.is_empty()) {
        request = request.header(AUTHORIZATION, format!("Bearer {}", api_key));
    }
    let response = request
        .send()
        .await
        .map_err(|err| AppError::unknown(format!("Local AI request failed: {}", err)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::validation_error(format!(
            "Local AI request failed ({}): {}",
            status, body
        )));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| AppError::unknown(format!("Local AI parse failed: {}", err)))?;
    let content = extract_ollama_chat_content(&payload).ok_or_else(|| {
        AppError::validation_error("Local AI returned an empty response. Try a different model.")
    })?;

    parse_goal_plan_response(&content).ok_or_else(|| {
        AppError::validation_error("Local AI response was not in the expected goal-plan format")
    })
}

fn client_id(provider: &str) -> Result<String, AppError> {
    let key = match provider {
        "github" => return github_client_id(),
        "linear" => "LINEAR_CLIENT_ID",
        "asana" => "ASANA_CLIENT_ID",
        "jira" => "JIRA_CLIENT_ID",
        _ => {
            return Err(AppError::validation_error(
                "Unsupported integration provider",
            ))
        }
    };
    std::env::var(key).map_err(|_| AppError::validation_error(format!("Missing {}", key)))
}

fn client_secret(provider: &str) -> Result<String, AppError> {
    let key = match provider {
        "github" => return github_client_secret(),
        "linear" => "LINEAR_CLIENT_SECRET",
        "asana" => "ASANA_CLIENT_SECRET",
        "jira" => "JIRA_CLIENT_SECRET",
        _ => {
            return Err(AppError::validation_error(
                "Unsupported integration provider",
            ))
        }
    };
    std::env::var(key).map_err(|_| AppError::validation_error(format!("Missing {}", key)))
}

fn provider_scopes(provider: &str) -> &'static str {
    match provider {
        "github" => "repo read:user",
        "linear" => "read",
        "asana" => "default",
        "jira" => "read:jira-work read:jira-user offline_access",
        _ => "",
    }
}

fn provider_auth_url(provider: &str) -> Result<Url, AppError> {
    let base = match provider {
        "github" => "https://github.com/login/oauth/authorize",
        "linear" => "https://linear.app/oauth/authorize",
        "asana" => "https://app.asana.com/-/oauth_authorize",
        "jira" => "https://auth.atlassian.com/authorize",
        _ => {
            return Err(AppError::validation_error(
                "Unsupported integration provider",
            ))
        }
    };
    Url::parse(base).map_err(|_| AppError::validation_error("Invalid auth URL"))
}

fn provider_token_url(provider: &str) -> Result<&'static str, AppError> {
    match provider {
        "github" => Ok("https://github.com/login/oauth/access_token"),
        "linear" => Ok("https://api.linear.app/oauth/token"),
        "asana" => Ok("https://app.asana.com/-/oauth_token"),
        "jira" => Ok("https://auth.atlassian.com/oauth/token"),
        _ => Err(AppError::validation_error(
            "Unsupported integration provider",
        )),
    }
}

#[tauri::command]
pub async fn start_integration_oauth(
    vault_id: Option<String>,
    provider: String,
    api_base_url: Option<String>,
    staging_api_secret: Option<String>,
    _state: State<'_, AppState>,
) -> Result<IntegrationAuthResponse, AppError> {
    let _ = vault_id;
    let provider = provider.to_lowercase();
    let state_token = uuid::Uuid::new_v4().to_string();
    if provider == GITHUB_PROVIDER {
        let device =
            request_github_device_code(api_base_url.as_deref(), staging_api_secret.as_deref())
                .await?;
        let authorization_url = device
            .verification_uri_complete
            .clone()
            .or_else(|| {
                let user_code = device
                    .user_code
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())?;
                let mut parsed = Url::parse(&device.verification_uri).ok()?;
                parsed.query_pairs_mut().append_pair("user_code", user_code);
                Some(parsed.to_string())
            })
            .unwrap_or_else(|| device.verification_uri.clone());
        let expires_in_seconds = device.expires_in.max(60);
        let poll_interval_secs = device.interval.unwrap_or(5).max(1) as u64;

        let mut store = OAUTH_STATE.lock().unwrap();
        store.insert(
            state_token.clone(),
            IntegrationState {
                provider: provider.clone(),
                device_client_id: Some(device.client_id),
                device_code: Some(device.device_code),
                device_poll_interval_secs: Some(poll_interval_secs),
                device_expires_at: Some(Utc::now() + Duration::seconds(expires_in_seconds)),
            },
        );

        return Ok(IntegrationAuthResponse {
            authorization_url,
            state: state_token,
            verification_code: device.user_code,
        });
    }

    let client_id = client_id(&provider)?;
    let mut url = provider_auth_url(&provider)?;
    let redirect = redirect_uri();

    {
        let mut query = url.query_pairs_mut();
        query.append_pair("client_id", &client_id);
        query.append_pair("redirect_uri", &redirect);
        query.append_pair("state", &state_token);
        query.append_pair("response_type", "code");
        query.append_pair("scope", provider_scopes(&provider));

        if provider == "jira" {
            query.append_pair("audience", "api.atlassian.com");
            query.append_pair("prompt", "consent");
        }
    }

    let mut store = OAUTH_STATE.lock().unwrap();
    store.insert(
        state_token.clone(),
        IntegrationState {
            provider: provider.clone(),
            device_client_id: None,
            device_code: None,
            device_poll_interval_secs: None,
            device_expires_at: None,
        },
    );

    Ok(IntegrationAuthResponse {
        authorization_url: url.to_string(),
        state: state_token,
        verification_code: None,
    })
}

#[tauri::command]
pub async fn complete_integration_oauth(
    code: String,
    state: String,
    _app_state: State<'_, AppState>,
) -> Result<(), AppError> {
    let stored = {
        let mut store = OAUTH_STATE.lock().unwrap();
        store.remove(&state)
    }
    .ok_or_else(|| AppError::validation_error("Invalid OAuth state"))?;

    let provider = stored.provider;
    let tokens = exchange_code(&provider, &code).await?;
    persist_oauth_tokens(provider, tokens).await
}

#[tauri::command]
pub async fn wait_for_integration_oauth(state: String) -> Result<(), AppError> {
    let stored = {
        let mut store = OAUTH_STATE.lock().unwrap();
        store.remove(&state)
    }
    .ok_or_else(|| AppError::validation_error("Invalid OAuth state"))?;

    if stored.provider != GITHUB_PROVIDER {
        return Err(AppError::validation_error(
            "Waiting for OAuth is only supported for GitHub device flow.",
        ));
    }

    let device_code = stored
        .device_code
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::validation_error("GitHub device authorization was not initialized")
        })?;
    let device_client_id = stored
        .device_client_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::validation_error("GitHub device authorization is missing a client ID")
        })?;
    let poll_interval_secs = stored.device_poll_interval_secs.unwrap_or(5);
    let expires_at = stored.device_expires_at.ok_or_else(|| {
        AppError::validation_error("GitHub device authorization expiry is missing")
    })?;

    let tokens = poll_github_device_token(
        device_client_id,
        device_code,
        poll_interval_secs,
        expires_at,
    )
    .await?;
    persist_oauth_tokens(stored.provider, tokens).await
}

async fn persist_oauth_tokens(
    provider: String,
    tokens: OAuthTokenResponse,
) -> Result<(), AppError> {
    let access_token = tokens
        .access_token
        .clone()
        .ok_or_else(|| AppError::unknown("OAuth response missing access token"))?;
    let expires_at = tokens
        .expires_in
        .map(|seconds| Utc::now() + Duration::seconds(seconds));

    let metadata = if provider == "jira" {
        fetch_jira_cloud_id(&access_token).await?
    } else {
        None
    };

    let now = Utc::now();
    let scopes = tokens
        .scope
        .clone()
        .map(|scope| scope.split_whitespace().map(|s| s.to_string()).collect())
        .unwrap_or_default();

    let user_id = try_read_user_id();
    let mut store = load_integration_store()?;
    let (mut integrations, updated) = resolve_active_integrations(&mut store, user_id.clone());
    if updated {
        save_integration_store(&store)?;
    }

    if let Some(existing) = integrations
        .iter_mut()
        .find(|item| item.provider == provider)
    {
        existing.access_token = Some(access_token.clone());
        existing.refresh_token = tokens.refresh_token.clone();
        existing.token_expires_at = expires_at;
        existing.scopes = scopes;
        existing.metadata = metadata;
        existing.connected_at = Some(now);
    } else {
        integrations.push(IntegrationConfig {
            provider,
            access_token: Some(access_token.clone()),
            refresh_token: tokens.refresh_token.clone(),
            token_expires_at: expires_at,
            scopes,
            metadata,
            connected_at: Some(now),
        });
    }

    if let Some(user_id) = user_id {
        store.users.insert(user_id, integrations);
    } else {
        store.device = integrations;
    }
    save_integration_store(&store)?;
    Ok(())
}

#[tauri::command]
pub async fn list_integration_connections(
    vault_id: Option<String>,
    app_state: State<'_, AppState>,
) -> Result<Vec<IntegrationSummary>, AppError> {
    let _ = vault_id;
    let _ = app_state;
    let integrations = load_active_integrations()?;

    let mut items = integrations
        .iter()
        .map(|integration| IntegrationSummary {
            provider: integration.provider.clone(),
            connected: integration
                .access_token
                .as_ref()
                .map(|s| !s.is_empty())
                .unwrap_or(false),
            connected_at: integration.connected_at.map(|dt| dt.to_rfc3339()),
        })
        .collect::<Vec<_>>();

    if github_api_key().is_some()
        && !items
            .iter()
            .any(|integration| integration.provider == GITHUB_PROVIDER)
    {
        items.push(IntegrationSummary {
            provider: GITHUB_PROVIDER.to_string(),
            connected: true,
            connected_at: None,
        });
    }

    if anthropic_api_key().is_some()
        && !items
            .iter()
            .any(|integration| integration.provider == ANTHROPIC_PROVIDER)
    {
        items.push(IntegrationSummary {
            provider: ANTHROPIC_PROVIDER.to_string(),
            connected: true,
            connected_at: None,
        });
    }

    if openai_api_key().is_some()
        && !items
            .iter()
            .any(|integration| integration.provider == OPENAI_PROVIDER)
    {
        items.push(IntegrationSummary {
            provider: OPENAI_PROVIDER.to_string(),
            connected: true,
            connected_at: None,
        });
    }

    if ollama_api_key().is_some()
        && !items
            .iter()
            .any(|integration| integration.provider == LOCAL_PROVIDER)
    {
        items.push(IntegrationSummary {
            provider: LOCAL_PROVIDER.to_string(),
            connected: true,
            connected_at: None,
        });
    }

    if gemini_api_key().is_some()
        && !items
            .iter()
            .any(|integration| integration.provider == GEMINI_PROVIDER)
    {
        items.push(IntegrationSummary {
            provider: GEMINI_PROVIDER.to_string(),
            connected: true,
            connected_at: None,
        });
    }

    if mistral_api_key().is_some()
        && !items
            .iter()
            .any(|integration| integration.provider == MISTRAL_PROVIDER)
    {
        items.push(IntegrationSummary {
            provider: MISTRAL_PROVIDER.to_string(),
            connected: true,
            connected_at: None,
        });
    }

    if perplexity_api_key().is_some()
        && !items
            .iter()
            .any(|integration| integration.provider == PERPLEXITY_PROVIDER)
    {
        items.push(IntegrationSummary {
            provider: PERPLEXITY_PROVIDER.to_string(),
            connected: true,
            connected_at: None,
        });
    }

    if openrouter_api_key().is_some()
        && !items
            .iter()
            .any(|integration| integration.provider == OPENROUTER_PROVIDER)
    {
        items.push(IntegrationSummary {
            provider: OPENROUTER_PROVIDER.to_string(),
            connected: true,
            connected_at: None,
        });
    }

    if groq_api_key().is_some()
        && !items
            .iter()
            .any(|integration| integration.provider == GROQ_PROVIDER)
    {
        items.push(IntegrationSummary {
            provider: GROQ_PROVIDER.to_string(),
            connected: true,
            connected_at: None,
        });
    }

    if together_api_key().is_some()
        && !items
            .iter()
            .any(|integration| integration.provider == TOGETHER_PROVIDER)
    {
        items.push(IntegrationSummary {
            provider: TOGETHER_PROVIDER.to_string(),
            connected: true,
            connected_at: None,
        });
    }

    if azure_openai_api_key().is_some()
        && azure_openai_endpoint().is_some()
        && !items
            .iter()
            .any(|integration| integration.provider == AZURE_OPENAI_PROVIDER)
    {
        items.push(IntegrationSummary {
            provider: AZURE_OPENAI_PROVIDER.to_string(),
            connected: true,
            connected_at: None,
        });
    }

    if let Some(region) = bedrock_region() {
        if bedrock_cli_available()
            && bedrock_credentials_available(&region)
            && !items
                .iter()
                .any(|integration| integration.provider == BEDROCK_PROVIDER)
        {
            items.push(IntegrationSummary {
                provider: BEDROCK_PROVIDER.to_string(),
                connected: true,
                connected_at: None,
            });
        }
    }

    if gcloud_cli_available()
        && vertex_ai_project_id().is_some()
        && gcloud_access_token().is_some()
        && !items
            .iter()
            .any(|integration| integration.provider == VERTEX_AI_PROVIDER)
    {
        items.push(IntegrationSummary {
            provider: VERTEX_AI_PROVIDER.to_string(),
            connected: true,
            connected_at: None,
        });
    }

    Ok(items)
}

#[tauri::command]
pub async fn disconnect_integration(
    vault_id: Option<String>,
    provider: String,
    app_state: State<'_, AppState>,
) -> Result<(), AppError> {
    let _ = vault_id;
    let _ = app_state;
    let user_id = try_read_user_id();
    let mut store = load_integration_store()?;
    let (mut integrations, updated) = resolve_active_integrations(&mut store, user_id.clone());
    if updated {
        save_integration_store(&store)?;
    }

    let normalized_provider = provider.trim().to_lowercase();
    integrations.retain(|integration| integration.provider != normalized_provider);
    if normalized_provider == GITHUB_PROVIDER {
        delete_github_api_key_from_keychain()?;
    } else if normalized_provider == ANTHROPIC_PROVIDER {
        delete_anthropic_api_key_from_keychain()?;
    } else if normalized_provider == OPENAI_PROVIDER {
        delete_openai_api_key_from_keychain()?;
    } else if normalized_provider == LOCAL_PROVIDER {
        delete_ollama_api_key_from_keychain()?;
    } else if normalized_provider == GEMINI_PROVIDER {
        delete_gemini_api_key_from_keychain()?;
    } else if normalized_provider == MISTRAL_PROVIDER {
        delete_mistral_api_key_from_keychain()?;
    } else if normalized_provider == PERPLEXITY_PROVIDER {
        delete_perplexity_api_key_from_keychain()?;
    } else if normalized_provider == OPENROUTER_PROVIDER {
        delete_openrouter_api_key_from_keychain()?;
    } else if normalized_provider == GROQ_PROVIDER {
        delete_groq_api_key_from_keychain()?;
    } else if normalized_provider == AZURE_OPENAI_PROVIDER {
        delete_azure_openai_api_key_from_keychain()?;
    } else if normalized_provider == TOGETHER_PROVIDER {
        delete_together_api_key_from_keychain()?;
    }
    if let Some(user_id) = user_id {
        store.users.insert(user_id, integrations);
    } else {
        store.device = integrations;
    }
    save_integration_store(&store)?;
    Ok(())
}

#[tauri::command]
pub async fn list_integration_tasks(
    vault_id: Option<String>,
    provider: String,
    app_state: State<'_, AppState>,
) -> Result<Vec<IntegrationTask>, AppError> {
    let _ = vault_id;
    let _ = app_state;
    let integrations = load_active_integrations()?;
    let integration = integrations
        .iter()
        .find(|item| item.provider == provider)
        .ok_or_else(|| AppError::validation_error("Integration not connected"))?;

    let access_token = integration
        .access_token
        .clone()
        .ok_or_else(|| AppError::validation_error("Integration missing access token"))?;
    let metadata = integration.metadata.clone();

    fetch_tasks(&provider, &access_token, metadata).await
}

#[tauri::command]
pub async fn list_available_ai_models(
    vault_id: Option<String>,
    app_state: State<'_, AppState>,
) -> Result<AiAvailableModelsResponse, AppError> {
    let _ = vault_id;
    let _ = app_state;
    let integrations = load_active_integrations()?;
    let github_oauth_token = integrations
        .iter()
        .find(|item| item.provider == GITHUB_PROVIDER)
        .and_then(|item| item.access_token.as_ref())
        .map(|token| token.trim())
        .filter(|token| !token.is_empty());
    let github_api_key = github_api_key();
    let github_token = github_oauth_token
        .map(ToString::to_string)
        .or_else(|| github_api_key.clone());

    let mut providers = Vec::new();
    let mut models: Vec<AiModelOption> = Vec::new();
    let local_sdk_availability = detect_local_sdk_availability();
    let local_openai_sdk_models = local_sdk_model_options_for_openai(local_sdk_availability);
    let has_local_openai_sdk = !local_openai_sdk_models.is_empty();
    let local_anthropic_sdk_models = local_sdk_model_options_for_anthropic(local_sdk_availability);
    let has_local_anthropic_sdk = !local_anthropic_sdk_models.is_empty();

    match github_token.as_deref() {
        Some(access_token) => {
            let github_models = fetch_github_model_catalog(access_token).await;
            match github_models {
                Ok(github_models) => {
                    let github_ready = !github_models.is_empty();
                    models.extend(github_models);
                    providers.push(to_provider_option(
                        GITHUB_PROVIDER,
                        "GitHub Models",
                        "oauth_or_api_key",
                        true,
                        github_ready,
                        if github_ready {
                            None
                        } else {
                            Some(
                                "Connected, but no models are available in your GitHub Models catalog."
                                    .to_string(),
                            )
                        },
                    ));
                }
                Err(err) => {
                    log::warn!("GitHub model catalog lookup failed: {}", err);
                    providers.push(to_provider_option(
                        GITHUB_PROVIDER,
                        "GitHub Models",
                        "oauth_or_api_key",
                        true,
                        false,
                        Some(format!(
                            "Connected, but model catalog failed: {}",
                            err.message
                        )),
                    ));
                }
            }
        }
        None => {
            providers.push(to_provider_option(
                GITHUB_PROVIDER,
                "GitHub Models",
                "oauth_or_api_key",
                false,
                false,
                Some("Connect GitHub with OAuth or add your GitHub API key.".to_string()),
            ));
        }
    }

    match ollama_api_key() {
        Some(api_key) => match fetch_local_ollama_models(Some(&api_key)).await {
            Ok(local_models) => {
                let local_ready = !local_models.is_empty();
                models.extend(local_models);
                providers.push(to_provider_option(
                    LOCAL_PROVIDER,
                    "Ollama",
                    "api_key",
                    true,
                    local_ready,
                    if local_ready {
                        None
                    } else {
                        Some(
                            "Configured, but no Ollama models are currently available.".to_string(),
                        )
                    },
                ));
            }
            Err(err) => {
                log::warn!("Ollama model catalog lookup failed: {}", err);
                providers.push(to_provider_option(
                    LOCAL_PROVIDER,
                    "Ollama",
                    "api_key",
                    true,
                    false,
                    Some(format!(
                        "Configured, but model catalog failed: {}",
                        err.message
                    )),
                ));
            }
        },
        None => {
            providers.push(to_provider_option(
                LOCAL_PROVIDER,
                "Ollama",
                "api_key",
                false,
                false,
                Some("Add your Ollama API key to use Ollama models.".to_string()),
            ));
        }
    }

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

    match gemini_api_key() {
        Some(api_key) => match fetch_gemini_models(&api_key).await {
            Ok(gemini_models) => {
                let gemini_ready = !gemini_models.is_empty();
                models.extend(gemini_models);
                providers.push(to_provider_option(
                    GEMINI_PROVIDER,
                    "Gemini",
                    "api_key",
                    true,
                    gemini_ready,
                    if gemini_ready {
                        None
                    } else {
                        Some(
                            "Configured, but no Gemini models are currently available.".to_string(),
                        )
                    },
                ));
            }
            Err(err) => {
                log::warn!("Gemini model catalog lookup failed: {}", err);
                providers.push(to_provider_option(
                    GEMINI_PROVIDER,
                    "Gemini",
                    "api_key",
                    true,
                    false,
                    Some(format!(
                        "Configured, but model catalog failed: {}",
                        err.message
                    )),
                ));
            }
        },
        None => {
            providers.push(to_provider_option(
                GEMINI_PROVIDER,
                "Gemini",
                "api_key",
                false,
                false,
                Some("Add your Gemini API key to use Gemini models.".to_string()),
            ));
        }
    }

    match mistral_api_key() {
        Some(api_key) => match fetch_mistral_models(&api_key).await {
            Ok(mistral_models) => {
                let mistral_ready = !mistral_models.is_empty();
                models.extend(mistral_models);
                providers.push(to_provider_option(
                    MISTRAL_PROVIDER,
                    "Mistral",
                    "api_key",
                    true,
                    mistral_ready,
                    if mistral_ready {
                        None
                    } else {
                        Some(
                            "Configured, but no Mistral models are currently available."
                                .to_string(),
                        )
                    },
                ));
            }
            Err(err) => {
                log::warn!("Mistral model catalog lookup failed: {}", err);
                providers.push(to_provider_option(
                    MISTRAL_PROVIDER,
                    "Mistral",
                    "api_key",
                    true,
                    false,
                    Some(format!(
                        "Configured, but model catalog failed: {}",
                        err.message
                    )),
                ));
            }
        },
        None => {
            providers.push(to_provider_option(
                MISTRAL_PROVIDER,
                "Mistral",
                "api_key",
                false,
                false,
                Some("Add your Mistral API key to use Mistral models.".to_string()),
            ));
        }
    }

    match perplexity_api_key() {
        Some(api_key) => match fetch_perplexity_models(&api_key).await {
            Ok(perplexity_models) => {
                let perplexity_ready = !perplexity_models.is_empty();
                models.extend(perplexity_models);
                providers.push(to_provider_option(
                    PERPLEXITY_PROVIDER,
                    "Perplexity",
                    "api_key",
                    true,
                    perplexity_ready,
                    if perplexity_ready {
                        None
                    } else {
                        Some(
                            "Configured, but no Perplexity models are currently available."
                                .to_string(),
                        )
                    },
                ));
            }
            Err(err) => {
                log::warn!("Perplexity model catalog lookup failed: {}", err);
                providers.push(to_provider_option(
                    PERPLEXITY_PROVIDER,
                    "Perplexity",
                    "api_key",
                    true,
                    false,
                    Some(format!(
                        "Configured, but model catalog failed: {}",
                        err.message
                    )),
                ));
            }
        },
        None => {
            providers.push(to_provider_option(
                PERPLEXITY_PROVIDER,
                "Perplexity",
                "api_key",
                false,
                false,
                Some("Add your Perplexity API key to use Perplexity models.".to_string()),
            ));
        }
    }

    match openrouter_api_key() {
        Some(api_key) => match fetch_openrouter_models(&api_key).await {
            Ok(openrouter_models) => {
                let openrouter_ready = !openrouter_models.is_empty();
                models.extend(openrouter_models);
                providers.push(to_provider_option(
                    OPENROUTER_PROVIDER,
                    "OpenRouter",
                    "api_key",
                    true,
                    openrouter_ready,
                    if openrouter_ready {
                        None
                    } else {
                        Some(
                            "Configured, but no OpenRouter models are currently available."
                                .to_string(),
                        )
                    },
                ));
            }
            Err(err) => {
                log::warn!("OpenRouter model catalog lookup failed: {}", err);
                providers.push(to_provider_option(
                    OPENROUTER_PROVIDER,
                    "OpenRouter",
                    "api_key",
                    true,
                    false,
                    Some(format!(
                        "Configured, but model catalog failed: {}",
                        err.message
                    )),
                ));
            }
        },
        None => {
            providers.push(to_provider_option(
                OPENROUTER_PROVIDER,
                "OpenRouter",
                "api_key",
                false,
                false,
                Some("Add your OpenRouter API key to use routed model access.".to_string()),
            ));
        }
    }

    match groq_api_key() {
        Some(api_key) => match fetch_groq_models(&api_key).await {
            Ok(groq_models) => {
                let groq_ready = !groq_models.is_empty();
                models.extend(groq_models);
                providers.push(to_provider_option(
                    GROQ_PROVIDER,
                    "Groq",
                    "api_key",
                    true,
                    groq_ready,
                    if groq_ready {
                        None
                    } else {
                        Some("Configured, but no Groq models are currently available.".to_string())
                    },
                ));
            }
            Err(err) => {
                log::warn!("Groq model catalog lookup failed: {}", err);
                providers.push(to_provider_option(
                    GROQ_PROVIDER,
                    "Groq",
                    "api_key",
                    true,
                    false,
                    Some(format!(
                        "Configured, but model catalog failed: {}",
                        err.message
                    )),
                ));
            }
        },
        None => {
            providers.push(to_provider_option(
                GROQ_PROVIDER,
                "Groq",
                "api_key",
                false,
                false,
                Some("Add your Groq API key to use low-latency Groq models.".to_string()),
            ));
        }
    }

    match together_api_key() {
        Some(api_key) => match fetch_together_models(&api_key).await {
            Ok(together_models) => {
                let together_ready = !together_models.is_empty();
                models.extend(together_models);
                providers.push(to_provider_option(
                    TOGETHER_PROVIDER,
                    "Together AI",
                    "api_key",
                    true,
                    together_ready,
                    if together_ready {
                        None
                    } else {
                        Some(
                            "Configured, but no Together AI models are currently available."
                                .to_string(),
                        )
                    },
                ));
            }
            Err(err) => {
                log::warn!("Together AI model catalog lookup failed: {}", err);
                providers.push(to_provider_option(
                    TOGETHER_PROVIDER,
                    "Together AI",
                    "api_key",
                    true,
                    false,
                    Some(format!(
                        "Configured, but model catalog failed: {}",
                        err.message
                    )),
                ));
            }
        },
        None => {
            providers.push(to_provider_option(
                TOGETHER_PROVIDER,
                "Together AI",
                "api_key",
                false,
                false,
                Some("Add your Together AI API key to use open-model inference.".to_string()),
            ));
        }
    }

    let azure_api_key = azure_openai_api_key();
    let azure_endpoint = azure_openai_endpoint();
    let azure_api_version = azure_openai_api_version();
    let azure_deployments = azure_openai_deployments();
    match (azure_api_key, azure_endpoint) {
        (Some(api_key), Some(endpoint)) => {
            match fetch_azure_openai_models(
                &api_key,
                &endpoint,
                &azure_api_version,
                &azure_deployments,
            )
            .await
            {
                Ok(azure_models) => {
                    let azure_ready = !azure_models.is_empty();
                    models.extend(azure_models);
                    providers.push(to_provider_option(
                        AZURE_OPENAI_PROVIDER,
                        "Azure OpenAI",
                        "api_key",
                        true,
                        azure_ready,
                        if azure_ready {
                            None
                        } else {
                            Some(
                                "Configured, but no Azure OpenAI deployments were discovered. Set GOALRATE_AZURE_OPENAI_DEPLOYMENTS if needed."
                                    .to_string(),
                            )
                        },
                    ));
                }
                Err(err) => {
                    log::warn!("Azure OpenAI model catalog lookup failed: {}", err);
                    providers.push(to_provider_option(
                        AZURE_OPENAI_PROVIDER,
                        "Azure OpenAI",
                        "api_key",
                        true,
                        false,
                        Some(format!(
                            "Configured, but model catalog failed: {}",
                            err.message
                        )),
                    ));
                }
            }
        }
        (None, Some(_)) => {
            providers.push(to_provider_option(
                AZURE_OPENAI_PROVIDER,
                "Azure OpenAI",
                "api_key",
                false,
                false,
                Some("Add your Azure OpenAI API key to use this endpoint.".to_string()),
            ));
        }
        (_, None) => {
            providers.push(to_provider_option(
                AZURE_OPENAI_PROVIDER,
                "Azure OpenAI",
                "api_key",
                false,
                false,
                Some(
                    "Set GOALRATE_AZURE_OPENAI_ENDPOINT and your API key to use Azure OpenAI."
                        .to_string(),
                ),
            ));
        }
    }

    let bedrock_region = bedrock_region();
    match bedrock_region.as_deref() {
        None => {
            providers.push(to_provider_option(
                BEDROCK_PROVIDER,
                "Amazon Bedrock",
                "sdk",
                false,
                false,
                Some(
                    "Set GOALRATE_BEDROCK_REGION (or AWS_REGION) and configure AWS credentials to use Bedrock."
                        .to_string(),
                ),
            ));
        }
        Some(region) => {
            if !bedrock_cli_available() {
                providers.push(to_provider_option(
                    BEDROCK_PROVIDER,
                    "Amazon Bedrock",
                    "sdk",
                    false,
                    false,
                    Some("Install AWS CLI to use Amazon Bedrock integration.".to_string()),
                ));
            } else if !bedrock_credentials_available(region) {
                providers.push(to_provider_option(
                    BEDROCK_PROVIDER,
                    "Amazon Bedrock",
                    "sdk",
                    false,
                    false,
                    Some(
                        "AWS CLI detected, but credentials are not ready. Run `aws configure` or SSO login."
                            .to_string(),
                    ),
                ));
            } else {
                match fetch_bedrock_models(region) {
                    Ok(bedrock_models) => {
                        let bedrock_ready = !bedrock_models.is_empty();
                        models.extend(bedrock_models);
                        providers.push(to_provider_option(
                            BEDROCK_PROVIDER,
                            "Amazon Bedrock",
                            "sdk",
                            true,
                            bedrock_ready,
                            if bedrock_ready {
                                None
                            } else {
                                Some(
                                    "Connected, but no Bedrock models are currently available."
                                        .to_string(),
                                )
                            },
                        ));
                    }
                    Err(err) => {
                        log::warn!("Bedrock model catalog lookup failed: {}", err);
                        providers.push(to_provider_option(
                            BEDROCK_PROVIDER,
                            "Amazon Bedrock",
                            "sdk",
                            true,
                            false,
                            Some(format!(
                                "Connected, but model catalog failed: {}",
                                err.message
                            )),
                        ));
                    }
                }
            }
        }
    }

    let vertex_project_id = vertex_ai_project_id();
    let vertex_location = vertex_ai_location();
    if !gcloud_cli_available() {
        providers.push(to_provider_option(
            VERTEX_AI_PROVIDER,
            "Google Vertex AI",
            "sdk",
            false,
            false,
            Some("Install gcloud CLI and authenticate to use Vertex AI.".to_string()),
        ));
    } else if vertex_project_id.is_none() {
        providers.push(to_provider_option(
            VERTEX_AI_PROVIDER,
            "Google Vertex AI",
            "sdk",
            false,
            false,
            Some(
                "Set GOALRATE_VERTEX_AI_PROJECT_ID (or configure gcloud project) to use Vertex AI."
                    .to_string(),
            ),
        ));
    } else if let Some(access_token) = gcloud_access_token() {
        if let Some(project_id) = vertex_project_id.as_deref() {
            match fetch_vertex_ai_models(&access_token, project_id, &vertex_location).await {
                Ok(vertex_models) => {
                    let vertex_ready = !vertex_models.is_empty();
                    models.extend(vertex_models);
                    providers.push(to_provider_option(
                        VERTEX_AI_PROVIDER,
                        "Google Vertex AI",
                        "sdk",
                        true,
                        vertex_ready,
                        if vertex_ready {
                            None
                        } else {
                            Some(
                                "Connected, but no Vertex AI models are currently available."
                                    .to_string(),
                            )
                        },
                    ));
                }
                Err(err) => {
                    log::warn!("Vertex AI model catalog lookup failed: {}", err);
                    providers.push(to_provider_option(
                        VERTEX_AI_PROVIDER,
                        "Google Vertex AI",
                        "sdk",
                        true,
                        false,
                        Some(format!(
                            "Connected, but model catalog failed: {}",
                            err.message
                        )),
                    ));
                }
            }
        }
    } else {
        providers.push(to_provider_option(
            VERTEX_AI_PROVIDER,
            "Google Vertex AI",
            "sdk",
            false,
            false,
            Some(
                "gcloud CLI is installed, but no access token is available. Run `gcloud auth application-default login` or `gcloud auth login`."
                    .to_string(),
            ),
        ));
    }

    let models = dedupe_models(models);
    Ok(AiAvailableModelsResponse {
        total: models.len(),
        models,
        providers,
    })
}

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
        GITHUB_PROVIDER => {
            let integrations = load_active_integrations()?;
            let oauth_token = integrations
                .iter()
                .find(|item| item.provider == GITHUB_PROVIDER)
                .and_then(|item| item.access_token.as_deref())
                .map(str::trim)
                .filter(|token| !token.is_empty())
                .map(ToString::to_string);
            let access_token = oauth_token.or_else(github_api_key).ok_or_else(|| {
                AppError::validation_error(
                    "Connect GitHub with OAuth or API key to use GitHub Models",
                )
            })?;

            generate_github_goal_plan(
                &access_token,
                &provider_model_id,
                sanitized_title,
                &goal_brief_with_context,
                sanitized_deadline,
                sanitized_priority,
                resolved_agent_mode,
            )
            .await
        }
        LOCAL_PROVIDER => {
            let api_key = ollama_api_key().ok_or_else(|| {
                AppError::validation_error("Ollama is not configured on this device")
            })?;
            generate_local_goal_plan(
                &provider_model_id,
                sanitized_title,
                &goal_brief_with_context,
                sanitized_deadline,
                sanitized_priority,
                resolved_agent_mode,
                Some(&api_key),
            )
            .await
        }
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
        GEMINI_PROVIDER => {
            let api_key = gemini_api_key().ok_or_else(|| {
                AppError::validation_error("Gemini is not configured on this device")
            })?;
            generate_gemini_goal_plan(
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
        MISTRAL_PROVIDER => {
            let api_key = mistral_api_key().ok_or_else(|| {
                AppError::validation_error("Mistral is not configured on this device")
            })?;
            generate_mistral_goal_plan(
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
        PERPLEXITY_PROVIDER => {
            let api_key = perplexity_api_key().ok_or_else(|| {
                AppError::validation_error("Perplexity is not configured on this device")
            })?;
            generate_perplexity_goal_plan(
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
        OPENROUTER_PROVIDER => {
            let api_key = openrouter_api_key().ok_or_else(|| {
                AppError::validation_error("OpenRouter is not configured on this device")
            })?;
            generate_openrouter_goal_plan(
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
        GROQ_PROVIDER => {
            let api_key = groq_api_key().ok_or_else(|| {
                AppError::validation_error("Groq is not configured on this device")
            })?;
            generate_groq_goal_plan(
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
        TOGETHER_PROVIDER => {
            let api_key = together_api_key().ok_or_else(|| {
                AppError::validation_error("Together AI is not configured on this device")
            })?;
            generate_together_goal_plan(
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
        AZURE_OPENAI_PROVIDER => {
            let api_key = azure_openai_api_key().ok_or_else(|| {
                AppError::validation_error("Azure OpenAI API key is not configured on this device")
            })?;
            let endpoint = azure_openai_endpoint().ok_or_else(|| {
                AppError::validation_error(
                    "Set GOALRATE_AZURE_OPENAI_ENDPOINT to use Azure OpenAI models",
                )
            })?;
            let api_version = azure_openai_api_version();
            let deployment_id = provider_model_id.trim();
            if deployment_id.is_empty() {
                return Err(AppError::validation_error(
                    "Select an Azure OpenAI deployment before generating a goal plan",
                ));
            }

            generate_azure_openai_goal_plan(
                &api_key,
                &endpoint,
                deployment_id,
                &api_version,
                sanitized_title,
                &goal_brief_with_context,
                sanitized_deadline,
                sanitized_priority,
                resolved_agent_mode,
            )
            .await
        }
        BEDROCK_PROVIDER => {
            let region = bedrock_region().ok_or_else(|| {
                AppError::validation_error(
                    "Set GOALRATE_BEDROCK_REGION (or AWS_REGION) before using Bedrock",
                )
            })?;
            if !bedrock_cli_available() {
                return Err(AppError::validation_error(
                    "AWS CLI is required for Bedrock integration. Install `aws` and configure credentials.",
                ));
            }
            if !bedrock_credentials_available(&region) {
                return Err(AppError::validation_error(
                    "AWS credentials are not ready for Bedrock. Run `aws configure` or your SSO login flow.",
                ));
            }

            generate_bedrock_goal_plan(
                &region,
                &provider_model_id,
                sanitized_title,
                &goal_brief_with_context,
                sanitized_deadline,
                sanitized_priority,
                resolved_agent_mode,
            )
            .await
        }
        VERTEX_AI_PROVIDER => {
            let project_id = vertex_ai_project_id().ok_or_else(|| {
                AppError::validation_error(
                    "Set GOALRATE_VERTEX_AI_PROJECT_ID (or configure gcloud project) before using Vertex AI",
                )
            })?;
            let access_token = gcloud_access_token().ok_or_else(|| {
                AppError::validation_error(
                    "gcloud access token is unavailable. Run `gcloud auth login` or `gcloud auth application-default login`.",
                )
            })?;
            let location = vertex_ai_location();

            generate_vertex_ai_goal_plan(
                &access_token,
                &project_id,
                &location,
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

async fn exchange_code(provider: &str, code: &str) -> Result<OAuthTokenResponse, AppError> {
    let token_url = provider_token_url(provider)?;
    let client_id = client_id(provider)?;
    let client_secret = client_secret(provider)?;
    let redirect = redirect_uri();

    let client = reqwest::Client::new();

    let response = match provider {
        "jira" => client
            .post(token_url)
            .json(&json!({
                "grant_type": "authorization_code",
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": redirect,
            }))
            .send()
            .await
            .map_err(|err| AppError::unknown(format!("Token exchange failed: {}", err))),
        _ => client
            .post(token_url)
            .form(&[
                ("grant_type", "authorization_code"),
                ("client_id", client_id.as_str()),
                ("client_secret", client_secret.as_str()),
                ("code", code),
                ("redirect_uri", redirect.as_str()),
            ])
            .header(ACCEPT, "application/json")
            .send()
            .await
            .map_err(|err| AppError::unknown(format!("Token exchange failed: {}", err))),
    }?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::unknown(format!(
            "Token exchange failed: {}",
            body
        )));
    }

    response
        .json::<OAuthTokenResponse>()
        .await
        .map_err(|err| AppError::unknown(format!("Token parsing failed: {}", err)))
}

async fn fetch_jira_cloud_id(access_token: &str) -> Result<Option<serde_json::Value>, AppError> {
    if access_token.is_empty() {
        return Ok(None);
    }
    let client = reqwest::Client::new();
    let response = client
        .get("https://api.atlassian.com/oauth/token/accessible-resources")
        .header(AUTHORIZATION, format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|err| AppError::unknown(format!("Jira cloud lookup failed: {}", err)))?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let resources: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|err| AppError::unknown(format!("Jira cloud parsing failed: {}", err)))?;

    if let Some(resource) = resources.first() {
        if let Some(id) = resource.get("id") {
            return Ok(Some(json!({ "cloudId": id })));
        }
    }
    Ok(None)
}

async fn fetch_tasks(
    provider: &str,
    access_token: &str,
    metadata: Option<serde_json::Value>,
) -> Result<Vec<IntegrationTask>, AppError> {
    let client = reqwest::Client::new();

    match provider {
        "github" => {
            let response = client
                .get("https://api.github.com/issues")
                .header(AUTHORIZATION, format!("Bearer {}", access_token))
                .header(ACCEPT, "application/vnd.github+json")
                .header(USER_AGENT, "GoalrateDesktop")
                .query(&[("filter", "assigned"), ("state", "open")])
                .send()
                .await
                .map_err(|err| AppError::unknown(format!("GitHub fetch failed: {}", err)))?;

            let items: Vec<serde_json::Value> = response
                .json()
                .await
                .map_err(|err| AppError::unknown(format!("GitHub parse failed: {}", err)))?;

            Ok(items
                .into_iter()
                .map(|item| IntegrationTask {
                    id: item
                        .get("id")
                        .and_then(|v| v.as_i64())
                        .unwrap_or_default()
                        .to_string(),
                    title: item
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Untitled")
                        .to_string(),
                    url: item
                        .get("html_url")
                        .and_then(|v| v.as_str())
                        .map(|v| v.to_string()),
                    status: item
                        .get("state")
                        .and_then(|v| v.as_str())
                        .map(|v| v.to_string()),
                    provider: "github".to_string(),
                    source: item
                        .get("repository")
                        .and_then(|repo| repo.get("full_name"))
                        .and_then(|v| v.as_str())
                        .map(|v| v.to_string()),
                })
                .collect())
        }
        "linear" => {
            let response = client
                .post("https://api.linear.app/graphql")
                .header(AUTHORIZATION, format!("Bearer {}", access_token))
                .json(&json!({
                    "query": "query { viewer { assignedIssues(first: 50, filter: { completedAt: { null: true } }) { nodes { id title url state { name } } } } }"
                }))
                .send()
                .await
                .map_err(|err| AppError::unknown(format!("Linear fetch failed: {}", err)))?;

            let data: serde_json::Value = response
                .json()
                .await
                .map_err(|err| AppError::unknown(format!("Linear parse failed: {}", err)))?;
            let nodes = data
                .get("data")
                .and_then(|v| v.get("viewer"))
                .and_then(|v| v.get("assignedIssues"))
                .and_then(|v| v.get("nodes"))
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            Ok(nodes
                .into_iter()
                .map(|node| IntegrationTask {
                    id: node
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    title: node
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Untitled")
                        .to_string(),
                    url: node
                        .get("url")
                        .and_then(|v| v.as_str())
                        .map(|v| v.to_string()),
                    status: node
                        .get("state")
                        .and_then(|v| v.get("name"))
                        .and_then(|v| v.as_str())
                        .map(|v| v.to_string()),
                    provider: "linear".to_string(),
                    source: Some("Linear".to_string()),
                })
                .collect())
        }
        "asana" => {
            let response = client
                .get("https://app.asana.com/api/1.0/tasks")
                .header(AUTHORIZATION, format!("Bearer {}", access_token))
                .query(&[
                    ("assignee", "me"),
                    ("completed_since", "now"),
                    ("opt_fields", "name,permalink_url,completed"),
                ])
                .send()
                .await
                .map_err(|err| AppError::unknown(format!("Asana fetch failed: {}", err)))?;

            let data: serde_json::Value = response
                .json()
                .await
                .map_err(|err| AppError::unknown(format!("Asana parse failed: {}", err)))?;
            let items = data
                .get("data")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            Ok(items
                .into_iter()
                .map(|item| IntegrationTask {
                    id: item
                        .get("gid")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    title: item
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Untitled")
                        .to_string(),
                    url: item
                        .get("permalink_url")
                        .and_then(|v| v.as_str())
                        .map(|v| v.to_string()),
                    status: Some(
                        if item
                            .get("completed")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false)
                        {
                            "completed".to_string()
                        } else {
                            "open".to_string()
                        },
                    ),
                    provider: "asana".to_string(),
                    source: Some("Asana".to_string()),
                })
                .collect())
        }
        "jira" => {
            let cloud_id = metadata
                .and_then(|value| value.get("cloudId").cloned())
                .and_then(|value| value.as_str().map(|s| s.to_string()));
            let cloud_id = match cloud_id {
                Some(id) => id,
                None => return Ok(vec![]),
            };
            let response = client
                .get(format!(
                    "https://api.atlassian.com/ex/jira/{}/rest/api/3/search",
                    cloud_id
                ))
                .header(AUTHORIZATION, format!("Bearer {}", access_token))
                .query(&[
                    ("jql", "assignee = currentUser() AND statusCategory != Done"),
                    ("fields", "summary,status"),
                    ("maxResults", "50"),
                ])
                .send()
                .await
                .map_err(|err| AppError::unknown(format!("Jira fetch failed: {}", err)))?;

            let data: serde_json::Value = response
                .json()
                .await
                .map_err(|err| AppError::unknown(format!("Jira parse failed: {}", err)))?;
            let items = data
                .get("issues")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            Ok(items
                .into_iter()
                .map(|issue| IntegrationTask {
                    id: issue
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    title: issue
                        .get("fields")
                        .and_then(|v| v.get("summary"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Untitled")
                        .to_string(),
                    url: None,
                    status: issue
                        .get("fields")
                        .and_then(|v| v.get("status"))
                        .and_then(|v| v.get("name"))
                        .and_then(|v| v.as_str())
                        .map(|v| v.to_string()),
                    provider: "jira".to_string(),
                    source: Some("Jira".to_string()),
                })
                .collect())
        }
        _ => Err(AppError::validation_error(
            "Unsupported integration provider",
        )),
    }
}
