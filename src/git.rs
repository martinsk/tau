use git2::{Repository, Status, StatusOptions};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;

#[derive(Clone, Serialize)]
pub struct GitStatusChanged {
    pub root_path: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileStatusKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
    TypeChanged,
}

#[derive(Clone, Debug, Serialize)]
pub struct FileStatus {
    pub path: String,
    pub staged: Option<FileStatusKind>,
    pub unstaged: Option<FileStatusKind>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RepoStatus {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub files: Vec<FileStatus>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Branch {
    pub name: String,
    pub is_head: bool,
    pub is_remote: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct DiffContent {
    pub original: Option<String>,
    pub modified: Option<String>,
    pub is_binary: bool,
}

fn kind_from_status(status: Status, staged: bool) -> Option<FileStatusKind> {
    if staged {
        if status.is_index_new() {
            return Some(FileStatusKind::Added);
        }
        if status.is_index_modified() {
            return Some(FileStatusKind::Modified);
        }
        if status.is_index_deleted() {
            return Some(FileStatusKind::Deleted);
        }
        if status.is_index_renamed() {
            return Some(FileStatusKind::Renamed);
        }
        if status.is_index_typechange() {
            return Some(FileStatusKind::TypeChanged);
        }
    } else {
        if status.is_wt_new() {
            return Some(FileStatusKind::Untracked);
        }
        if status.is_wt_modified() {
            return Some(FileStatusKind::Modified);
        }
        if status.is_wt_deleted() {
            return Some(FileStatusKind::Deleted);
        }
        if status.is_wt_renamed() {
            return Some(FileStatusKind::Renamed);
        }
        if status.is_wt_typechange() {
            return Some(FileStatusKind::TypeChanged);
        }
    }
    if status.is_conflicted() {
        return Some(FileStatusKind::Conflicted);
    }
    None
}

fn compute_status(root_path: &str) -> Result<RepoStatus, String> {
    let repo = match Repository::open(root_path) {
        Ok(r) => r,
        Err(_) => {
            return Ok(RepoStatus {
                is_repo: false,
                branch: None,
                ahead: 0,
                behind: 0,
                files: Vec::new(),
            });
        }
    };

    let branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    let (ahead, behind) = compute_ahead_behind(&repo).unwrap_or((0, 0));

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);

    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;
    let workdir = repo
        .workdir()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from(root_path));

    let mut files = Vec::new();
    for entry in statuses.iter() {
        let status = entry.status();
        if status.is_ignored() {
            continue;
        }
        let rel_path = match entry.path() {
            Some(p) => p,
            None => continue,
        };
        let abs_path = workdir.join(rel_path).to_string_lossy().to_string();
        let staged = kind_from_status(status, true);
        let unstaged = kind_from_status(status, false);
        if staged.is_none() && unstaged.is_none() {
            continue;
        }
        files.push(FileStatus {
            path: abs_path,
            staged,
            unstaged,
        });
    }

    Ok(RepoStatus {
        is_repo: true,
        branch,
        ahead,
        behind,
        files,
    })
}

fn compute_ahead_behind(repo: &Repository) -> Option<(usize, usize)> {
    let head = repo.head().ok()?;
    let local_oid = head.target()?;
    let branch_name = head.shorthand()?;
    let upstream_name = format!("refs/remotes/origin/{}", branch_name);
    let upstream_ref = repo.find_reference(&upstream_name).ok()?;
    let upstream_oid = upstream_ref.target()?;
    repo.graph_ahead_behind(local_oid, upstream_oid).ok()
}

fn resolve_relative(repo: &Repository, root_path: &str, file_path: &str) -> String {
    let workdir = repo
        .workdir()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from(root_path));
    let workdir = std::fs::canonicalize(&workdir).unwrap_or(workdir);
    let target = PathBuf::from(file_path);
    let target = std::fs::canonicalize(&target).unwrap_or(target);
    target
        .strip_prefix(&workdir)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| file_path.to_string())
}

fn blob_content_at_tree(
    repo: &Repository,
    tree: &git2::Tree,
    rel_path: &str,
) -> Option<(Vec<u8>, bool)> {
    let entry = tree.get_path(std::path::Path::new(rel_path)).ok()?;
    let object = entry.to_object(repo).ok()?;
    let blob = object.as_blob()?;
    Some((blob.content().to_vec(), blob.is_binary()))
}

fn blob_content_in_index(repo: &Repository, rel_path: &str) -> Option<(Vec<u8>, bool)> {
    let index = repo.index().ok()?;
    let entry = index.get_path(std::path::Path::new(rel_path), 0)?;
    let blob = repo.find_blob(entry.id).ok()?;
    Some((blob.content().to_vec(), blob.is_binary()))
}

fn bytes_to_string_opt(data: Option<(Vec<u8>, bool)>) -> (Option<String>, bool) {
    match data {
        Some((bytes, is_binary)) => {
            if is_binary {
                (None, true)
            } else {
                (Some(String::from_utf8_lossy(&bytes).to_string()), false)
            }
        }
        None => (None, false),
    }
}

fn is_binary_bytes(bytes: &[u8]) -> bool {
    bytes.iter().take(8000).any(|&b| b == 0)
}

/// Builds the two sides of a diff for a single file.
///
/// `staged = false` (Changes section): compares the index (fallback HEAD) against
/// the working-tree file, i.e. what `git diff` shows.
/// `staged = true` (Staged Changes section): compares HEAD against the index,
/// i.e. what `git diff --cached` shows.
fn diff_content_for_path(
    root_path: &str,
    file_path: &str,
    staged: bool,
) -> Result<DiffContent, String> {
    let repo = Repository::open(root_path).map_err(|e| e.to_string())?;
    let rel = resolve_relative(&repo, root_path, file_path);
    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());

    if staged {
        let head_data = head_tree
            .as_ref()
            .and_then(|t| blob_content_at_tree(&repo, t, &rel));
        let index_data = blob_content_in_index(&repo, &rel);

        let (original, orig_bin) = bytes_to_string_opt(head_data);
        let (modified, mod_bin) = bytes_to_string_opt(index_data);
        Ok(DiffContent {
            original,
            modified,
            is_binary: orig_bin || mod_bin,
        })
    } else {
        let index_data = blob_content_in_index(&repo, &rel);
        let original_data = index_data.or_else(|| {
            head_tree
                .as_ref()
                .and_then(|t| blob_content_at_tree(&repo, t, &rel))
        });
        let (original, orig_bin) = bytes_to_string_opt(original_data);

        let abs = PathBuf::from(root_path).join(&rel);
        let (modified, mod_bin) = match std::fs::read(&abs) {
            Ok(bytes) => {
                if is_binary_bytes(&bytes) {
                    (None, true)
                } else {
                    (Some(String::from_utf8_lossy(&bytes).to_string()), false)
                }
            }
            Err(_) => (None, false),
        };

        Ok(DiffContent {
            original,
            modified,
            is_binary: orig_bin || mod_bin,
        })
    }
}

fn stage_path(root_path: &str, file_path: &str) -> Result<(), String> {
    let repo = Repository::open(root_path).map_err(|e| e.to_string())?;
    let rel = resolve_relative(&repo, root_path, file_path);
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let abs = PathBuf::from(root_path).join(&rel);
    if abs.exists() {
        index
            .add_path(std::path::Path::new(&rel))
            .map_err(|e| e.to_string())?;
    } else {
        index
            .remove_path(std::path::Path::new(&rel))
            .map_err(|e| e.to_string())?;
    }
    index.write().map_err(|e| e.to_string())
}

fn unstage_path(root_path: &str, file_path: &str) -> Result<(), String> {
    let repo = Repository::open(root_path).map_err(|e| e.to_string())?;
    let rel = resolve_relative(&repo, root_path, file_path);
    let head = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    match head {
        Some(commit) => {
            repo.reset_default(Some(commit.as_object()), [rel.as_str()])
                .map_err(|e| e.to_string())?;
        }
        None => {
            let mut index = repo.index().map_err(|e| e.to_string())?;
            index
                .remove_path(std::path::Path::new(&rel))
                .map_err(|e| e.to_string())?;
            index.write().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn stage_all(root_path: &str) -> Result<(), String> {
    let repo = Repository::open(root_path).map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index
        .add_all(["*"], git2::IndexAddOption::DEFAULT, None)
        .map_err(|e| e.to_string())?;
    index.update_all(["*"], None).map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())
}

fn unstage_all(root_path: &str) -> Result<(), String> {
    let repo = Repository::open(root_path).map_err(|e| e.to_string())?;
    if let Ok(head) = repo.head().and_then(|value| value.peel_to_commit()) {
        repo.reset_default(Some(head.as_object()), ["*"])
            .map_err(|e| e.to_string())?;
    } else {
        let mut index = repo.index().map_err(|e| e.to_string())?;
        index.clear().map_err(|e| e.to_string())?;
        index.write().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn commit_changes(root_path: &str, message: &str) -> Result<(), String> {
    let repo = Repository::open(root_path).map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_oid = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;
    let sig = repo.signature().map_err(|e| e.to_string())?;

    let parent_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent_commit.iter().collect();

    repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn list_branches(root_path: &str) -> Result<Vec<Branch>, String> {
    let repo = Repository::open(root_path).map_err(|e| e.to_string())?;
    let head_name = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    let mut branches = Vec::new();
    for entry in repo.branches(None).map_err(|e| e.to_string())? {
        let (branch, branch_type) = entry.map_err(|e| e.to_string())?;
        let name = match branch.name().map_err(|e| e.to_string())? {
            Some(n) => n.to_string(),
            None => continue,
        };
        let is_remote = matches!(branch_type, git2::BranchType::Remote);
        let is_head = head_name.as_deref() == Some(name.as_str());
        branches.push(Branch {
            name,
            is_head,
            is_remote,
        });
    }
    Ok(branches)
}

fn create_branch(root_path: &str, branch_name: &str) -> Result<(), String> {
    if branch_name.trim().is_empty() {
        return Err("branch name is required".into());
    }
    let repo = Repository::open(root_path).map_err(|e| e.to_string())?;
    let commit = repo
        .head()
        .and_then(|head| head.peel_to_commit())
        .map_err(|e| e.to_string())?;
    repo.branch(branch_name, &commit, false)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn checkout_branch(root_path: &str, branch_name: &str) -> Result<(), String> {
    let repo = Repository::open(root_path).map_err(|e| e.to_string())?;
    let (object, reference) = repo.revparse_ext(branch_name).map_err(|e| e.to_string())?;
    repo.checkout_tree(&object, None)
        .map_err(|e| e.to_string())?;
    match reference {
        Some(r) => {
            let name = r.name().ok_or("invalid reference name")?;
            repo.set_head(name).map_err(|e| e.to_string())?;
        }
        None => {
            repo.set_head_detached(object.id())
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// State managed by Tauri for currently watched Git repositories, keyed by
/// root path. Each entry owns a `notify` watcher that emits `git-status-changed`
/// events whenever the working tree or `.git` directory changes.
pub struct GitManager {
    watchers: Mutex<HashMap<String, RepoWatcher>>,
}

struct RepoWatcher {
    _watcher: notify::RecommendedWatcher,
}

impl Default for GitManager {
    fn default() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }
}

impl GitManager {
    /// Start (or restart) watching `root_path` for Git changes. Safe to call
    /// on non-repositories; the watcher is simply not attached in that case.
    pub fn watch(&self, root_path: String, app: tauri::AppHandle) -> Result<(), String> {
        use notify::Watcher;

        if Repository::open(&root_path).is_err() {
            self.watchers.lock().unwrap().remove(&root_path);
            return Ok(());
        }

        // Note: on very large repositories, `compute_status`'s
        // `recurse_untracked_dirs` walk can be relatively expensive. The
        // 150ms debounce below coalesces bursts of filesystem events (e.g.
        // from a build/watch process) into a single `git-status-changed`
        // emit so the frontend doesn't request a fresh status per file
        // write. If this becomes a bottleneck on huge repos, consider
        // increasing the debounce window or capping untracked-dir depth.
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if res.is_ok() {
                let _ = tx.send(());
            }
        })
        .map_err(|e| e.to_string())?;
        watcher
            .watch(
                std::path::Path::new(&root_path),
                notify::RecursiveMode::Recursive,
            )
            .map_err(|e| e.to_string())?;

        let root_for_thread = root_path.clone();
        let app_for_thread = app.clone();
        std::thread::spawn(move || {
            let mut pending = false;
            loop {
                match rx.recv_timeout(Duration::from_millis(150)) {
                    Ok(()) => pending = true,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        if pending {
                            pending = false;
                            let _ = app_for_thread.emit(
                                "git-status-changed",
                                GitStatusChanged {
                                    root_path: root_for_thread.clone(),
                                },
                            );
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        self.watchers
            .lock()
            .unwrap()
            .insert(root_path.clone(), RepoWatcher { _watcher: watcher });

        let _ = app.emit("git-status-changed", GitStatusChanged { root_path });
        Ok(())
    }
}

#[tauri::command]
pub fn git_watch_repo(
    root_path: String,
    state: tauri::State<'_, GitManager>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    state.watch(root_path, app)
}

#[tauri::command]
pub fn git_status(root_path: String) -> Result<RepoStatus, String> {
    compute_status(&root_path)
}

#[tauri::command]
pub fn git_diff_content(
    root_path: String,
    file_path: String,
    staged: bool,
) -> Result<DiffContent, String> {
    diff_content_for_path(&root_path, &file_path, staged)
}

#[tauri::command]
pub fn git_init(root_path: String) -> Result<(), String> {
    Repository::init(root_path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn git_stage(root_path: String, file_path: String) -> Result<(), String> {
    stage_path(&root_path, &file_path)
}

#[tauri::command]
pub fn git_stage_all(root_path: String) -> Result<(), String> {
    stage_all(&root_path)
}

#[tauri::command]
pub fn git_unstage(root_path: String, file_path: String) -> Result<(), String> {
    unstage_path(&root_path, &file_path)
}

#[tauri::command]
pub fn git_unstage_all(root_path: String) -> Result<(), String> {
    unstage_all(&root_path)
}

#[tauri::command]
pub fn git_commit(root_path: String, message: String) -> Result<(), String> {
    commit_changes(&root_path, &message)
}

#[tauri::command]
pub fn git_branches(root_path: String) -> Result<Vec<Branch>, String> {
    list_branches(&root_path)
}

#[tauri::command]
pub fn git_create_branch(root_path: String, branch_name: String) -> Result<(), String> {
    create_branch(&root_path, &branch_name)
}

#[tauri::command]
pub fn git_checkout(root_path: String, branch_name: String) -> Result<(), String> {
    checkout_branch(&root_path, &branch_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;

    fn init_repo() -> tempfile_dir::TempDir {
        let dir = tempfile_dir::TempDir::new();
        let run = |args: &[&str]| {
            Command::new("git")
                .args(args)
                .current_dir(dir.path())
                .output()
                .expect("git command failed");
        };
        run(&["init"]);
        run(&["config", "user.email", "test@example.com"]);
        run(&["config", "user.name", "Test"]);
        dir
    }

    mod tempfile_dir {
        use std::path::{Path, PathBuf};
        use std::sync::atomic::{AtomicU64, Ordering};

        static COUNTER: AtomicU64 = AtomicU64::new(0);

        pub struct TempDir(PathBuf);

        impl TempDir {
            pub fn new() -> Self {
                let mut path = std::env::temp_dir();
                let unique = format!(
                    "tau-git-test-{}-{}-{}",
                    std::process::id(),
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_nanos(),
                    COUNTER.fetch_add(1, Ordering::SeqCst)
                );
                path.push(unique);
                std::fs::create_dir_all(&path).unwrap();
                Self(path)
            }

            pub fn path(&self) -> &Path {
                &self.0
            }
        }

        impl Drop for TempDir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    #[test]
    fn status_on_non_repo_returns_is_repo_false() {
        let dir = tempfile_dir::TempDir::new();
        let status = compute_status(dir.path().to_str().unwrap()).unwrap();
        assert!(!status.is_repo);
        assert!(status.files.is_empty());
    }

    #[test]
    fn status_detects_untracked_file() {
        let dir = init_repo();
        fs::write(dir.path().join("a.txt"), "hello").unwrap();
        let status = compute_status(dir.path().to_str().unwrap()).unwrap();
        assert!(status.is_repo);
        assert_eq!(status.files.len(), 1);
        assert_eq!(status.files[0].unstaged, Some(FileStatusKind::Untracked));
    }

    #[test]
    fn stage_and_commit_roundtrip() {
        let dir = init_repo();
        let root = dir.path().to_str().unwrap().to_string();
        fs::write(dir.path().join("a.txt"), "hello").unwrap();

        stage_path(&root, &dir.path().join("a.txt").to_string_lossy()).unwrap();
        let status = compute_status(&root).unwrap();
        assert_eq!(status.files[0].staged, Some(FileStatusKind::Added));

        commit_changes(&root, "initial commit").unwrap();
        let status_after = compute_status(&root).unwrap();
        assert!(status_after.files.is_empty());
        assert!(status_after.branch.is_some());
    }

    #[test]
    fn unstage_reverts_index() {
        let dir = init_repo();
        let root = dir.path().to_str().unwrap().to_string();
        fs::write(dir.path().join("a.txt"), "hello").unwrap();
        let file_path = dir.path().join("a.txt").to_string_lossy().to_string();

        stage_path(&root, &file_path).unwrap();
        unstage_path(&root, &file_path).unwrap();

        let status = compute_status(&root).unwrap();
        assert_eq!(status.files[0].staged, None);
        assert_eq!(status.files[0].unstaged, Some(FileStatusKind::Untracked));
    }

    #[test]
    fn stage_and_unstage_all_roundtrip() {
        let dir = init_repo();
        let root = dir.path().to_str().unwrap().to_string();
        fs::write(dir.path().join("a.txt"), "a").unwrap();
        fs::write(dir.path().join("b.txt"), "b").unwrap();
        stage_all(&root).unwrap();
        let staged = compute_status(&root).unwrap();
        assert!(staged.files.iter().all(|file| file.staged.is_some()));
        unstage_all(&root).unwrap();
        let unstaged = compute_status(&root).unwrap();
        assert!(unstaged.files.iter().all(|file| file.staged.is_none()));
    }

    #[test]
    fn creates_and_checks_out_branch() {
        let dir = init_repo();
        let root = dir.path().to_str().unwrap().to_string();
        fs::write(dir.path().join("a.txt"), "a").unwrap();
        stage_all(&root).unwrap();
        commit_changes(&root, "initial").unwrap();
        create_branch(&root, "feature").unwrap();
        checkout_branch(&root, "feature").unwrap();
        assert_eq!(
            compute_status(&root).unwrap().branch.as_deref(),
            Some("feature")
        );
    }

    #[test]
    fn diff_content_reports_unstaged_changes() {
        let dir = init_repo();
        let root = dir.path().to_str().unwrap().to_string();
        let file_path = dir.path().join("a.txt").to_string_lossy().to_string();
        fs::write(dir.path().join("a.txt"), "line1\n").unwrap();
        stage_path(&root, &file_path).unwrap();
        commit_changes(&root, "add a.txt").unwrap();

        fs::write(dir.path().join("a.txt"), "line1\nline2\n").unwrap();
        let diff = diff_content_for_path(&root, &file_path, false).unwrap();
        assert_eq!(diff.original.as_deref(), Some("line1\n"));
        assert_eq!(diff.modified.as_deref(), Some("line1\nline2\n"));
        assert!(!diff.is_binary);
    }

    #[test]
    fn diff_content_reports_staged_changes() {
        let dir = init_repo();
        let root = dir.path().to_str().unwrap().to_string();
        let file_path = dir.path().join("a.txt").to_string_lossy().to_string();
        fs::write(dir.path().join("a.txt"), "line1\n").unwrap();
        stage_path(&root, &file_path).unwrap();
        commit_changes(&root, "add a.txt").unwrap();

        fs::write(dir.path().join("a.txt"), "line1\nline2\n").unwrap();
        stage_path(&root, &file_path).unwrap();
        let diff = diff_content_for_path(&root, &file_path, true).unwrap();
        assert_eq!(diff.original.as_deref(), Some("line1\n"));
        assert_eq!(diff.modified.as_deref(), Some("line1\nline2\n"));
    }
}
