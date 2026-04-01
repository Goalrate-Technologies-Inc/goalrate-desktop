//! Window management commands for the GoalRate desktop application.

use tauri::{command, AppHandle, Manager};

/// Set the main window title.
///
/// This command allows the frontend to dynamically update the window title,
/// typically to reflect the current vault name.
///
/// # Arguments
/// * `app` - The Tauri app handle
/// * `title` - The new window title
///
/// # Examples
/// - "GoalRate" (no vault open)
/// - "My Vault - GoalRate" (vault open)
#[command]
pub async fn set_window_title(app: AppHandle, title: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.set_title(&title).map_err(|e| e.to_string())?;
    }
    Ok(())
}
