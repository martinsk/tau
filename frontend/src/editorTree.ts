import type {
  PaneNode,
  EditorPane,
  EmptyEditorPane,
  ActiveEditorPane,
  SplitPane,
} from "./components/Layout.js";
import type { TabInfo } from "./components/Tabs.js";

function nonEmptyTabs(tabs: TabInfo[]): [TabInfo, ...TabInfo[]] {
  if (tabs.length === 0) {
    throw new Error("expected non-empty tabs");
  }
  return tabs as [TabInfo, ...TabInfo[]];
}

export function emptyEditorPane(id: string): EmptyEditorPane {
  return { type: "editor", id, tabs: [], activeTab: null };
}

export function addTab(pane: EditorPane, tab: TabInfo): ActiveEditorPane {
  return {
    type: "editor",
    id: pane.id,
    tabs: nonEmptyTabs([...pane.tabs.filter((t) => t.path !== tab.path), tab]),
    activeTab: tab,
  };
}

export function setActiveTabByPath(
  pane: EditorPane,
  path: string
): EditorPane {
  const existing = pane.tabs.find((t) => t.path === path);
  if (!existing) return pane;
  if (pane.activeTab === existing) return pane;
  return {
    type: "editor",
    id: pane.id,
    tabs: nonEmptyTabs(pane.tabs),
    activeTab: existing,
  };
}

export function removeTab(
  pane: EditorPane,
  path: string
): EditorPane {
  const tabs = pane.tabs.filter((t) => t.path !== path);
  if (tabs.length === 0) {
    return emptyEditorPane(pane.id);
  }
  const activeTab =
    pane.activeTab && pane.activeTab.path !== path
      ? pane.activeTab
      : tabs[tabs.length - 1];
  return {
    type: "editor",
    id: pane.id,
    tabs: nonEmptyTabs(tabs),
    activeTab,
  };
}

export function activeTabPath(pane: EditorPane): string | null {
  return pane.activeTab?.path ?? null;
}

export function findPane(root: PaneNode, id: string): EditorPane | null {
  if (root.type === "editor") return root.id === id ? root : null;
  for (const child of root.children) {
    const found = findPane(child, id);
    if (found) return found;
  }
  return null;
}

export function firstEditorPane(root: PaneNode): EditorPane | null {
  if (root.type === "editor") return root;
  for (const child of root.children) {
    const found = firstEditorPane(child);
    if (found) return found;
  }
  return null;
}

export function containsPane(root: PaneNode, id: string): boolean {
  if (root.type === "editor") return root.id === id;
  return root.children.some((child) => containsPane(child, id));
}

export function replacePane(
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

export function pruneNode(node: PaneNode, isRoot: boolean): PaneNode | null {
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
    return isRoot ? emptyEditorPane("pane-1") : null;
  }
  if (children.length === 1) return children[0];
  return { type: "split", direction: node.direction, children };
}

export function pruneEmptyPanes(
  root: PaneNode,
  activePaneId: string
): { root: PaneNode; activePaneId: string } {
  const pruned = pruneNode(root, true);
  const newRoot: PaneNode = pruned ?? emptyEditorPane("pane-1");
  const activeExists = findPane(newRoot, activePaneId) !== null;
  if (!activeExists) {
    const first = firstEditorPane(newRoot);
    if (first) activePaneId = first.id;
  }
  return { root: newRoot, activePaneId };
}

export function splitPane(
  root: PaneNode,
  paneId: string,
  direction: "row" | "column",
  newPane: EditorPane,
  side: "left" | "right" | "top" | "bottom"
): PaneNode {
  const targetPane = findPane(root, paneId);
  if (!targetPane) return root;

  const isNewPaneFirst = side === "left" || side === "top";
  return replacePane(root, paneId, {
    type: "split",
    direction,
    children: isNewPaneFirst ? [newPane, targetPane] : [targetPane, newPane],
  });
}

export function moveTabToPane(
  root: PaneNode,
  sourcePaneId: string | null | undefined,
  targetPaneId: string,
  tab: TabInfo
): PaneNode {
  let updated = root;

  if (sourcePaneId && sourcePaneId !== targetPaneId) {
    const source = findPane(updated, sourcePaneId);
    if (source) {
      updated = replacePane(updated, sourcePaneId, removeTab(source, tab.path));
    }
  }

  const target = findPane(updated, targetPaneId);
  if (!target) return updated;

  return replacePane(updated, targetPaneId, addTab(target, tab));
}

export function closeTab(
  root: PaneNode,
  paneId: string,
  path: string,
  activePaneId: string,
  keepEmptyPane?: boolean
): { root: PaneNode; activePaneId: string } {
  const pane = findPane(root, paneId);
  if (!pane) return { root, activePaneId };
  const updatedRoot = replacePane(root, paneId, removeTab(pane, path));
  if (keepEmptyPane) return { root: updatedRoot, activePaneId };
  return pruneEmptyPanes(updatedRoot, activePaneId);
}

export function activePane(
  root: PaneNode,
  activePaneId: string
): { pane: EditorPane; activePaneId: string } {
  const pane = findPane(root, activePaneId);
  if (pane) return { pane, activePaneId };
  const first = firstEditorPane(root);
  if (first) return { pane: first, activePaneId: first.id };
  const fallback = emptyEditorPane("pane-1");
  return { pane: fallback, activePaneId: fallback.id };
}
