import {
  getCommands,
  isCommandEnabled,
  runCommand,
  type Command,
} from "../commands.js";
import { getKeymap, type KeybindingMode } from "../keymaps.js";

export interface CommandPaletteAPI {
  element: HTMLElement;
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
}

const CHORD_LABELS: Record<string, string> = {
  mod: "\u2318",
  shift: "\u21e7",
  alt: "\u2325",
  ctrl: "\u2303",
};

function formatChord(chord: string): string {
  return chord
    .split("+")
    .map((part) => CHORD_LABELS[part] ?? part.toUpperCase())
    .join(" ");
}

/**
 * Builds the command palette overlay. Populates its list from the global
 * command registry each time it opens, so newly-registered commands always
 * show up without any extra wiring.
 */
export function createCommandPalette(
  getKeybindingMode: () => KeybindingMode
): CommandPaletteAPI {
  const overlay = document.createElement("div");
  overlay.className =
    "fixed inset-0 z-50 hidden items-start justify-center bg-black/40 pt-24";

  const panel = document.createElement("div");
  panel.className =
    "w-full max-w-lg mx-4 bg-tau-panel border border-tau-border rounded-md shadow-2xl overflow-hidden";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type a command…";
  input.className =
    "w-full px-3 py-2 bg-tau-panel text-tau-fg placeholder-tau-muted border-b border-tau-border outline-none text-sm";

  const list = document.createElement("div");
  list.className = "max-h-80 overflow-y-auto py-1";

  panel.appendChild(input);
  panel.appendChild(list);
  overlay.appendChild(panel);

  let filtered: Command[] = [];
  let selectedIndex = 0;

  function itemEl(command: Command, index: number): HTMLElement {
    const row = document.createElement("div");
    const enabled = isCommandEnabled(command);
    row.className = `px-3 py-1.5 flex items-center justify-between gap-3 text-sm ${
      !enabled
        ? "text-tau-muted opacity-50 cursor-not-allowed"
        : index === selectedIndex
          ? "bg-tau-active text-tau-fg cursor-pointer"
          : "text-tau-fg hover:bg-tau-active-hover cursor-pointer"
    }`;

    const title = document.createElement("span");
    title.className = "truncate";
    title.textContent = command.title;
    row.appendChild(title);

    const binding = getKeymap(getKeybindingMode()).find(
      (b) => b.commandId === command.id
    );
    if (binding) {
      const chip = document.createElement("span");
      chip.className = "text-tau-muted text-xs shrink-0";
      chip.textContent = formatChord(binding.chord);
      row.appendChild(chip);
    }

    row.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (enabled) execute(command);
    });
    return row;
  }

  function render() {
    list.innerHTML = "";
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "px-3 py-2 text-sm text-tau-muted";
      empty.textContent = "No matching commands";
      list.appendChild(empty);
      return;
    }
    filtered.forEach((command, index) => {
      list.appendChild(itemEl(command, index));
    });
  }

  function applyFilter(query: string) {
    const q = query.trim().toLowerCase();
    const all = getCommands();
    filtered = q
      ? all.filter((c) => c.title.toLowerCase().includes(q))
      : all;
    selectedIndex = 0;
    render();
  }

  function execute(command: Command) {
    if (!isCommandEnabled(command)) return;
    close();
    void runCommand(command.id);
  }

  function open() {
    input.value = "";
    applyFilter("");
    overlay.classList.remove("hidden");
    overlay.classList.add("flex");
    input.focus();
  }

  function close() {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
  }

  function isOpen(): boolean {
    return !overlay.classList.contains("hidden");
  }

  input.addEventListener("input", () => applyFilter(input.value));

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length > 0) {
        selectedIndex = (selectedIndex + 1) % filtered.length;
        render();
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length > 0) {
        selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
        render();
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const command = filtered[selectedIndex];
      if (command) execute(command);
    }
  });

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });

  return { element: overlay, open, close, isOpen };
}
