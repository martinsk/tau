export interface RecentFolderStore {
  getLastOpenedFolder(): string | null;
  setLastOpenedFolder(path: string | null): void;
  getRecentFolders(): string[];
  addRecentFolder(path: string): void;
}

export function createLocalRecentFolderStore(): RecentFolderStore {
  const LAST_KEY = "tau:last-opened-folder";
  const RECENT_KEY = "tau:recent-folders";
  const MAX_RECENT = 10;

  function readRecent(): string[] {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeRecent(recent: string[]) {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  }

  return {
    getLastOpenedFolder() {
      return localStorage.getItem(LAST_KEY);
    },
    setLastOpenedFolder(path) {
      if (path) {
        localStorage.setItem(LAST_KEY, path);
        this.addRecentFolder(path);
      } else {
        localStorage.removeItem(LAST_KEY);
      }
    },
    getRecentFolders() {
      return readRecent();
    },
    addRecentFolder(path) {
      const recent = readRecent();
      const updated = [path, ...recent.filter((p) => p !== path)].slice(
        0,
        MAX_RECENT
      );
      writeRecent(updated);
    },
  };
}
