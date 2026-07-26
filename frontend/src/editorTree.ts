import type { PaneNode, EditorPane, SplitPane } from "./components/Layout.js";
import type { TabInfo } from "./components/Tabs.js";

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
    return isRoot
      ? { type: "editor", id: "pane-1", tabs: [], activeTabPath: null }
      : null;
  }
  if (children.length === 1) return children[0];
  return { type: "split", direction: node.direction, children };
}

export function pruneEmptyPanes(
  root: PaneNode,
  activePaneId: string
): { root: PaneNode; activePaneId: string } {
  const pruned = pruneNode(root, true);
  const newRoot: PaneNode =
    pruned ?? {
      type: "editor",
      id: "pane-1",
      tabs: [],
      activeTabPath: null,
    };
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
      source.tabs = source.tabs.filter((t) => t.path !== tab.path);
      if (source.activeTabPath === tab.path) {
        source.activeTabPath =
          source.tabs[source.tabs.length - 1]?.path ?? null;
      }
    }
  }

  const target = findPane(updated, targetPaneId);
  if (!target) return updated;

  if (!target.tabs.some((t) => t.path === tab.path)) {
    target.tabs.push({ ...tab });
  }
  target.activeTabPath = tab.path;
  return updated;
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
  pane.tabs = pane.tabs.filter((t) => t.path !== path);
  if (pane.activeTabPath === path) {
    pane.activeTabPath = pane.tabs[pane.tabs.length - 1]?.path ?? null;
  }
  if (keepEmptyPane) return { root, activePaneId };
  return pruneEmptyPanes(root, activePaneId);
}

export function activePane(
  root: PaneNode,
  activePaneId: string
): { pane: EditorPane; activePaneId: string } {
  const pane = findPane(root, activePaneId);
  if (pane) return { pane, activePaneId };
  const first = firstEditorPane(root);
  if (first) return { pane: first, activePaneId: first.id };
  const fallback = root as EditorPane;
  return { pane: fallback, activePaneId: fallback.id };
}
