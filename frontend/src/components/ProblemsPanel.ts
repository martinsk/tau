import type { Diagnostic, DiagnosticSeverity } from "../lsp.js";

export interface ProblemsPanelAPI {
  element: HTMLElement;
  update: (diagnostics: Diagnostic[]) => void;
}

const SEVERITY_ORDER: Record<DiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
};

const SEVERITY_ICON: Record<DiagnosticSeverity, string> = {
  error: "●",
  warning: "▲",
  info: "ⓘ",
  hint: "·",
};

const SEVERITY_CLASS: Record<DiagnosticSeverity, string> = {
  error: "text-red-400",
  warning: "text-yellow-400",
  info: "text-tau-accent",
  hint: "text-tau-muted",
};

/**
 * Build the "Problems" panel: a flat list of LSP diagnostics grouped by file,
 * shown in the bottom drawer. Clicking a diagnostic opens the file and jumps
 * to its location.
 */
export function createProblemsPanel(
  onOpenDiagnostic: (diagnostic: Diagnostic) => void
): ProblemsPanelAPI {
  const container = document.createElement("div");
  container.className = "flex-1 min-w-0 min-h-0 bg-tau-bg overflow-auto text-sm";

  function update(diagnostics: Diagnostic[]) {
    container.innerHTML = "";

    if (diagnostics.length === 0) {
      const empty = document.createElement("div");
      empty.className = "px-3 py-2 text-xs text-tau-muted italic";
      empty.textContent = "No problems detected.";
      container.appendChild(empty);
      return;
    }

    const byPath = new Map<string, Diagnostic[]>();
    for (const d of diagnostics) {
      const list = byPath.get(d.path) ?? [];
      list.push(d);
      byPath.set(d.path, list);
    }

    for (const [path, items] of byPath) {
      items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.line - b.line);

      const group = document.createElement("div");

      const header = document.createElement("div");
      header.className =
        "px-3 py-1 text-xs text-tau-muted truncate sticky top-0 bg-tau-bg";
      header.title = path;
      header.textContent = `${path.split("/").pop()} — ${path}`;
      group.appendChild(header);

      for (const d of items) {
        const row = document.createElement("button");
        row.type = "button";
        row.className =
          "w-full px-4 py-1.5 flex items-start gap-2 text-left bg-transparent border-0 text-tau-fg hover:bg-tau-active-hover focus:outline-none focus:ring-1 focus:ring-inset focus:ring-tau-accent cursor-pointer";
        row.title = `Go to ${path}, line ${d.line}, column ${d.column}: ${d.message}`;

        const icon = document.createElement("span");
        icon.textContent = SEVERITY_ICON[d.severity];
        icon.className = `shrink-0 ${SEVERITY_CLASS[d.severity]}`;
        row.appendChild(icon);

        const severity = document.createElement("span");
        severity.className = `shrink-0 w-14 text-[10px] font-semibold uppercase tracking-wide ${SEVERITY_CLASS[d.severity]}`;
        severity.textContent = d.severity;
        row.appendChild(severity);

        const message = document.createElement("span");
        message.className = "flex-1 min-w-0 whitespace-normal break-words";
        message.textContent = d.message;
        row.appendChild(message);

        if (d.source) {
          const source = document.createElement("span");
          source.className = "shrink-0 text-tau-muted text-xs";
          source.textContent = d.source;
          row.appendChild(source);
        }

        const location = document.createElement("span");
        location.className = "shrink-0 text-tau-accent text-xs tabular-nums";
        location.textContent = `Line ${d.line}, Col ${d.column}`;
        row.appendChild(location);

        row.addEventListener("click", () => onOpenDiagnostic(d));
        group.appendChild(row);
      }

      container.appendChild(group);
    }
  }

  update([]);

  return { element: container, update };
}
