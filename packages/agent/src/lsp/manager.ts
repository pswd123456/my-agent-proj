import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection
} from "vscode-jsonrpc/node.js";
import {
  DefinitionRequest,
  DidChangeTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DocumentSymbolRequest,
  HoverRequest,
  InitializeRequest,
  PublishDiagnosticsNotification,
  ReferencesRequest,
  WorkspaceSymbolRequest,
  type Diagnostic,
  type DocumentSymbol,
  type Hover,
  type InitializeParams,
  type Location,
  type LocationLink,
  type Position,
  type SymbolInformation,
  type WorkspaceSymbol
} from "vscode-languageserver-protocol";

const require = createRequire(import.meta.url);
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const SHUTDOWN_TIMEOUT_MS = 1_000;

interface OpenDocumentState {
  uri: string;
  text: string;
  version: number;
  languageId: string;
}

interface LspConnectionState {
  child: ChildProcessWithoutNullStreams;
  connection: MessageConnection;
  stderr: string;
}

export class LspServerUnavailableError extends Error {
  constructor(message = "LSP server is unavailable.") {
    super(message);
    this.name = "LspServerUnavailableError";
  }
}

export class LspRequestTimeoutError extends Error {
  constructor(message = "LSP request timed out.") {
    super(message);
    this.name = "LspRequestTimeoutError";
  }
}

export type LspDefinitionResult = Location | Location[] | LocationLink[] | null;
export type LspDocumentSymbolResult =
  | DocumentSymbol[]
  | SymbolInformation[]
  | null;
export type LspWorkspaceSymbolResult =
  | SymbolInformation[]
  | WorkspaceSymbol[]
  | null;

export interface LspServerManager {
  hover(filePath: string, position: Position): Promise<Hover | null>;
  definition(filePath: string, position: Position): Promise<LspDefinitionResult>;
  references(input: {
    filePath: string;
    position: Position;
    includeDeclaration: boolean;
  }): Promise<Location[] | null>;
  documentSymbols(filePath: string): Promise<LspDocumentSymbolResult>;
  workspaceSymbols(query: string): Promise<LspWorkspaceSymbolResult>;
  diagnostics(filePath: string): Promise<Diagnostic[]>;
  dispose(): Promise<void>;
}

export function createLspServerManager(options: {
  workingDirectory: string;
  requestTimeoutMs?: number;
}): LspServerManager {
  return new TypeScriptLspServerManager(options);
}

class TypeScriptLspServerManager implements LspServerManager {
  private connectionState: LspConnectionState | null = null;
  private startPromise: Promise<LspConnectionState> | null = null;
  private readonly documents = new Map<string, OpenDocumentState>();
  private readonly diagnosticsByUri = new Map<string, Diagnostic[]>();
  private disposed = false;

  constructor(
    private readonly options: {
      workingDirectory: string;
      requestTimeoutMs?: number;
    }
  ) {}

  async hover(filePath: string, position: Position): Promise<Hover | null> {
    const uri = await this.syncDocument(filePath);
    return this.sendRequest(HoverRequest.type.method, {
      textDocument: { uri },
      position
    });
  }

  async definition(
    filePath: string,
    position: Position
  ): Promise<LspDefinitionResult> {
    const uri = await this.syncDocument(filePath);
    return this.sendRequest(DefinitionRequest.type.method, {
      textDocument: { uri },
      position
    });
  }

  async references(input: {
    filePath: string;
    position: Position;
    includeDeclaration: boolean;
  }): Promise<Location[] | null> {
    const uri = await this.syncDocument(input.filePath);
    return this.sendRequest(ReferencesRequest.type.method, {
      textDocument: { uri },
      position: input.position,
      context: {
        includeDeclaration: input.includeDeclaration
      }
    });
  }

  async documentSymbols(filePath: string): Promise<LspDocumentSymbolResult> {
    const uri = await this.syncDocument(filePath);
    return this.sendRequest(DocumentSymbolRequest.type.method, {
      textDocument: { uri }
    });
  }

  async workspaceSymbols(query: string): Promise<LspWorkspaceSymbolResult> {
    await this.ensureConnection();
    return this.sendRequest(WorkspaceSymbolRequest.type.method, { query });
  }

  async diagnostics(filePath: string): Promise<Diagnostic[]> {
    const uri = await this.syncDocument(filePath);
    await new Promise((resolve) => setTimeout(resolve, 750));
    return this.diagnosticsByUri.get(uri) ?? [];
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const state = this.connectionState;
    this.connectionState = null;
    this.startPromise = null;
    this.documents.clear();
    this.diagnosticsByUri.clear();

    if (!state) {
      return;
    }

    try {
      await withTimeout(
        state.connection.sendRequest("shutdown"),
        SHUTDOWN_TIMEOUT_MS,
        () => new LspRequestTimeoutError("LSP shutdown timed out.")
      );
      state.connection.sendNotification("exit");
    } catch {
      state.child.kill("SIGTERM");
    } finally {
      state.connection.dispose();
      if (!state.child.killed) {
        state.child.kill("SIGTERM");
      }
    }
  }

  private async ensureConnection(): Promise<LspConnectionState> {
    if (this.disposed) {
      throw new LspServerUnavailableError("LSP manager has been disposed.");
    }
    if (this.connectionState) {
      return this.connectionState;
    }
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startServer();
    try {
      this.connectionState = await this.startPromise;
      return this.connectionState;
    } finally {
      this.startPromise = null;
    }
  }

  private async startServer(): Promise<LspConnectionState> {
    const serverPath = resolveTypeScriptLanguageServerPath();
    const child = spawn(process.execPath, [serverPath, "--stdio"], {
      cwd: this.options.workingDirectory,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4_000);
    });

    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin)
    );
    this.registerClientHandlers(connection);
    connection.listen();

    const state = {
      child,
      connection,
      get stderr() {
        return stderr;
      }
    } satisfies LspConnectionState;

    const rootUri = pathToFileURL(path.resolve(this.options.workingDirectory)).href;
    const initializeParams: InitializeParams = {
      processId: typeof process.pid === "number" ? process.pid : null,
      rootUri,
      capabilities: {
        textDocument: {
          synchronization: {
            didSave: true
          },
          hover: {
            contentFormat: ["markdown", "plaintext"]
          },
          definition: {},
          references: {},
          documentSymbol: {
            hierarchicalDocumentSymbolSupport: true
          },
          publishDiagnostics: {
            relatedInformation: true
          }
        },
        workspace: {
          configuration: true,
          workspaceFolders: true,
          symbol: {}
        }
      },
      workspaceFolders: [
        {
          uri: rootUri,
          name: path.basename(path.resolve(this.options.workingDirectory))
        }
      ]
    };

    try {
      await withTimeout(
        connection.sendRequest(InitializeRequest.type.method, initializeParams),
        this.requestTimeoutMs(),
        () => new LspRequestTimeoutError("LSP initialize request timed out.")
      );
      connection.sendNotification("initialized", {});
      return state;
    } catch (error) {
      connection.dispose();
      child.kill("SIGTERM");
      if (error instanceof LspRequestTimeoutError) {
        throw error;
      }
      throw new LspServerUnavailableError(
        `TypeScript LSP server failed to initialize.${stderr ? ` ${stderr}` : ""}`
      );
    }
  }

  private registerClientHandlers(connection: MessageConnection): void {
    connection.onNotification(
      PublishDiagnosticsNotification.type.method,
      (params: { uri: string; diagnostics: Diagnostic[] }) => {
      this.diagnosticsByUri.set(params.uri, params.diagnostics);
      }
    );
    connection.onRequest("workspace/configuration", (params: unknown) => {
      const items = isRecord(params) && Array.isArray(params.items)
        ? params.items
        : [];
      return items.map(() => ({}));
    });
    connection.onRequest("workspace/workspaceFolders", () => [
      {
        uri: pathToFileURL(path.resolve(this.options.workingDirectory)).href,
        name: path.basename(path.resolve(this.options.workingDirectory))
      }
    ]);
    connection.onRequest("client/registerCapability", () => null);
    connection.onRequest("window/workDoneProgress/create", () => null);
    connection.onRequest("workspace/diagnostic/refresh", () => null);
    connection.onRequest("workspace/semanticTokens/refresh", () => null);
    connection.onRequest("workspace/inlayHint/refresh", () => null);
  }

  private async syncDocument(filePath: string): Promise<string> {
    const state = await this.ensureConnection();
    const absolutePath = path.resolve(filePath);
    const text = await fs.readFile(absolutePath, "utf8");
    const uri = pathToFileURL(absolutePath).href;
    const existing = this.documents.get(absolutePath);

    if (!existing) {
      const document = {
        uri,
        text,
        version: 1,
        languageId: languageIdForPath(absolutePath)
      };
      this.documents.set(absolutePath, document);
      state.connection.sendNotification(DidOpenTextDocumentNotification.type.method, {
        textDocument: {
          uri,
          languageId: document.languageId,
          version: document.version,
          text
        }
      });
      return uri;
    }

    if (existing.text === text) {
      return existing.uri;
    }

    const nextVersion = existing.version + 1;
    this.documents.set(absolutePath, {
      ...existing,
      text,
      version: nextVersion
    });
    state.connection.sendNotification(DidChangeTextDocumentNotification.type.method, {
      textDocument: {
        uri,
        version: nextVersion
      },
      contentChanges: [{ text }]
    });

    return uri;
  }

  private async sendRequest<P, R>(method: string, params: P): Promise<R> {
    const state = await this.ensureConnection();
    try {
      return await withTimeout(
        state.connection.sendRequest(method, params) as Promise<R>,
        this.requestTimeoutMs(),
        () => new LspRequestTimeoutError("LSP request timed out.")
      );
    } catch (error) {
      if (error instanceof LspRequestTimeoutError) {
        throw error;
      }
      throw new LspServerUnavailableError(
        `TypeScript LSP request failed.${state.stderr ? ` ${state.stderr}` : ""}`
      );
    }
  }

  private requestTimeoutMs(): number {
    return this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }
}

function resolveTypeScriptLanguageServerPath(): string {
  return require.resolve("typescript-language-server/lib/cli.mjs");
}

function languageIdForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".tsx") {
    return "typescriptreact";
  }
  if (extension === ".jsx") {
    return "javascriptreact";
  }
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return "javascript";
  }
  return "typescript";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  createError: () => Error
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(createError()), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
