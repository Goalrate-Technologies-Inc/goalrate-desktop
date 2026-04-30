//! Subscription helpers.
//!
//! StoreKit commands are retained for future Apple-channel work, while the
//! initial Mac production path uses Stripe-backed GoalRate account entitlements.

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use crate::error::{AppError, ErrorCode};

const GOALRATE_API_BASE_URL: &str = "https://api.goalrate.com";
const SUBSCRIPTION_DETAILS_PATH: &str = "/api/subscriptions/me/details";
const SUBSCRIPTION_STATUS_FALLBACK_PATH: &str = "/api/subscriptions/me";
pub const PLUS_PRODUCT_ID: &str = "com.goalrate.desktop.plus.monthly";
pub const SUBSCRIPTION_MANAGEMENT_URL: &str =
    "https://support.apple.com/guide/app-store/cancel-change-or-share-subscriptions-fire5f3a0745/mac";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionPeriod {
    pub unit: String,
    pub value: i32,
    pub display: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppStoreSubscriptionProduct {
    pub product_id: String,
    pub display_name: String,
    pub description: String,
    pub display_price: String,
    pub subscription_period: Option<SubscriptionPeriod>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppStoreSubscriptionStatus {
    pub plan_id: String,
    pub state: String,
    pub active: bool,
    pub will_renew: Option<bool>,
    pub product_id: Option<String>,
    pub expires_at: Option<String>,
    pub checked_at: String,
    pub management_url: String,
    pub latest_transaction_id: Option<String>,
    pub original_transaction_id: Option<String>,
    pub transaction_jws: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StoreKitEnvelope<T> {
    ok: bool,
    data: Option<T>,
    error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AccountSubscriptionStatus {
    #[serde(default, alias = "plan_id")]
    plan_id: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default, alias = "cancel_at_period_end")]
    cancel_at_period_end: Option<bool>,
    #[serde(default)]
    source: Option<String>,
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn goalrate_storekit_get_product(product_ids_json: *const c_char) -> *mut c_char;
    fn goalrate_storekit_get_status(product_ids_json: *const c_char) -> *mut c_char;
    fn goalrate_storekit_purchase_plus(product_ids_json: *const c_char) -> *mut c_char;
    fn goalrate_storekit_restore_purchases(product_ids_json: *const c_char) -> *mut c_char;
    fn goalrate_storekit_open_management() -> *mut c_char;
    fn goalrate_storekit_free_string(value: *mut c_char);
}

fn product_ids_json() -> Result<CString, AppError> {
    CString::new(format!("[\"{PLUS_PRODUCT_ID}\"]"))
        .map_err(|err| AppError::unknown(format!("Invalid StoreKit product ID: {err}")))
}

fn unavailable_status(state: &str) -> AppStoreSubscriptionStatus {
    AppStoreSubscriptionStatus {
        plan_id: "free".to_string(),
        state: state.to_string(),
        active: false,
        will_renew: None,
        product_id: None,
        expires_at: None,
        checked_at: chrono::Utc::now().to_rfc3339(),
        management_url: SUBSCRIPTION_MANAGEMENT_URL.to_string(),
        latest_transaction_id: None,
        original_transaction_id: None,
        transaction_jws: None,
    }
}

fn fallback_plus_product() -> AppStoreSubscriptionProduct {
    AppStoreSubscriptionProduct {
        product_id: PLUS_PRODUCT_ID.to_string(),
        display_name: "GoalRate Plus".to_string(),
        description: "AI planning and Assistant features for GoalRate Desktop.".to_string(),
        display_price: "Price loads from the App Store".to_string(),
        subscription_period: Some(SubscriptionPeriod {
            unit: "month".to_string(),
            value: 1,
            display: "Monthly".to_string(),
        }),
    }
}

fn truthy_env(name: &str) -> bool {
    std::env::var(name)
        .map(|value| matches!(value.trim(), "1" | "true" | "TRUE" | "True"))
        .unwrap_or(false)
}

fn is_app_store_build() -> bool {
    option_env!("GOALRATE_APP_STORE_BUILD")
        .map(|value| matches!(value.trim(), "1" | "true" | "TRUE" | "True"))
        .unwrap_or(false)
        || truthy_env("GOALRATE_APP_STORE_BUILD")
}

fn storekit_runtime_enabled() -> bool {
    is_app_store_build() || truthy_env("GOALRATE_ENABLE_STOREKIT_DEV")
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
        || is_app_store_build()
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

fn entitlement_error() -> AppError {
    AppError::new(
        ErrorCode::PermissionDenied,
        "Upgrade to GoalRate Plus to use AI planning and Assistant features.",
    )
}

async fn fetch_account_subscription_status(
    access_token: &str,
) -> Result<Option<AccountSubscriptionStatus>, AppError> {
    let client = reqwest::Client::new();

    for path in [SUBSCRIPTION_DETAILS_PATH, SUBSCRIPTION_STATUS_FALLBACK_PATH] {
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
            if path == SUBSCRIPTION_DETAILS_PATH {
                log::warn!(
                    "Unable to load subscription details from {}; trying fallback status endpoint: HTTP {}",
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
            return Ok(None);
        }

        let value: Value = serde_json::from_str(&body).map_err(|err| {
            AppError::new(
                ErrorCode::UnknownError,
                format!("Unable to parse GoalRate entitlement response: {err}"),
            )
        })?;

        let Some(payload) = subscription_payload_from_value(value) else {
            return Ok(None);
        };

        let subscription = serde_json::from_value(payload).map_err(|err| {
            AppError::new(
                ErrorCode::UnknownError,
                format!("Unable to parse GoalRate subscription status: {err}"),
            )
        })?;

        return Ok(Some(subscription));
    }

    Ok(None)
}

fn state_plan_id(state: &str) -> &'static str {
    match state {
        "active" | "activeCanceled" | "gracePeriod" => "plus",
        _ => "free",
    }
}

fn normalize_status(mut status: AppStoreSubscriptionStatus) -> AppStoreSubscriptionStatus {
    status.plan_id = state_plan_id(&status.state).to_string();
    status.active = status.plan_id == "plus";
    if status.management_url.trim().is_empty() {
        status.management_url = SUBSCRIPTION_MANAGEMENT_URL.to_string();
    }
    status
}

#[cfg(debug_assertions)]
fn debug_status_from_env() -> Option<AppStoreSubscriptionStatus> {
    let mode = std::env::var("GOALRATE_STOREKIT_TEST_STATUS").ok()?;
    let state = match mode.trim() {
        "active" => "active",
        "active_canceled" | "activeCanceled" | "cancelled" | "canceled" => "activeCanceled",
        "grace" | "gracePeriod" => "gracePeriod",
        "billing_retry" | "billingRetry" => "billingRetry",
        "expired" => "expired",
        "revoked" => "revoked",
        "pending" => "pending",
        "unavailable" => "unavailable",
        _ => "none",
    };
    Some(normalize_status(AppStoreSubscriptionStatus {
        product_id: Some(PLUS_PRODUCT_ID.to_string()),
        ..unavailable_status(state)
    }))
}

#[cfg(not(debug_assertions))]
fn debug_status_from_env() -> Option<AppStoreSubscriptionStatus> {
    None
}

#[cfg(target_os = "macos")]
fn call_storekit<T>(call: unsafe extern "C" fn(*const c_char) -> *mut c_char) -> Result<T, AppError>
where
    T: DeserializeOwned,
{
    let ids = product_ids_json()?;
    let ptr = unsafe { call(ids.as_ptr()) };
    decode_storekit_response(ptr)
}

#[cfg(target_os = "macos")]
fn call_storekit_no_args<T>(call: unsafe extern "C" fn() -> *mut c_char) -> Result<T, AppError>
where
    T: DeserializeOwned,
{
    let ptr = unsafe { call() };
    decode_storekit_response(ptr)
}

#[cfg(target_os = "macos")]
fn decode_storekit_response<T>(ptr: *mut c_char) -> Result<T, AppError>
where
    T: DeserializeOwned,
{
    if ptr.is_null() {
        return Err(AppError::unknown("StoreKit returned an empty response."));
    }

    let raw = unsafe { CStr::from_ptr(ptr).to_string_lossy().into_owned() };
    unsafe { goalrate_storekit_free_string(ptr) };

    let envelope: StoreKitEnvelope<T> = serde_json::from_str(&raw).map_err(|err| {
        AppError::new(
            ErrorCode::UnknownError,
            format!("Unable to parse StoreKit response: {err}"),
        )
    })?;

    if envelope.ok {
        envelope
            .data
            .ok_or_else(|| AppError::unknown("StoreKit response did not include data."))
    } else {
        Err(AppError::new(
            ErrorCode::UnknownError,
            envelope
                .error
                .unwrap_or_else(|| "The App Store returned an unknown error.".to_string()),
        ))
    }
}

#[cfg(target_os = "macos")]
fn storekit_product() -> Result<AppStoreSubscriptionProduct, AppError> {
    call_storekit(goalrate_storekit_get_product)
}

#[cfg(not(target_os = "macos"))]
fn storekit_product() -> Result<AppStoreSubscriptionProduct, AppError> {
    Err(AppError::validation_error(
        "App Store subscriptions are only available on macOS.",
    ))
}

#[cfg(target_os = "macos")]
fn storekit_status() -> Result<AppStoreSubscriptionStatus, AppError> {
    call_storekit(goalrate_storekit_get_status).map(normalize_status)
}

#[cfg(not(target_os = "macos"))]
fn storekit_status() -> Result<AppStoreSubscriptionStatus, AppError> {
    Ok(unavailable_status("unavailable"))
}

#[cfg(target_os = "macos")]
fn storekit_purchase_plus() -> Result<AppStoreSubscriptionStatus, AppError> {
    call_storekit(goalrate_storekit_purchase_plus).map(normalize_status)
}

#[cfg(not(target_os = "macos"))]
fn storekit_purchase_plus() -> Result<AppStoreSubscriptionStatus, AppError> {
    Err(AppError::validation_error(
        "App Store purchases are only available on macOS.",
    ))
}

#[cfg(target_os = "macos")]
fn storekit_restore_purchases() -> Result<AppStoreSubscriptionStatus, AppError> {
    call_storekit(goalrate_storekit_restore_purchases).map(normalize_status)
}

#[cfg(not(target_os = "macos"))]
fn storekit_restore_purchases() -> Result<AppStoreSubscriptionStatus, AppError> {
    Ok(unavailable_status("unavailable"))
}

#[tauri::command]
pub async fn get_plus_subscription_product() -> Result<AppStoreSubscriptionProduct, AppError> {
    if !storekit_runtime_enabled() {
        return Ok(fallback_plus_product());
    }

    match storekit_product() {
        Ok(product) => Ok(product),
        Err(err) => {
            log::warn!("Unable to load GoalRate Plus product from StoreKit: {err}");
            Ok(fallback_plus_product())
        }
    }
}

#[tauri::command]
pub async fn get_app_store_subscription_status() -> Result<AppStoreSubscriptionStatus, AppError> {
    if let Some(status) = debug_status_from_env() {
        return Ok(status);
    }
    if !storekit_runtime_enabled() {
        return Ok(unavailable_status("none"));
    }
    storekit_status()
}

#[tauri::command]
pub async fn purchase_plus_subscription() -> Result<AppStoreSubscriptionStatus, AppError> {
    if let Some(status) = debug_status_from_env() {
        return Ok(status);
    }
    if !storekit_runtime_enabled() {
        return Err(AppError::validation_error(
            "App Store purchases are disabled in this development build. Use GOALRATE_STOREKIT_TEST_STATUS for local entitlement testing, or set GOALRATE_ENABLE_STOREKIT_DEV=1 to exercise StoreKit.",
        ));
    }
    storekit_purchase_plus()
}

#[tauri::command]
pub async fn restore_app_store_purchases() -> Result<AppStoreSubscriptionStatus, AppError> {
    if let Some(status) = debug_status_from_env() {
        return Ok(status);
    }
    if !storekit_runtime_enabled() {
        return Err(AppError::validation_error(
            "App Store restore is disabled in this development build. Use GOALRATE_STOREKIT_TEST_STATUS for local entitlement testing, or set GOALRATE_ENABLE_STOREKIT_DEV=1 to exercise StoreKit.",
        ));
    }
    storekit_restore_purchases()
}

#[tauri::command]
pub async fn open_app_store_subscription_management() -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    {
        let _: String = call_storekit_no_args(goalrate_storekit_open_management)?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err(AppError::validation_error(
            "App Store subscription management is only available on macOS.",
        ))
    }
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

    let subscription = fetch_account_subscription_status(&tokens.access_token).await?;
    if subscription
        .as_ref()
        .map(subscription_status_allows_hosted_ai)
        .unwrap_or(false)
    {
        Ok(())
    } else {
        Err(entitlement_error())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_and_grace_states_map_to_plus() {
        for state in ["active", "activeCanceled", "gracePeriod"] {
            let status = normalize_status(AppStoreSubscriptionStatus {
                product_id: Some(PLUS_PRODUCT_ID.to_string()),
                ..unavailable_status(state)
            });
            assert_eq!(status.plan_id, "plus");
            assert!(status.active);
        }
    }

    #[test]
    fn expired_cancelled_and_retry_states_do_not_unlock_plus() {
        for state in [
            "none",
            "billingRetry",
            "expired",
            "revoked",
            "pending",
            "unavailable",
        ] {
            let status = normalize_status(AppStoreSubscriptionStatus {
                product_id: Some(PLUS_PRODUCT_ID.to_string()),
                ..unavailable_status(state)
            });
            assert_eq!(status.plan_id, "free");
            assert!(!status.active);
        }
    }

    #[test]
    fn active_plus_stripe_subscription_unlocks_hosted_ai() {
        let status = AccountSubscriptionStatus {
            plan_id: Some("plus".to_string()),
            status: Some("active".to_string()),
            cancel_at_period_end: Some(false),
            source: Some("stripe".to_string()),
        };

        assert!(subscription_status_allows_hosted_ai(&status));
    }

    #[test]
    fn post_launch_tiers_do_not_unlock_direct_mac_hosted_ai() {
        for plan_id in ["pro", "premium"] {
            let status = AccountSubscriptionStatus {
                plan_id: Some(plan_id.to_string()),
                status: Some("active".to_string()),
                cancel_at_period_end: Some(false),
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
                cancel_at_period_end: Some(false),
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
            cancel_at_period_end: Some(false),
            source: Some("storekit".to_string()),
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
