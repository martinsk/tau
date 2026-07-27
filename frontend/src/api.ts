import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

/**
 * Opens a folder dialog and returns the selected path, or null if cancelled.
 */
export async function pickFolder(): Promise<string | null> {
  const path = await open({ directory: true, multiple: false });
  return (path as string | null) ?? null;
}

/**
 * Lists the entries in a directory. Directories are sorted before files.
 */
export async function readDir(path: string): Promise<FileNode[]> {
  return await invoke<FileNode[]>("read_dir", { path });
}

/**
 * Reads the UTF-8 text content of a file.
 */
export async function readFile(path: string): Promise<string> {
  return await invoke<string>("read_file", { path });
}

/**
 * Writes text content to a file.
 */
export async function writeFile(path: string, content: string): Promise<void> {
  return await invoke("write_file", { path, content });
}

/**
 * Creates a new terminal PTY session.
 */
export async function createTerminal(
  id: string,
  cwd: string,
  shell?: string
): Promise<void> {
  await invoke("create_terminal", { id, cwd, shell });
}

/**
 * Sends input data to a terminal session.
 */
export async function terminalInput(id: string, data: string): Promise<void> {
  await invoke("terminal_input", { id, data });
}

/**
 * Resizes a terminal session.
 */
export async function terminalResize(
  id: string,
  cols: number,
  rows: number
): Promise<void> {
  await invoke("terminal_resize", { id, cols, rows });
}

/**
 * Kills a terminal session.
 */
export async function killTerminal(id: string): Promise<void> {
  await invoke("kill_terminal", { id });
}

export async function createAgentSession(
  id: string,
  cwd: string,
  program: string,
  args: string[]
): Promise<void> {
  await invoke("create_agent_session", { id, cwd, program, args });
}

export async function agentSessionInput(id: string, data: string): Promise<void> {
  await invoke("agent_session_input", { id, data });
}

export async function resizeAgentSession(
  id: string,
  cols: number,
  rows: number
): Promise<void> {
  await invoke("resize_agent_session", { id, cols, rows });
}

export async function stopAgentSession(id: string): Promise<void> {
  await invoke("stop_agent_session", { id });
}

export type FileStatusKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflicted"
  | "type_changed";

export interface FileStatus {
  path: string;
  staged: FileStatusKind | null;
  unstaged: FileStatusKind | null;
}

export interface RepoStatus {
  is_repo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  files: FileStatus[];
}

export interface GitBranch {
  name: string;
  is_head: boolean;
  is_remote: boolean;
}

/**
 * Starts watching a folder for Git changes. Emits `git-status-changed`
 * events (immediately, and whenever the working tree changes) if the folder
 * is a Git repository. Safe to call on non-repositories.
 */
export async function gitWatchRepo(rootPath: string): Promise<void> {
  await invoke("git_watch_repo", { rootPath });
}

/**
 * Returns the current branch, ahead/behind counts, and per-file status.
 */
export async function gitStatus(rootPath: string): Promise<RepoStatus> {
  return await invoke<RepoStatus>("git_status", { rootPath });
}

export interface DiffContent {
  original: string | null;
  modified: string | null;
  is_binary: boolean;
}

/**
 * Returns the original/modified text for a single file, for use in a diff
 * editor. When `staged` is true, compares HEAD (original) against the index
 * (modified) -- i.e. `git diff --cached`. When false, compares the index
 * (original) against the working tree (modified) -- i.e. `git diff`.
 */
export async function gitDiffContent(
  rootPath: string,
  filePath: string,
  staged: boolean
): Promise<DiffContent> {
  return await invoke<DiffContent>("git_diff_content", {
    rootPath,
    filePath,
    staged,
  });
}

/**
 * Stages a file (adds working-tree changes, including new files, to the index).
 */
export async function gitStage(rootPath: string, filePath: string): Promise<void> {
  await invoke("git_stage", { rootPath, filePath });
}

/**
 * Unstages a file (reverts the index entry to HEAD).
 */
export async function gitUnstage(rootPath: string, filePath: string): Promise<void> {
  await invoke("git_unstage", { rootPath, filePath });
}

/**
 * Commits all staged changes with the given message.
 */
export async function gitCommit(rootPath: string, message: string): Promise<void> {
  await invoke("git_commit", { rootPath, message });
}

/**
 * Lists local and remote branches.
 */
export async function gitBranches(rootPath: string): Promise<GitBranch[]> {
  return await invoke<GitBranch[]>("git_branches", { rootPath });
}

/**
 * Checks out a branch by name.
 */
export async function gitCheckout(rootPath: string, branchName: string): Promise<void> {
  await invoke("git_checkout", { rootPath, branchName });
}
