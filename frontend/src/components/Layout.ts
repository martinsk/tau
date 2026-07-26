import { createTitleBar } from "./TitleBar.js";
import { createSidebar } from "./Sidebar.js";
import { createEditorPane, type EditorPaneAPI } from "./EditorPane.js";
import type { DropZone } from "./PaneDropOverlay.js";
import { createSplitPane } from "./SplitPane.js";
import {
  createTerminalManager,
  type TerminalInfo,
  type TerminalState,
  type TerminalManagerAPI,
} from "./TerminalManager.js";
export type { TerminalInfo, TerminalState } from "./TerminalManager.js";
import { createStatusBar } from "./StatusBar.js";
import { createResizer } from "./Resizer.js";
import type { FileNode } from "../api.js";
import type { TabInfo } from "./Tabs.js";

export type EmptyEditorPane = {
  type: "editor";
  id: string;
  tabs: [];
  activeTab: null;
};

export type ActiveEditorPane = {
  type: "editor";
  id: string;
  tabs: [TabInfo, ...TabInfo[]];
  activeTab: TabInfo;
};

export type EditorPane = EmptyEditorPane | ActiveEditorPane;

export type PaneNode = EditorPane | SplitPane;

export interface SplitPane {
  type: "split";
  direction: "row" | "column";
  children: PaneNode[];
}

export interface LayoutCallbacks {
  onOpenFolder: () => void;
  onFileClick: (path: string, name: string) => void;
  onTabClick: (paneId: string, path: string) => void;
  onTabClose: (paneId: string, path: string) => void;
  onTabDrop: (targetPaneId: string, tabJson: string) => void;
  onFileDrop: (
    targetPaneId: string,
    path: string,
    name: string,
    zone: DropZone
  ) => void;
  onSplit: (paneId: string, direction: "row" | "column") => void;
  onSplitDrop: (paneId: string, direction: DropZone, data?: string) => void;
  onSave: (paneId: string) => void;
  onContentChange: (paneId: string, content: string) => void;
  onPaneFocus: (paneId: string) => void;
  onToggleTerminal: () => void;
  onNewTerminal: () => void;
  onCloseTerminal: (id: string) => void;
  onSwitchTerminal: (id: string) => void;
  onSidebarResize: (width: number) => void;
  onTerminalResize: (height: number) => void;
}

export interface LayoutAPI {
  element: HTMLElement;
  updateTree: (nodes: FileNode[]) => void;
  updateEditorRoot: (root: PaneNode, activePaneId: string) => void;
  updatePaneTabs: (paneId: string) => void;
  updateTerminals: (state: TerminalState) => void;
  getPaneContent: (paneId: string) => string;
}

export function createLayout(
  callbacks: LayoutCallbacks,
  options: { sidebarWidth?: number; terminalHeight?: number } = {}
): LayoutAPI {
  const wrapper = document.createElement("div");
  wrapper.className = "flex flex-col h-screen w-screen overflow-hidden bg-tau-bg";

  const titleBar = createTitleBar();

  const workspace = document.createElement("div");
  workspace.className = "flex flex-1 min-h-0";

  const activityBar = document.createElement("div");
  activityBar.className =
    "w-12 bg-tau-bg border-r border-tau-border flex flex-col items-center py-2 select-none text-tau-muted";
  activityBar.textContent = "τ";

  const sidebar = createSidebar(callbacks.onOpenFolder, callbacks.onFileClick);
  const sidebarWidth = Math.max(160, options.sidebarWidth ?? 256);
  sidebar.element.style.width = `${sidebarWidth}px`;
  sidebar.element.classList.remove("w-64");

  const sidebarResizer = createResizer({
    direction: "row",
    onChange(delta) {
      const next = Math.max(160, sidebar.element.offsetWidth + delta);
      sidebar.element.style.width = `${next}px`;
      callbacks.onSidebarResize(next);
    },
  });

  const mainArea = document.createElement("div");
  mainArea.className = "flex flex-1 flex-col min-w-0";

  const editorContainer = document.createElement("div");
  editorContainer.className = "flex-1 min-h-0 flex flex-col";

  const terminalManager = createTerminalManager({
    onNewTerminal: () => callbacks.onNewTerminal(),
    onCloseTerminal: (id: string) => callbacks.onCloseTerminal(id),
    onSwitchTerminal: (id: string) => callbacks.onSwitchTerminal(id),
  });
  const terminalHeight = Math.max(120, options.terminalHeight ?? 192);
  terminalManager.element.style.height = `${terminalHeight}px`;
  terminalManager.element.classList.remove("h-48");

  const terminalResizer = createResizer({
    direction: "column",
    onChange(delta) {
      const next = Math.max(120, terminalManager.element.offsetHeight + delta);
      terminalManager.element.style.height = `${next}px`;
      callbacks.onTerminalResize(next);
      terminalManager.fitActive();
    },
  });

  mainArea.appendChild(editorContainer);
  mainArea.appendChild(terminalResizer.element);
  mainArea.appendChild(terminalManager.element);

  workspace.appendChild(activityBar);
  workspace.appendChild(sidebar.element);
  workspace.appendChild(sidebarResizer.element);
  workspace.appendChild(mainArea);

  wrapper.appendChild(titleBar.element);
  wrapper.appendChild(workspace);

  const statusBar = createStatusBar();
  wrapper.appendChild(statusBar.element);

  let currentRoot: PaneNode | null = null;
  const editorPanes = new Map<string, EditorPaneAPI>();

  function getOrCreateEditorPane(pane: EditorPane): EditorPaneAPI {
    let api = editorPanes.get(pane.id);
    if (!api) {
      api = createEditorPane({
        paneId: pane.id,
        onTabClick: (path: string) => callbacks.onTabClick(pane.id, path),
        onTabClose: (path: string) => callbacks.onTabClose(pane.id, path),
        onContentChange: (content: string) =>
          callbacks.onContentChange(pane.id, content),
        onSave: () => callbacks.onSave(pane.id),
        onFocus: () => callbacks.onPaneFocus(pane.id),
        onTabDrop: (data: string) => callbacks.onTabDrop(pane.id, data),
        onSplitRequest: (direction: DropZone, data?: string) =>
          callbacks.onSplitDrop(pane.id, direction, data),
        onFileDrop: (path: string, name: string, zone: DropZone) =>
          callbacks.onFileDrop(pane.id, path, name, zone),
      });
      editorPanes.set(pane.id, api);
    }
    return api;
  }

  function renderPane(node: PaneNode): HTMLElement {
    if (node.type === "editor") {
      const api = getOrCreateEditorPane(node);
      const tabs = node.tabs;
      const active = node.activeTab;
      api.updateTabs(tabs, active?.path ?? null);
      api.updateContent(active?.name ?? null, active?.content ?? "");
      return api.element;
    }

    const children = node.children.map(renderPane);
    const split = createSplitPane(
      node.direction,
      children,
      node.children.map(() => 1)
    );
    return split.element;
  }

  function cleanupRemovedPanes(newRoot: PaneNode) {
    const ids = new Set<string>();
    function collect(n: PaneNode) {
      if (n.type === "editor") ids.add(n.id);
      else n.children.forEach(collect);
    }
    collect(newRoot);
    for (const [id, api] of editorPanes) {
      if (!ids.has(id)) {
        api.element.remove();
        editorPanes.delete(id);
      }
    }
  }

  function updateEditorRoot(root: PaneNode, activePaneId: string) {
    currentRoot = root;
    cleanupRemovedPanes(root);
    editorContainer.innerHTML = "";
    editorContainer.appendChild(renderPane(root));
    statusBar.updatePath(getActivePath(root, activePaneId) ?? "Ready");
  }

  function updatePaneTabs(paneId: string) {
    if (!currentRoot) return;
    const pane = findPane(currentRoot, paneId);
    const api = editorPanes.get(paneId);
    if (pane && api) {
      api.updateTabs(pane.tabs, pane.activeTab?.path ?? null);
    }
  }

  function getActivePath(root: PaneNode, activePaneId: string): string | null {
    const pane = findPane(root, activePaneId);
    return pane?.activeTab?.path ?? null;
  }

  function findPane(root: PaneNode, id: string): EditorPane | null {
    if (root.type === "editor") return root.id === id ? root : null;
    for (const child of root.children) {
      const found = findPane(child, id);
      if (found) return found;
    }
    return null;
  }

  async function updateTerminals(state: TerminalState) {
    if (state.kind === "noTerminals") {
      for (const id of terminalManager.listTerminals()) {
        await terminalManager.closeTerminal(id);
      }
      terminalManager.setVisible(false);
      return;
    }

    const existing = new Set(terminalManager.listTerminals());
    for (const info of state.terminals) {
      if (!existing.has(info.id)) {
        await terminalManager.addTerminal(info);
      }
    }
    const ids = new Set(state.terminals.map((t) => t.id));
    for (const id of existing) {
      if (!ids.has(id)) {
        await terminalManager.closeTerminal(id);
      }
    }
    terminalManager.setActive(state.activeTerminalId);
    terminalManager.setVisible(state.bottomPanelVisible);
  }

  function getPaneContent(paneId: string): string {
    return editorPanes.get(paneId)?.getContent() ?? "";
  }

  function updateTree(nodes: FileNode[]) {
    sidebar.updateTree(nodes);
  }

  return {
    element: wrapper,
    updateTree,
    updateEditorRoot,
    updatePaneTabs,
    updateTerminals,
    getPaneContent,
  };
}
