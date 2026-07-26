import { readFile } from "./api.js";

export interface Task {
  label: string;
  type: string;
  command: string;
  args?: string[];
  group?: "build" | "test" | "none" | { kind: "build" | "test"; isDefault?: boolean };
  options?: { cwd?: string };
}

export interface TasksConfig {
  version: string;
  tasks: Task[];
}

function normalizeGroup(
  group: Task["group"]
): "build" | "test" | "none" {
  if (!group) return "none";
  if (typeof group === "string") return group;
  return group.kind;
}

export function taskCommand(task: Task): string {
  const args = task.args ?? [];
  return [task.command, ...args].join(" ");
}

export async function loadTasks(rootPath: string): Promise<Task[]> {
  try {
    const raw = await readFile(`${rootPath}/.vscode/tasks.json`);
    const config = JSON.parse(raw) as TasksConfig;
    return config.tasks ?? [];
  } catch {
    return [];
  }
}

export function findDefaultTask(
  tasks: Task[],
  group: "build" | "test"
): Task | undefined {
  return (
    tasks.find((t) => {
      const g = normalizeGroup(t.group);
      if (g !== group) return false;
      if (typeof t.group === "object" && t.group.isDefault) return true;
      return false;
    }) ??
    tasks.find((t) => normalizeGroup(t.group) === group)
  );
}

export function findTaskByLabel(tasks: Task[], label: string): Task | undefined {
  return tasks.find((t) => t.label === label);
}
