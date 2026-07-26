export interface StatusBarAPI {
  element: HTMLElement;
  updatePath: (path: string) => void;
}

/**
 * Build the bottom status bar.
 * TODO: display real status information (cursor position, language mode, etc.).
 */
export function createStatusBar(): StatusBarAPI {
  const statusBar = document.createElement("div");
  statusBar.className =
    "h-6 bg-tau-bg border-t border-tau-border text-tau-muted text-xs flex items-center px-2 justify-between select-none";

  const left = document.createElement("span");
  left.textContent = "Tau";
  left.className = "text-tau-fg font-medium";

  const right = document.createElement("span");
  right.textContent = "Ready";
  right.className = "truncate max-w-md";

  statusBar.appendChild(left);
  statusBar.appendChild(right);

  function updatePath(path: string) {
    right.textContent = path || "Ready";
  }

  return { element: statusBar, updatePath };
}
