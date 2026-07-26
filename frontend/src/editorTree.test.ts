import { describe, it, expect } from "vitest";
import {
  findPane,
  replacePane,
  pruneEmptyPanes,
  splitPane,
  moveTabToPane,
  activePane,
  emptyEditorPane,
  addTab,
  activeTabPath,
} from "./editorTree.js";
import type { EditorPane, PaneNode } from "./components/Layout.js";

function editor(id: string, paths: string[]): EditorPane {
  return paths.reduce<EditorPane>(
    (pane, path) => addTab(pane, { path, name: path, content: "", dirty: false }),
    emptyEditorPane(id)
  );
}

function split(direction: "row" | "column", children: PaneNode[]): PaneNode {
  return { type: "split", direction, children };
}

describe("editorTree", () => {
  it("finds a nested pane", () => {
    const root = split("row", [editor("a", []), editor("b", ["x"])]);
    expect(findPane(root, "b")?.id).toBe("b");
    expect(findPane(root, "c")).toBeNull();
  });

  it("replaces a pane and keeps structure", () => {
    const root = split("row", [editor("a", []), editor("b", [])]);
    const next = replacePane(root, "b", editor("c", []));
    expect(findPane(next, "c")).not.toBeNull();
    expect(findPane(next, "b")).toBeNull();
  });

  it("prunes empty panes after a tab close", () => {
    const root = split("row", [editor("a", ["x"]), editor("b", [])]);
    const next = pruneEmptyPanes(root, "a");
    expect(findPane(next.root, "b")).toBeNull();
    expect(findPane(next.root, "a")).not.toBeNull();
  });

  it("splits a pane and focuses the new one", () => {
    const root = editor("a", ["x"]);
    const next = splitPane(root, "a", "row", editor("b", []), "right");
    expect(findPane(next, "b")).not.toBeNull();
    expect(next.type).toBe("split");
  });

  it("moves a tab between panes", () => {
    const root: PaneNode = split("row", [
      editor("a", ["x"]),
      editor("b", ["y"]),
    ]);
    const tab = { path: "x", name: "x", content: "", dirty: false };
    const next = moveTabToPane(root, "a", "b", tab);
    expect(findPane(next, "a")?.tabs).toHaveLength(0);
    expect(findPane(next, "b")?.tabs.map((t) => t.path)).toContain("x");
  });

  it("falls back to the first pane when active pane is missing", () => {
    const root = editor("a", ["x"]);
    const result = activePane(root, "missing");
    expect(result.pane.id).toBe("a");
    expect(result.activePaneId).toBe("a");
  });

  it("adds a tab and sets it active", () => {
    const pane = editor("a", ["x"]);
    const next = addTab(pane, { path: "y", name: "y", content: "", dirty: false });
    expect(next.tabs.map((t) => t.path)).toEqual(["x", "y"]);
    expect(activeTabPath(next)).toBe("y");
  });

  it("deduplicates tabs when adding a tab that already exists", () => {
    const pane = editor("a", ["x", "y"]);
    const next = addTab(pane, { path: "x", name: "x", content: "", dirty: false });
    expect(next.tabs.map((t) => t.path)).toEqual(["y", "x"]);
    expect(activeTabPath(next)).toBe("x");
  });
});
