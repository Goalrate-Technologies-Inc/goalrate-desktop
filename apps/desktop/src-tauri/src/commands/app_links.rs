//! Fixed external links that are safe to expose to the frontend and menus.

use tauri::command;

use crate::error::AppError;

pub const DOCS_URL: &str = "https://docs.goalrate.com";
pub const PRIVACY_POLICY_URL: &str = "https://goalrate.com/privacy";
pub const SUPPORT_URL: &str = "https://goalrate.com/support";
pub const TERMS_OF_USE_URL: &str = "https://goalrate.com/terms";
pub const REPORT_ISSUE_URL: &str =
    "https://github.com/Goalrate-Technologies-Inc/goalrate-desktop/issues";

fn open_fixed_url(url: &str, label: &str) -> Result<(), AppError> {
    open::that(url).map_err(|err| AppError::unknown(format!("Failed to open {label}: {err}")))
}

fn host_matches(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

fn parsed_url(url: &str) -> Option<reqwest::Url> {
    reqwest::Url::parse(url).ok()
}

fn is_allowed_billing_url(url: &str) -> bool {
    let Some(parsed) = parsed_url(url) else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }

    matches!(
        parsed.host_str(),
        Some("checkout.stripe.com" | "billing.stripe.com" | "goalrate.com" | "app.goalrate.com")
    )
}

fn is_local_dev_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

fn is_allowed_auth_url(url: &str) -> bool {
    let Some(parsed) = parsed_url(url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };

    match parsed.scheme() {
        "https" => {
            matches!(
                host,
                "app.goalrate.com" | "api.goalrate.com" | "goalrate.com"
            ) || host_matches(host, "workos.com")
        }
        "http" => is_local_dev_host(host),
        _ => false,
    }
}

#[command]
pub async fn open_privacy_policy() -> Result<(), AppError> {
    open_fixed_url(PRIVACY_POLICY_URL, "privacy policy")
}

#[command]
pub async fn open_support_page() -> Result<(), AppError> {
    open_fixed_url(SUPPORT_URL, "support page")
}

#[command]
pub async fn open_terms_of_use() -> Result<(), AppError> {
    open_fixed_url(TERMS_OF_USE_URL, "terms of use")
}

#[command]
pub async fn open_billing_url(url: String) -> Result<(), AppError> {
    let trimmed = url.trim();
    if !is_allowed_billing_url(trimmed) {
        return Err(AppError::validation_error(
            "Only GoalRate and Stripe billing URLs can be opened from billing actions.",
        ));
    }

    open_fixed_url(trimmed, "billing page")
}

#[command]
pub async fn open_auth_url(url: String) -> Result<(), AppError> {
    let trimmed = url.trim();
    if !is_allowed_auth_url(trimmed) {
        return Err(AppError::validation_error(
            "Only GoalRate and WorkOS auth URLs can be opened from sign-in actions.",
        ));
    }

    open_fixed_url(trimmed, "sign-in page")
}

#[cfg(test)]
mod tests {
    use super::{is_allowed_auth_url, is_allowed_billing_url};

    #[test]
    fn billing_urls_are_limited_to_stripe_and_goalrate() {
        assert!(is_allowed_billing_url(
            "https://checkout.stripe.com/c/pay/cs_test"
        ));
        assert!(is_allowed_billing_url(
            "https://billing.stripe.com/p/session"
        ));
        assert!(is_allowed_billing_url(
            "https://app.goalrate.com/account/billing"
        ));
        assert!(!is_allowed_billing_url(
            "http://checkout.stripe.com/c/pay/cs_test"
        ));
        assert!(!is_allowed_billing_url(
            "https://checkout.stripe.com.evil.test/c/pay"
        ));
    }

    #[test]
    fn auth_urls_allow_workos_goalrate_and_local_dev_only() {
        assert!(is_allowed_auth_url(
            "https://api.workos.com/user_management/authorize?client_id=test"
        ));
        assert!(is_allowed_auth_url(
            "https://authkit.workos.com/oauth2/auth"
        ));
        assert!(is_allowed_auth_url(
            "https://app.goalrate.com/auth/desktop/start"
        ));
        assert!(is_allowed_auth_url(
            "http://localhost:8000/auth/desktop/start"
        ));
        assert!(!is_allowed_auth_url(
            "https://api.workos.com.evil.test/auth"
        ));
        assert!(!is_allowed_auth_url(
            "goalrate://auth/callback?code=abc&state=123"
        ));
    }
}
