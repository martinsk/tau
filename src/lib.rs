pub mod commands;
pub mod git;
pub mod menu;
pub mod model;
pub mod pty;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(pty::PtyManager::default())
        .manage(git::GitManager::default())
        .manage(commands::WorkspaceManager::default())
        .setup(|app| {
            let menu = menu::build_menu(&app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                menu::handle_menu_event(&app, event);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pick_folder,
            commands::read_dir,
            commands::read_file,
            commands::write_file,
            commands::create_file,
            commands::create_directory,
            commands::rename_path,
            commands::delete_path,
            commands::copy_path,
            commands::reveal_path,
            commands::list_workspace_files,
            commands::watch_workspace,
            pty::create_terminal,
            pty::terminal_input,
            pty::terminal_resize,
            pty::kill_terminal,
            pty::create_agent_session,
            pty::agent_session_input,
            pty::resize_agent_session,
            pty::stop_agent_session,
            git::git_watch_repo,
            git::git_status,
            git::git_diff_content,
            git::git_init,
            git::git_stage,
            git::git_stage_all,
            git::git_unstage,
            git::git_unstage_all,
            git::git_commit,
            git::git_branches,
            git::git_create_branch,
            git::git_checkout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    // Regression test for a bug where `lsp.ts` spawns `rust-analyzer`/`clangd`
    // via `@tauri-apps/plugin-shell`'s `Command.create(...).spawn()`, but the
    // Rust-side capability file didn't grant the permissions that API path
    // actually needs. Note `spawn()` (long-running, streamed I/O) is gated by
    // `shell:allow-spawn`, which is distinct from `shell:allow-execute` (gates
    // the one-shot `execute()` API, unused here) — granting the wrong one
    // silently blocks every LSP client from starting (surfacing as e.g.
    // "Outline unavailable" in the UI). `write()`/`kill()` on the spawned
    // child additionally require `shell:allow-stdin-write` / `shell:allow-kill`.
    // This checks the capability file directly since JSON edits aren't caught
    // by `cargo build` the way removing the `tauri_plugin_shell::init()` call
    // would be.
    #[test]
    fn default_capabilities_grant_shell_spawn_for_lsp_servers() {
        let raw = include_str!("../capabilities/default.json");
        let value: serde_json::Value =
            serde_json::from_str(raw).expect("capabilities/default.json must be valid JSON");
        let permissions = value["permissions"]
            .as_array()
            .expect("permissions must be an array");

        for flat in ["shell:allow-stdin-write", "shell:allow-kill"] {
            assert!(
                permissions.iter().any(|p| p == flat),
                "expected capabilities/default.json to grant `{flat}` (required by LspClient.send/stop in frontend/src/lsp.ts)"
            );
        }

        let spawn_permission = permissions
            .iter()
            .find(|p| p["identifier"] == "shell:allow-spawn")
            .expect("capabilities/default.json must grant shell:allow-spawn (Command.spawn(), not shell:allow-execute)");

        let allowed_names: Vec<&str> = spawn_permission["allow"]
            .as_array()
            .expect("shell:allow-spawn must have an `allow` scope array")
            .iter()
            .map(|entry| {
                entry["name"]
                    .as_str()
                    .expect("scope entry must have a `name`")
            })
            .collect();

        for server in ["rust-analyzer", "clangd"] {
            assert!(
                allowed_names.contains(&server),
                "expected shell:allow-spawn scope to include `{server}` (used by frontend/src/lsp.ts's defaultServers)"
            );
        }
    }
}
