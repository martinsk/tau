import { describe, expect, it } from "vitest";
import { findDefaultTask, taskCommand, type Task } from "./tasks.js";

describe("tasks", () => {
  it("quotes shell-sensitive arguments", () => {
    const task: Task = {
      label: "example",
      type: "shell",
      command: "echo",
      args: ["hello world", "it's safe"],
    };
    expect(taskCommand(task)).toBe("echo 'hello world' 'it'\"'\"'s safe'");
  });

  it("selects the configured default for each group", () => {
    const tasks: Task[] = [
      { label: "build", type: "shell", command: "build", group: "build" },
      {
        label: "test",
        type: "shell",
        command: "test",
        group: { kind: "test", isDefault: true },
      },
    ];
    expect(findDefaultTask(tasks, "build")?.label).toBe("build");
    expect(findDefaultTask(tasks, "test")?.label).toBe("test");
  });
});
