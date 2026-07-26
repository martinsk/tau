import { describe, it, expect } from "vitest";
import {
  noTerminals,
  createTerminal,
  closeTerminal,
  switchTerminal,
  toggleTerminal,
  type TerminalState,
} from "./terminalState.js";

function expectOpen(state: TerminalState) {
  if (state.kind !== "terminalsOpen") {
    throw new Error("expected open terminal state");
  }
  return state;
}

describe("terminalState", () => {
  it("creates the first terminal from noTerminals", () => {
    const next = expectOpen(createTerminal(noTerminals, "t1", "Terminal 1", "/project"));
    expect(next.terminals).toHaveLength(1);
    expect(next.activeTerminalId).toBe("t1");
    expect(next.bottomPanelVisible).toBe(true);
  });

  it("appends a terminal to an open state", () => {
    const first = expectOpen(createTerminal(noTerminals, "t1", "Terminal 1", "/project"));
    const next = expectOpen(createTerminal(first, "t2", "Terminal 2", "/project"));
    expect(next.terminals).toHaveLength(2);
    expect(next.activeTerminalId).toBe("t2");
  });

  it("closes the active terminal and falls back to the last one", () => {
    let state = expectOpen(createTerminal(noTerminals, "t1", "Terminal 1", "/project"));
    state = expectOpen(createTerminal(state, "t2", "Terminal 2", "/project"));
    state = expectOpen(closeTerminal(state, "t2"));
    expect(state.terminals).toHaveLength(1);
    expect(state.activeTerminalId).toBe("t1");
  });

  it("closes the only terminal and returns noTerminals", () => {
    const state = expectOpen(createTerminal(noTerminals, "t1", "Terminal 1", "/project"));
    const next = closeTerminal(state, "t1");
    expect(next).toBe(noTerminals);
  });

  it("ignores close on noTerminals", () => {
    expect(closeTerminal(noTerminals, "t1")).toBe(noTerminals);
  });

  it("switches to a valid terminal", () => {
    let state = expectOpen(createTerminal(noTerminals, "t1", "Terminal 1", "/project"));
    state = expectOpen(createTerminal(state, "t2", "Terminal 2", "/project"));
    state = expectOpen(switchTerminal(state, "t1"));
    expect(state.activeTerminalId).toBe("t1");
    expect(state.bottomPanelVisible).toBe(true);
  });

  it("ignores switch to an unknown terminal", () => {
    const state = expectOpen(createTerminal(noTerminals, "t1", "Terminal 1", "/project"));
    const next = switchTerminal(state, "unknown");
    expect(expectOpen(next).activeTerminalId).toBe("t1");
  });

  it("ignores switch on noTerminals", () => {
    expect(switchTerminal(noTerminals, "t1")).toBe(noTerminals);
  });

  it("toggles visibility on an open state", () => {
    const state = expectOpen(createTerminal(noTerminals, "t1", "Terminal 1", "/project"));
    const hidden = expectOpen(toggleTerminal(state));
    expect(hidden.bottomPanelVisible).toBe(false);
    const shown = expectOpen(toggleTerminal(hidden));
    expect(shown.bottomPanelVisible).toBe(true);
  });

  it("ignores toggle on noTerminals", () => {
    expect(toggleTerminal(noTerminals)).toBe(noTerminals);
  });
});
