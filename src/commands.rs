use serde::Serialize;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;

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
    app.dialog()
        .file()
        .blocking_pick_folder()
        .map(|p| p.to_string())
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

    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.cmp(&b.name)));
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

fn canonical_root(root_path: &str) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(root_path).map_err(|e| e.to_string())?;
    if !root.is_dir() {
        return Err("workspace root is not a directory".into());
    }
    Ok(root)
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name == "." || name == ".." {
        return Err("invalid name".into());
    }
    let mut components = Path::new(name).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(()),
        _ => Err("name must not contain path separators".into()),
    }
}

fn existing_workspace_path(root_path: &str, path: &str) -> Result<(PathBuf, PathBuf), String> {
    let root = canonical_root(root_path)?;
    let target = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !target.starts_with(&root) {
        return Err("path is outside the workspace".into());
    }
    Ok((root, target))
}

fn workspace_parent(root_path: &str, parent_path: &str) -> Result<(PathBuf, PathBuf), String> {
    let (root, parent) = existing_workspace_path(root_path, parent_path)?;
    if !parent.is_dir() {
        return Err("parent path is not a directory".into());
    }
    Ok((root, parent))
}

fn node_for_path(path: &Path) -> Result<FileNode, String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .ok_or("path has no file name")?;
    Ok(FileNode {
        name,
        path: path.to_string_lossy().to_string(),
        is_dir: metadata.is_dir(),
    })
}

#[tauri::command]
pub fn create_file(
    root_path: String,
    parent_path: String,
    name: String,
) -> Result<FileNode, String> {
    validate_name(&name)?;
    let (_, parent) = workspace_parent(&root_path, &parent_path)?;
    let path = parent.join(name);
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    node_for_path(&path)
}

#[tauri::command]
pub fn create_directory(
    root_path: String,
    parent_path: String,
    name: String,
) -> Result<FileNode, String> {
    validate_name(&name)?;
    let (_, parent) = workspace_parent(&root_path, &parent_path)?;
    let path = parent.join(name);
    std::fs::create_dir(&path).map_err(|e| e.to_string())?;
    node_for_path(&path)
}

#[tauri::command]
pub fn rename_path(root_path: String, path: String, new_name: String) -> Result<FileNode, String> {
    validate_name(&new_name)?;
    let (root, target) = existing_workspace_path(&root_path, &path)?;
    if target == root {
        return Err("cannot rename the workspace root".into());
    }
    let parent = target.parent().ok_or("path has no parent")?;
    let destination = parent.join(new_name);
    if destination.exists() {
        return Err("destination already exists".into());
    }
    std::fs::rename(&target, &destination).map_err(|e| e.to_string())?;
    node_for_path(&destination)
}

#[tauri::command]
pub fn delete_path(root_path: String, path: String) -> Result<(), String> {
    let (root, target) = existing_workspace_path(&root_path, &path)?;
    if target == root {
        return Err("cannot delete the workspace root".into());
    }
    let metadata = std::fs::symlink_metadata(&target).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() || metadata.is_file() {
        std::fs::remove_file(target).map_err(|e| e.to_string())
    } else if metadata.is_dir() {
        std::fs::remove_dir_all(target).map_err(|e| e.to_string())
    } else {
        Err("unsupported filesystem entry".into())
    }
}

fn copy_entry(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(source).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("copying symbolic links is not supported".into());
    }
    if metadata.is_file() {
        std::fs::copy(source, destination)
            .map(|_| ())
            .map_err(|e| e.to_string())
    } else if metadata.is_dir() {
        std::fs::create_dir(destination).map_err(|e| e.to_string())?;
        for entry in std::fs::read_dir(source).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            copy_entry(&entry.path(), &destination.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        Err("unsupported filesystem entry".into())
    }
}

#[tauri::command]
pub fn copy_path(
    root_path: String,
    path: String,
    destination_name: String,
) -> Result<FileNode, String> {
    validate_name(&destination_name)?;
    let (root, source) = existing_workspace_path(&root_path, &path)?;
    if source == root {
        return Err("cannot copy the workspace root".into());
    }
    let destination = source
        .parent()
        .ok_or("path has no parent")?
        .join(destination_name);
    if destination.exists() {
        return Err("destination already exists".into());
    }
    copy_entry(&source, &destination)?;
    node_for_path(&destination)
}

fn collect_workspace_files(
    root: &Path,
    directory: &Path,
    files: &mut Vec<String>,
) -> Result<(), String> {
    if files.len() >= 50_000 {
        return Ok(());
    }
    for entry in std::fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if matches!(name.as_ref(), ".git" | "node_modules" | "target" | "dist") {
                continue;
            }
            collect_workspace_files(root, &path, files)?;
        } else if file_type.is_file() {
            let relative = path.strip_prefix(root).map_err(|e| e.to_string())?;
            files.push(relative.to_string_lossy().to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_workspace_files(root_path: String) -> Result<Vec<String>, String> {
    let root = canonical_root(&root_path)?;
    let mut files = Vec::new();
    collect_workspace_files(&root, &root, &mut files)?;
    files.sort();
    Ok(files)
}

#[tauri::command]
pub fn reveal_path(root_path: String, path: String) -> Result<(), String> {
    let (_, target) = existing_workspace_path(&root_path, &path)?;
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open")
        .arg("-R")
        .arg(&target)
        .status()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("explorer")
        .arg(format!("/select,{}", target.to_string_lossy()))
        .status()
        .map_err(|e| e.to_string())?;
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let status = std::process::Command::new("xdg-open")
        .arg(target.parent().unwrap_or(&target))
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("failed to reveal path".into())
    }
}

#[derive(Clone, Serialize)]
pub struct WorkspaceChanged {
    pub root_path: String,
}

pub struct WorkspaceManager {
    watchers: Mutex<HashMap<String, notify::RecommendedWatcher>>,
}

impl Default for WorkspaceManager {
    fn default() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }
}

impl WorkspaceManager {
    fn watch(&self, root_path: String, app: tauri::AppHandle) -> Result<(), String> {
        use notify::Watcher;
        let root = canonical_root(&root_path)?;
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                if result.is_ok() {
                    let _ = tx.send(());
                }
            })
            .map_err(|e| e.to_string())?;
        watcher
            .watch(&root, notify::RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;
        let event_root = root_path.clone();
        std::thread::spawn(move || {
            while rx.recv().is_ok() {
                while rx.recv_timeout(Duration::from_millis(200)).is_ok() {}
                let _ = app.emit(
                    "workspace-changed",
                    WorkspaceChanged {
                        root_path: event_root.clone(),
                    },
                );
            }
        });
        self.watchers
            .lock()
            .map_err(|_| "workspace watcher lock poisoned".to_string())?
            .insert(root_path, watcher);
        Ok(())
    }
}

#[tauri::command]
pub fn watch_workspace(
    root_path: String,
    state: tauri::State<'_, WorkspaceManager>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    state.watch(root_path, app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let suffix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!("tau-commands-{suffix}"));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }

        fn text(&self) -> String {
            self.0.to_string_lossy().to_string()
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn creates_renames_copies_and_deletes_entries() {
        let root = TestDir::new();
        let root_path = root.text();
        let file = create_file(root_path.clone(), root_path.clone(), "one.txt".into()).unwrap();
        std::fs::write(&file.path, "content").unwrap();
        let renamed = rename_path(root_path.clone(), file.path, "two.txt".into()).unwrap();
        let copy = copy_path(root_path.clone(), renamed.path.clone(), "three.txt".into()).unwrap();
        assert_eq!(std::fs::read_to_string(&copy.path).unwrap(), "content");
        delete_path(root_path.clone(), renamed.path).unwrap();
        assert!(!Path::new(&root_path).join("two.txt").exists());
        assert!(Path::new(&root_path).join("three.txt").exists());
    }

    #[test]
    fn rejects_invalid_names_and_workspace_escapes() {
        let root = TestDir::new();
        let outside = TestDir::new();
        let root_path = root.text();
        assert!(create_file(root_path.clone(), root_path.clone(), "../escape".into()).is_err());
        assert!(create_file(root_path.clone(), outside.text(), "escape".into()).is_err());
        assert!(delete_path(root_path.clone(), root_path).is_err());
    }

    #[test]
    fn recursively_duplicates_directories() {
        let root = TestDir::new();
        let root_path = root.text();
        let directory =
            create_directory(root_path.clone(), root_path.clone(), "src".into()).unwrap();
        create_file(root_path.clone(), directory.path.clone(), "main.rs".into()).unwrap();
        let copy = copy_path(root_path, directory.path, "src-copy".into()).unwrap();
        assert!(Path::new(&copy.path).join("main.rs").exists());
    }
}
