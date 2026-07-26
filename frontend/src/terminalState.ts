import type { TerminalInfo } from "./components/Layout.js";

export interface TerminalState {
  terminals: TerminalInfo[];
  activeTerminalId: string | null;
  bottomPanelVisible: boolean;
}

export function createTerminal(
  state: TerminalState,
  id: string,
  name: string,
  cwd: string
): TerminalState {
  return {
    ...state,
    terminals: [...state.terminals, { id, name, cwd }],
    activeTerminalId: id,
    bottomPanelVisible: true,
  };
}

export function closeTerminal(
  state: TerminalState,
  id: string
): TerminalState {
  const terminals = state.terminals.filter((t) => t.id !== id);
  let activeTerminalId = state.activeTerminalId;
  if (activeTerminalId === id) {
    activeTerminalId = terminals[terminals.length - 1]?.id ?? null;
  }
  return {
    ...state,
    terminals,
    activeTerminalId,
    bottomPanelVisible: terminals.length > 0 ? state.bottomPanelVisible : false,
  };
}

export function switchTerminal(
  state: TerminalState,
  id: string
): TerminalState {
  return {
    ...state,
    activeTerminalId: id,
    bottomPanelVisible: true,
  };
}

export function toggleTerminal(state: TerminalState): TerminalState {
  return {
    ...state,
    bottomPanelVisible:
      state.terminals.length === 0 ? state.bottomPanelVisible : !state.bottomPanelVisible,
  };
}
