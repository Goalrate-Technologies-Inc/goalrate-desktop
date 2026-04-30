//! Native menu implementation for GoalRate desktop application.
//!
//! Simplified for the Daily Loop app — no Focus/Goals/Projects navigation.

use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Emitter, Manager, Runtime,
};

use crate::commands::app_links::{DOCS_URL, PRIVACY_POLICY_URL, REPORT_ISSUE_URL, SUPPORT_URL};

/// Menu item identifiers for custom actions
pub mod menu_ids {
    pub const NEW_VAULT: &str = "new_vault";
    pub const OPEN_VAULT: &str = "open_vault";
    pub const CLOSE_VAULT: &str = "close_vault";
    pub const RELOAD: &str = "reload";
    pub const TOGGLE_DEVTOOLS: &str = "toggle_devtools";
    pub const DOCS: &str = "docs";
    pub const PRIVACY_POLICY: &str = "privacy_policy";
    pub const SUPPORT: &str = "support";
    pub const REPORT_ISSUE: &str = "report_issue";
}

/// Build the application menu for the given app handle.
pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = MenuBuilder::new(app);

    #[cfg(target_os = "macos")]
    let menu = menu.items(&[
        &build_app_menu(app)?,
        &build_file_menu(app, false)?,
        &build_edit_menu(app)?,
        &build_view_menu(app)?,
        &build_window_menu(app)?,
        &build_help_menu(app, false)?,
    ]);

    #[cfg(not(target_os = "macos"))]
    let menu = menu.items(&[
        &build_file_menu(app, true)?,
        &build_edit_menu(app)?,
        &build_view_menu(app)?,
        &build_window_menu(app)?,
        &build_help_menu(app, true)?,
    ]);

    menu.build()
}

/// Build macOS-specific app menu (GoalRate menu)
#[cfg(target_os = "macos")]
fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    SubmenuBuilder::new(app, "GoalRate")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()
}

/// Build File menu
fn build_file_menu<R: Runtime>(
    app: &AppHandle<R>,
    include_quit: bool,
) -> tauri::Result<tauri::menu::Submenu<R>> {
    let new_vault = MenuItemBuilder::with_id(menu_ids::NEW_VAULT, "New Vault")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;

    let open_vault = MenuItemBuilder::with_id(menu_ids::OPEN_VAULT, "Open Vault...")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;

    let close_vault = MenuItemBuilder::with_id(menu_ids::CLOSE_VAULT, "Close Vault")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;

    let mut builder = SubmenuBuilder::new(app, "File")
        .item(&new_vault)
        .item(&open_vault)
        .separator()
        .item(&close_vault);

    if include_quit {
        builder = builder.separator().quit();
    }

    builder.build()
}

/// Build Edit menu with standard editing operations
fn build_edit_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .separator()
        .select_all()
        .build()
}

/// Build View menu (dev tools only — no page navigation)
fn build_view_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    let reload = MenuItemBuilder::with_id(menu_ids::RELOAD, "Reload")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;

    let toggle_devtools =
        MenuItemBuilder::with_id(menu_ids::TOGGLE_DEVTOOLS, "Toggle Developer Tools")
            .accelerator("CmdOrCtrl+Shift+I")
            .build(app)?;

    SubmenuBuilder::new(app, "View")
        .item(&reload)
        .item(&toggle_devtools)
        .build()
}

/// Build Window menu
fn build_window_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()
}

/// Build Help menu
fn build_help_menu<R: Runtime>(
    app: &AppHandle<R>,
    include_about: bool,
) -> tauri::Result<tauri::menu::Submenu<R>> {
    let docs = MenuItemBuilder::with_id(menu_ids::DOCS, "Documentation").build(app)?;

    let privacy_policy =
        MenuItemBuilder::with_id(menu_ids::PRIVACY_POLICY, "Privacy Policy").build(app)?;

    let support = MenuItemBuilder::with_id(menu_ids::SUPPORT, "Support").build(app)?;

    let report_issue =
        MenuItemBuilder::with_id(menu_ids::REPORT_ISSUE, "Report Issue").build(app)?;

    let mut builder = SubmenuBuilder::new(app, "Help")
        .item(&docs)
        .item(&privacy_policy)
        .item(&support)
        .separator()
        .item(&report_issue);

    if include_about {
        builder = builder.separator().about(None);
    }

    builder.build()
}

/// Handle menu events and emit appropriate frontend events
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();

    match id {
        // File menu actions
        menu_ids::NEW_VAULT => {
            let _ = app.emit("menu-action", "file:new-vault");
        }
        menu_ids::OPEN_VAULT => {
            let _ = app.emit("menu-action", "file:open-vault");
        }
        menu_ids::CLOSE_VAULT => {
            let _ = app.emit("menu-action", "file:close-vault");
        }

        // Dev tools
        menu_ids::RELOAD => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("window.location.reload()");
            }
        }
        menu_ids::TOGGLE_DEVTOOLS =>
        {
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                if window.is_devtools_open() {
                    window.close_devtools();
                } else {
                    window.open_devtools();
                }
            }
        }

        // Help menu actions
        menu_ids::DOCS => {
            let _ = open::that(DOCS_URL);
        }
        menu_ids::PRIVACY_POLICY => {
            let _ = open::that(PRIVACY_POLICY_URL);
        }
        menu_ids::SUPPORT => {
            let _ = open::that(SUPPORT_URL);
        }
        menu_ids::REPORT_ISSUE => {
            let _ = open::that(REPORT_ISSUE_URL);
        }

        _ => {}
    }
}
