use serde::Serialize;

/// TODO: replace with a real project descriptor from the model layer.
#[derive(Serialize)]
pub struct ProjectStub {
    pub id: String,
    pub name: String,
}

/// TODO: replace with a real container descriptor from the model layer.
#[derive(Serialize)]
pub struct ContainerStub {
    pub id: String,
    pub name: String,
}

/// TODO: replace with a real item descriptor from the model layer.
#[derive(Serialize)]
pub struct ItemStub {
    pub id: String,
    pub name: String,
    pub kind: String,
}

/// TODO: implement project enumeration using the model/workspace layer.
#[tauri::command]
pub fn list_projects() -> Vec<String> {
    todo!()
}

/// TODO: implement project opening using the model layer.
#[tauri::command]
pub fn open_project(path: String) -> ProjectStub {
    let _ = path;
    todo!()
}

/// TODO: implement container listing using the model layer.
#[tauri::command]
pub fn list_containers(project_id: String) -> Vec<ContainerStub> {
    let _ = project_id;
    todo!()
}

/// TODO: implement item opening using the model layer.
#[tauri::command]
pub fn open_item(item_id: String) -> ItemStub {
    let _ = item_id;
    todo!()
}

#[derive(Serialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// Opens a folder dialog and returns the selected path.
#[tauri::command]
pub fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog().file().blocking_pick_folder().map(|p| p.to_string())
}

/// Reads a directory and returns its entries, sorted with directories first.
#[tauri::command]
pub fn read_dir(path: String) -> Result<Vec<FileNode>, String> {
    let mut entries: Vec<FileNode> = std::fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path().to_string_lossy().to_string();
            Some(FileNode {
                name,
                path,
                is_dir: metadata.is_dir(),
            })
        })
        .collect();

    entries.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name))
    });
    Ok(entries)
}

/// Reads the contents of a UTF-8 text file.
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Writes text content to a file.
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}
