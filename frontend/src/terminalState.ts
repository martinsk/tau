import type { TerminalInfo, TerminalState } from "./components/Layout.js";

export type { TerminalState } from "./components/Layout.js";

export const noTerminals: TerminalState = {
  kind: "noTerminals",
  terminals: [],
  bottomPanelVisible: false,
};

export function createTerminal(
  state: TerminalState,
  id: string,
  name: string,
  cwd: string
): TerminalState {
  const terminal: TerminalInfo = { id, name, cwd };
  if (state.kind === "noTerminals") {
    return {
      kind: "terminalsOpen",
      terminals: [terminal],
      activeTerminalId: id,
      bottomPanelVisible: true,
    };
  }
  return {
    kind: "terminalsOpen",
    terminals: [...state.terminals, terminal],
    activeTerminalId: id,
    bottomPanelVisible: true,
  };
}

export function closeTerminal(state: TerminalState, id: string): TerminalState {
  if (state.kind === "noTerminals") {
    return state;
  }

  const terminals = state.terminals.filter((t) => t.id !== id);
  if (terminals.length === 0) {
    return noTerminals;
  }

  const activeTerminalId =
    state.activeTerminalId === id
      ? terminals[terminals.length - 1].id
      : state.activeTerminalId;

  return {
    kind: "terminalsOpen",
    terminals: terminals as [TerminalInfo, ...TerminalInfo[]],
    activeTerminalId,
    bottomPanelVisible: state.bottomPanelVisible,
  };
}

export function switchTerminal(state: TerminalState, id: string): TerminalState {
  if (state.kind === "noTerminals") {
    return state;
  }
  if (!state.terminals.some((t) => t.id === id)) {
    return state;
  }
  return {
    ...state,
    activeTerminalId: id,
    bottomPanelVisible: true,
  };
}

export function toggleTerminal(state: TerminalState): TerminalState {
  if (state.kind === "noTerminals") {
    return state;
  }
  return {
    ...state,
    bottomPanelVisible: !state.bottomPanelVisible,
  };
}
