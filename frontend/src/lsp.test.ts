import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { Command } from "@tauri-apps/plugin-shell";
import * as monaco from "monaco-editor";
import { LspClient, LspManager } from "./lsp.js";

const createCommand = Command.create as unknown as Mock<(...args: unknown[]) => FakeCommand["command"]>;
const modelListeners = vi.hoisted(
  () => [] as Array<(model: { uri: { fsPath: string } }) => void>
);

function waitNextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Replace Monaco with a minimal stub so the test runs in Node.
vi.mock("monaco-editor", () => ({
  editor: {
    getModel: vi.fn(() => ({ uri: { toString: () => "", fsPath: "" } })),
    onDidCreateModel: vi.fn((listener) => {
      modelListeners.push(listener);
      return { dispose: vi.fn() };
    }),
    setModelMarkers: vi.fn(),
    defineTheme: vi.fn(),
    create: vi.fn(),
    createModel: vi.fn(),
  },
  languages: {
    registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() })),
  },
  Uri: {
    file: vi.fn((path: string) => ({ toString: () => `file://${path}` })),
  },
  MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
}));

// Replace the real Tauri Command with a controllable fake.
vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: {
    create: vi.fn(),
  },
}));

type LspRequest = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

type FakeCommand = ReturnType<typeof createFakeCommand>;

function createFakeCommand() {
  const dataListeners: Array<(data: string) => void> = [];
  const errListeners: Array<(data: string) => void> = [];
  const writes: string[] = [];

  const child = {
    write: vi.fn(async (data: string) => {
      writes.push(data);
    }),
    kill: vi.fn(async () => {}),
  };

  const command = {
    stdout: {
      on: vi.fn((event: string, cb: (data: string) => void) => {
        if (event === "data") dataListeners.push(cb);
      }),
      off: vi.fn((event: string, cb: (data: string) => void) => {
        if (event !== "data") return;
        const index = dataListeners.indexOf(cb);
        if (index >= 0) dataListeners.splice(index, 1);
      }),
    },
    stderr: {
      on: vi.fn((event: string, cb: (data: string) => void) => {
        if (event === "data") errListeners.push(cb);
      }),
      off: vi.fn((event: string, cb: (data: string) => void) => {
        if (event !== "data") return;
        const index = errListeners.indexOf(cb);
        if (index >= 0) errListeners.splice(index, 1);
      }),
    },
    spawn: vi.fn(async () => child),
  };

  return {
    command,
    child,
    writes,
    send(value: unknown) {
      const body = JSON.stringify(value);
      const length = new TextEncoder().encode(body).length;
      const payload = `Content-Length: ${length}\r\n\r\n${body}`;
      for (const cb of dataListeners) cb(payload);
    },
    requests(): LspRequest[] {
      return writes
        .map((payload) => {
          const match = payload.match(/Content-Length: \d+\r\n\r\n/);
          if (!match) return null;
          return JSON.parse(payload.slice(match[0].length));
        })
        .filter((x): x is LspRequest => x !== null);
    },
  };
}

async function startClient(fake: FakeCommand, program = "rust-analyzer") {
  createCommand.mockReturnValue(fake.command);
  const promise = LspClient.create(program, []).start("file:///project");
  await waitNextTick(); // let start reach the initialize request
  fake.send({ jsonrpc: "2.0", id: 1, result: { capabilities: {} } });
  return promise;
}

beforeEach(() => {
  vi.clearAllMocks();
  modelListeners.length = 0;
});

describe("LspClient", () => {
  it("completes initialize and sends initialized", async () => {
    const fake = createFakeCommand();
    await startClient(fake);
    expect(createCommand).toHaveBeenCalledWith("rust-analyzer", [], {
      cwd: "/project",
      encoding: "raw",
      env: {},
    });
    const [init, initialized] = fake.requests();
    expect(init).toMatchObject({
      id: 1,
      method: "initialize",
      params: { rootUri: "file:///project", processId: null },
    });
    expect(initialized).toMatchObject({ method: "initialized" });
  });

  it("routes notifications to onNotification", async () => {
    const fake = createFakeCommand();
    const client = await startClient(fake);
    const onNotification = vi.fn();
    client.onNotification = onNotification;

    fake.send({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri: "file:///project/main.rs", diagnostics: [] },
    });

    expect(onNotification).toHaveBeenCalledWith(
      "textDocument/publishDiagnostics",
      expect.objectContaining({ uri: "file:///project/main.rs" })
    );
  });

  it("resolves requests from server responses", async () => {
    const fake = createFakeCommand();
    const client = await startClient(fake);
    const reqPromise = client.request("textDocument/hover", {
      textDocument: { uri: "file:///project/main.rs" },
      position: { line: 0, character: 0 },
    });

    await waitNextTick();
    const requests = fake.requests();
    const hover = requests[requests.length - 1];
    expect(hover).toMatchObject({ method: "textDocument/hover" });

    fake.send({
      jsonrpc: "2.0",
      id: hover.id!,
      result: { contents: "hello" },
    });
    await expect(reqPromise).resolves.toEqual({ contents: "hello" });
  });

  it("rejects requests when the server returns an error", async () => {
    const fake = createFakeCommand();
    const client = await startClient(fake);
    const promise = client.request("textDocument/hover", {});
    await waitNextTick();
    const requests = fake.requests();
    const request = requests[requests.length - 1];

    fake.send({
      jsonrpc: "2.0",
      id: request.id!,
      error: { code: -32603, message: "failed" },
    });

    await expect(promise).rejects.toEqual({ code: -32603, message: "failed" });
  });

  it("uses UTF-8 byte lengths for outgoing and incoming messages", async () => {
    const fake = createFakeCommand();
    const client = await startClient(fake);
    const promise = client.request("test/echo", { value: "τ" });
    await waitNextTick();
    const payload = fake.writes[fake.writes.length - 1];
    const [header, body] = payload.split("\r\n\r\n");
    expect(header).toBe(`Content-Length: ${new TextEncoder().encode(body).length}`);
    const requests = fake.requests();
    const request = requests[requests.length - 1];

    fake.send({ jsonrpc: "2.0", id: request.id!, result: "✓" });

    await expect(promise).resolves.toBe("✓");
  });

  it("responds to server configuration requests", async () => {
    const fake = createFakeCommand();
    await startClient(fake);

    fake.send({
      jsonrpc: "2.0",
      id: 99,
      method: "workspace/configuration",
      params: { items: [{ section: "rust" }, { section: "cargo" }] },
    });

    const requests = fake.requests();
    expect(requests[requests.length - 1]).toMatchObject({
      id: 99,
      result: [null, null],
    });
  });

  it("stops and kills the child", async () => {
    const fake = createFakeCommand();
    const client = await startClient(fake);
    client.stop();
    expect(fake.child.kill).toHaveBeenCalled();
  });
});

describe("LspManager", () => {
  function createManager(fake: FakeCommand) {
    createCommand.mockReturnValue(fake.command);
    return new LspManager("/project");
  }

  it("returns null for unconfigured languages", async () => {
    const manager = new LspManager("/project");
    const nodes = await manager.documentSymbols(
      "/project/readme.txt",
      "plaintext"
    );
    expect(nodes).toBeNull();
  });

  it("shares startup and opens a document before requesting its symbols", async () => {
    const fake = createFakeCommand();
    const manager = createManager(fake);
    const opening = manager.openDocument("/project/main.rs", "rust", "fn main() {}");
    const symbols = manager.documentSymbols("/project/main.rs", "rust");

    await waitNextTick();
    expect(fake.command.spawn).toHaveBeenCalledTimes(1);
    fake.send({ jsonrpc: "2.0", id: 1, result: {} });
    await waitNextTick();

    const requests = fake.requests();
    const didOpenIndex = requests.findIndex((request) => request.method === "textDocument/didOpen");
    const symbolsIndex = requests.findIndex(
      (request) => request.method === "textDocument/documentSymbol"
    );
    expect(didOpenIndex).toBeGreaterThan(-1);
    expect(symbolsIndex).toBeGreaterThan(didOpenIndex);
    fake.send({ jsonrpc: "2.0", id: requests[symbolsIndex].id!, result: [] });

    await opening;
    await expect(symbols).resolves.toEqual([]);
  });

  it("notifies the language server when an open document is saved", async () => {
    const fake = createFakeCommand();
    const manager = createManager(fake);
    const opening = manager.openDocument(
      "/project/main.rs",
      "rust",
      "fn main() {}"
    );

    await waitNextTick();
    fake.send({ jsonrpc: "2.0", id: 1, result: {} });
    await opening;
    await manager.saveDocument("/project/main.rs");

    expect(fake.requests()).toContainEqual({
      jsonrpc: "2.0",
      method: "textDocument/didSave",
      params: {
        textDocument: { uri: "file:///project/main.rs" },
      },
    });
  });

  it("fetches and converts DocumentSymbol outline nodes", async () => {
    const fake = createFakeCommand();
    const manager = createManager(fake);
    const promise = manager.documentSymbols("/project/main.rs", "rust");

    await waitNextTick(); // let ensureClient start and send initialize
    fake.send({ jsonrpc: "2.0", id: 1, result: {} });
    await waitNextTick(); // let the documentSymbol request be sent

    const requests = fake.requests();
    const symbolReq = requests[requests.length - 1];
    expect(symbolReq.method).toBe("textDocument/documentSymbol");

    fake.send({
      jsonrpc: "2.0",
      id: symbolReq.id!,
      result: [
        {
          name: "main",
          kind: 12,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 3 },
          },
          selectionRange: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 3 },
          },
        },
      ],
    });

    const nodes = await promise;
    expect(nodes).toEqual([
      { name: "main", kind: 12, line: 1, column: 1, children: [] },
    ]);
  });

  it("converts SymbolInformation into flat outline nodes", async () => {
    const fake = createFakeCommand();
    const manager = createManager(fake);
    const promise = manager.documentSymbols("/project/main.rs", "rust");

    await waitNextTick(); // let ensureClient start and send initialize
    fake.send({ jsonrpc: "2.0", id: 1, result: {} });
    await waitNextTick(); // let the documentSymbol request be sent

    const requests = fake.requests();
    const symbolReq = requests[requests.length - 1];

    fake.send({
      jsonrpc: "2.0",
      id: symbolReq.id!,
      result: [
        {
          name: "foo",
          kind: 13,
          location: {
            uri: "file:///project/main.rs",
            range: {
              start: { line: 2, character: 4 },
              end: { line: 2, character: 7 },
            },
          },
        },
      ],
    });

    const nodes = await promise;
    expect(nodes).toEqual([
      { name: "foo", kind: 13, line: 3, column: 5, children: [] },
    ]);
  });

  it("collects diagnostics, notifies listeners, and sets Monaco markers", async () => {
    const fake = createFakeCommand();
    const manager = createManager(fake);
    const onChange = vi.fn();
    manager.onDiagnosticsChange(onChange);

    const openPromise = manager.openDocument(
      "/project/main.rs",
      "rust",
      "fn main() {}"
    );
    await waitNextTick(); // let ensureClient start and send initialize
    fake.send({ jsonrpc: "2.0", id: 1, result: {} });
    await openPromise;

    fake.send({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: "file:///project/main.rs",
        diagnostics: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 3 },
            },
            severity: 1,
            message: "expected identifier",
            source: "rustc",
          },
        ],
      },
    });

    const diagnostics = manager.getDiagnostics();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      path: "/project/main.rs",
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 4,
      severity: "error",
      message: "expected identifier",
      source: "rustc",
    });
    expect(onChange).toHaveBeenCalledWith(diagnostics);

    const setModelMarkers = vi.mocked(monaco.editor.setModelMarkers);
    expect(setModelMarkers).toHaveBeenCalled();
    expect(setModelMarkers.mock.calls[0][1]).toBe("lsp");
    expect(setModelMarkers.mock.calls[0][2][0]).toMatchObject({
      startLineNumber: 1,
      startColumn: 1,
      message: "expected identifier",
    });
  });

  it("applies stored diagnostics when the editor model is created later", async () => {
    const fake = createFakeCommand();
    const manager = createManager(fake);
    const openPromise = manager.openDocument(
      "/project/main.rs",
      "rust",
      "fn main() {}"
    );
    await waitNextTick();
    fake.send({ jsonrpc: "2.0", id: 1, result: {} });
    await openPromise;

    vi.mocked(monaco.editor.getModel).mockReturnValueOnce(null);
    fake.send({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: "file:///project/main.rs",
        diagnostics: [
          {
            range: {
              start: { line: 1, character: 2 },
              end: { line: 1, character: 5 },
            },
            severity: 2,
            message: "delayed marker",
          },
        ],
      },
    });
    const setModelMarkers = vi.mocked(monaco.editor.setModelMarkers);
    expect(setModelMarkers).not.toHaveBeenCalled();

    manager.registerLanguageFeatures();
    const model = { uri: { fsPath: "/project/main.rs" } };
    modelListeners[0](model);

    expect(setModelMarkers).toHaveBeenCalledWith(
      model,
      "lsp",
      [
        expect.objectContaining({
          startLineNumber: 2,
          startColumn: 3,
          endLineNumber: 2,
          endColumn: 6,
          severity: monaco.MarkerSeverity.Warning,
          message: "delayed marker",
        }),
      ]
    );
  });

  it("clears diagnostics when a file has no problems", async () => {
    const fake = createFakeCommand();
    const manager = createManager(fake);
    const onChange = vi.fn();
    manager.onDiagnosticsChange(onChange);

    const openPromise = manager.openDocument(
      "/project/main.rs",
      "rust",
      "fn main() {}"
    );
    await waitNextTick(); // let ensureClient start and send initialize
    fake.send({ jsonrpc: "2.0", id: 1, result: {} });
    await openPromise;

    fake.send({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: "file:///project/main.rs",
        diagnostics: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 3 },
            },
            severity: 1,
            message: "err",
          },
        ],
      },
    });
    expect(manager.getDiagnostics()).toHaveLength(1);

    fake.send({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: "file:///project/main.rs",
        diagnostics: [],
      },
    });

    expect(manager.getDiagnostics()).toHaveLength(0);
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
