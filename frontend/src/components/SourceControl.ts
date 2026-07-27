import type { RepoStatus, FileStatus, FileStatusKind } from "../api.js";

export interface SourceControlCallbacks {
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onCommit: (message: string) => void;
  onOpenFile: (path: string, staged: boolean) => void;
}

export interface SourceControlAPI {
  element: HTMLElement;
  update: (status: RepoStatus | null) => void;
  changeCount: () => number;
}

const KIND_LABEL: Record<FileStatusKind, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  conflicted: "C",
  type_changed: "T",
};

/**
 * Build the Source Control panel: branch/ahead-behind header, commit box,
 * staged/unstaged file lists, and an inline diff viewer.
 */
export function createSourceControl(
  callbacks: SourceControlCallbacks
): SourceControlAPI {
  const container = document.createElement("div");
  container.className = "h-full w-full flex flex-col bg-tau-sidebar hidden";

  const header = document.createElement("div");
  header.className = "px-3 py-2 border-b border-tau-border";

  const branchRow = document.createElement("div");
  branchRow.className = "flex items-center gap-1 text-xs text-tau-fg mb-2";
  const branchIcon = document.createElement("span");
  branchIcon.className = "text-tau-accent";
  branchIcon.textContent = "⎇";
  const branchLabel = document.createElement("span");
  branchLabel.className = "truncate";
  branchLabel.textContent = "No repository";
  branchRow.appendChild(branchIcon);
  branchRow.appendChild(branchLabel);
  header.appendChild(branchRow);

  const commitInput = document.createElement("textarea");
  commitInput.placeholder = "Commit message";
  commitInput.rows = 2;
  commitInput.className =
    "w-full resize-none bg-tau-panel border border-tau-border rounded px-2 py-1 text-xs text-tau-fg placeholder-tau-muted focus:outline-none focus:border-tau-accent";
  header.appendChild(commitInput);

  const commitButton = document.createElement("button");
  commitButton.textContent = "Commit";
  commitButton.className =
    "mt-2 w-full py-1 text-xs rounded bg-tau-accent text-tau-bg font-medium hover:bg-tau-accent-hover disabled:opacity-40 disabled:cursor-not-allowed";
  commitButton.disabled = true;
  commitButton.addEventListener("click", () => {
    const message = commitInput.value.trim();
    if (!message) return;
    callbacks.onCommit(message);
    commitInput.value = "";
    commitButton.disabled = true;
  });
  commitInput.addEventListener("input", () => {
    commitButton.disabled = commitInput.value.trim().length === 0;
  });
  header.appendChild(commitButton);

  container.appendChild(header);

  const lists = document.createElement("div");
  lists.className = "flex-1 overflow-auto text-sm";
  container.appendChild(lists);

  let currentStatus: RepoStatus | null = null;

  function renderFileRow(status: FileStatus, staged: boolean): HTMLElement {
    const row = document.createElement("div");
    row.className =
      "flex items-center gap-2 px-3 py-1 hover:bg-tau-active-hover cursor-pointer group";

    const name = document.createElement("span");
    name.className = "flex-1 truncate";
    name.textContent = status.path.split("/").pop() ?? status.path;
    name.title = status.path;

    const kind = staged ? status.staged : status.unstaged;
    const badge = document.createElement("span");
    badge.className = `text-[10px] font-bold w-4 text-center shrink-0 ${
      staged ? "text-green-400" : "text-tau-accent"
    }`;
    badge.textContent = kind ? KIND_LABEL[kind] : "";

    const actionButton = document.createElement("button");
    actionButton.className =
      "opacity-0 group-hover:opacity-100 text-tau-muted hover:text-tau-accent text-xs px-1 shrink-0";
    actionButton.textContent = staged ? "−" : "+";
    actionButton.title = staged ? "Unstage" : "Stage";
    actionButton.addEventListener("click", (e) => {
      e.stopPropagation();
      if (staged) callbacks.onUnstage(status.path);
      else callbacks.onStage(status.path);
    });

    row.addEventListener("click", () => callbacks.onOpenFile(status.path, staged));

    row.appendChild(name);
    row.appendChild(badge);
    row.appendChild(actionButton);
    return row;
  }

  function renderSection(
    title: string,
    files: FileStatus[],
    staged: boolean
  ): HTMLElement | null {
    if (files.length === 0) return null;
    const section = document.createElement("div");
    const heading = document.createElement("div");
    heading.className =
      "px-3 py-1 text-[10px] uppercase tracking-wider text-tau-muted";
    heading.textContent = `${title} (${files.length})`;
    section.appendChild(heading);
    for (const file of files) {
      section.appendChild(renderFileRow(file, staged));
    }
    return section;
  }

  function update(status: RepoStatus | null) {
    currentStatus = status;
    lists.innerHTML = "";

    if (!status || !status.is_repo) {
      branchLabel.textContent = "Not a Git repository";
      commitInput.disabled = true;
      commitButton.disabled = true;
      return;
    }

    commitInput.disabled = false;
    const aheadBehind =
      status.ahead || status.behind
        ? ` ↑${status.ahead} ↓${status.behind}`
        : "";
    branchLabel.textContent = `${status.branch ?? "detached HEAD"}${aheadBehind}`;

    const staged = status.files.filter((f) => f.staged);
    const unstaged = status.files.filter((f) => f.unstaged);

    const stagedSection = renderSection("Staged Changes", staged, true);
    const unstagedSection = renderSection("Changes", unstaged, false);
    if (stagedSection) lists.appendChild(stagedSection);
    if (unstagedSection) lists.appendChild(unstagedSection);

    if (staged.length === 0 && unstaged.length === 0) {
      const empty = document.createElement("div");
      empty.className = "px-3 py-4 text-xs text-tau-muted text-center";
      empty.textContent = "No changes";
      lists.appendChild(empty);
    }

    commitButton.disabled = commitInput.value.trim().length === 0;
  }

  function changeCount(): number {
    return currentStatus?.files.length ?? 0;
  }

  return { element: container, update, changeCount };
}
