import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { createTerminal, terminalInput, terminalResize } from "../api.js";
import { listen } from "@tauri-apps/api/event";

import "xterm/css/xterm.css";

export interface TerminalAPI {
  element: HTMLElement;
  fit: () => void;
  dispose: () => void;
}

export async function createTerminalPane(
  id: string,
  cwd: string,
  shell?: string
): Promise<TerminalAPI> {
  const container = document.createElement("div");
  container.className = "flex-1 min-w-0 min-h-0 bg-tau-bg p-1";

  const term = new XTerm({
    cursorBlink: true,
    theme: {
      background: "#1b1b1f",
      foreground: "#d7d7d9",
      cursor: "#c69c6d",
      selectionBackground: "#3a3a40",
    },
    fontFamily: "Menlo, Monaco, 'Courier New', monospace",
    fontSize: 13,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);

  term.onData((data: string) => {
    terminalInput(id, data).catch(console.error);
  });

  const unlisten = await listen<{ id: string; data: string }>(
    "terminal-output",
    (event) => {
      if (event.payload.id === id) {
        term.write(event.payload.data);
      }
    }
  );

  container.addEventListener("remove", () => {
    unlisten();
    term.dispose();
  });

  await createTerminal(id, cwd, shell);

  function fit() {
    fitAddon.fit();
    const dims = fitAddon.proposeDimensions();
    if (dims) {
      terminalResize(id, dims.cols, dims.rows).catch(console.error);
    }
  }

  if (container.offsetParent) {
    fit();
  }

  function dispose() {
    unlisten();
    term.dispose();
  }

  return { element: container, fit, dispose };
}
