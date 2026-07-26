export interface StatusBarAPI {
  element: HTMLElement;
  updatePath: (path: string) => void;
  updateBranch: (branch: string | null, ahead: number, behind: number) => void;
}

/**
 * Build the bottom status bar.
 * TODO: display real status information (cursor position, language mode, etc.).
 */
export function createStatusBar(): StatusBarAPI {
  const statusBar = document.createElement("div");
  statusBar.className =
    "h-6 bg-tau-bg border-t border-tau-border text-tau-muted text-xs flex items-center px-2 justify-between select-none";

  const leftGroup = document.createElement("div");
  leftGroup.className = "flex items-center gap-3 min-w-0";

  const left = document.createElement("span");
  left.textContent = "Tau";
  left.className = "text-tau-fg font-medium shrink-0";

  const branchEl = document.createElement("span");
  branchEl.className = "hidden items-center gap-1 truncate";

  leftGroup.appendChild(left);
  leftGroup.appendChild(branchEl);

  const right = document.createElement("span");
  right.textContent = "Ready";
  right.className = "truncate max-w-md";

  statusBar.appendChild(leftGroup);
  statusBar.appendChild(right);

  function updatePath(path: string) {
    right.textContent = path || "Ready";
  }

  function updateBranch(branch: string | null, ahead: number, behind: number) {
    if (!branch) {
      branchEl.classList.add("hidden");
      branchEl.classList.remove("flex");
      return;
    }
    const aheadBehind =
      ahead || behind ? ` ↑${ahead} ↓${behind}` : "";
    branchEl.textContent = `⎇ ${branch}${aheadBehind}`;
    branchEl.classList.remove("hidden");
    branchEl.classList.add("flex");
  }

  return { element: statusBar, updatePath, updateBranch };
}
