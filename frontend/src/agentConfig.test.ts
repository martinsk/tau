import { describe, expect, it } from "vitest";
import {
  parseArgs,
  parseProjectAgentConfig,
  resolveHarness,
  validateHarness,
  type HarnessConfig,
} from "./agentConfig.js";

describe("agent configuration", () => {
  it("uses a local override ahead of project configuration", () => {
    const local: HarnessConfig = {
      id: "custom",
      label: "Local command",
      program: "local-agent",
      args: ["--fast"],
    };

    expect(resolveHarness(local, { harness: "codex" })).toEqual(local);
  });

  it("resolves a project preset when no local override exists", () => {
    expect(resolveHarness(null, { harness: "aider" })).toMatchObject({
      id: "aider",
      program: "aider",
      args: [],
    });
  });

  it("parses only JSON string argument arrays", () => {
    expect(parseArgs('["--model", "fast"]')).toEqual(["--model", "fast"]);
    expect(() => parseArgs("--model fast")).toThrow(
      "Arguments must be a JSON array of strings."
    );
  });

  it("rejects invalid project configuration", () => {
    expect(() => parseProjectAgentConfig('{"args":"--fast"}')).toThrow(
      "Project arguments must be an array of strings."
    );
  });

  it("requires a harness executable", () => {
    expect(
      validateHarness({ id: "custom", label: "Custom", program: "", args: [] })
    ).toBe("Choose a harness executable.");
  });
});
