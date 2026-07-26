import { describe, it, expect } from "vitest";
import { isLspMessage, isResponse } from "./lspMessage.js";

describe("LspMessage type guards", () => {
  it("identifies valid LSP messages", () => {
    expect(
      isLspMessage({ jsonrpc: "2.0", id: 1, method: "initialize" })
    ).toBe(true);
    expect(isLspMessage({ jsonrpc: "2.0", method: "initialized" })).toBe(true);
    expect(isLspMessage({ jsonrpc: "2.0", id: 1, result: {} })).toBe(true);
    expect(isLspMessage({ jsonrpc: "2.0", id: 1, error: {} })).toBe(true);
  });

  it("rejects non-LSP messages", () => {
    expect(isLspMessage(null)).toBe(false);
    expect(isLspMessage({})).toBe(false);
    expect(isLspMessage({ jsonrpc: "1.0" })).toBe(false);
  });

  it("distinguishes responses from requests and notifications", () => {
    const request = { jsonrpc: "2.0", id: 1, method: "initialize" } as const;
    const notification = { jsonrpc: "2.0", method: "initialized" } as const;
    const response = { jsonrpc: "2.0", id: 1, result: {} } as const;
    const errorResponse = { jsonrpc: "2.0", id: 1, error: {} } as const;

    expect(isResponse(request)).toBe(false);
    expect(isResponse(notification)).toBe(false);
    expect(isResponse(response)).toBe(true);
    expect(isResponse(errorResponse)).toBe(true);
  });
});
