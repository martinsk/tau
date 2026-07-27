export interface TabDiffInfo {
  staged: boolean;
  original: string;
  editable: boolean;
}

export interface TabInfo {
  path: string;
  name: string;
  content: string;
  dirty: boolean;
  diff?: TabDiffInfo;
}

export interface TabsAPI {
  element: HTMLElement;
  updateTabs: (tabs: TabInfo[], activePath: string | null) => void;
}

/**
 * Build the editor tab bar.
 */
export function createTabs(
  onTabClick: (path: string) => void,
  onTabClose: (path: string) => void
): TabsAPI {
  const tabs = document.createElement("div");
  tabs.className =
    "h-9 bg-tau-panel border-b border-tau-border flex items-center px-2 gap-1 select-none overflow-hidden";

  function updateTabs(tabList: TabInfo[], activePath: string | null) {
    tabs.innerHTML = "";
    for (const tab of tabList) {
      const isActive = tab.path === activePath;
      const el = document.createElement("div");
      el.className = `px-3 py-1 text-xs cursor-default flex items-center gap-2 border-t max-w-[200px] ${
        isActive
          ? "bg-tau-active border-tau-accent"
          : "border-transparent hover:bg-tau-active-hover"
      }`;
      el.title = tab.path;
      el.textContent = `${tab.dirty ? "• " : ""}${tab.name}`;

      el.addEventListener("click", () => onTabClick(tab.path));

      const close = document.createElement("span");
      close.textContent = "×";
      close.className = "ml-2 hover:text-tau-accent shrink-0";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        onTabClose(tab.path);
      });
      el.appendChild(close);

      tabs.appendChild(el);
    }
  }

  return { element: tabs, updateTabs };
}
