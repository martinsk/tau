export interface HarnessConfig {
  id: string;
  label: string;
  program: string;
  args: string[];
}

export interface ProjectAgentConfig {
  harness?: string;
  program?: string;
  args?: string[];
}

export const harnessPresets: HarnessConfig[] = [
  { id: "claude", label: "Claude Code", program: "claude", args: [] },
  { id: "codex", label: "Codex CLI", program: "codex", args: [] },
  { id: "aider", label: "Aider", program: "aider", args: [] },
  { id: "custom", label: "Custom command", program: "", args: [] },
];

export function parseArgs(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || !parsed.every((arg) => typeof arg === "string")) {
      throw new Error("Arguments must be a JSON array of strings");
    }
    return parsed;
  } catch {
    throw new Error("Arguments must be a JSON array of strings.");
  }
}

export function resolveHarness(
  local: HarnessConfig | null,
  project: ProjectAgentConfig | null
): HarnessConfig {
  if (local) return local;
  const preset = harnessPresets.find((entry) => entry.id === project?.harness);
  return {
    id: project?.program ? "custom" : (preset?.id ?? "claude"),
    label: project?.program ? "Project command" : (preset?.label ?? "Claude Code"),
    program: project?.program ?? preset?.program ?? "claude",
    args: project?.args ?? preset?.args ?? [],
  };
}

export interface AgentConfigStore {
  load(rootPath: string): HarnessConfig | null;
  save(rootPath: string, config: HarnessConfig): void;
}

export function createLocalAgentConfigStore(): AgentConfigStore {
  const key = (rootPath: string) => `tau:agent-config:${rootPath}`;
  return {
    load(rootPath) {
      const raw = localStorage.getItem(key(rootPath));
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as HarnessConfig;
        return validateHarness(parsed) ? null : parsed;
      } catch {
        return null;
      }
    },
    save(rootPath, config) {
      localStorage.setItem(key(rootPath), JSON.stringify(config));
    },
  };
}

export function validateHarness(config: HarnessConfig): string | null {
  if (!config.program.trim()) return "Choose a harness executable.";
  if (config.args.some((arg) => typeof arg !== "string")) {
    return "Harness arguments must be strings.";
  }
  return null;
}

export function parseProjectAgentConfig(raw: string): ProjectAgentConfig {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Project agent configuration must be an object.");
  }
  const config = parsed as Record<string, unknown>;
  if (config.harness !== undefined && typeof config.harness !== "string") {
    throw new Error("Project harness must be a string.");
  }
  if (config.program !== undefined && typeof config.program !== "string") {
    throw new Error("Project program must be a string.");
  }
  if (
    config.args !== undefined &&
    (!Array.isArray(config.args) || !config.args.every((arg) => typeof arg === "string"))
  ) {
    throw new Error("Project arguments must be an array of strings.");
  }
  return {
    harness: config.harness as string | undefined,
    program: config.program as string | undefined,
    args: config.args as string[] | undefined,
  };
}
