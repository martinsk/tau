import {
  pickFolder,
  readDir,
  readFile,
  writeFile,
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

interface AppState {
  rootPath: string | null;
  editorRoot: PaneNode;
  activePaneId: string;
  bottomPanelVisible: boolean;
  terminals: TerminalInfo[];
  activeTerminalId: string | null;
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
};

let layout: LayoutAPI | null = null;
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

function layoutKey(rootPath: string): string {
  return `tau-layout:${rootPath}`;
}

function saveLayout() {
  if (!state.rootPath) return;
  const data = {
    editorRoot: persistPane(state.editorRoot),
    activePaneId: state.activePaneId,
    bottomPanelVisible: state.bottomPanelVisible,
    terminals: state.terminals,
    activeTerminalId: state.activeTerminalId,
  };
  localStorage.setItem(layoutKey(state.rootPath), JSON.stringify(data));
}

function loadLayout(rootPath: string): {
  editorRoot: PaneNode;
  activePaneId: string;
  bottomPanelVisible: boolean;
  terminals: TerminalInfo[];
  activeTerminalId: string | null;
} | null {
  const raw = localStorage.getItem(layoutKey(rootPath));
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    return {
      editorRoot: hydratePane(data.editorRoot),
      activePaneId: data.activePaneId ?? "pane-1",
      bottomPanelVisible: data.bottomPanelVisible ?? false,
      terminals: Array.isArray(data.terminals) ? data.terminals : [],
      activeTerminalId: data.activeTerminalId ?? null,
    };
  } catch {
    return null;
  }
}

function persistPane(root: PaneNode): unknown {
  if (root.type === "editor") {
    return {
      type: "editor",
      id: root.id,
      tabs: root.tabs,
      activeTabPath: root.activeTabPath,
    };
  }
  return {
    type: "split",
    direction: root.direction,
    children: root.children.map(persistPane),
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

  state.rootPath = path;

  const saved = loadLayout(path);
  if (saved) {
    state.editorRoot = saved.editorRoot;
    state.activePaneId = saved.activePaneId;
    state.bottomPanelVisible = saved.bottomPanelVisible;
    state.terminals = saved.terminals;
    state.activeTerminalId = saved.activeTerminalId;
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

  updateLayout();
}

function activePane(): EditorPane {
  const pane = findPane(state.editorRoot, state.activePaneId);
  if (!pane) {
    const first = firstEditorPane(state.editorRoot);
    if (first) {
      state.activePaneId = first.id;
      return first;
    }
    return state.editorRoot as EditorPane;
  }
  return pane;
}

function firstEditorPane(root: PaneNode): EditorPane | null {
  if (root.type === "editor") return root;
  for (const child of root.children) {
    const found = firstEditorPane(child);
    if (found) return found;
  }
  return null;
}

function pruneEmptyPanes(
  root: PaneNode,
  activeId: string
): { root: PaneNode; activeId: string } {
  const pruned = pruneNode(root, true);
  const newRoot: PaneNode =
    pruned ?? {
      type: "editor",
      id: "pane-1",
      tabs: [],
      activeTabPath: null,
    };
  const activeExists = findPane(newRoot, activeId) !== null;
  if (!activeExists) {
    const first = firstEditorPane(newRoot);
    if (first) activeId = first.id;
  }
  return { root: newRoot, activeId };
}

function pruneNode(node: PaneNode, isRoot: boolean): PaneNode | null {
  if (node.type === "editor") {
    if (node.tabs.length === 0 && !isRoot) return null;
    return node;
  }
  const children: PaneNode[] = [];
  for (const child of node.children) {
    const pruned = pruneNode(child, false);
    if (pruned) children.push(pruned);
  }
  if (children.length === 0) {
    return isRoot
      ? { type: "editor", id: "pane-1", tabs: [], activeTabPath: null }
      : null;
  }
  if (children.length === 1) return children[0];
  return { type: "split", direction: node.direction, children };
}

async function handleFileClick(path: string, name: string) {
  const pane = activePane();
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
    updateLayout();
  } catch (err) {
    console.error("Failed to read file:", err);
    alert(`Failed to read file: ${err}`);
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
  const pane = findPane(state.editorRoot, paneId);
  if (!pane) return;
  pane.tabs = pane.tabs.filter((t) => t.path !== path);
  if (pane.activeTabPath === path) {
    pane.activeTabPath = pane.tabs[pane.tabs.length - 1]?.path ?? null;
  }
  const pruned = pruneEmptyPanes(state.editorRoot, state.activePaneId);
  state.editorRoot = pruned.root;
  state.activePaneId = pruned.activeId;
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

  const isNewPaneFirst = side === "left" || side === "top";

  state.editorRoot = replacePane(
    state.editorRoot,
    paneId,
    direction === "row"
      ? {
          type: "split",
          direction: "row",
          children: isNewPaneFirst ? [newPane, pane] : [pane, newPane],
        }
      : {
          type: "split",
          direction: "column",
          children: isNewPaneFirst ? [newPane, pane] : [pane, newPane],
        }
  );
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
  const isNewPaneFirst = direction === "left" || direction === "top";
  const newPane: EditorPane = {
    type: "editor",
    id: newPaneId(),
    tabs: [tab],
    activeTabPath: tab.path,
  };

  state.editorRoot = replacePane(state.editorRoot, targetPaneId, {
    type: "split",
    direction: dir,
    children: isNewPaneFirst ? [newPane, targetPane] : [targetPane, newPane],
  });
  state.activePaneId = newPane.id;
  const pruned = pruneEmptyPanes(state.editorRoot, state.activePaneId);
  state.editorRoot = pruned.root;
  state.activePaneId = pruned.activeId;
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
    updateLayout();
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
    updateLayout();
  }
}

function handleTabDrop(targetPaneId: string, tabJson: string) {
  const dropped = JSON.parse(tabJson) as TabInfo & { paneId?: string };
  const sourcePaneId = dropped.paneId;
  if (sourcePaneId === targetPaneId) return;

  const sourcePane = sourcePaneId ? findPane(state.editorRoot, sourcePaneId) : null;
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
      sourcePane.activeTabPath = sourcePane.tabs[sourcePane.tabs.length - 1]?.path ?? null;
    }
  }

  if (!targetPane.tabs.some((t) => t.path === tab.path)) {
    targetPane.tabs.push(tab);
  }
  targetPane.activeTabPath = tab.path;
  state.activePaneId = targetPaneId;
  const pruned = pruneEmptyPanes(state.editorRoot, state.activePaneId);
  state.editorRoot = pruned.root;
  state.activePaneId = pruned.activeId;
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

function handleNewTerminal() {
  const cwd = state.rootPath ?? "/";
  const id = newTerminalId();
  state.terminals.push({
    id,
    name: `Terminal ${state.terminals.length + 1}`,
    cwd,
  });
  state.activeTerminalId = id;
  state.bottomPanelVisible = true;
  updateLayout();
}

function handleCloseTerminal(id: string) {
  state.terminals = state.terminals.filter((t) => t.id !== id);
  if (state.activeTerminalId === id) {
    state.activeTerminalId =
      state.terminals[state.terminals.length - 1]?.id ?? null;
  }
  if (state.terminals.length === 0) {
    state.bottomPanelVisible = false;
  }
  updateLayout();
}

function handleSwitchTerminal(id: string) {
  state.activeTerminalId = id;
  state.bottomPanelVisible = true;
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

function findPane(root: PaneNode, id: string): EditorPane | null {
  if (root.type === "editor") return root.id === id ? root : null;
  for (const child of root.children) {
    const found = findPane(child, id);
    if (found) return found;
  }
  return null;
}

function replacePane(
  root: PaneNode,
  id: string,
  replacement: PaneNode
): PaneNode {
  if (root.type === "editor") {
    return root.id === id ? replacement : root;
  }
  return {
    type: "split",
    direction: root.direction,
    children: root.children.map((child) =>
      containsPane(child, id) ? replacePane(child, id, replacement) : child
    ),
  };
}

function containsPane(root: PaneNode, id: string): boolean {
  if (root.type === "editor") return root.id === id;
  return root.children.some((child) => containsPane(child, id));
}

document.addEventListener("DOMContentLoaded", async () => {
  const app = document.getElementById("app");
  if (!app) {
    throw new Error("missing #app mount point");
  }

  layout = createLayout({
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
  });

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
  } catch {
    // Tauri event listening is unavailable in browser dev server.
  }
});
