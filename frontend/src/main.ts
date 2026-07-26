import {
  pickFolder,
  readDir,
  readFile,
  writeFile,
  terminalInput,
  type FileNode,
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
  createLocalRecentFolderStore,
  type RecentFolderStore,
} from "./appStorage.js";
import {
  loadTasks,
  findDefaultTask,
  findTaskByLabel,
  taskCommand,
} from "./tasks.js";
import { LspManager } from "./lsp.js";

interface AppState {
  rootPath: string | null;
  editorRoot: PaneNode;
  activePaneId: string;
  terminalState: TerminalState;
  sidebarWidth: number;
  terminalHeight: number;
}

const state: AppState = {
  rootPath: null,
  editorRoot: emptyEditorPane("pane-1"),
  activePaneId: "pane-1",
  terminalState: noTerminals,
  sidebarWidth: 256,
  terminalHeight: 192,
};

let layout: LayoutAPI | null = null;
let lspManager: LspManager | null = null;
const layoutStorage: LayoutStorage = createLocalLayoutStorage();
const recentFolderStore: RecentFolderStore = createLocalRecentFolderStore();
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

function saveLayout() {
  if (!state.rootPath) return;
  layoutStorage.save(state.rootPath, {
    editorRoot: state.editorRoot,
    activePaneId: state.activePaneId,
    terminalState: state.terminalState,
    sidebarWidth: state.sidebarWidth,
    terminalHeight: state.terminalHeight,
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
  state.rootPath = path;
  recentFolderStore.setLastOpenedFolder(path);

  const saved = loadLayout(path);
  if (saved) {
    state.editorRoot = saved.editorRoot;
    state.activePaneId = saved.activePaneId;
    state.terminalState = saved.terminalState;
    state.sidebarWidth = saved.sidebarWidth ?? 256;
    state.terminalHeight = saved.terminalHeight ?? 192;
  } else {
    state.editorRoot = emptyEditorPane("pane-1");
    state.activePaneId = "pane-1";
    state.terminalState = noTerminals;
    state.sidebarWidth = 256;
    state.terminalHeight = 192;
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

  updateLayout();
}

function getActivePane(): EditorPane {
  const result = activePane(state.editorRoot, state.activePaneId);
  state.activePaneId = result.activePaneId;
  return result.pane;
}

async function handleFileClick(path: string, name: string) {
  const pane = getActivePane();
  const existing = pane.tabs.find((t) => t.path === path);
  if (existing) {
    state.editorRoot = replacePane(
      state.editorRoot,
      pane.id,
      setActiveTabByPath(pane, path)
    );
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
  try {
    const content = layout.getPaneContent(paneId);
    await writeFile(tab.path, content);
    tab.content = content;
    tab.dirty = false;
    layout.updatePaneTabs(paneId);
    saveLayout();
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
    },
    {
      sidebarWidth: state.sidebarWidth,
      terminalHeight: state.terminalHeight,
    }
  );

  app.appendChild(layout.element);

  try {
    await listen("menu-open-folder", () => handleOpenFolder());
    await listen("menu-save", () => handleSave(state.activePaneId));
    await listen("menu-close-tab", () => {
      const pane = findPane(state.editorRoot, state.activePaneId);
      if (pane?.activeTab?.path) {
        handleTabClose(state.activePaneId, pane.activeTab.path);
      }
    });
    await listen("menu-split-horizontal", () =>
      handleSplit(state.activePaneId, "row")
    );
    await listen("menu-split-vertical", () =>
      handleSplit(state.activePaneId, "column")
    );
    await listen("menu-toggle-terminal", () => handleToggleTerminal());
    await listen("menu-new-terminal", () => handleNewTerminal());
    await listen("menu-kill-terminal", () => {
      if (
        state.terminalState.kind === "terminalsOpen" &&
        state.terminalState.activeTerminalId
      ) {
        handleCloseTerminal(state.terminalState.activeTerminalId);
      }
    });
    await listen("menu-run-build-task", () => runTask("build"));
    await listen("menu-run-test-task", () => runTask("test"));
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
