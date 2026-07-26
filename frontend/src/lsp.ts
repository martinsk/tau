import * as monaco from "monaco-editor";

interface LspServerSettings {
  command: string;
  args?: string[];
}

export interface LspSettings {
  languageServers?: Record<string, LspServerSettings>;
}

interface LspMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

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

export class LspClient {
  private child: {
    write(data: string): Promise<void>;
    kill(): Promise<void>;
  } | null = null;
  private unlisteners: (() => void)[] = [];
  private idCounter = 0;
  private pending = new Map<number, (response: unknown) => void>();
  private buffer = "";
  private stopped = false;

  constructor(private program: string, private args: string[]) {}

  async start(rootUri: string): Promise<void> {
    const { Command } = await import("@tauri-apps/plugin-shell");
    const cmd = Command.create(this.program, this.args);
    const child = await cmd.spawn();
    this.child = child;
    const unlistenOut = cmd.stdout.on("data", (line: string) =>
      this.onData(line)
    ) as unknown as () => void;
    const unlistenErr = cmd.stderr.on("data", (line: string) =>
      console.error("LSP stderr:", line)
    ) as unknown as () => void;
    this.unlisteners.push(unlistenOut, unlistenErr);

    try {
      await this.request("initialize", {
        processId: null,
        rootUri,
        capabilities: {},
        workspaceFolders: null,
      });
      this.notify("initialized", {});
    } catch (err) {
      this.stop();
      throw err;
    }
  }

  stop(): void {
    this.stopped = true;
    this.child?.kill().catch(console.error);
    this.child = null;
    for (const unlisten of this.unlisteners) {
      unlisten();
    }
    this.unlisteners = [];
    for (const reject of this.pending.values()) {
      reject(new Error("LSP client stopped"));
    }
    this.pending.clear();
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
        const msg = JSON.parse(body) as LspMessage;
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!(msg.result);
          this.pending.delete(msg.id);
        }
      } catch {
        // ignore malformed messages
      }
    }
  }

  private send(msg: LspMessage): void {
    if (!this.child || this.stopped) return;
    const body = JSON.stringify(msg);
    const payload = `Content-Length: ${body.length}\r\n\r\n${body}`;
    this.child.write(payload).catch(console.error);
  }

  request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.child || this.stopped) {
        reject(new Error("LSP client not started"));
        return;
      }
      const id = ++this.idCounter;
      this.pending.set(id, resolve);
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }
}

export class LspManager {
  private clients = new Map<string, LspClient>();
  private settings: LspSettings = {};
  private rootUri: string = "";
  private unregisters: (() => void)[] = [];

  constructor(private rootPath: string) {
    this.rootUri = `file://${rootPath}`;
  }

  async loadSettings(): Promise<void> {
    this.settings = await loadLspSettings(this.rootPath);
  }

  async ensureClient(languageId: string): Promise<LspClient | null> {
    if (this.clients.has(languageId)) return this.clients.get(languageId)!;

    const config = this.settings.languageServers?.[languageId] ??
      defaultServers[languageId];
    if (!config) return null;

    const client = new LspClient(config.command, config.args ?? []);
    try {
      await client.start(this.rootUri);
    } catch (err) {
      console.error(`Failed to start ${config.command}:`, err);
      return null;
    }
    this.clients.set(languageId, client);
    return client;
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
