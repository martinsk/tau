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

export interface OutlineNode {
  name: string;
  kind: number;
  line: number;
  column: number;
  children: OutlineNode[];
}

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export interface Diagnostic {
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: DiagnosticSeverity;
  message: string;
  source?: string;
}

interface RawDiagnostic {
  range: LspRange;
  severity?: number;
  message: string;
  source?: string;
}

const SEVERITY_LABEL: Record<number, DiagnosticSeverity> = {
  1: "error",
  2: "warning",
  3: "info",
  4: "hint",
};

function uriToPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ""));
}

function toDiagnostic(path: string, raw: RawDiagnostic): Diagnostic {
  return {
    path,
    line: raw.range.start.line + 1,
    column: raw.range.start.character + 1,
    endLine: raw.range.end.line + 1,
    endColumn: raw.range.end.character + 1,
    severity: SEVERITY_LABEL[raw.severity ?? 1] ?? "error",
    message: raw.message,
    source: raw.source,
  };
}

const MONACO_SEVERITY: Record<DiagnosticSeverity, monaco.MarkerSeverity> = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  info: monaco.MarkerSeverity.Info,
  hint: monaco.MarkerSeverity.Hint,
};

interface LspPosition {
  line: number;
  character: number;
}

interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

interface RawDocumentSymbol {
  name: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children?: RawDocumentSymbol[];
}

interface RawSymbolInformation {
  name: string;
  kind: number;
  location: { uri: string; range: LspRange };
}

function isDocumentSymbol(value: unknown): value is RawDocumentSymbol {
  return (
    typeof value === "object" &&
    value !== null &&
    "selectionRange" in (value as Record<string, unknown>)
  );
}

function toOutlineNode(symbol: RawDocumentSymbol | RawSymbolInformation): OutlineNode {
  if (isDocumentSymbol(symbol)) {
    return {
      name: symbol.name,
      kind: symbol.kind,
      line: symbol.selectionRange.start.line + 1,
      column: symbol.selectionRange.start.character + 1,
      children: (symbol.children ?? []).map(toOutlineNode),
    };
  }
  return {
    name: symbol.name,
    kind: symbol.kind,
    line: symbol.location.range.start.line + 1,
    column: symbol.location.range.start.character + 1,
    children: [],
  };
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
  private pending = new Map<
    number,
    { resolve: (response: unknown) => void; reject: (error: unknown) => void }
  >();
  private buffer = "";
  private stdoutDecoder = new TextDecoder();
  private stderrDecoder = new TextDecoder();
  onNotification: ((method: string, params: unknown) => void) | null = null;

  private constructor(private program: string, private args: string[]) {}

  static create(program: string, args: string[]): LspClient<"notStarted"> {
    return new LspClient<"notStarted">(program, args);
  }

  async start(this: LspClient<"notStarted">, rootUri: string): Promise<LspClient<"running">> {
    const { Command } = await import("@tauri-apps/plugin-shell");
    const running = new LspClient<"running">(this.program, this.args);
    const cwd = uriToPath(rootUri);
    const cmd = Command.create(running.program, running.args, {
      cwd,
      encoding: "raw",
      env: {},
    });
    const onStdout = (data: Uint8Array | number[]) => running.onData(data);
    const onStderr = (data: Uint8Array | number[]) => {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const message = running.stderrDecoder.decode(bytes, { stream: true });
      if (message) console.error("LSP stderr:", message);
    };
    cmd.stdout.on("data", onStdout);
    cmd.stderr.on("data", onStderr);
    running.unlisteners.push(
      () => cmd.stdout.off("data", onStdout),
      () => cmd.stderr.off("data", onStderr)
    );
    const child = await cmd.spawn();
    running.child = child;

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
    for (const pending of this.pending.values()) {
      pending.reject(new Error("LSP client stopped"));
    }
    this.pending.clear();
    return stopped;
  }

  private onData(chunk: string | Uint8Array | number[]) {
    const bytes =
      typeof chunk === "string"
        ? null
        : chunk instanceof Uint8Array
          ? chunk
          : new Uint8Array(chunk);
    this.buffer +=
      typeof chunk === "string"
        ? chunk
        : this.stdoutDecoder.decode(bytes!, { stream: true });
    while (true) {
      const headerMatch = this.buffer.match(/Content-Length: (\d+)\r\n\r\n/);
      if (!headerMatch) break;
      const len = parseInt(headerMatch[1], 10);
      const start = headerMatch.index! + headerMatch[0].length;
      const framed = this.takeUtf8Bytes(this.buffer.slice(start), len);
      if (!framed) break;
      this.buffer = this.buffer.slice(start + framed.characters);
      try {
        const value = JSON.parse(framed.value);
        if (!isLspMessage(value)) continue;
        if (!isResponse(value)) {
          if ("id" in value) {
            this.handleServerRequest(value.id, value.method, value.params);
          } else {
            this.onNotification?.(value.method, value.params);
          }
          continue;
        }
        const pending = this.pending.get(value.id);
        if (!pending) continue;
        this.pending.delete(value.id);
        if ("error" in value) {
          pending.reject(value.error);
        } else {
          pending.resolve(value.result);
        }
      } catch {
        // ignore malformed messages
      }
    }
  }

  private takeUtf8Bytes(
    value: string,
    byteLength: number
  ): { value: string; characters: number } | null {
    let bytes = 0;
    let characters = 0;
    for (const character of value) {
      const next = new TextEncoder().encode(character).length;
      if (bytes + next > byteLength) return null;
      bytes += next;
      characters += character.length;
      if (bytes === byteLength) {
        return { value: value.slice(0, characters), characters };
      }
    }
    return null;
  }

  private handleServerRequest(id: number, method: string, params: unknown): void {
    let result: unknown = null;
    if (method === "workspace/configuration") {
      const items = (params as { items?: unknown[] } | undefined)?.items ?? [];
      result = items.map(() => null);
    } else if (
      method !== "client/registerCapability" &&
      method !== "client/unregisterCapability" &&
      method !== "window/workDoneProgress/create" &&
      method !== "workspace/workspaceFolders"
    ) {
      this.send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
      return;
    }
    this.send({ jsonrpc: "2.0", id, result });
  }

  private send(msg: LspMessage): void {
    if (!this.child) return;
    const body = JSON.stringify(msg);
    const length = new TextEncoder().encode(body).length;
    const payload = `Content-Length: ${length}\r\n\r\n${body}`;
    this.child.write(payload).catch(console.error);
  }

  request(this: LspClient<"running">, method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.child) {
        reject(new Error("LSP client not started"));
        return;
      }
      const id = ++this.idCounter;
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(this: LspClient<"running">, method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }
}

export class LspManager {
  private clients = new Map<string, LspClient<"running">>();
  private startingClients = new Map<
    string,
    Promise<LspClient<"running"> | null>
  >();
  private openingDocuments = new Map<string, Promise<void>>();
  private documents = new Map<string, { languageId: string; version: number }>();
  private settings: LspSettings = {};
  private rootUri: string = "";
  private unregisters: (() => void)[] = [];
  private diagnosticsByPath = new Map<string, Diagnostic[]>();
  private diagnosticsListeners = new Set<(diagnostics: Diagnostic[]) => void>();
  private stopped = false;

  constructor(private rootPath: string) {
    this.rootUri = `file://${rootPath}`;
  }

  getDiagnostics(): Diagnostic[] {
    return Array.from(this.diagnosticsByPath.values()).flat();
  }

  onDiagnosticsChange(callback: (diagnostics: Diagnostic[]) => void): () => void {
    this.diagnosticsListeners.add(callback);
    return () => this.diagnosticsListeners.delete(callback);
  }

  private notifyDiagnosticsListeners(): void {
    const all = this.getDiagnostics();
    for (const listener of this.diagnosticsListeners) listener(all);
  }

  private applyDiagnosticsToModel(
    model: monaco.editor.ITextModel,
    diagnostics: Diagnostic[]
  ): void {
    monaco.editor.setModelMarkers(
      model,
      "lsp",
      diagnostics.map((d) => ({
        startLineNumber: d.line,
        startColumn: d.column,
        endLineNumber: d.endLine,
        endColumn: d.endColumn,
        message: d.message,
        severity: MONACO_SEVERITY[d.severity],
        source: d.source,
      }))
    );
  }

  private handleNotification(method: string, params: unknown): void {
    if (method !== "textDocument/publishDiagnostics") return;
    const { uri, diagnostics } = params as { uri: string; diagnostics: RawDiagnostic[] };
    const path = uriToPath(uri);
    const converted = (diagnostics ?? []).map((raw) => toDiagnostic(path, raw));
    if (converted.length > 0) {
      this.diagnosticsByPath.set(path, converted);
    } else {
      this.diagnosticsByPath.delete(path);
    }
    this.notifyDiagnosticsListeners();

    const model = monaco.editor.getModel(monaco.Uri.file(path));
    if (model) this.applyDiagnosticsToModel(model, converted);
  }

  async loadSettings(): Promise<void> {
    this.settings = await loadLspSettings(this.rootPath);
  }

  async ensureClient(languageId: string): Promise<LspClient<"running"> | null> {
    const existing = this.clients.get(languageId);
    if (existing) return existing;
    const starting = this.startingClients.get(languageId);
    if (starting) return starting;

    const config = this.settings.languageServers?.[languageId] ??
      defaultServers[languageId];
    if (!config) return null;

    const promise = (async () => {
      const client = LspClient.create(config.command, config.args ?? []);
      try {
        const running = await client.start(this.rootUri);
        if (this.stopped) {
          running.stop();
          return null;
        }
        running.onNotification = (method, params) =>
          this.handleNotification(method, params);
        this.clients.set(languageId, running);
        return running;
      } catch (err) {
        console.error(`Failed to start ${config.command}:`, err);
        return null;
      }
    })();
    this.startingClients.set(languageId, promise);
    try {
      return await promise;
    } finally {
      if (this.startingClients.get(languageId) === promise) {
        this.startingClients.delete(languageId);
      }
    }
  }

  async openDocument(path: string, languageId: string, text: string): Promise<void> {
    const existing = this.openingDocuments.get(path);
    if (existing) await existing;

    const promise = this.openDocumentNow(path, languageId, text);
    this.openingDocuments.set(path, promise);
    try {
      await promise;
    } finally {
      if (this.openingDocuments.get(path) === promise) {
        this.openingDocuments.delete(path);
      }
    }
  }

  private async openDocumentNow(
    path: string,
    languageId: string,
    text: string
  ): Promise<void> {
    const client = await this.ensureClient(languageId);
    if (!client) return;
    const current = this.documents.get(path);
    if (current?.languageId === languageId) {
      const version = current.version + 1;
      current.version = version;
      client.notify("textDocument/didChange", {
        textDocument: { uri: `file://${path}`, version },
        contentChanges: [{ text }],
      });
      return;
    }
    client.notify("textDocument/didOpen", {
      textDocument: {
        uri: `file://${path}`,
        languageId,
        version: 1,
        text,
      },
    });
    this.documents.set(path, { languageId, version: 1 });
  }

  async documentSymbols(path: string, languageId: string): Promise<OutlineNode[] | null> {
    const opening = this.openingDocuments.get(path);
    if (opening) await opening;
    const client = await this.ensureClient(languageId);
    if (!client) return null;
    try {
      const result = (await client.request("textDocument/documentSymbol", {
        textDocument: { uri: `file://${path}` },
      })) as (RawDocumentSymbol | RawSymbolInformation)[] | null;
      if (!Array.isArray(result)) return null;
      return result.map(toOutlineNode);
    } catch (err) {
      console.error("Failed to fetch document symbols:", err);
      return null;
    }
  }

  async changeDocument(path: string, text: string): Promise<void> {
    const opening = this.openingDocuments.get(path);
    if (opening) await opening;
    const document = this.documents.get(path);
    if (!document) return;
    const client = this.clients.get(document.languageId);
    if (!client) return;
    const version = document.version + 1;
    document.version = version;
    client.notify("textDocument/didChange", {
      textDocument: { uri: `file://${path}`, version },
      contentChanges: [{ text }],
    });
  }

  async saveDocument(path: string): Promise<void> {
    const opening = this.openingDocuments.get(path);
    if (opening) await opening;
    const document = this.documents.get(path);
    if (!document) return;
    const client = this.clients.get(document.languageId);
    if (!client) return;
    client.notify("textDocument/didSave", {
      textDocument: { uri: `file://${path}` },
    });
  }

  stop(): void {
    this.stopped = true;
    for (const client of this.clients.values()) {
      client.stop();
    }
    this.clients.clear();
    this.startingClients.clear();
    this.openingDocuments.clear();
    this.documents.clear();
    this.diagnosticsByPath.clear();
    this.notifyDiagnosticsListeners();
    for (const unregister of this.unregisters) {
      unregister();
    }
    this.unregisters = [];
  }

  registerLanguageFeatures(): void {
    const modelListener = monaco.editor.onDidCreateModel((model) => {
      const diagnostics = this.diagnosticsByPath.get(model.uri.fsPath) ?? [];
      this.applyDiagnosticsToModel(model, diagnostics);
    });
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
    this.unregisters.push(
      () => modelListener.dispose(),
      () => hoverProvider.dispose()
    );
  }
}
