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

fn is_allowed_billing_url(url: &str) -> bool {
    url.starts_with("https://checkout.stripe.com/")
        || url.starts_with("https://billing.stripe.com/")
        || url.starts_with("https://goalrate.com/")
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
