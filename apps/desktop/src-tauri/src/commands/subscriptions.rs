//! Subscription entitlement helpers for the direct Mac launch.

use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;

use crate::error::{AppError, ErrorCode};

const GOALRATE_API_BASE_URL: &str = "https://api.goalrate.com";
const ENTITLEMENTS_PATH: &str = "/entitlements";
const SUBSCRIPTION_DETAILS_PATH: &str = "/api/subscriptions/me/details";
const SUBSCRIPTION_STATUS_FALLBACK_PATH: &str = "/api/subscriptions/me";
const AI_FEATURE_KEYS: [&str; 4] = [
    "ai.agenda.generate",
    "ai.assistant.chat",
    "ai.task.breakdown",
    "ai.memory.context",
];

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AccountSubscriptionStatus {
    #[serde(default, alias = "plan_id")]
    plan_id: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    source: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AccountEntitlementStatus {
    #[serde(default)]
    active_workspace_plan: Option<AccountSubscriptionStatus>,
    #[serde(default)]
    active_workspace_features: HashMap<String, bool>,
}

fn truthy_env(name: &str) -> bool {
    std::env::var(name)
        .map(|value| matches!(value.trim(), "1" | "true" | "TRUE" | "True"))
        .unwrap_or(false)
}

fn hosted_ai_requires_account() -> bool {
    std::env::var("GOALRATE_HOSTED_AI_URL")
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
        || option_env!("GOALRATE_REQUIRE_HOSTED_AI")
            .map(|value| matches!(value.trim(), "1" | "true" | "TRUE" | "True"))
            .unwrap_or(false)
        || truthy_env("GOALRATE_REQUIRE_HOSTED_AI")
        || !cfg!(debug_assertions)
}

fn hosted_ai_api_base_url() -> String {
    std::env::var("GOALRATE_API_BASE_URL")
        .or_else(|_| std::env::var("VITE_API_BASE_URL"))
        .ok()
        .or_else(|| option_env!("GOALRATE_API_BASE_URL").map(str::to_string))
        .or_else(|| option_env!("VITE_API_BASE_URL").map(str::to_string))
        .or_else(hosted_ai_origin_from_env)
        .unwrap_or_else(|| {
            if cfg!(debug_assertions) {
                "http://localhost:8000".to_string()
            } else {
                GOALRATE_API_BASE_URL.to_string()
            }
        })
        .trim_end_matches('/')
        .to_string()
}

fn hosted_ai_origin_from_env() -> Option<String> {
    let configured_url = std::env::var("GOALRATE_HOSTED_AI_URL").ok()?;
    let parsed = reqwest::Url::parse(configured_url.trim()).ok()?;
    let host = parsed.host_str()?;
    let mut origin = format!("{}://{}", parsed.scheme(), host);
    if let Some(port) = parsed.port() {
        origin.push(':');
        origin.push_str(&port.to_string());
    }
    Some(origin)
}

fn subscription_api_url(path: &str) -> String {
    let normalized_path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    format!("{}{}", hosted_ai_api_base_url(), normalized_path)
}

fn subscription_payload_from_value(value: Value) -> Option<Value> {
    if value.is_null() {
        return None;
    }

    if let Some(subscription) = value.get("subscription") {
        return (!subscription.is_null()).then(|| subscription.clone());
    }

    if let Some(data) = value.get("data") {
        if data.is_null() {
            return None;
        }
        if let Some(subscription) = data.get("subscription") {
            return (!subscription.is_null()).then(|| subscription.clone());
        }
        return Some(data.clone());
    }

    Some(value)
}

fn plan_allows_hosted_ai(plan_id: Option<&str>) -> bool {
    matches!(plan_id, Some("plus"))
}

fn source_allows_stripe_entitlement(source: Option<&str>) -> bool {
    source
        .map(|value| value.eq_ignore_ascii_case("stripe"))
        .unwrap_or(true)
}

fn subscription_status_allows_hosted_ai(status: &AccountSubscriptionStatus) -> bool {
    let plan_allows_ai = plan_allows_hosted_ai(status.plan_id.as_deref());
    let source_is_stripe = source_allows_stripe_entitlement(status.source.as_deref());
    let active_state = matches!(
        status.status.as_deref(),
        Some("active" | "activeCanceled" | "active_canceled")
    );

    plan_allows_ai && source_is_stripe && active_state
}

fn entitlement_status_allows_hosted_ai(status: &AccountEntitlementStatus) -> bool {
    let all_ai_features_enabled = AI_FEATURE_KEYS.iter().all(|feature| {
        status
            .active_workspace_features
            .get(*feature)
            .copied()
            .unwrap_or(false)
    });
    let plan_is_active_stripe = status
        .active_workspace_plan
        .as_ref()
        .map(|plan| {
            source_allows_stripe_entitlement(plan.source.as_deref())
                && matches!(plan.status.as_deref(), Some("active"))
        })
        .unwrap_or(false);

    all_ai_features_enabled && plan_is_active_stripe
}

fn entitlement_error() -> AppError {
    AppError::new(
        ErrorCode::PermissionDenied,
        "Upgrade to GoalRate Plus to use AI planning and Assistant features.",
    )
}

async fn fetch_account_ai_entitlement(access_token: &str) -> Result<bool, AppError> {
    let client = reqwest::Client::new();

    for path in [
        ENTITLEMENTS_PATH,
        SUBSCRIPTION_DETAILS_PATH,
        SUBSCRIPTION_STATUS_FALLBACK_PATH,
    ] {
        let response = client
            .get(subscription_api_url(path))
            .header("Accept", "application/json")
            .header("Authorization", format!("Bearer {access_token}"))
            .send()
            .await
            .map_err(|err| {
                AppError::new(
                    ErrorCode::NetworkError,
                    format!("Unable to verify GoalRate Plus entitlement: {err}"),
                )
            })?;

        let status = response.status();
        if matches!(
            status,
            reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN
        ) {
            return Err(AppError::auth_error(
                "Sign in again to verify your GoalRate Plus entitlement.",
            ));
        }

        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            if path != SUBSCRIPTION_STATUS_FALLBACK_PATH {
                log::warn!(
                    "Unable to load entitlement status from {}; trying fallback endpoint: HTTP {}",
                    path,
                    status
                );
                continue;
            }
            return Err(AppError::new(
                ErrorCode::NetworkError,
                format!("GoalRate entitlement check failed ({status}): {body}"),
            ));
        }

        if body.trim().is_empty() {
            return Ok(false);
        }

        let value: Value = serde_json::from_str(&body).map_err(|err| {
            AppError::new(
                ErrorCode::UnknownError,
                format!("Unable to parse GoalRate entitlement response: {err}"),
            )
        })?;

        if path == ENTITLEMENTS_PATH {
            let status: AccountEntitlementStatus =
                serde_json::from_value(value).map_err(|err| {
                    AppError::new(
                        ErrorCode::UnknownError,
                        format!("Unable to parse GoalRate entitlements: {err}"),
                    )
                })?;
            return Ok(entitlement_status_allows_hosted_ai(&status));
        }

        let Some(payload) = subscription_payload_from_value(value) else {
            return Ok(false);
        };

        let subscription = serde_json::from_value(payload).map_err(|err| {
            AppError::new(
                ErrorCode::UnknownError,
                format!("Unable to parse GoalRate subscription status: {err}"),
            )
        })?;

        return Ok(subscription_status_allows_hosted_ai(&subscription));
    }

    Ok(false)
}

pub async fn require_ai_entitlement() -> Result<(), AppError> {
    if !hosted_ai_requires_account() {
        return Ok(());
    }

    let tokens = super::auth::get_tokens().await?.ok_or_else(|| {
        AppError::new(
            ErrorCode::AuthError,
            "Sign in to use GoalRate Plus AI planning and Assistant features.",
        )
    })?;

    if tokens.expires_at <= chrono::Utc::now().timestamp_millis() {
        return Err(AppError::new(
            ErrorCode::AuthError,
            "Your GoalRate session has expired. Sign in again to use AI planning and Assistant features.",
        ));
    }

    if fetch_account_ai_entitlement(&tokens.access_token).await? {
        Ok(())
    } else {
        Err(entitlement_error())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_plus_stripe_subscription_unlocks_hosted_ai() {
        let status = AccountSubscriptionStatus {
            plan_id: Some("plus".to_string()),
            status: Some("active".to_string()),
            source: Some("stripe".to_string()),
        };

        assert!(subscription_status_allows_hosted_ai(&status));
    }

    #[test]
    fn active_entitlement_features_unlock_hosted_ai() {
        let status = AccountEntitlementStatus {
            active_workspace_plan: Some(AccountSubscriptionStatus {
                plan_id: Some("plus".to_string()),
                status: Some("active".to_string()),
                source: Some("stripe".to_string()),
            }),
            active_workspace_features: AI_FEATURE_KEYS
                .iter()
                .map(|feature| ((*feature).to_string(), true))
                .collect(),
        };

        assert!(entitlement_status_allows_hosted_ai(&status));
    }

    #[test]
    fn entitlement_features_do_not_unlock_when_billing_is_not_active() {
        let status = AccountEntitlementStatus {
            active_workspace_plan: Some(AccountSubscriptionStatus {
                plan_id: Some("plus".to_string()),
                status: Some("trialing".to_string()),
                source: Some("stripe".to_string()),
            }),
            active_workspace_features: AI_FEATURE_KEYS
                .iter()
                .map(|feature| ((*feature).to_string(), true))
                .collect(),
        };

        assert!(!entitlement_status_allows_hosted_ai(&status));
    }

    #[test]
    fn post_launch_tiers_do_not_unlock_direct_mac_hosted_ai() {
        for plan_id in ["pro", "premium"] {
            let status = AccountSubscriptionStatus {
                plan_id: Some(plan_id.to_string()),
                status: Some("active".to_string()),
                source: Some("stripe".to_string()),
            };

            assert!(!subscription_status_allows_hosted_ai(&status));
        }
    }

    #[test]
    fn free_trial_and_past_due_states_do_not_unlock_hosted_ai() {
        for status_text in ["trial", "trialing", "past_due", "canceled", "expired"] {
            let status = AccountSubscriptionStatus {
                plan_id: Some("plus".to_string()),
                status: Some(status_text.to_string()),
                source: Some("stripe".to_string()),
            };

            assert!(!subscription_status_allows_hosted_ai(&status));
        }
    }

    #[test]
    fn non_stripe_subscription_sources_do_not_unlock_direct_mac_hosted_ai() {
        let status = AccountSubscriptionStatus {
            plan_id: Some("plus".to_string()),
            status: Some("active".to_string()),
            source: Some("app_store".to_string()),
        };

        assert!(!subscription_status_allows_hosted_ai(&status));
    }

    #[test]
    fn subscription_payload_accepts_wrapped_backend_shapes() {
        let value = serde_json::json!({
            "data": {
                "subscription": {
                    "plan_id": "plus",
                    "status": "active",
                    "source": "stripe"
                }
            }
        });
        let payload = subscription_payload_from_value(value).unwrap();
        let status: AccountSubscriptionStatus = serde_json::from_value(payload).unwrap();

        assert_eq!(status.plan_id.as_deref(), Some("plus"));
        assert_eq!(status.status.as_deref(), Some("active"));
        assert_eq!(status.source.as_deref(), Some("stripe"));
    }
}
