import { readDir, type FileNode } from "../api.js";
import { setDrag, clearDrag } from "../dragState.js";

export interface SidebarAPI {
  element: HTMLElement;
  updateTree: (nodes: FileNode[]) => void;
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
    icon.textContent = "📁";

    const name = document.createElement("span");
    name.textContent = node.name;

    row.appendChild(arrow);
    row.appendChild(icon);
    row.appendChild(name);

    const childrenContainer = document.createElement("div");
    childrenContainer.style.display = "none";

    let expanded = false;
    let loaded = false;

    row.addEventListener("click", async () => {
      expanded = !expanded;
      if (expanded) {
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
      } else {
        arrow.style.transform = "";
        childrenContainer.style.display = "none";
      }
    });

    container.appendChild(row);
    container.appendChild(childrenContainer);
  }

  function renderFile(node: FileNode, depth: number, container: HTMLElement) {
    const row = document.createElement("div");
    row.className =
      "py-1 px-2 hover:bg-tau-active-hover cursor-pointer flex items-center gap-2 whitespace-nowrap overflow-hidden text-ellipsis";
    row.style.paddingLeft = `${depth * 12 + 8}px`;
    row.title = node.path;
    row.textContent = `📄 ${node.name}`;
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
    for (const node of nodes) {
      renderNode(node, 0, tree);
    }
  }

  return { element: sidebar, updateTree };
}
