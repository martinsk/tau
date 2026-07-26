pub mod commands;
pub mod menu;
pub mod model;
pub mod pty;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyManager::default())
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
            pty::create_terminal,
            pty::terminal_input,
            pty::terminal_resize,
            pty::kill_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
