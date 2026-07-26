import { createTerminalPane, type TerminalAPI } from "./Terminal.js";
import {
  harnessPresets,
  parseArgs,
  type HarnessConfig,
  validateHarness,
} from "../agentConfig.js";
import { stopAgentSession } from "../api.js";

export interface AgentPanelCallbacks {
  onStart: (config: HarnessConfig) => void;
  onStop: () => void;
  onConfigChange: (config: HarnessConfig) => void;
}

export interface AgentPanelAPI {
  element: HTMLElement;
  updateWorkspace: (rootPath: string | null) => void;
  updateConfig: (config: HarnessConfig) => void;
  updateSession: (sessionId: string | null, cwd: string | null) => Promise<void>;
  dispose: () => Promise<void>;
}

export function createAgentPanel(callbacks: AgentPanelCallbacks): AgentPanelAPI {
  const panel = document.createElement("aside");
  panel.className = "h-full w-full min-w-0 bg-tau-sidebar border-l border-tau-border flex flex-col";

  const header = document.createElement("div");
  header.className = "h-10 px-3 border-b border-tau-border flex items-center justify-between shrink-0";
  const title = document.createElement("span");
  title.className = "text-xs uppercase tracking-wider text-tau-muted";
  title.textContent = "Agent";
  const status = document.createElement("span");
  status.className = "text-[10px] text-tau-muted";
  status.textContent = "Idle";
  header.append(title, status);

  const controls = document.createElement("div");
  controls.className = "p-3 border-b border-tau-border space-y-2";
  const select = document.createElement("select");
  select.className = "w-full bg-tau-panel border border-tau-border rounded px-2 py-1.5 text-sm text-tau-fg";
  for (const preset of harnessPresets) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    select.appendChild(option);
  }
  const program = document.createElement("input");
  program.className = "w-full bg-tau-panel border border-tau-border rounded px-2 py-1.5 text-sm text-tau-fg";
  program.placeholder = "Executable";
  const args = document.createElement("input");
  args.className = "w-full bg-tau-panel border border-tau-border rounded px-2 py-1.5 text-sm text-tau-fg";
  args.placeholder = 'Arguments, e.g. ["--flag"]';
  const error = document.createElement("div");
  error.className = "text-xs text-red-400 hidden";
  const actions = document.createElement("div");
  actions.className = "flex gap-2";
  const start = document.createElement("button");
  start.className = "flex-1 rounded bg-tau-accent text-tau-bg px-2 py-1.5 text-sm font-medium hover:bg-tau-accent-hover";
  start.textContent = "Start";
  const stop = document.createElement("button");
  stop.className = "rounded border border-tau-border px-2 py-1.5 text-sm text-tau-muted hover:bg-tau-active-hover disabled:opacity-50";
  stop.textContent = "Stop";
  stop.disabled = true;
  actions.append(start, stop);
  controls.append(select, program, args, error, actions);

  const terminalHost = document.createElement("div");
  terminalHost.className = "flex-1 min-h-0 relative";
  const empty = document.createElement("div");
  empty.className = "absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-tau-muted";
  empty.textContent = "Start a locally authenticated coding harness in this workspace.";
  terminalHost.appendChild(empty);
  panel.append(header, controls, terminalHost);

  let workspace: string | null = null;
  let currentConfig: HarnessConfig = harnessPresets[0];
  let terminal: TerminalAPI | null = null;
  let activeSessionId: string | null = null;

  function displayConfig(config: HarnessConfig) {
    currentConfig = config;
    select.value = harnessPresets.some((preset) => preset.id === config.id)
      ? config.id
      : "custom";
    program.value = config.program;
    args.value = JSON.stringify(config.args);
  }

  function showError(message: string | null) {
    error.textContent = message ?? "";
    error.classList.toggle("hidden", !message);
  }

  function configFromInputs(): HarnessConfig | null {
    try {
      const selected = harnessPresets.find((preset) => preset.id === select.value) ?? harnessPresets[3];
      const config = {
        id: selected.id,
        label: selected.label,
        program: program.value.trim(),
        args: parseArgs(args.value),
      };
      const issue = validateHarness(config);
      if (issue) {
        showError(issue);
        return null;
      }
      showError(null);
      return config;
    } catch (err) {
      showError(err instanceof Error ? err.message : "Invalid harness arguments.");
      return null;
    }
  }

  select.addEventListener("change", () => {
    const preset = harnessPresets.find((entry) => entry.id === select.value) ?? harnessPresets[3];
    program.value = preset.program;
    args.value = JSON.stringify(preset.args);
    const config = configFromInputs();
    if (config) callbacks.onConfigChange(config);
  });
  for (const input of [program, args]) {
    input.addEventListener("change", () => {
      const config = configFromInputs();
      if (config) callbacks.onConfigChange(config);
    });
  }
  start.addEventListener("click", () => {
    if (!workspace) {
      showError("Open a workspace before starting an agent.");
      return;
    }
    const config = configFromInputs();
    if (config) callbacks.onStart(config);
  });
  stop.addEventListener("click", () => callbacks.onStop());

  async function updateSession(sessionId: string | null, cwd: string | null) {
    if (activeSessionId === sessionId) return;
    const previousSessionId = activeSessionId;
    if (previousSessionId) await stopAgentSession(previousSessionId).catch(console.error);
    if (terminal) {
      terminal.element.remove();
      terminal.dispose();
      terminal = null;
    }
    activeSessionId = sessionId;
    empty.classList.toggle("hidden", !!sessionId);
    stop.disabled = !sessionId;
    start.disabled = !!sessionId;
    status.textContent = sessionId ? "Running" : "Idle";
    if (!sessionId || !cwd) return;
    terminal = await createTerminalPane(sessionId, cwd, undefined, {
      program: currentConfig.program,
      args: currentConfig.args,
      agent: true,
    });
    terminal.element.style.cssText = "position: absolute; inset: 0;";
    terminalHost.appendChild(terminal.element);
    terminal.fit();
  }

  async function dispose() {
    const sessionId = activeSessionId;
    activeSessionId = null;
    if (terminal) {
      terminal.element.remove();
      terminal.dispose();
      terminal = null;
    }
    if (sessionId) await stopAgentSession(sessionId).catch(console.error);
  }

  displayConfig(currentConfig);
  return {
    element: panel,
    updateWorkspace(rootPath) {
      workspace = rootPath;
    },
    updateConfig: displayConfig,
    updateSession,
    dispose,
  };
}
