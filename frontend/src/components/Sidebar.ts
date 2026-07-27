import { readDir, type FileNode, type RepoStatus, type FileStatusKind } from "../api.js";
import { setDrag, clearDrag } from "../dragState.js";
import { getFileIcon } from "../fileIcons.js";

export interface SidebarAPI {
  element: HTMLElement;
  updateTree: (nodes: FileNode[]) => void;
  updateGitStatus: (status: RepoStatus | null) => void;
}

const STATUS_LABEL: Record<FileStatusKind, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  conflicted: "C",
  type_changed: "T",
};

function badgeInfo(
  staged: FileStatusKind | null,
  unstaged: FileStatusKind | null
): { text: string; className: string } | null {
  const kind = unstaged ?? staged;
  if (!kind) return null;
  const isStagedOnly = !unstaged && !!staged;
  return {
    text: STATUS_LABEL[kind],
    className: isStagedOnly ? "text-green-400" : "text-tau-accent",
  };
}

/**
 * Build the sidebar / file explorer panel.
 * Directories are expanded lazily when clicked.
 */
export function createSidebar(
  onOpenFolder: () => void,
  onFileClick: (path: string, name: string) => void
): SidebarAPI {
  const sidebar = document.createElement("div");
  sidebar.className =
    "w-64 bg-tau-sidebar border-r border-tau-border flex flex-col select-none";

  const header = document.createElement("div");
  header.className =
    "px-4 py-2 text-xs uppercase tracking-wider text-tau-muted flex items-center justify-between";
  header.textContent = "Explorer";

  const openButton = document.createElement("button");
  openButton.textContent = "Open Folder";
  openButton.className = "text-tau-accent hover:text-tau-accent-hover";
  openButton.addEventListener("click", onOpenFolder);
  header.appendChild(openButton);

  const tree = document.createElement("div");
  tree.className = "flex-1 px-2 py-1 text-sm overflow-auto";

  sidebar.appendChild(header);
  sidebar.appendChild(tree);

  let currentStatus = new Map<string, { staged: FileStatusKind | null; unstaged: FileStatusKind | null }>();
  const badgeEls = new Map<string, HTMLElement>();
  // Tracks which directories are expanded so re-rendering the tree (e.g.
  // reopening the same folder) doesn't collapse everything the user had open.
  const expandedPaths = new Set<string>();

  function applyBadge(path: string, badge: HTMLElement) {
    const entry = currentStatus.get(path);
    const info = entry ? badgeInfo(entry.staged, entry.unstaged) : null;
    badge.textContent = info?.text ?? "";
    badge.className = `text-[10px] font-bold w-3 text-center shrink-0 ${info?.className ?? ""}`;
  }

  function renderDirectory(
    node: FileNode,
    depth: number,
    container: HTMLElement
  ) {
    const row = document.createElement("div");
    row.className =
      "py-1 px-2 hover:bg-tau-active-hover cursor-pointer flex items-center gap-1 whitespace-nowrap overflow-hidden text-ellipsis";
    row.style.paddingLeft = `${depth * 12 + 8}px`;
    row.title = node.path;

    const arrow = document.createElement("span");
    arrow.textContent = "▶";
    arrow.className = "w-4 inline-block text-center text-tau-muted text-[10px] transition-transform duration-150";

    const icon = document.createElement("span");
    icon.className = "shrink-0 w-5 h-5 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full";
    icon.innerHTML = getFileIcon(node.name, true, false);

    const name = document.createElement("span");
    name.textContent = node.name;

    row.appendChild(arrow);
    row.appendChild(icon);
    row.appendChild(name);

    const childrenContainer = document.createElement("div");
    childrenContainer.style.display = "none";

    let expanded = false;
    let loaded = false;

    function updateIcon() {
      icon.innerHTML = getFileIcon(node.name, true, expanded);
    }

    async function expand() {
      expanded = true;
      expandedPaths.add(node.path);
      updateIcon();
      arrow.style.transform = "rotate(90deg)";
      childrenContainer.style.display = "block";
      if (!loaded) {
        try {
          const children = await readDir(node.path);
          loaded = true;
          for (const child of children) {
            renderNode(child, depth + 1, childrenContainer);
          }
        } catch (err) {
          console.error("Failed to read directory:", err);
        }
      }
    }

    function collapse() {
      expanded = false;
      expandedPaths.delete(node.path);
      updateIcon();
      arrow.style.transform = "";
      childrenContainer.style.display = "none";
    }

    row.addEventListener("click", () => {
      if (expanded) collapse();
      else expand();
    });

    container.appendChild(row);
    container.appendChild(childrenContainer);

    if (expandedPaths.has(node.path)) {
      expand();
    }
  }

  function renderFile(node: FileNode, depth: number, container: HTMLElement) {
    const row = document.createElement("div");
    row.className =
      "py-1 px-2 hover:bg-tau-active-hover cursor-pointer flex items-center gap-2 whitespace-nowrap overflow-hidden text-ellipsis";
    row.style.paddingLeft = `${depth * 12 + 8}px`;
    row.title = node.path;
    row.innerHTML = "";
    const icon = document.createElement("span");
    icon.className = "shrink-0 w-5 h-5 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full";
    icon.innerHTML = getFileIcon(node.name, false, false);
    const name = document.createElement("span");
    name.textContent = node.name;
    name.className = "truncate flex-1";
    row.appendChild(icon);
    row.appendChild(name);

    const badge = document.createElement("span");
    badgeEls.set(node.path, badge);
    applyBadge(node.path, badge);
    row.appendChild(badge);

    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      const data = JSON.stringify({ path: node.path, name: node.name });
      setDrag({ kind: "file", data });
      e.dataTransfer?.setData("application/tau-file", data);
    });
    row.addEventListener("dragend", () => clearDrag());
    row.addEventListener("click", () => onFileClick(node.path, node.name));
    container.appendChild(row);
  }

  function renderNode(
    node: FileNode,
    depth: number,
    container: HTMLElement
  ) {
    if (node.is_dir) {
      renderDirectory(node, depth, container);
    } else {
      renderFile(node, depth, container);
    }
  }

  function updateTree(nodes: FileNode[]) {
    tree.innerHTML = "";
    badgeEls.clear();
    for (const node of nodes) {
      renderNode(node, 0, tree);
    }
  }

  function updateGitStatus(status: RepoStatus | null) {
    currentStatus = new Map(
      (status?.files ?? []).map((f) => [
        f.path,
        { staged: f.staged, unstaged: f.unstaged },
      ])
    );
    for (const [path, badge] of badgeEls) {
      applyBadge(path, badge);
    }
  }

  return { element: sidebar, updateTree, updateGitStatus };
}
