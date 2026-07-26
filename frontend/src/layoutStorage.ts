import type { PaneNode } from "./components/Layout.js";
import type { TerminalInfo } from "./components/Layout.js";

export interface SavedLayout {
  editorRoot: PaneNode;
  activePaneId: string;
  bottomPanelVisible: boolean;
  terminals: TerminalInfo[];
  activeTerminalId: string | null;
  sidebarWidth?: number;
  terminalHeight?: number;
}

export interface LayoutStorage {
  save(rootPath: string, layout: SavedLayout): void;
  load(rootPath: string): SavedLayout | null;
}

export function createLocalLayoutStorage(): LayoutStorage {
  const key = (rootPath: string) => `tau-layout:${rootPath}`;

  return {
    save(rootPath, layout) {
      localStorage.setItem(key(rootPath), JSON.stringify(layout));
    },
    load(rootPath) {
      const raw = localStorage.getItem(key(rootPath));
      if (!raw) return null;
      try {
        return JSON.parse(raw) as SavedLayout;
      } catch {
        return null;
      }
    },
  };
}

export function createInMemoryLayoutStorage(): LayoutStorage & {
  snapshot(): Record<string, SavedLayout>;
  reset(): void;
} {
  const store: Record<string, SavedLayout> = {};

  return {
    save(rootPath, layout) {
      store[rootPath] = JSON.parse(JSON.stringify(layout));
    },
    load(rootPath) {
      const value = store[rootPath];
      return value ? JSON.parse(JSON.stringify(value)) : null;
    },
    snapshot() {
      return JSON.parse(JSON.stringify(store));
    },
    reset() {
      for (const key of Object.keys(store)) {
        delete store[key];
      }
    },
  };
}
