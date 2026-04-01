mod commands;
mod error;
mod menu;
mod types;

use tauri::Emitter;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use commands::auth::{
    clear_tokens, get_current_user_id, get_stored_user, get_tokens, has_valid_tokens, store_tokens,
    update_tokens,
};
use commands::daily_loop::{
    daily_loop_count_check_ins, daily_loop_create_check_in, daily_loop_create_outcome,
    daily_loop_create_plan, daily_loop_defer_task, daily_loop_delete_outcome,
    daily_loop_get_chat_dates, daily_loop_get_chat_history, daily_loop_get_check_in,
    daily_loop_get_deferral_count, daily_loop_get_deferrals, daily_loop_get_outcomes,
    daily_loop_get_plan, daily_loop_get_recent_stats, daily_loop_get_revisions,
    daily_loop_get_task_metadata, daily_loop_lock_plan, daily_loop_send_chat,
    daily_loop_toggle_task_completion, daily_loop_update_outcome, daily_loop_update_plan,
};
use commands::daily_loop_ai::{
    daily_loop_chat_reprioritize, daily_loop_generate_plan, daily_loop_generate_summary,
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
    archive_goal, create_goal, delete_goal, get_goal, list_goals, migrate_goal_frontmatter,
    rename_domain, update_goal,
};
use commands::integrations::{
    check_api_keys, clear_anthropic_api_key, clear_azure_openai_api_key, clear_gemini_api_key,
    clear_github_api_key, clear_groq_api_key, clear_mistral_api_key, clear_ollama_api_key,
    clear_openai_api_key, clear_openrouter_api_key, clear_perplexity_api_key,
    clear_together_api_key, complete_integration_oauth, disconnect_integration,
    generate_integration_goal_plan, list_available_ai_models, list_integration_connections,
    list_integration_tasks, set_anthropic_api_key, set_azure_openai_api_key, set_gemini_api_key,
    set_github_api_key, set_groq_api_key, set_mistral_api_key, set_ollama_api_key,
    set_openai_api_key, set_openrouter_api_key, set_perplexity_api_key, set_together_api_key,
    start_integration_oauth, wait_for_integration_oauth,
};
use commands::project_tasks::{
    complete_project_task, create_project_task, delete_project_task, get_project_task,
    list_project_tasks, move_project_task, update_project_task,
};
use commands::projects::{
    archive_project, create_project, delete_project, get_project, list_projects, update_project,
};
use commands::vault::{
    close_vault, create_vault, delete_vault, get_user_vaults, get_vault_stats, greet,
    link_vault_to_user, list_vaults, move_vault, open_vault, rename_vault, reveal_vault,
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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
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
            // Goal task commands
            list_goal_tasks,
            get_goal_task,
            create_goal_task,
            update_goal_task,
            delete_goal_task,
            move_goal_task,
            complete_goal_task,
            // Project commands
            list_projects,
            get_project,
            create_project,
            update_project,
            delete_project,
            archive_project,
            // Project task commands
            list_project_tasks,
            get_project_task,
            create_project_task,
            update_project_task,
            delete_project_task,
            move_project_task,
            complete_project_task,
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
            // Daily Loop commands
            daily_loop_get_plan,
            daily_loop_create_plan,
            daily_loop_update_plan,
            daily_loop_lock_plan,
            daily_loop_create_outcome,
            daily_loop_get_outcomes,
            daily_loop_update_outcome,
            daily_loop_delete_outcome,
            daily_loop_defer_task,
            daily_loop_toggle_task_completion,
            daily_loop_get_task_metadata,
            daily_loop_get_deferral_count,
            daily_loop_get_deferrals,
            daily_loop_create_check_in,
            daily_loop_get_check_in,
            daily_loop_send_chat,
            daily_loop_get_chat_history,
            daily_loop_get_chat_dates,
            daily_loop_get_recent_stats,
            daily_loop_count_check_ins,
            daily_loop_get_revisions,
            // Daily Loop AI commands
            daily_loop_generate_plan,
            daily_loop_chat_reprioritize,
            daily_loop_generate_summary,
            // Integration commands
            start_integration_oauth,
            complete_integration_oauth,
            wait_for_integration_oauth,
            list_integration_connections,
            disconnect_integration,
            list_integration_tasks,
            list_available_ai_models,
            generate_integration_goal_plan,
            check_api_keys,
            set_github_api_key,
            clear_github_api_key,
            set_anthropic_api_key,
            clear_anthropic_api_key,
            set_ollama_api_key,
            clear_ollama_api_key,
            set_openai_api_key,
            clear_openai_api_key,
            set_gemini_api_key,
            clear_gemini_api_key,
            set_mistral_api_key,
            clear_mistral_api_key,
            set_perplexity_api_key,
            clear_perplexity_api_key,
            set_openrouter_api_key,
            clear_openrouter_api_key,
            set_groq_api_key,
            clear_groq_api_key,
            set_azure_openai_api_key,
            clear_azure_openai_api_key,
            set_together_api_key,
            clear_together_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
