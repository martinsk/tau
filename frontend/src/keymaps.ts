/**
 * Keybinding-mode infrastructure: translates KeyboardEvents into a
 * normalized "chord" string and maps chords to command ids for each
 * supported keybinding mode.
 *
 * Chord format: modifiers joined with "+", followed by the key, e.g.
 * "mod+s", "mod+shift+p", "ctrl+`". "mod" means the Cmd key (metaKey) and
 * is kept distinct from "ctrl" (the literal Control key) so that Emacs-style
 * C- chords (which always use literal Control) never collide with Cmd-based
 * shortcuts, even on mac where CmdOrCtrl accelerators normally resolve to Cmd.
 */
export type KeybindingMode = "default" | "emacs" | "vim";

export interface KeyBinding {
  chord: string;
  commandId: string;
}

const IGNORED_KEYS = new Set(["control", "meta", "shift", "alt", "os"]);

export function chordFromEvent(e: KeyboardEvent): string | null {
  let key = e.key.toLowerCase();
  if (IGNORED_KEYS.has(key)) return null;
  if (key === " ") key = "space";

  const parts: string[] = [];
  if (e.metaKey) parts.push("mod");
  if (e.ctrlKey) parts.push("ctrl");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  parts.push(key);
  return parts.join("+");
}

/**
 * Base keymap shared by "default" and (for now) "vim" modes. Vim mode will
 * eventually layer modal editing on top of this via monaco-vim; until then
 * it falls back to the same chords as "default".
 */
export const DEFAULT_KEYMAP: KeyBinding[] = [
  { chord: "mod+shift+p", commandId: "commandPalette.open" },
  { chord: "mod+s", commandId: "file.save" },
  { chord: "mod+shift+o", commandId: "file.openFolder" },
  { chord: "mod+w", commandId: "tab.close" },
  { chord: "mod+2", commandId: "view.splitHorizontal" },
  { chord: "mod+3", commandId: "view.splitVertical" },
  { chord: "ctrl+`", commandId: "terminal.toggle" },
  { chord: "ctrl+shift+`", commandId: "terminal.new" },
  { chord: "ctrl+shift+k", commandId: "terminal.kill" },
  { chord: "mod+shift+a", commandId: "agent.toggle" },
  { chord: "mod+shift+b", commandId: "task.runBuild" },
  { chord: "mod+shift+t", commandId: "task.runTest" },
  { chord: "mod+b", commandId: "sidebar.toggle" },
  { chord: "mod+shift+e", commandId: "view.focusExplorer" },
  { chord: "mod+shift+g", commandId: "view.focusSourceControl" },
  { chord: "mod+alt+]", commandId: "pane.focusNext" },
  { chord: "mod+alt+[", commandId: "pane.focusPrevious" },
];

/**
 * Emacs mode: currently only overrides how the command palette is opened
 * (M-x, mapped to Cmd+X per user preference) so `Cmd+X` no longer performs a
 * browser/editor "cut" while this mode is active. Everything else falls
 * back to the default keymap for now.
 *
 * Follow-up work (not yet implemented): C-a/C-e (line start/end), C-k
 * (kill-line), C-y (yank), C-w (kill-region/cut), M-w (copy), C-space
 * (set-mark), C-x C-s (save), C-g (cancel).
 */
export const EMACS_KEYMAP: KeyBinding[] = [
  ...DEFAULT_KEYMAP,
  { chord: "mod+x", commandId: "commandPalette.open" },
];

/**
 * Vim mode stub: chords are identical to the default keymap. Full modal
 * editing (via the `monaco-vim` integration) is deferred to a later phase.
 */
export const VIM_KEYMAP: KeyBinding[] = DEFAULT_KEYMAP;

export function getKeymap(mode: KeybindingMode): KeyBinding[] {
  switch (mode) {
    case "emacs":
      return EMACS_KEYMAP;
    case "vim":
      return VIM_KEYMAP;
    default:
      return DEFAULT_KEYMAP;
  }
}

export function findBinding(
  mode: KeybindingMode,
  chord: string
): KeyBinding | undefined {
  return getKeymap(mode).find((b) => b.chord === chord);
}
