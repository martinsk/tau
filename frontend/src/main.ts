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
} from "./editorTree.js";
import { createTerminal, closeTerminal, switchTerminal } from "./terminalState.js";
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
  bottomPanelVisible: boolean;
  terminals: TerminalInfo[];
  activeTerminalId: string | null;
  sidebarWidth: number;
  terminalHeight: number;
}

const state: AppState = {
  rootPath: null,
  editorRoot: {
    type: "editor",
    id: "pane-1",
    tabs: [],
    activeTabPath: null,
  },
  activePaneId: "pane-1",
  bottomPanelVisible: false,
  terminals: [],
  activeTerminalId: null,
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
    bottomPanelVisible: state.bottomPanelVisible,
    terminals: state.terminals,
    activeTerminalId: state.activeTerminalId,
    sidebarWidth: state.sidebarWidth,
    terminalHeight: state.terminalHeight,
  });
}

function loadLayout(rootPath: string) {
  const raw = layoutStorage.load(rootPath);
  if (!raw) return null;
  return {
    ...raw,
    editorRoot: hydratePane(raw.editorRoot),
  };
}

function hydratePane(data: unknown): PaneNode {
  const d = data as Record<string, unknown>;
  if (d.type === "editor") {
    return {
      type: "editor",
      id: (d.id as string) ?? newPaneId(),
      tabs: Array.isArray(d.tabs) ? (d.tabs as TabInfo[]) : [],
      activeTabPath: (d.activeTabPath as string | null) ?? null,
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
  layout?.updateTerminals(
    state.bottomPanelVisible,
    state.terminals,
    state.activeTerminalId
  );
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
    state.bottomPanelVisible = saved.bottomPanelVisible;
    state.terminals = saved.terminals;
    state.activeTerminalId = saved.activeTerminalId;
    state.sidebarWidth = saved.sidebarWidth ?? 256;
    state.terminalHeight = saved.terminalHeight ?? 192;
  } else {
    state.editorRoot = {
      type: "editor",
      id: "pane-1",
      tabs: [],
      activeTabPath: null,
    };
    state.activePaneId = "pane-1";
    state.bottomPanelVisible = false;
    state.terminals = [];
    state.activeTerminalId = null;
    state.sidebarWidth = 256;
    state.terminalHeight = 192;
    paneCounter = 1;
    terminalCounter = 0;
  }

  const maxTerminal = state.terminals.reduce((max, t) => {
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
    pane.activeTabPath = path;
    updateLayout();
    return;
  }

  try {
    const content = await readFile(path);
    pane.tabs.push({ path, name, content, dirty: false });
    pane.activeTabPath = path;
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
  pane.activeTabPath = path;
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

  const activeTab = pane.tabs.find((t) => t.path === pane.activeTabPath);
  const newPane: EditorPane = {
    type: "editor",
    id: newPaneId(),
    tabs: activeTab ? [{ ...activeTab }] : [],
    activeTabPath: activeTab?.path ?? null,
  };

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

  if (sourcePane) {
    sourcePane.tabs = sourcePane.tabs.filter((t) => t.path !== tab.path);
    if (sourcePane.activeTabPath === tab.path) {
      sourcePane.activeTabPath =
        sourcePane.tabs[sourcePane.tabs.length - 1]?.path ?? null;
    }
  }

  const dir = direction === "left" || direction === "right" ? "row" : "column";
  const newPane: EditorPane = {
    type: "editor",
    id: newPaneId(),
    tabs: [tab],
    activeTabPath: tab.path,
  };

  state.editorRoot = splitPane(state.editorRoot, targetPaneId, dir, newPane, direction);
  state.activePaneId = newPane.id;
  const pruned = pruneEmptyPanes(state.editorRoot, state.activePaneId);
  state.editorRoot = pruned.root;
  state.activePaneId = pruned.activePaneId;
  updateLayout();
}

async function handleSave(paneId: string) {
  const pane = findPane(state.editorRoot, paneId);
  if (!pane || !layout) return;
  const tab = pane.tabs.find((t) => t.path === pane.activeTabPath);
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
  const tab = pane.tabs.find((t) => t.path === pane.activeTabPath);
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
  state.bottomPanelVisible = !state.bottomPanelVisible;
  if (state.bottomPanelVisible && state.terminals.length === 0) {
    handleNewTerminal();
    return;
  }
  updateLayout();
}

function addTaskTerminal(name: string, cwd: string): string {
  const id = newTerminalId();
  const next = createTerminal(
    {
      terminals: state.terminals,
      activeTerminalId: state.activeTerminalId,
      bottomPanelVisible: state.bottomPanelVisible,
    },
    id,
    name,
    cwd
  );
  state.terminals = next.terminals;
  state.activeTerminalId = next.activeTerminalId;
  state.bottomPanelVisible = next.bottomPanelVisible;
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
  const name = `Terminal ${state.terminals.length + 1}`;
  const cwd = state.rootPath ?? "/";
  const next = createTerminal(
    {
      terminals: state.terminals,
      activeTerminalId: state.activeTerminalId,
      bottomPanelVisible: state.bottomPanelVisible,
    },
    id,
    name,
    cwd
  );
  state.terminals = next.terminals;
  state.activeTerminalId = next.activeTerminalId;
  state.bottomPanelVisible = next.bottomPanelVisible;
  updateLayout();
}

function handleCloseTerminal(id: string) {
  const next = closeTerminal(
    {
      terminals: state.terminals,
      activeTerminalId: state.activeTerminalId,
      bottomPanelVisible: state.bottomPanelVisible,
    },
    id
  );
  state.terminals = next.terminals;
  state.activeTerminalId = next.activeTerminalId;
  state.bottomPanelVisible = next.bottomPanelVisible;
  updateLayout();
}

function handleSwitchTerminal(id: string) {
  const next = switchTerminal(
    {
      terminals: state.terminals,
      activeTerminalId: state.activeTerminalId,
      bottomPanelVisible: state.bottomPanelVisible,
    },
    id
  );
  state.activeTerminalId = next.activeTerminalId;
  state.bottomPanelVisible = next.bottomPanelVisible;
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
      targetPane.activeTabPath = path;
    } else {
      try {
        const content = await readFile(path);
        targetPane.tabs.push({ path, name, content, dirty: false });
        targetPane.activeTabPath = path;
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
    const newPane: EditorPane = {
      type: "editor",
      id: newPaneId(),
      tabs: [{ path, name, content, dirty: false }],
      activeTabPath: path,
    };
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
      if (pane?.activeTabPath) {
        handleTabClose(state.activePaneId, pane.activeTabPath);
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
      if (state.activeTerminalId) {
        handleCloseTerminal(state.activeTerminalId);
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
