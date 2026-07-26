import { createTerminalPane, type TerminalAPI } from "./Terminal.js";
import { killTerminal } from "../api.js";

export interface TerminalInfo {
  id: string;
  name: string;
  cwd: string;
}

export interface TerminalManagerCallbacks {
  onNewTerminal: () => void;
  onCloseTerminal: (id: string) => void;
  onSwitchTerminal: (id: string) => void;
}

export interface TerminalManagerAPI {
  element: HTMLElement;
  listTerminals: () => string[];
  addTerminal: (info: TerminalInfo) => Promise<void>;
  closeTerminal: (id: string) => Promise<void>;
  setActive: (id: string) => void;
  setVisible: (visible: boolean) => void;
  fitActive: () => void;
}

export function createTerminalManager(
  callbacks: TerminalManagerCallbacks
): TerminalManagerAPI {
  const container = document.createElement("div");
  container.className =
    "h-48 border-t border-tau-border bg-tau-bg hidden flex flex-col";

  const header = document.createElement("div");
  header.className =
    "h-8 bg-tau-panel border-b border-tau-border flex items-center px-2 select-none overflow-hidden gap-1";

  const tabsContainer = document.createElement("div");
  tabsContainer.className = "flex items-center gap-1 flex-1 min-w-0";

  const addButton = document.createElement("button");
  addButton.textContent = "+";
  addButton.className =
    "w-6 h-6 flex items-center justify-center text-tau-fg hover:bg-tau-active-hover rounded text-sm";
  addButton.title = "New Terminal";
  addButton.addEventListener("click", () => callbacks.onNewTerminal());

  header.appendChild(tabsContainer);
  header.appendChild(addButton);

  const body = document.createElement("div");
  body.className = "flex-1 min-h-0 relative";

  container.appendChild(header);
  container.appendChild(body);

  const terminals = new Map<string, { info: TerminalInfo; api: TerminalAPI }>();
  let activeId: string | null = null;

  function renderTabs() {
    tabsContainer.innerHTML = "";
    for (const [id, { info }] of terminals) {
      const tab = document.createElement("div");
      const isActive = id === activeId;
      tab.className = `flex items-center gap-1 px-2 py-1 text-xs rounded cursor-default max-w-[120px] ${
        isActive
          ? "bg-tau-active text-tau-fg"
          : "text-tau-muted hover:bg-tau-active-hover"
      }`;

      const label = document.createElement("span");
      label.textContent = info.name;
      label.className = "truncate flex-1 select-none";
      tab.appendChild(label);

      const close = document.createElement("span");
      close.textContent = "×";
      close.className =
        "hover:text-tau-accent shrink-0 text-[10px] leading-none px-1";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        callbacks.onCloseTerminal(id);
      });
      tab.appendChild(close);

      tab.addEventListener("click", () => callbacks.onSwitchTerminal(id));
      tabsContainer.appendChild(tab);
    }
  }

  async function addTerminal(info: TerminalInfo) {
    try {
      const api = await createTerminalPane(info.id, info.cwd);
      api.element.style.cssText =
        "position: absolute; inset: 0; display: none;";
      body.appendChild(api.element);
      terminals.set(info.id, { info, api });
      renderTabs();
    } catch (err) {
      console.error("Failed to create terminal:", err);
    }
  }

  function setActive(id: string) {
    if (!terminals.has(id)) return;
    activeId = id;
    for (const [tid, { api }] of terminals) {
      api.element.style.display = tid === id ? "block" : "none";
    }
    renderTabs();
    fitActive();
  }

  function fitActive() {
    if (activeId) {
      const active = terminals.get(activeId);
      if (active) active.api.fit();
    }
  }

  async function closeTerminal(id: string) {
    const entry = terminals.get(id);
    if (!entry) return;
    terminals.delete(id);
    entry.api.element.remove();
    entry.api.dispose();
    try {
      await killTerminal(id);
    } catch (err) {
      console.error("Failed to kill terminal:", err);
    }
    if (activeId === id) {
      const next = terminals.keys().next().value as string | undefined;
      activeId = next ?? null;
      if (activeId) setActive(activeId);
    }
    renderTabs();
  }

  function setVisible(visible: boolean) {
    container.classList.toggle("hidden", !visible);
    if (visible) fitActive();
  }

  window.addEventListener("resize", () => {
    if (!container.classList.contains("hidden")) {
      fitActive();
    }
  });

  return {
    element: container,
    listTerminals: () => Array.from(terminals.keys()),
    addTerminal,
    closeTerminal,
    setActive,
    setVisible,
    fitActive,
  };
}
