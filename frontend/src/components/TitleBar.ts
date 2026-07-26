import { getCurrentWindow } from "@tauri-apps/api/window";

export interface TitleBarAPI {
  element: HTMLElement;
}

/**
 * Render a custom title bar that blends with the app chrome.
 */
export function createTitleBar(): TitleBarAPI {
  const titleBar = document.createElement("div");
  titleBar.className =
    "h-8 bg-tau-bg flex items-center justify-between pl-[84px] pr-4 select-none cursor-default";
  titleBar.setAttribute("data-tauri-drag-region", "");

  let appWindow: ReturnType<typeof getCurrentWindow> | null = null;
  try {
    appWindow = getCurrentWindow();
  } catch {
    // Running outside Tauri (e.g. browser dev server).
  }
  titleBar.addEventListener("mousedown", () => {
    appWindow?.startDragging();
  });

  const left = document.createElement("div");
  left.className = "flex items-center gap-2";

  const title = document.createElement("span");
  title.className = "text-sm font-medium text-tau-fg";
  title.textContent = "Tau";

  left.appendChild(title);

  const right = document.createElement("div");
  right.className = "text-xs text-tau-muted";
  right.textContent = "editor";

  titleBar.appendChild(left);
  titleBar.appendChild(right);

  return { element: titleBar };
}
