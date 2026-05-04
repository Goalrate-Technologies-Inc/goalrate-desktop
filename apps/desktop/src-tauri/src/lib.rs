mod commands;
mod error;
mod menu;
mod types;

use tauri::Emitter;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use commands::agenda::{
    agenda_archive_goal_for_missed_subtask, agenda_archive_parent_task_for_missed_subtask,
    agenda_count_check_ins, agenda_create_check_in, agenda_create_outcome, agenda_create_plan,
    agenda_defer_task, agenda_delete_outcome, agenda_generate_alternative_subtask,
    agenda_generate_alternative_task, agenda_get_agenda_warnings, agenda_get_chat_dates,
    agenda_get_chat_history, agenda_get_check_in, agenda_get_deferral_count, agenda_get_deferrals,
    agenda_get_outcomes, agenda_get_plan, agenda_get_recent_stats, agenda_get_revisions,
    agenda_get_task_metadata, agenda_lock_plan, agenda_open_agenda_error_log,
    agenda_schedule_parent_task_for_missed_subtask, agenda_schedule_task_for_date,
    agenda_send_chat, agenda_toggle_task_completion, agenda_update_outcome, agenda_update_plan,
};
use commands::agenda_ai::{
    agenda_chat_reprioritize, agenda_generate_plan, agenda_generate_summary, assess_goal_priority,
    generate_goal_tasks,
};
use commands::app_links::{
    open_auth_url, open_billing_url, open_privacy_policy, open_support_page, open_terms_of_use,
};
use commands::auth::{
    clear_tokens, get_current_user_id, get_stored_user, get_tokens, has_valid_tokens, store_tokens,
    update_tokens,
};
use commands::focus::{
    complete_focus_item, defer_focus_item, focus_list_close_day, focus_list_generate,
    focus_list_get_current, focus_list_navigate_to_task, gather_focus_candidates,
    gather_focus_candidates_all_vaults, get_focus_day, get_focus_velocity, save_focus_day,
};
use commands::goal_milestones::{
    complete_goal_task, create_goal_task, delete_goal_task, get_goal_task, list_goal_tasks,
    move_goal_task, update_goal_task,
};
use commands::goals::{
    add_goal_frontmatter_task, archive_goal, create_goal, delete_goal,
    delete_goal_frontmatter_task, get_goal, list_goal_frontmatter_tasks, list_goals,
    migrate_goal_frontmatter, rename_domain, update_goal, update_goal_frontmatter_task,
    update_goal_frontmatter_task_recurrence, update_goal_frontmatter_task_scheduled_date,
    update_goal_frontmatter_task_status,
};
use commands::integrations::{
    check_api_keys, clear_anthropic_api_key, clear_openai_api_key, set_anthropic_api_key,
    set_openai_api_key,
};
use commands::memory::save_memory;
use commands::vault::{
    close_vault, create_vault, delete_vault, get_user_vaults, get_vault_stats, greet,
    link_vault_to_user, list_vault_error_log_entries, list_vault_snapshots, list_vaults,
    move_vault, open_vault, open_vault_error_log, open_vault_issue_file, preview_vault_snapshot,
    rename_vault, restore_latest_vault_snapshot, restore_vault_snapshot, reveal_vault,
    set_vault_sync, unlink_vault_from_user, AppState,
};
use commands::vault_tasks::{
    create_vault_task_file, create_vault_task_folder, delete_vault_task_entry, list_vault_tasks,
    move_vault_task_entry, open_vault_task_entry, read_vault_task_file, rename_vault_task_entry,
    update_vault_task_file,
};
use commands::window::set_window_title;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let menu = menu::build_menu(app.handle())?;
            app.set_menu(menu)?;

            // Register global quick-capture shortcut (Cmd+Shift+G)
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::ShortcutState;
                let handle = app.handle().clone();
                app.global_shortcut()
                    .on_shortcut("CmdOrCtrl+Shift+G", move |_app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            let _ = handle.emit("quick-capture", ());
                        }
                    })
                    .unwrap_or_else(|e| {
                        log::warn!("Failed to register quick-capture shortcut: {}", e);
                    });
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::handle_menu_event(app, event);
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            // Auth commands
            store_tokens,
            get_tokens,
            get_stored_user,
            clear_tokens,
            has_valid_tokens,
            get_current_user_id,
            update_tokens,
            // Vault commands
            greet,
            list_vaults,
            create_vault,
            open_vault,
            close_vault,
            delete_vault,
            reveal_vault,
            rename_vault,
            move_vault,
            preview_vault_snapshot,
            restore_latest_vault_snapshot,
            restore_vault_snapshot,
            list_vault_snapshots,
            list_vault_error_log_entries,
            open_vault_error_log,
            open_vault_issue_file,
            get_vault_stats,
            link_vault_to_user,
            unlink_vault_from_user,
            get_user_vaults,
            set_vault_sync,
            set_window_title,
            // Vault task library commands
            list_vault_tasks,
            create_vault_task_folder,
            create_vault_task_file,
            read_vault_task_file,
            update_vault_task_file,
            rename_vault_task_entry,
            delete_vault_task_entry,
            move_vault_task_entry,
            open_vault_task_entry,
            // Goal commands
            list_goals,
            get_goal,
            create_goal,
            update_goal,
            delete_goal,
            archive_goal,
            rename_domain,
            migrate_goal_frontmatter,
            list_goal_frontmatter_tasks,
            add_goal_frontmatter_task,
            update_goal_frontmatter_task,
            update_goal_frontmatter_task_recurrence,
            update_goal_frontmatter_task_scheduled_date,
            update_goal_frontmatter_task_status,
            delete_goal_frontmatter_task,
            // Goal task commands
            list_goal_tasks,
            get_goal_task,
            create_goal_task,
            update_goal_task,
            delete_goal_task,
            move_goal_task,
            complete_goal_task,
            // Focus commands
            get_focus_day,
            save_focus_day,
            complete_focus_item,
            defer_focus_item,
            gather_focus_candidates,
            gather_focus_candidates_all_vaults,
            get_focus_velocity,
            focus_list_generate,
            focus_list_close_day,
            focus_list_get_current,
            focus_list_navigate_to_task,
            // Agenda commands
            agenda_get_plan,
            agenda_get_agenda_warnings,
            agenda_open_agenda_error_log,
            agenda_create_plan,
            agenda_update_plan,
            agenda_schedule_task_for_date,
            agenda_generate_alternative_subtask,
            agenda_schedule_parent_task_for_missed_subtask,
            agenda_generate_alternative_task,
            agenda_archive_parent_task_for_missed_subtask,
            agenda_archive_goal_for_missed_subtask,
            agenda_lock_plan,
            agenda_create_outcome,
            agenda_get_outcomes,
            agenda_update_outcome,
            agenda_delete_outcome,
            agenda_defer_task,
            agenda_toggle_task_completion,
            agenda_get_task_metadata,
            agenda_get_deferral_count,
            agenda_get_deferrals,
            agenda_create_check_in,
            agenda_get_check_in,
            agenda_send_chat,
            agenda_get_chat_history,
            agenda_get_chat_dates,
            agenda_get_recent_stats,
            agenda_count_check_ins,
            agenda_get_revisions,
            // Agenda AI commands
            agenda_generate_plan,
            agenda_chat_reprioritize,
            agenda_generate_summary,
            assess_goal_priority,
            generate_goal_tasks,
            save_memory,
            // Integration commands
            check_api_keys,
            set_openai_api_key,
            clear_openai_api_key,
            set_anthropic_api_key,
            clear_anthropic_api_key,
            open_privacy_policy,
            open_support_page,
            open_terms_of_use,
            open_auth_url,
            open_billing_url,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Opened { urls } = event {
                for url in urls {
                    let callback_url = url.to_string();
                    if callback_url.starts_with("goalrate://auth/callback") {
                        let _ = app.emit("auth-callback-url", callback_url);
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    fn invoke_handler_block() -> &'static str {
        let source = include_str!("lib.rs");
        let start = source
            .find("tauri::generate_handler![")
            .expect("Tauri invoke handler should be present");
        let handler_source = &source[start..];
        let end = handler_source
            .find("])")
            .expect("Tauri invoke handler should close");
        &handler_source[..end]
    }

    #[test]
    fn desktop_mvp_does_not_register_legacy_project_ipc_commands() {
        let handler_source = invoke_handler_block();
        let disabled_commands = [
            "list_projects",
            "get_project",
            "create_project",
            "update_project",
            "delete_project",
            "archive_project",
            "list_project_tasks",
            "get_project_task",
            "create_project_task",
            "update_project_task",
            "delete_project_task",
            "move_project_task",
            "complete_project_task",
        ];

        for command in disabled_commands {
            let registered_command = format!("\n            {command},");
            assert!(
                !handler_source.contains(&registered_command),
                "{command} must not be registered in the desktop MVP invoke handler"
            );
        }
    }

    #[test]
    fn desktop_mvp_removes_legacy_project_modules_and_types() {
        let command_modules = include_str!("commands/mod.rs");
        let types_source = include_str!("types.rs");

        assert!(!command_modules.contains("pub mod project_tasks"));
        assert!(!command_modules.contains("pub mod projects"));

        for marker in [
            "pub struct Project",
            "pub struct ProjectCreate",
            "pub struct ProjectUpdate",
            "pub struct ProjectTask",
            "pub struct ProjectTaskCreate",
            "pub struct ProjectTaskUpdate",
        ] {
            assert!(
                !types_source.contains(marker),
                "{marker} should not remain in the desktop MVP Tauri types"
            );
        }
    }
}
