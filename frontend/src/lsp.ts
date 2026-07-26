import * as monaco from "monaco-editor";
import {
  isLspMessage,
  isResponse,
  type LspMessage,
} from "./lspMessage.js";

interface LspServerSettings {
  command: string;
  args?: string[];
}

export interface LspSettings {
  languageServers?: Record<string, LspServerSettings>;
}

export { isLspMessage, isResponse, type LspMessage } from "./lspMessage.js";

const defaultServers: Record<string, LspServerSettings> = {
  rust: { command: "rust-analyzer", args: [] },
  c: { command: "clangd", args: [] },
  cpp: { command: "clangd", args: [] },
};

export async function loadLspSettings(rootPath: string): Promise<LspSettings> {
  try {
    const { readFile } = await import("./api.js");
    const raw = await readFile(`${rootPath}/.tau/settings.json`);
    return JSON.parse(raw) as LspSettings;
  } catch {
    // fall back to .vscode/settings.json if present
  }
  try {
    const { readFile } = await import("./api.js");
    const raw = await readFile(`${rootPath}/.vscode/settings.json`);
    return JSON.parse(raw) as LspSettings;
  } catch {
    return {};
  }
}

type LspClientState = "notStarted" | "running" | "stopped";

interface LspChild {
  write(data: string): Promise<void>;
  kill(): Promise<void>;
}

export class LspClient<S extends LspClientState = LspClientState> {
  private child: LspChild | null = null;
  private unlisteners: (() => void)[] = [];
  private idCounter = 0;
  private pending = new Map<number, (response: unknown) => void>();
  private buffer = "";

  private constructor(private program: string, private args: string[]) {}

  static create(program: string, args: string[]): LspClient<"notStarted"> {
    return new LspClient<"notStarted">(program, args);
  }

  async start(this: LspClient<"notStarted">, rootUri: string): Promise<LspClient<"running">> {
    const { Command } = await import("@tauri-apps/plugin-shell");
    const running = new LspClient<"running">(this.program, this.args);
    const cmd = Command.create(running.program, running.args);
    const child = await cmd.spawn();
    running.child = child;
    const unlistenOut = cmd.stdout.on("data", (line: string) =>
      running.onData(line)
    ) as unknown as () => void;
    const unlistenErr = cmd.stderr.on("data", (line: string) =>
      console.error("LSP stderr:", line)
    ) as unknown as () => void;
    running.unlisteners.push(unlistenOut, unlistenErr);

    try {
      await running.request("initialize", {
        processId: null,
        rootUri,
        capabilities: {},
        workspaceFolders: null,
      });
      running.notify("initialized", {});
    } catch (err) {
      running.stop();
      throw err;
    }
    return running;
  }

  stop(this: LspClient<"running">): LspClient<"stopped"> {
    const stopped = new LspClient<"stopped">(this.program, this.args);
    this.child?.kill().catch(console.error);
    for (const unlisten of this.unlisteners) {
      unlisten();
    }
    for (const reject of this.pending.values()) {
      reject(new Error("LSP client stopped"));
    }
    return stopped;
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    while (true) {
      const headerMatch = this.buffer.match(/Content-Length: (\d+)\r\n\r\n/);
      if (!headerMatch) break;
      const len = parseInt(headerMatch[1], 10);
      const start = headerMatch.index! + headerMatch[0].length;
      if (this.buffer.length < start + len) break;
      const body = this.buffer.slice(start, start + len);
      this.buffer = this.buffer.slice(start + len);
      try {
        const value = JSON.parse(body);
        if (!isLspMessage(value)) continue;
        if (!isResponse(value)) continue;
        const resolver = this.pending.get(value.id);
        if (!resolver) continue;
        if ("error" in value) {
          resolver(value.error);
        } else {
          resolver(value.result);
        }
        this.pending.delete(value.id);
      } catch {
        // ignore malformed messages
      }
    }
  }

  private send(msg: LspMessage): void {
    if (!this.child) return;
    const body = JSON.stringify(msg);
    const payload = `Content-Length: ${body.length}\r\n\r\n${body}`;
    this.child.write(payload).catch(console.error);
  }

  request(this: LspClient<"running">, method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.child) {
        reject(new Error("LSP client not started"));
        return;
      }
      const id = ++this.idCounter;
      this.pending.set(id, resolve);
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(this: LspClient<"running">, method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }
}

export class LspManager {
  private clients = new Map<string, LspClient<"running">>();
  private settings: LspSettings = {};
  private rootUri: string = "";
  private unregisters: (() => void)[] = [];

  constructor(private rootPath: string) {
    this.rootUri = `file://${rootPath}`;
  }

  async loadSettings(): Promise<void> {
    this.settings = await loadLspSettings(this.rootPath);
  }

  async ensureClient(languageId: string): Promise<LspClient<"running"> | null> {
    if (this.clients.has(languageId)) return this.clients.get(languageId)!;

    const config = this.settings.languageServers?.[languageId] ??
      defaultServers[languageId];
    if (!config) return null;

    const client = LspClient.create(config.command, config.args ?? []);
    let running: LspClient<"running">;
    try {
      running = await client.start(this.rootUri);
    } catch (err) {
      console.error(`Failed to start ${config.command}:`, err);
      return null;
    }
    this.clients.set(languageId, running);
    return running;
  }

  async openDocument(path: string, languageId: string, text: string): Promise<void> {
    const client = await this.ensureClient(languageId);
    if (!client) return;
    client.notify("textDocument/didOpen", {
      textDocument: {
        uri: `file://${path}`,
        languageId,
        version: 1,
        text,
      },
    });
  }

  async changeDocument(path: string, text: string): Promise<void> {
    for (const [lang, client] of this.clients) {
      client.notify("textDocument/didChange", {
        textDocument: { uri: `file://${path}` },
        contentChanges: [{ text }],
      });
    }
  }

  stop(): void {
    for (const client of this.clients.values()) {
      client.stop();
    }
    this.clients.clear();
    for (const unregister of this.unregisters) {
      unregister();
    }
    this.unregisters = [];
  }

  registerLanguageFeatures(): void {
    const hoverProvider = monaco.languages.registerHoverProvider(
      { scheme: "file" },
      {
        provideHover: async (model, position) => {
          const languageId = model.getLanguageId();
          const client = await this.ensureClient(languageId);
          if (!client) return null;
          const result = (await client.request("textDocument/hover", {
            textDocument: { uri: model.uri.toString() },
            position: {
              line: position.lineNumber - 1,
              character: position.column - 1,
            },
          })) as {
            contents?: { value?: string } | string | Array<{ value?: string }>;
            range?: {
              start: { line: number; character: number };
              end: { line: number; character: number };
            };
          } | null;
          if (!result || !result.contents) return null;
          let value = "";
          if (typeof result.contents === "string") {
            value = result.contents;
          } else if (Array.isArray(result.contents)) {
            value = result.contents.map((c) => c.value ?? "").join("\n");
          } else {
            value = result.contents.value ?? "";
          }
          return {
            contents: [{ value, isTrusted: true }],
            range: result.range
              ? {
                  startLineNumber: result.range.start.line + 1,
                  startColumn: result.range.start.character + 1,
                  endLineNumber: result.range.end.line + 1,
                  endColumn: result.range.end.character + 1,
                }
              : undefined,
          };
        },
      }
    );
    this.unregisters.push(() => hoverProvider.dispose());
  }
}
