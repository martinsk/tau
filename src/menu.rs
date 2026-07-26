use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;

pub const MENU_OPEN_FOLDER: &str = "menu-open-folder";
pub const MENU_SAVE: &str = "menu-save";
pub const MENU_CLOSE_TAB: &str = "menu-close-tab";
pub const MENU_UNDO: &str = "menu-undo";
pub const MENU_REDO: &str = "menu-redo";
pub const MENU_CUT: &str = "menu-cut";
pub const MENU_COPY: &str = "menu-copy";
pub const MENU_PASTE: &str = "menu-paste";
pub const MENU_SPLIT_HORIZONTAL: &str = "menu-split-horizontal";
pub const MENU_SPLIT_VERTICAL: &str = "menu-split-vertical";
pub const MENU_TOGGLE_TERMINAL: &str = "menu-toggle-terminal";
pub const MENU_NEW_TERMINAL: &str = "menu-new-terminal";
pub const MENU_KILL_TERMINAL: &str = "menu-kill-terminal";
pub const MENU_MINIMIZE: &str = "menu-minimize";
pub const MENU_TOGGLE_FULLSCREEN: &str = "menu-toggle-fullscreen";

pub fn build_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<tauri::menu::Menu<R>, tauri::Error> {
    let about = SubmenuBuilder::new(app, "Tau")
        .about(Some(AboutMetadata::default()))
        .separator()
        .hide()
        .hide_others()
        .quit()
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::new("Open Folder…")
                .id(MENU_OPEN_FOLDER)
                .accelerator("CmdOrCtrl+Shift+O")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::new("Save")
                .id(MENU_SAVE)
                .accelerator("CmdOrCtrl+S")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new("Close Tab")
                .id(MENU_CLOSE_TAB)
                .accelerator("CmdOrCtrl+W")
                .build(app)?,
        )
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::new("Split Horizontal")
                .id(MENU_SPLIT_HORIZONTAL)
                .accelerator("CmdOrCtrl+2")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new("Split Vertical")
                .id(MENU_SPLIT_VERTICAL)
                .accelerator("CmdOrCtrl+3")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::new("Toggle Terminal")
                .id(MENU_TOGGLE_TERMINAL)
                .accelerator("Ctrl+`")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new("New Terminal")
                .id(MENU_NEW_TERMINAL)
                .accelerator("Ctrl+Shift+`")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new("Kill Terminal")
                .id(MENU_KILL_TERMINAL)
                .accelerator("Ctrl+Shift+K")
                .build(app)?,
        )
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .close_window()
        .fullscreen()
        .build()?;

    MenuBuilder::new(app)
        .item(&about)
        .item(&file)
        .item(&edit)
        .item(&view)
        .item(&window)
        .build()
}

pub fn handle_menu_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: tauri::menu::MenuEvent) {
    let id = event.id.0.as_ref();
    match id {
        MENU_OPEN_FOLDER
        | MENU_SAVE
        | MENU_CLOSE_TAB
        | MENU_UNDO
        | MENU_REDO
        | MENU_CUT
        | MENU_COPY
        | MENU_PASTE
        | MENU_SPLIT_HORIZONTAL
        | MENU_SPLIT_VERTICAL
        | MENU_TOGGLE_TERMINAL
        | MENU_NEW_TERMINAL
        | MENU_KILL_TERMINAL => {
            let _ = app.emit(id, ());
        }
        _ => {}
    }
}
