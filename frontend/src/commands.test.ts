import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCommands,
  registerCommand,
  runCommand,
  setCommandErrorHandler,
  unregisterCommand,
} from "./commands.js";

const ids: string[] = [];

afterEach(() => {
  for (const id of ids.splice(0)) unregisterCommand(id);
});

describe("commands", () => {
  it("awaits asynchronous commands", async () => {
    const run = vi.fn(async () => undefined);
    ids.push("test.async");
    registerCommand({ id: "test.async", title: "Async", run });
    expect(await runCommand("test.async")).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not run disabled or hidden commands", async () => {
    const disabledRun = vi.fn();
    const hiddenRun = vi.fn();
    ids.push("test.disabled", "test.hidden");
    registerCommand({
      id: "test.disabled",
      title: "Disabled",
      enabled: () => false,
      run: disabledRun,
    });
    registerCommand({
      id: "test.hidden",
      title: "Hidden",
      visible: () => false,
      run: hiddenRun,
    });
    expect(await runCommand("test.disabled")).toBe(false);
    expect(await runCommand("test.hidden")).toBe(false);
    expect(disabledRun).not.toHaveBeenCalled();
    expect(hiddenRun).not.toHaveBeenCalled();
    expect(getCommands().some((command) => command.id === "test.hidden")).toBe(false);
  });

  it("routes command failures to the error handler", async () => {
    const handler = vi.fn();
    setCommandErrorHandler(handler);
    ids.push("test.failure");
    const error = new Error("failure");
    registerCommand({
      id: "test.failure",
      title: "Failure",
      run: async () => {
        throw error;
      },
    });
    expect(await runCommand("test.failure")).toBe(false);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: "test.failure" }), error);
  });
});
