import {
  pickFolder,
  readDir,
  readFile,
  writeFile,
  terminalInput,
  gitWatchRepo,
  gitStatus as fetchGitStatus,
  gitStage,
  gitUnstage,
  gitCommit,
  gitDiffContent,
  type FileNode,
  type RepoStatus,
} from "./api.js";
import {
  createLayout,
  type LayoutAPI,
  type PaneNode,
  type EditorPane,
  type TerminalInfo,
} from "./components/Layout.js";
import type { TabInfo } from "./components/Tabs.js";
import type { DropZone } from "./components/PaneDropOverlay.js";
import { listen } from "@tauri-apps/api/event";
import {
  findPane,
  firstEditorPane,
  pruneEmptyPanes,
  replacePane,
  containsPane,
  splitPane,
  moveTabToPane,
  closeTab,
  activePane,
  emptyEditorPane,
  addTab,
  setActiveTabByPath,
  activeTabPath,
  removeTab,
} from "./editorTree.js";
import {
  noTerminals,
  createTerminal,
  closeTerminal,
  switchTerminal,
  toggleTerminal,
  type TerminalState,
} from "./terminalState.js";
import { createLocalLayoutStorage, type LayoutStorage } from "./layoutStorage.js";
import {
  createLocalAgentConfigStore,
  parseProjectAgentConfig,
  resolveHarness,
  type HarnessConfig,
} from "./agentConfig.js";
import {
  createLocalRecentFolderStore,
  getKeybindingMode,
  setKeybindingMode,
  type RecentFolderStore,
} from "./appStorage.js";
import {
  loadTasks,
  findDefaultTask,
  findTaskByLabel,
  taskCommand,
} from "./tasks.js";
import { LspManager } from "./lsp.js";
import { registerCommands, runCommand } from "./commands.js";
import { chordFromEvent, findBinding, type KeybindingMode } from "./keymaps.js";
import { createCommandPalette } from "./components/CommandPalette.js";

interface AppState {
  rootPath: string | null;
  editorRoot: PaneNode;
  activePaneId: string;
  terminalState: TerminalState;
  sidebarWidth: number;
  terminalHeight: number;
  gitStatus: RepoStatus | null;
  agentWidth: number;
  agentVisible: boolean;
  agentConfig: HarnessConfig;
  agentSessionId: string | null;
  keybindingMode: KeybindingMode;
}

const state: AppState = {
  rootPath: null,
  editorRoot: emptyEditorPane("pane-1"),
  activePaneId: "pane-1",
  terminalState: noTerminals,
  sidebarWidth: 256,
  terminalHeight: 192,
  gitStatus: null,
  agentWidth: 400,
  agentVisible: false,
  agentConfig: resolveHarness(null, null),
  agentSessionId: null,
  keybindingMode: getKeybindingMode(),
};

let layout: LayoutAPI | null = null;
let lspManager: LspManager | null = null;
let commandPalette: ReturnType<typeof createCommandPalette> | null = null;
const layoutStorage: LayoutStorage = createLocalLayoutStorage();
const recentFolderStore: RecentFolderStore = createLocalRecentFolderStore();
const agentConfigStore = createLocalAgentConfigStore();
let paneCounter = 1;
let terminalCounter = 0;

function newPaneId(): string {
  paneCounter += 1;
  return `pane-${paneCounter}`;
}

function newTerminalId(): string {
  terminalCounter += 1;
  return `terminal-${terminalCounter}`;
}

function stripDiffTabs(node: PaneNode): PaneNode {
  if (node.type === "editor") {
    const tabs = node.tabs.filter((t) => !t.diff);
    if (tabs.length === 0) return emptyEditorPane(node.id);
    const activeTab =
      node.activeTab && !node.activeTab.diff ? node.activeTab : tabs[tabs.length - 1];
    return {
      type: "editor",
      id: node.id,
      tabs: tabs as [TabInfo, ...TabInfo[]],
      activeTab,
    };
  }
  return {
    type: "split",
    direction: node.direction,
    children: node.children.map(stripDiffTabs),
  };
}

function saveLayout() {
  if (!state.rootPath) return;
  layoutStorage.save(state.rootPath, {
    editorRoot: stripDiffTabs(state.editorRoot),
    activePaneId: state.activePaneId,
    terminalState: state.terminalState,
    sidebarWidth: state.sidebarWidth,
    terminalHeight: state.terminalHeight,
    agentWidth: state.agentWidth,
    agentVisible: state.agentVisible,
  });
}

function migrateTerminalState(saved: Record<string, unknown>): TerminalState {
  const terminals = Array.isArray(saved.terminals)
    ? (saved.terminals as TerminalInfo[])
    : [];
  const activeTerminalId = (saved.activeTerminalId as string | null) ?? null;
  const bottomPanelVisible = (saved.bottomPanelVisible as boolean) ?? false;
  if (terminals.length === 0) {
    return noTerminals;
  }
  const active = terminals.some((t) => t.id === activeTerminalId)
    ? activeTerminalId!
    : terminals[terminals.length - 1].id;
  return {
    kind: "terminalsOpen",
    terminals: terminals as [TerminalInfo, ...TerminalInfo[]],
    activeTerminalId: active,
    bottomPanelVisible,
  };
}

async function loadAgentConfig(rootPath: string): Promise<HarnessConfig> {
  const local = agentConfigStore.load(rootPath);
  try {
    const project = parseProjectAgentConfig(await readFile(`${rootPath}/.tau/agent.json`));
    return resolveHarness(local, project);
  } catch (err) {
    if (local) return local;
    if (err instanceof Error && !err.message.includes("No such file")) {
      console.warn("Failed to load .tau/agent.json:", err);
    }
    return resolveHarness(null, null);
  }
}

function loadLayout(rootPath: string) {
  const raw = layoutStorage.load(rootPath);
  if (!raw) return null;
  const terminalState =
    "terminalState" in raw && raw.terminalState !== undefined
      ? raw.terminalState
      : migrateTerminalState(raw as unknown as Record<string, unknown>);
  return {
    ...raw,
    editorRoot: hydratePane(raw.editorRoot),
    terminalState,
  };
}

function hydratePane(data: unknown): PaneNode {
  const d = data as Record<string, unknown>;
  if (d.type === "editor") {
    const tabs = Array.isArray(d.tabs) ? (d.tabs as TabInfo[]) : [];
    const activeTabPath = (d.activeTabPath as string | null) ?? null;
    const id = (d.id as string) ?? newPaneId();
    if (tabs.length === 0) {
      return emptyEditorPane(id);
    }
    const activeTab =
      tabs.find((t) => t.path === activeTabPath) ?? tabs[tabs.length - 1];
    return {
      type: "editor",
      id,
      tabs: tabs as [TabInfo, ...TabInfo[]],
      activeTab,
    };
  }
  return {
    type: "split",
    direction: (d.direction as "row" | "column") ?? "row",
    children: Array.isArray(d.children)
      ? d.children.map(hydratePane)
      : [],
  };
}

function updateLayout() {
  layout?.updateEditorRoot(state.editorRoot, state.activePaneId);
  layout?.updateTerminals(state.terminalState);
  saveLayout();
}

async function handleOpenFolder() {
  let path: string | null = null;
  try {
    path = await pickFolder();
  } catch (err) {
    console.error("Failed to open folder dialog:", err);
    alert(`Failed to open folder dialog: ${err}`);
    return;
  }
  if (!path) return;
  await openFolder(path);
}

async function openFolder(path: string) {
  if (state.agentSessionId) {
    state.agentSessionId = null;
    await layout?.updateAgent(null, state.agentConfig, null);
  }
  state.rootPath = path;
  recentFolderStore.setLastOpenedFolder(path);

  const saved = loadLayout(path);
  if (saved) {
    state.editorRoot = saved.editorRoot;
    state.activePaneId = saved.activePaneId;
    state.terminalState = saved.terminalState;
    state.sidebarWidth = saved.sidebarWidth ?? 256;
    state.terminalHeight = saved.terminalHeight ?? 192;
    state.agentWidth = saved.agentWidth ?? 400;
    state.agentVisible = saved.agentVisible ?? false;
  } else {
    state.editorRoot = emptyEditorPane("pane-1");
    state.activePaneId = "pane-1";
    state.terminalState = noTerminals;
    state.sidebarWidth = 256;
    state.terminalHeight = 192;
    state.agentWidth = 400;
    state.agentVisible = false;
    paneCounter = 1;
    terminalCounter = 0;
  }

  const terminals =
    state.terminalState.kind === "terminalsOpen"
      ? state.terminalState.terminals
      : [];
  const maxTerminal = terminals.reduce((max, t) => {
    const n = parseInt(t.id.replace("terminal-", ""), 10);
    return isNaN(n) ? max : Math.max(max, n);
  }, 0);
  terminalCounter = Math.max(terminalCounter, maxTerminal);

  state.agentConfig = await loadAgentConfig(path);

  try {
    const tree = await readDir(path);
    layout?.updateTree(tree);
  } catch (err) {
    console.error("Failed to read root directory:", err);
    alert(`Failed to read root directory: ${err}`);
  }

  lspManager?.stop();
  lspManager = new LspManager(path);
  lspManager.loadSettings().then(() => {
    lspManager?.registerLanguageFeatures();
  });

  gitWatchRepo(path).catch((err) => {
    console.error("Failed to watch git repository:", err);
  });
  await refreshGitStatus();

  updateLayout();
  layout?.setAgentWidth(state.agentWidth);
  layout?.setAgentVisible(state.agentVisible);
  await layout?.updateAgent(state.rootPath, state.agentConfig, state.agentSessionId);
}

async function refreshGitStatus() {
  if (!state.rootPath) {
    state.gitStatus = null;
    layout?.updateGitStatus(null);
    return;
  }
  try {
    state.gitStatus = await fetchGitStatus(state.rootPath);
  } catch (err) {
    console.error("Failed to load git status:", err);
    state.gitStatus = null;
  }
  layout?.updateGitStatus(state.gitStatus);
  await refreshOpenDiffTabs();
}

function collectEditorPanes(root: PaneNode, acc: EditorPane[] = []): EditorPane[] {
  if (root.type === "editor") {
    acc.push(root);
    return acc;
  }
  for (const child of root.children) collectEditorPanes(child, acc);
  return acc;
}

/**
 * Re-fetches original/modified content for any currently open diff tabs so
 * they don't go stale after staging/unstaging/committing. Skips the
 * working-tree side of dirty (unsaved) tabs to avoid clobbering local edits.
 */
async function refreshOpenDiffTabs() {
  if (!state.rootPath) return;
  const rootPath = state.rootPath;
  let changed = false;
  for (const pane of collectEditorPanes(state.editorRoot)) {
    for (const tab of pane.tabs) {
      if (!tab.diff) continue;
      try {
        const diff = await gitDiffContent(rootPath, tab.path, tab.diff.staged);
        tab.diff.original = diff.original ?? "";
        if (!tab.dirty) {
          tab.content = diff.modified ?? "";
        }
        changed = true;
      } catch (err) {
        console.error("Failed to refresh diff:", err);
      }
    }
  }
  if (changed) updateLayout();
}

async function handleStageFile(path: string) {
  if (!state.rootPath) return;
  try {
    await gitStage(state.rootPath, path);
    await refreshGitStatus();
  } catch (err) {
    console.error("Failed to stage file:", err);
    alert(`Failed to stage file: ${err}`);
  }
}

async function handleUnstageFile(path: string) {
  if (!state.rootPath) return;
  try {
    await gitUnstage(state.rootPath, path);
    await refreshGitStatus();
  } catch (err) {
    console.error("Failed to unstage file:", err);
    alert(`Failed to unstage file: ${err}`);
  }
}

async function handleCommit(message: string) {
  if (!state.rootPath) return;
  try {
    await gitCommit(state.rootPath, message);
    await refreshGitStatus();
  } catch (err) {
    console.error("Failed to commit:", err);
    alert(`Failed to commit: ${err}`);
  }
}

async function handleOpenDiffFile(path: string, staged: boolean) {
  if (!state.rootPath) return;
  try {
    const diff = await gitDiffContent(state.rootPath, path, staged);
    if (diff.is_binary) {
      alert("Binary file, diff not available.");
      return;
    }
    const name = path.split("/").pop() ?? path;
    const pane = getActivePane();
    const tab: TabInfo = {
      path,
      name,
      content: diff.modified ?? "",
      dirty: false,
      diff: { staged, original: diff.original ?? "", editable: !staged },
    };
    state.editorRoot = replacePane(state.editorRoot, pane.id, addTab(pane, tab));
    updateLayout();
  } catch (err) {
    console.error("Failed to load diff:", err);
    alert(`Failed to load diff: ${err}`);
  }
}

function getActivePane(): EditorPane {
  const result = activePane(state.editorRoot, state.activePaneId);
  state.activePaneId = result.activePaneId;
  return result.pane;
}

async function handleFileClick(path: string, name: string) {
  const pane = getActivePane();
  const existing = pane.tabs.find((t) => t.path === path);
  if (existing && !existing.diff) {
    state.editorRoot = replacePane(
      state.editorRoot,
      pane.id,
      setActiveTabByPath(pane, path)
    );
    updateLayout();
    return;
  }

  if (existing && existing.diff) {
    // Switch an already-open diff tab back to a plain working-copy view.
    const content = existing.dirty ? existing.content : await readFile(path).catch(() => existing.content);
    const tab: TabInfo = { path, name, content, dirty: existing.dirty };
    state.editorRoot = replacePane(state.editorRoot, pane.id, addTab(pane, tab));
    updateLayout();
    return;
  }

  try {
    const content = await readFile(path);
    const tab = { path, name, content, dirty: false };
    state.editorRoot = replacePane(state.editorRoot, pane.id, addTab(pane, tab));
    lspManager?.openDocument(path, languageForFile(name), content);
    updateLayout();
  } catch (err) {
    console.error("Failed to read file:", err);
    alert(`Failed to read file: ${err}`);
  }
}

function languageForFile(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "rs":
      return "rust";
    case "c":
    case "h":
      return "c";
    case "cpp":
    case "cc":
    case "hpp":
      return "cpp";
    default:
      return ext;
  }
}

function handleTabClick(paneId: string, path: string) {
  const pane = findPane(state.editorRoot, paneId);
  if (!pane) return;
  state.activePaneId = paneId;
  state.editorRoot = replacePane(
    state.editorRoot,
    paneId,
    setActiveTabByPath(pane, path)
  );
  updateLayout();
}

function handleTabClose(paneId: string, path: string) {
  const result = closeTab(state.editorRoot, paneId, path, state.activePaneId);
  state.editorRoot = result.root;
  state.activePaneId = result.activePaneId;
  updateLayout();
}

function handleSplit(
  paneId: string,
  direction: "row" | "column",
  side: "left" | "right" | "top" | "bottom" = "right"
) {
  const pane = findPane(state.editorRoot, paneId);
  if (!pane) return;

  const activeTab = pane.activeTab;
  const newPane = activeTab
    ? addTab(emptyEditorPane(newPaneId()), activeTab)
    : emptyEditorPane(newPaneId());

  state.editorRoot = splitPane(state.editorRoot, paneId, direction, newPane, side);
  state.activePaneId = newPane.id;
  updateLayout();
}

function handleSplitDrop(
  targetPaneId: string,
  direction: DropZone,
  tabJson?: string
) {
  if (direction === "center") return;
  if (!tabJson) {
    const dir = direction === "left" || direction === "right" ? "row" : "column";
    handleSplit(targetPaneId, dir, direction);
    return;
  }

  const dropped = JSON.parse(tabJson) as TabInfo & { paneId?: string };
  const sourcePaneId = dropped.paneId;
  const sourcePane = sourcePaneId
    ? findPane(state.editorRoot, sourcePaneId)
    : null;
  const targetPane = findPane(state.editorRoot, targetPaneId);
  if (!targetPane) return;

  const tab: TabInfo = {
    path: dropped.path,
    name: dropped.name,
    content: dropped.content,
    dirty: dropped.dirty,
    diff: dropped.diff,
  };

  let updated = state.editorRoot;
  if (sourcePane && sourcePaneId) {
    updated = replacePane(updated, sourcePaneId, removeTab(sourcePane, tab.path));
  }

  const dir = direction === "left" || direction === "right" ? "row" : "column";
  const newPane = addTab(emptyEditorPane(newPaneId()), tab);

  updated = splitPane(updated, targetPaneId, dir, newPane, direction);
  const pruned = pruneEmptyPanes(updated, newPane.id);
  state.editorRoot = pruned.root;
  state.activePaneId = pruned.activePaneId;
  updateLayout();
}

async function handleSave(paneId: string) {
  const pane = findPane(state.editorRoot, paneId);
  if (!pane || !layout) return;
  const tab = pane.activeTab;
  if (!tab) return;
  if (tab.diff && !tab.diff.editable) return;
  try {
    const content = layout.getPaneContent(paneId);
    await writeFile(tab.path, content);
    tab.content = content;
    tab.dirty = false;
    layout.updatePaneTabs(paneId);
    saveLayout();
    refreshGitStatus();
  } catch (err) {
    console.error("Failed to save file:", err);
    alert(`Failed to save file: ${err}`);
  }
}

function handleContentChange(paneId: string, content: string) {
  const pane = findPane(state.editorRoot, paneId);
  if (!pane) return;
  const tab = pane.activeTab;
  if (!tab) return;
  tab.content = content;
  if (!tab.dirty) {
    tab.dirty = true;
    layout?.updatePaneTabs(paneId);
  }
  lspManager?.changeDocument(tab.path, content);
}

function handleTabDrop(targetPaneId: string, tabJson: string) {
  const dropped = JSON.parse(tabJson) as TabInfo & { paneId?: string };
  const sourcePaneId = dropped.paneId;
  if (sourcePaneId === targetPaneId) return;

  const tab: TabInfo = {
    path: dropped.path,
    name: dropped.name,
    content: dropped.content,
    dirty: dropped.dirty,
    diff: dropped.diff,
  };

  state.editorRoot = moveTabToPane(state.editorRoot, sourcePaneId, targetPaneId, tab);
  state.activePaneId = targetPaneId;
  const pruned = pruneEmptyPanes(state.editorRoot, state.activePaneId);
  state.editorRoot = pruned.root;
  state.activePaneId = pruned.activePaneId;
  updateLayout();
}

function handlePaneFocus(paneId: string) {
  state.activePaneId = paneId;
}

function handleToggleTerminal() {
  if (state.terminalState.kind === "noTerminals") {
    handleNewTerminal();
    return;
  }
  state.terminalState = toggleTerminal(state.terminalState);
  updateLayout();
}

function addTaskTerminal(name: string, cwd: string): string {
  const id = newTerminalId();
  state.terminalState = createTerminal(state.terminalState, id, name, cwd);
  updateLayout();
  return id;
}

async function runTask(label: string) {
  if (!state.rootPath) return;
  const tasks = await loadTasks(state.rootPath);
  const task = findTaskByLabel(tasks, label) ?? findDefaultTask(tasks, "build");
  if (!task) {
    console.warn(`Task "${label}" not found`);
    return;
  }
  const id = addTaskTerminal(task.label, task.options?.cwd ?? state.rootPath);
  // Wait a tick so the shell prompt is ready.
  await new Promise((resolve) => setTimeout(resolve, 150));
  await terminalInput(id, taskCommand(task) + "\n");
}

function handleAgentStart(config: HarnessConfig) {
  if (!state.rootPath || state.agentSessionId) return;
  state.agentConfig = config;
  agentConfigStore.save(state.rootPath, config);
  state.agentSessionId = `agent-${Date.now()}`;
  state.agentVisible = true;
  layout?.setAgentVisible(true);
  layout?.updateAgent(state.rootPath, state.agentConfig, state.agentSessionId).catch((err) => {
    console.error("Failed to start agent:", err);
    state.agentSessionId = null;
    layout?.updateAgent(state.rootPath, state.agentConfig, null);
  });
  saveLayout();
}

function handleAgentStop() {
  state.agentSessionId = null;
  layout?.updateAgent(state.rootPath, state.agentConfig, null).catch(console.error);
}

function handleAgentConfigChange(config: HarnessConfig) {
  state.agentConfig = config;
  if (state.rootPath) agentConfigStore.save(state.rootPath, config);
}

function handleToggleAgent() {
  state.agentVisible = !state.agentVisible;
  layout?.setAgentVisible(state.agentVisible);
  saveLayout();
}

function handleNewTerminal() {
  const id = newTerminalId();
  const name = `Terminal ${
    state.terminalState.kind === "terminalsOpen"
      ? state.terminalState.terminals.length + 1
      : 1
  }`;
  const cwd = state.rootPath ?? "/";
  state.terminalState = createTerminal(state.terminalState, id, name, cwd);
  updateLayout();
}

function handleCloseTerminal(id: string) {
  state.terminalState = closeTerminal(state.terminalState, id);
  updateLayout();
}

function handleSwitchTerminal(id: string) {
  state.terminalState = switchTerminal(state.terminalState, id);
  updateLayout();
}

async function handleFileDrop(
  targetPaneId: string,
  path: string,
  name: string,
  zone: DropZone
) {
  if (zone === "center") {
    const targetPane = findPane(state.editorRoot, targetPaneId);
    if (!targetPane) return;
    const existing = targetPane.tabs.find((t) => t.path === path);
    if (existing) {
      state.editorRoot = replacePane(
        state.editorRoot,
        targetPaneId,
        setActiveTabByPath(targetPane, path)
      );
    } else {
      try {
        const content = await readFile(path);
        const tab = { path, name, content, dirty: false };
        state.editorRoot = replacePane(
          state.editorRoot,
          targetPaneId,
          addTab(targetPane, tab)
        );
      } catch (err) {
        console.error("Failed to read file:", err);
        alert(`Failed to read file: ${err}`);
      }
    }
    state.activePaneId = targetPaneId;
    updateLayout();
    return;
  }

  try {
    const content = await readFile(path);
    const dir = zone === "left" || zone === "right" ? "row" : "column";
    const isNewPaneFirst = zone === "left" || zone === "top";
    const newPane = addTab(emptyEditorPane(newPaneId()), {
      path,
      name,
      content,
      dirty: false,
    });
    const targetPane = findPane(state.editorRoot, targetPaneId);
    if (!targetPane) return;
    state.editorRoot = replacePane(state.editorRoot, targetPaneId, {
      type: "split",
      direction: dir,
      children: isNewPaneFirst ? [newPane, targetPane] : [targetPane, newPane],
    });
    state.activePaneId = newPane.id;
    updateLayout();
  } catch (err) {
    console.error("Failed to read file:", err);
    alert(`Failed to read file: ${err}`);
  }
}


function handleCloseActiveTab() {
  const pane = findPane(state.editorRoot, state.activePaneId);
  if (pane?.activeTab?.path) {
    handleTabClose(state.activePaneId, pane.activeTab.path);
  }
}

function handleKillActiveTerminal() {
  if (
    state.terminalState.kind === "terminalsOpen" &&
    state.terminalState.activeTerminalId
  ) {
    handleCloseTerminal(state.terminalState.activeTerminalId);
  }
}

function focusPaneRelative(direction: 1 | -1) {
  const panes = collectEditorPanes(state.editorRoot);
  if (panes.length < 2) return;
  const currentIndex = panes.findIndex((p) => p.id === state.activePaneId);
  const nextIndex =
    (currentIndex + direction + panes.length) % panes.length;
  const next = panes[nextIndex];
  state.activePaneId = next.id;
  layout?.focusPane(next.id);
}

function handleSetKeybindingMode(mode: KeybindingMode) {
  state.keybindingMode = mode;
  setKeybindingMode(mode);
}

/**
 * Registers every action in the app as a discoverable command so it shows
 * up in the command palette and can be bound via any keymap.
 */
function registerAppCommands() {
  registerCommands([
    {
      id: "commandPalette.open",
      title: "Open Command Palette",
      run: () => commandPalette?.open(),
    },
    {
      id: "file.openFolder",
      title: "File: Open Folder…",
      run: () => handleOpenFolder(),
    },
    {
      id: "file.save",
      title: "File: Save",
      run: () => handleSave(state.activePaneId),
    },
    {
      id: "tab.close",
      title: "File: Close Tab",
      run: () => handleCloseActiveTab(),
    },
    {
      id: "view.splitHorizontal",
      title: "View: Split Editor Horizontally",
      run: () => handleSplit(state.activePaneId, "row"),
    },
    {
      id: "view.splitVertical",
      title: "View: Split Editor Vertically",
      run: () => handleSplit(state.activePaneId, "column"),
    },
    {
      id: "terminal.toggle",
      title: "Terminal: Toggle Panel",
      run: () => handleToggleTerminal(),
    },
    {
      id: "terminal.new",
      title: "Terminal: New Terminal",
      run: () => handleNewTerminal(),
    },
    {
      id: "terminal.kill",
      title: "Terminal: Kill Active Terminal",
      run: () => handleKillActiveTerminal(),
    },
    {
      id: "agent.toggle",
      title: "Agent: Toggle Panel",
      run: () => handleToggleAgent(),
    },
    {
      id: "task.runBuild",
      title: "Task: Run Build Task",
      run: () => runTask("build"),
    },
    {
      id: "task.runTest",
      title: "Task: Run Test Task",
      run: () => runTask("test"),
    },
    {
      id: "sidebar.toggle",
      title: "View: Toggle Sidebar",
      run: () => layout?.toggleSidebar(),
    },
    {
      id: "view.focusExplorer",
      title: "View: Show Explorer",
      run: () => layout?.focusExplorer(),
    },
    {
      id: "view.focusSourceControl",
      title: "View: Show Source Control",
      run: () => layout?.focusSourceControl(),
    },
    {
      id: "pane.focusNext",
      title: "View: Focus Next Editor Pane",
      run: () => focusPaneRelative(1),
    },
    {
      id: "pane.focusPrevious",
      title: "View: Focus Previous Editor Pane",
      run: () => focusPaneRelative(-1),
    },
    {
      id: "keybindings.useDefault",
      title: "Preferences: Use Default Keybindings",
      run: () => handleSetKeybindingMode("default"),
    },
    {
      id: "keybindings.useEmacs",
      title: "Preferences: Use Emacs Keybindings",
      run: () => handleSetKeybindingMode("emacs"),
    },
    {
      id: "keybindings.useVim",
      title: "Preferences: Use Vim Keybindings",
      run: () => handleSetKeybindingMode("vim"),
    },
  ]);
}

document.addEventListener("DOMContentLoaded", async () => {
  const app = document.getElementById("app");
  if (!app) {
    throw new Error("missing #app mount point");
  }

  layout = createLayout(
    {
      onOpenFolder: handleOpenFolder,
      onFileClick: handleFileClick,
      onTabClick: handleTabClick,
      onTabClose: handleTabClose,
      onTabDrop: handleTabDrop,
      onFileDrop: handleFileDrop,
      onSplit: handleSplit,
      onSplitDrop: handleSplitDrop,
      onSave: handleSave,
      onContentChange: handleContentChange,
      onPaneFocus: handlePaneFocus,
      onToggleTerminal: handleToggleTerminal,
      onNewTerminal: handleNewTerminal,
      onCloseTerminal: handleCloseTerminal,
      onSwitchTerminal: handleSwitchTerminal,
      onSidebarResize: (width) => {
        state.sidebarWidth = width;
        saveLayout();
      },
      onTerminalResize: (height) => {
        state.terminalHeight = height;
        saveLayout();
      },
      onStageFile: handleStageFile,
      onUnstageFile: handleUnstageFile,
      onCommit: handleCommit,
      onOpenDiffFile: handleOpenDiffFile,
      onAgentStart: handleAgentStart,
      onAgentStop: handleAgentStop,
      onAgentConfigChange: handleAgentConfigChange,
      onAgentResize: (width) => {
        state.agentWidth = width;
        saveLayout();
      },
    },
    {
      sidebarWidth: state.sidebarWidth,
      terminalHeight: state.terminalHeight,
      agentWidth: state.agentWidth,
      agentVisible: state.agentVisible,
    }
  );

  app.appendChild(layout.element);

  registerAppCommands();
  commandPalette = createCommandPalette(() => state.keybindingMode);
  document.body.appendChild(commandPalette.element);

  window.addEventListener(
    "keydown",
    (e) => {
      if (commandPalette?.isOpen() && commandPalette.element.contains(e.target as Node)) {
        return;
      }
      const chord = chordFromEvent(e);
      if (!chord) return;
      const binding = findBinding(state.keybindingMode, chord);
      if (!binding) return;
      e.preventDefault();
      e.stopPropagation();
      runCommand(binding.commandId);
    },
    { capture: true }
  );

  try {
    await listen("menu-open-folder", () => runCommand("file.openFolder"));
    await listen("menu-save", () => runCommand("file.save"));
    await listen("menu-close-tab", () => runCommand("tab.close"));
    await listen("menu-split-horizontal", () => runCommand("view.splitHorizontal"));
    await listen("menu-split-vertical", () => runCommand("view.splitVertical"));
    await listen("menu-toggle-terminal", () => runCommand("terminal.toggle"));
    await listen("menu-toggle-agent", () => runCommand("agent.toggle"));
    await listen("menu-new-terminal", () => runCommand("terminal.new"));
    await listen("menu-kill-terminal", () => runCommand("terminal.kill"));
    await listen("menu-run-build-task", () => runCommand("task.runBuild"));
    await listen("menu-run-test-task", () => runCommand("task.runTest"));
    await listen<{ root_path: string }>("git-status-changed", (event) => {
      if (event.payload.root_path === state.rootPath) {
        refreshGitStatus();
      }
    });
  } catch {
    // Tauri event listening is unavailable in browser dev server.
  }

  const lastFolder = recentFolderStore.getLastOpenedFolder();
  if (lastFolder) {
    openFolder(lastFolder).catch((err) => {
      console.error("Failed to reopen last folder:", err);
      recentFolderStore.setLastOpenedFolder(null);
    });
  }
});
