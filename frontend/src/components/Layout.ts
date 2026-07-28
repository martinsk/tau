import { createTitleBar } from "./TitleBar.js";
import { createSidebar } from "./Sidebar.js";
import type { EditorPaneAPI } from "./EditorPane.js";
import type { DropZone } from "./PaneDropOverlay.js";
import { createSplitPane, type SplitPaneAPI } from "./SplitPane.js";
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
import type { OutlineNode, Diagnostic } from "../lsp.js";
import { createProblemsPanel } from "./ProblemsPanel.js";

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
  onCreateFile: (node: FileNode | null) => void;
  onCreateDirectory: (node: FileNode | null) => void;
  onRenamePath: (node: FileNode) => void;
  onDeletePath: (node: FileNode) => void;
  onDuplicatePath: (node: FileNode) => void;
  onRefreshExplorer: () => void;
  onRevealPath: (node: FileNode) => void;
  onCopyPath: (node: FileNode, relative: boolean) => void;
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
  onOpenProblem: (diagnostic: Diagnostic) => void;
}

export interface LayoutAPI {
  element: HTMLElement;
  updateTree: (nodes: FileNode[]) => void;
  updateOutline: (nodes: OutlineNode[], available: boolean) => void;
  updateDiagnostics: (diagnostics: Diagnostic[]) => void;
  updateEditorRoot: (root: PaneNode, activePaneId: string) => Promise<void>;
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
  revealPosition: (
    paneId: string,
    line: number,
    column: number,
    endLine?: number,
    endColumn?: number
  ) => void;
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

  const sidebar = createSidebar(
    {
      onOpenFolder: callbacks.onOpenFolder,
      onFileClick: callbacks.onFileClick,
      onCreateFile: callbacks.onCreateFile,
      onCreateDirectory: callbacks.onCreateDirectory,
      onRename: callbacks.onRenamePath,
      onDelete: callbacks.onDeletePath,
      onDuplicate: callbacks.onDuplicatePath,
      onRefresh: callbacks.onRefreshExplorer,
      onReveal: callbacks.onRevealPath,
      onCopyPath: callbacks.onCopyPath,
    },
    (line, column) => revealPosition(currentActivePaneId, line, column)
  );
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
  terminalManager.element.classList.remove("h-48", "border-t", "border-tau-border", "hidden");
  terminalManager.element.classList.add("absolute", "inset-0");

  const problemsPanel = createProblemsPanel((diagnostic) =>
    callbacks.onOpenProblem(diagnostic)
  );
  problemsPanel.element.classList.add("absolute", "inset-0", "hidden");

  const bottomPanel = document.createElement("div");
  bottomPanel.className = "border-t border-tau-border bg-tau-bg hidden flex flex-col";
  const terminalHeight = Math.max(120, options.terminalHeight ?? 192);
  bottomPanel.style.height = `${terminalHeight}px`;

  const bottomTabs = document.createElement("div");
  bottomTabs.className =
    "h-8 bg-tau-panel border-b border-tau-border flex items-center px-3 gap-4 select-none shrink-0 text-xs uppercase tracking-wide";

  const problemsTabButton = document.createElement("button");
  problemsTabButton.textContent = "Problems";
  problemsTabButton.className = "py-1 border-b-2 border-transparent text-tau-muted hover:text-tau-fg";
  const terminalTabButton = document.createElement("button");
  terminalTabButton.textContent = "Terminal";
  terminalTabButton.className = "py-1 border-b-2 border-transparent text-tau-muted hover:text-tau-fg";

  bottomTabs.appendChild(problemsTabButton);
  bottomTabs.appendChild(terminalTabButton);

  const bottomBody = document.createElement("div");
  bottomBody.className = "flex-1 min-h-0 relative";
  bottomBody.appendChild(problemsPanel.element);
  bottomBody.appendChild(terminalManager.element);

  bottomPanel.appendChild(bottomTabs);
  bottomPanel.appendChild(bottomBody);

  let bottomView: "terminal" | "problems" = "terminal";
  let problemsForcedVisible = false;
  let lastTerminalBottomVisible = false;
  let lastDiagnosticsCount = 0;

  function recomputeBottomVisibility() {
    const visible = problemsForcedVisible || lastTerminalBottomVisible;
    bottomPanel.classList.toggle("hidden", !visible);
    terminalManager.setVisible(visible && bottomView === "terminal");
    problemsPanel.element.classList.toggle("hidden", !(visible && bottomView === "problems"));
    problemsTabButton.classList.toggle("text-tau-fg", bottomView === "problems");
    problemsTabButton.classList.toggle("border-tau-accent", bottomView === "problems");
    terminalTabButton.classList.toggle("text-tau-fg", bottomView === "terminal");
    terminalTabButton.classList.toggle("border-tau-accent", bottomView === "terminal");
  }

  function setBottomView(view: "terminal" | "problems") {
    bottomView = view;
    if (view === "problems") problemsForcedVisible = true;
    else problemsForcedVisible = false;
    recomputeBottomVisibility();
  }

  problemsTabButton.addEventListener("click", () => setBottomView("problems"));
  terminalTabButton.addEventListener("click", () => setBottomView("terminal"));
  recomputeBottomVisibility();

  const terminalResizer = createResizer({
    direction: "column",
    onChange(delta) {
      const next = Math.max(120, bottomPanel.offsetHeight + delta);
      bottomPanel.style.height = `${next}px`;
      callbacks.onTerminalResize(next);
      terminalManager.fitActive();
    },
  });

  mainArea.appendChild(editorContainer);
  mainArea.appendChild(terminalResizer.element);
  mainArea.appendChild(bottomPanel);

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
  let currentActivePaneId = "";
  const editorPanes = new Map<string, EditorPaneAPI>();
  let activeSplitPanes: SplitPaneAPI[] = [];

  // `monaco-editor` is heavy; the module is only fetched/evaluated lazily on
  // first pane creation so it doesn't block the initial app shell paint.
  let editorPaneModulePromise: Promise<typeof import("./EditorPane.js")> | null = null;
  function loadEditorPaneModule(): Promise<typeof import("./EditorPane.js")> {
    if (!editorPaneModulePromise) {
      editorPaneModulePromise = import("./EditorPane.js");
    }
    return editorPaneModulePromise;
  }

  async function getOrCreateEditorPane(pane: EditorPane): Promise<EditorPaneAPI> {
    let api = editorPanes.get(pane.id);
    if (!api) {
      const { createEditorPane } = await loadEditorPaneModule();
      // Another concurrent render may have created this pane while we
      // were awaiting the module import.
      api = editorPanes.get(pane.id);
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
    }
    return api;
  }

  async function renderPane(
    node: PaneNode,
    newSplitPanes: SplitPaneAPI[]
  ): Promise<HTMLElement> {
    if (node.type === "editor") {
      const api = await getOrCreateEditorPane(node);
      const tabs = node.tabs;
      const active = node.activeTab;
      api.updateTabs(tabs, active?.path ?? null);
      api.updateContent(active);
      return api.element;
    }

    const children = await Promise.all(
      node.children.map((child) => renderPane(child, newSplitPanes))
    );
    const split = createSplitPane(
      node.direction,
      children,
      node.children.map(() => 1)
    );
    newSplitPanes.push(split);
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

  let editorRootRenderVersion = 0;

  async function updateEditorRoot(root: PaneNode, activePaneId: string) {
    currentRoot = root;
    currentActivePaneId = activePaneId;
    cleanupRemovedPanes(root);
    const version = ++editorRootRenderVersion;
    const newSplitPanes: SplitPaneAPI[] = [];
    const rendered = await renderPane(root, newSplitPanes);
    // If another `updateEditorRoot` call started (and possibly finished)
    // while this one was awaiting the lazy editor module, discard this
    // stale render instead of clobbering the newer state.
    if (version !== editorRootRenderVersion) {
      for (const split of newSplitPanes) split.dispose();
      return;
    }
    for (const split of activeSplitPanes) split.dispose();
    activeSplitPanes = newSplitPanes;
    editorContainer.innerHTML = "";
    editorContainer.appendChild(rendered);
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
      lastTerminalBottomVisible = false;
      recomputeBottomVisibility();
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
    lastTerminalBottomVisible = state.bottomPanelVisible;
    if (state.bottomPanelVisible) bottomView = "terminal";
    recomputeBottomVisibility();
  }

  function updateDiagnostics(diagnostics: Diagnostic[]) {
    problemsPanel.update(diagnostics);
    lastDiagnosticsCount = diagnostics.length;
    problemsTabButton.textContent =
      lastDiagnosticsCount > 0 ? `Problems (${lastDiagnosticsCount})` : "Problems";
    if (lastDiagnosticsCount > 0 && !problemsForcedVisible && !lastTerminalBottomVisible) {
      bottomView = "problems";
      problemsForcedVisible = true;
      recomputeBottomVisibility();
    }
  }

  function getPaneContent(paneId: string): string {
    return editorPanes.get(paneId)?.getContent() ?? "";
  }

  function updateTree(nodes: FileNode[]) {
    sidebar.updateTree(nodes);
  }

  function updateOutline(nodes: OutlineNode[], available: boolean) {
    sidebar.updateOutline(nodes, available);
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

  function revealPosition(
    paneId: string,
    line: number,
    column: number,
    endLine?: number,
    endColumn?: number
  ) {
    editorPanes
      .get(paneId)
      ?.revealPosition(line, column, endLine, endColumn);
  }

  return {
    element: wrapper,
    updateTree,
    updateOutline,
    updateDiagnostics,
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
    revealPosition,
  };
}
