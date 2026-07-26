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
