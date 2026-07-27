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
import { createSourceControl } from "./SourceControl.js";
import { createAgentPanel } from "./AgentPanel.js";
import type { HarnessConfig } from "../agentConfig.js";
import type { FileNode, RepoStatus } from "../api.js";
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
  onStageFile: (path: string) => void;
  onUnstageFile: (path: string) => void;
  onCommit: (message: string) => void;
  onOpenDiffFile: (path: string, staged: boolean) => void;
  onAgentStart: (config: HarnessConfig) => void;
  onAgentStop: () => void;
  onAgentConfigChange: (config: HarnessConfig) => void;
  onAgentResize: (width: number) => void;
}

export interface LayoutAPI {
  element: HTMLElement;
  updateTree: (nodes: FileNode[]) => void;
  updateEditorRoot: (root: PaneNode, activePaneId: string) => void;
  updatePaneTabs: (paneId: string) => void;
  updateTerminals: (state: TerminalState) => void;
  getPaneContent: (paneId: string) => string;
  updateGitStatus: (status: RepoStatus | null) => void;
  updateAgent: (
    workspace: string | null,
    config: HarnessConfig,
    sessionId: string | null
  ) => Promise<void>;
  setAgentVisible: (visible: boolean) => void;
  setAgentWidth: (width: number) => void;
  toggleSidebar: () => void;
  focusExplorer: () => void;
  focusSourceControl: () => void;
  focusPane: (paneId: string) => void;
}

export function createLayout(
  callbacks: LayoutCallbacks,
  options: {
    sidebarWidth?: number;
    terminalHeight?: number;
    agentWidth?: number;
    agentVisible?: boolean;
  } = {}
): LayoutAPI {
  const wrapper = document.createElement("div");
  wrapper.className = "flex flex-col h-screen w-screen overflow-hidden bg-tau-bg";

  const titleBar = createTitleBar();

  const workspace = document.createElement("div");
  workspace.className = "flex flex-1 min-h-0";

  const activityBar = document.createElement("div");
  activityBar.className =
    "w-12 bg-tau-bg border-r border-tau-border flex flex-col items-center py-2 gap-1 select-none text-tau-muted";

  const brand = document.createElement("div");
  brand.className = "text-tau-accent font-bold mb-2";
  brand.textContent = "τ";
  activityBar.appendChild(brand);

  const explorerButton = document.createElement("button");
  explorerButton.className =
    "w-8 h-8 flex items-center justify-center rounded hover:bg-tau-active-hover text-lg";
  explorerButton.title = "Explorer";
  explorerButton.textContent = "▤";
  activityBar.appendChild(explorerButton);

  const sourceControlWrapper = document.createElement("div");
  sourceControlWrapper.className = "relative";
  const sourceControlButton = document.createElement("button");
  sourceControlButton.className =
    "w-8 h-8 flex items-center justify-center rounded hover:bg-tau-active-hover text-lg";
  sourceControlButton.title = "Source Control";
  sourceControlButton.textContent = "⎇";
  sourceControlWrapper.appendChild(sourceControlButton);

  const changeBadge = document.createElement("span");
  changeBadge.className =
    "absolute -top-1 -right-1 min-w-[14px] h-[14px] px-[3px] rounded-full bg-tau-accent text-[9px] leading-[14px] text-tau-bg text-center hidden";
  sourceControlWrapper.appendChild(changeBadge);
  activityBar.appendChild(sourceControlWrapper);

  const sidebar = createSidebar(callbacks.onOpenFolder, callbacks.onFileClick);
  const sourceControl = createSourceControl({
    onStage: (path) => callbacks.onStageFile(path),
    onUnstage: (path) => callbacks.onUnstageFile(path),
    onCommit: (message) => callbacks.onCommit(message),
    onOpenFile: (path, staged) => callbacks.onOpenDiffFile(path, staged),
  });

  const sidebarContainer = document.createElement("div");
  sidebarContainer.className =
    "flex flex-col border-r border-tau-border overflow-hidden";
  const sidebarWidth = Math.max(160, options.sidebarWidth ?? 256);
  sidebarContainer.style.width = `${sidebarWidth}px`;
  sidebar.element.classList.remove("w-64", "border-r", "border-tau-border");
  sidebar.element.classList.add("h-full", "w-full");
  sourceControl.element.classList.add("h-full", "w-full");
  sidebarContainer.appendChild(sidebar.element);
  sidebarContainer.appendChild(sourceControl.element);

  let sidebarVisible = true;
  function toggleSidebar() {
    sidebarVisible = !sidebarVisible;
    sidebarContainer.classList.toggle("hidden", !sidebarVisible);
    sidebarResizer.element.classList.toggle("hidden", !sidebarVisible);
  }

  let activityView: "explorer" | "source-control" = "explorer";
  function focusExplorer() {
    activityView = "explorer";
    if (!sidebarVisible) toggleSidebar();
    updateActivityView();
  }
  function focusSourceControl() {
    activityView = "source-control";
    if (!sidebarVisible) toggleSidebar();
    updateActivityView();
  }
  function updateActivityView() {
    sidebar.element.classList.toggle("hidden", activityView !== "explorer");
    sourceControl.element.classList.toggle(
      "hidden",
      activityView !== "source-control"
    );
    explorerButton.classList.toggle("bg-tau-active", activityView === "explorer");
    explorerButton.classList.toggle("text-tau-fg", activityView === "explorer");
    sourceControlButton.classList.toggle(
      "bg-tau-active",
      activityView === "source-control"
    );
    sourceControlButton.classList.toggle(
      "text-tau-fg",
      activityView === "source-control"
    );
  }
  explorerButton.addEventListener("click", () => focusExplorer());
  sourceControlButton.addEventListener("click", () => focusSourceControl());
  updateActivityView();

  const sidebarResizer = createResizer({
    direction: "row",
    onChange(delta) {
      const next = Math.max(160, sidebarContainer.offsetWidth + delta);
      sidebarContainer.style.width = `${next}px`;
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

  const agentPanel = createAgentPanel({
    onStart: callbacks.onAgentStart,
    onStop: callbacks.onAgentStop,
    onConfigChange: callbacks.onAgentConfigChange,
  });
  const agentWidth = Math.max(280, options.agentWidth ?? 400);
  agentPanel.element.style.width = `${agentWidth}px`;
  const agentResizer = createResizer({
    direction: "row",
    onChange(delta) {
      const next = Math.max(280, agentPanel.element.offsetWidth - delta);
      agentPanel.element.style.width = `${next}px`;
      callbacks.onAgentResize(next);
    },
  });
  const agentContainer = document.createElement("div");
  agentContainer.className = "flex h-full shrink-0 min-w-0";
  agentContainer.append(agentResizer.element, agentPanel.element);
  agentContainer.classList.toggle("hidden", !options.agentVisible);

  workspace.appendChild(activityBar);
  workspace.appendChild(sidebarContainer);
  workspace.appendChild(sidebarResizer.element);
  workspace.appendChild(mainArea);
  workspace.appendChild(agentContainer);

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
      api.updateContent(active);
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

  function updateGitStatus(status: RepoStatus | null) {
    sidebar.updateGitStatus(status);
    sourceControl.update(status);
    statusBar.updateBranch(
      status && status.is_repo ? status.branch : null,
      status?.ahead ?? 0,
      status?.behind ?? 0
    );
    const count = status?.files.length ?? 0;
    changeBadge.textContent = String(count);
    changeBadge.classList.toggle("hidden", count === 0);
  }

  async function updateAgent(
    workspaceRoot: string | null,
    config: HarnessConfig,
    sessionId: string | null
  ) {
    agentPanel.updateWorkspace(workspaceRoot);
    agentPanel.updateConfig(config);
    await agentPanel.updateSession(sessionId, workspaceRoot);
  }

  function setAgentVisible(visible: boolean) {
    agentContainer.classList.toggle("hidden", !visible);
  }

  function setAgentWidth(width: number) {
    agentPanel.element.style.width = `${Math.max(280, width)}px`;
  }

  function focusPane(paneId: string) {
    editorPanes.get(paneId)?.focus();
  }

  return {
    element: wrapper,
    updateTree,
    updateEditorRoot,
    updatePaneTabs,
    updateTerminals,
    getPaneContent,
    updateGitStatus,
    updateAgent,
    setAgentVisible,
    setAgentWidth,
    toggleSidebar,
    focusExplorer,
    focusSourceControl,
    focusPane,
  };
}
