import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";
import {
  DiagnosticSeverity,
  SymbolKind,
  type Diagnostic,
  type DocumentSymbol,
  type Hover,
  type Location,
  type LocationLink,
  type MarkedString,
  type MarkupContent,
  type Range,
  type SymbolInformation,
  type WorkspaceSymbol
} from "vscode-languageserver-protocol";

import {
  createLspServerManager,
  LspRequestTimeoutError,
  LspServerUnavailableError,
  type LspDocumentSymbolResult,
  type LspServerManager,
  type LspWorkspaceSymbolResult
} from "../lsp/index.js";
import type { JsonValue } from "../types.js";
import {
  normalizeWorkspacePath,
  toRelativeWorkspacePath
} from "./workspace.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";

const SUPPORTED_TS_JS_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs"
]);
const MAX_LOCATION_RESULTS = 50;
const MAX_SYMBOL_RESULTS = 80;

const lspPositionSchema = z.object({
  path: z.string().trim().min(1),
  line: z.number().int().positive(),
  character: z.number().int().min(0)
});

const lspReferencesSchema = lspPositionSchema.extend({
  includeDeclaration: z.boolean().optional()
});

const lspDocumentSchema = z.object({
  path: z.string().trim().min(1)
});

const lspWorkspaceSymbolSchema = z.object({
  query: z.string().trim().min(1),
  maxResults: z.number().int().positive().max(MAX_SYMBOL_RESULTS).optional()
});

class InvalidLspInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLspInputError";
  }
}

interface LspToolOptions {
  workingDirectory: string;
  lspServerManager?: LspServerManager;
}

interface NormalizedDocumentInput {
  absolutePath: string;
  relativePath: string;
}

interface NormalizedPositionInput extends NormalizedDocumentInput {
  line: number;
  character: number;
}

export function createLspTools(options: LspToolOptions): RuntimeTool[] {
  const manager =
    options.lspServerManager ??
    createLspServerManager({ workingDirectory: options.workingDirectory });

  return [
    createLspHoverTool(options.workingDirectory, manager),
    createLspGoToDefinitionTool(options.workingDirectory, manager),
    createLspFindReferencesTool(options.workingDirectory, manager),
    createLspDocumentSymbolsTool(options.workingDirectory, manager),
    createLspWorkspaceSymbolsTool(manager),
    createLspDiagnosticsTool(options.workingDirectory, manager)
  ];
}

function createLspHoverTool(
  workingDirectory: string,
  manager: LspServerManager
): RuntimeTool {
  return {
    name: "lsp_hover",
    description:
      "Read TypeScript or JavaScript hover information for a symbol at a file position.",
    family: "lsp",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "workspace-rooted",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative TS/JS file path."
        },
        line: {
          type: "number",
          description: "1-based line number."
        },
        character: {
          type: "number",
          description: "0-based UTF-16 character offset."
        }
      },
      required: ["path", "line", "character"],
      additionalProperties: false
    },
    getSandboxTargets: pathSandboxTarget,
    validate(input) {
      return validateLspInput(lspPositionSchema, input);
    },
    async execute(input) {
      const normalized = await normalizePositionInput(workingDirectory, input);
      if (normalized instanceof Error) {
        return invalidLspInputResult("lsp_hover", normalized.message);
      }

      try {
        const hover = await manager.hover(normalized.absolutePath, {
          line: normalized.line - 1,
          character: normalized.character
        });
        const text = hoverToText(hover);
        return successResult(
          createToolResult({
            ok: true,
            code: "LSP_HOVER_OK",
            message: text
              ? "Hover information loaded."
              : "No hover information found.",
            data: {
              path: normalized.relativePath,
              position: {
                line: normalized.line,
                character: normalized.character
              },
              text
            }
          }),
          `[lsp_hover] success\n- ${text ? "hover loaded" : "no hover information"}`
        );
      } catch (error) {
        return lspFailureResult("lsp_hover", error);
      }
    }
  };
}

function createLspGoToDefinitionTool(
  workingDirectory: string,
  manager: LspServerManager
): RuntimeTool {
  return {
    name: "lsp_go_to_definition",
    description:
      "Find TypeScript or JavaScript definition locations for a symbol at a file position.",
    family: "lsp",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "workspace-rooted",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative TS/JS file path."
        },
        line: { type: "number", description: "1-based line number." },
        character: {
          type: "number",
          description: "0-based UTF-16 character offset."
        }
      },
      required: ["path", "line", "character"],
      additionalProperties: false
    },
    getSandboxTargets: pathSandboxTarget,
    validate(input) {
      return validateLspInput(lspPositionSchema, input);
    },
    async execute(input) {
      const normalized = await normalizePositionInput(workingDirectory, input);
      if (normalized instanceof Error) {
        return invalidLspInputResult(
          "lsp_go_to_definition",
          normalized.message
        );
      }

      try {
        const definition = await manager.definition(normalized.absolutePath, {
          line: normalized.line - 1,
          character: normalized.character
        });
        const locations = await normalizeDefinitionLocations(
          workingDirectory,
          definition
        );
        return successResult(
          createToolResult({
            ok: true,
            code: "LSP_DEFINITION_OK",
            message:
              locations.length > 0
                ? "Definition locations loaded."
                : "No definition locations found.",
            data: {
              locations
            }
          }),
          `[lsp_go_to_definition] success\n- ${locations.length} location(s)`
        );
      } catch (error) {
        return lspFailureResult("lsp_go_to_definition", error);
      }
    }
  };
}

function createLspFindReferencesTool(
  workingDirectory: string,
  manager: LspServerManager
): RuntimeTool {
  return {
    name: "lsp_find_references",
    description:
      "Find TypeScript or JavaScript references for a symbol at a file position.",
    family: "lsp",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "workspace-rooted",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative TS/JS file path."
        },
        line: { type: "number", description: "1-based line number." },
        character: {
          type: "number",
          description: "0-based UTF-16 character offset."
        },
        includeDeclaration: {
          type: "boolean",
          description: "Whether to include the declaration itself."
        }
      },
      required: ["path", "line", "character"],
      additionalProperties: false
    },
    getSandboxTargets: pathSandboxTarget,
    validate(input) {
      return validateLspInput(lspReferencesSchema, input);
    },
    async execute(input) {
      const normalized = await normalizePositionInput(workingDirectory, input);
      if (normalized instanceof Error) {
        return invalidLspInputResult("lsp_find_references", normalized.message);
      }

      try {
        const references = await manager.references({
          filePath: normalized.absolutePath,
          position: {
            line: normalized.line - 1,
            character: normalized.character
          },
          includeDeclaration: input.includeDeclaration === true
        });
        const locations = await normalizeLocations(
          workingDirectory,
          references ?? []
        );
        return successResult(
          createToolResult({
            ok: true,
            code: "LSP_REFERENCES_OK",
            message:
              locations.length > 0
                ? "Reference locations loaded."
                : "No references found.",
            data: {
              locations
            }
          }),
          `[lsp_find_references] success\n- ${locations.length} location(s)`
        );
      } catch (error) {
        return lspFailureResult("lsp_find_references", error);
      }
    }
  };
}

function createLspDocumentSymbolsTool(
  workingDirectory: string,
  manager: LspServerManager
): RuntimeTool {
  return {
    name: "lsp_document_symbols",
    description: "List TypeScript or JavaScript symbols declared in a file.",
    family: "lsp",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "workspace-rooted",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative TS/JS file path."
        }
      },
      required: ["path"],
      additionalProperties: false
    },
    getSandboxTargets: pathSandboxTarget,
    validate(input) {
      return validateLspInput(lspDocumentSchema, input);
    },
    async execute(input) {
      const normalized = normalizeDocumentInput(workingDirectory, input);
      if (normalized instanceof Error) {
        return invalidLspInputResult(
          "lsp_document_symbols",
          normalized.message
        );
      }
      const readableError = await validateReadableFile(normalized.absolutePath);
      if (readableError) {
        return invalidLspInputResult("lsp_document_symbols", readableError);
      }

      try {
        const symbols = await manager.documentSymbols(normalized.absolutePath);
        const items = normalizeDocumentSymbols(symbols).slice(
          0,
          MAX_SYMBOL_RESULTS
        );
        return successResult(
          createToolResult({
            ok: true,
            code: "LSP_DOCUMENT_SYMBOLS_OK",
            message: "Document symbols loaded.",
            data: {
              path: normalized.relativePath,
              symbols: items
            }
          }),
          `[lsp_document_symbols] success\n- ${items.length} symbol(s)`
        );
      } catch (error) {
        return lspFailureResult("lsp_document_symbols", error);
      }
    }
  };
}

function createLspWorkspaceSymbolsTool(manager: LspServerManager): RuntimeTool {
  return {
    name: "lsp_workspace_symbols",
    description:
      "Search TypeScript or JavaScript symbols across the workspace.",
    family: "lsp",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "workspace-rooted",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Symbol query string." },
        maxResults: {
          type: "number",
          description: `Maximum number of symbols to return, up to ${MAX_SYMBOL_RESULTS}.`
        }
      },
      required: ["query"],
      additionalProperties: false
    },
    getSandboxTargets() {
      return ["."];
    },
    validate(input) {
      return validateWithSchema(lspWorkspaceSymbolSchema, input);
    },
    async execute(input, context) {
      const maxResults =
        typeof input.maxResults === "number"
          ? Math.min(input.maxResults, MAX_SYMBOL_RESULTS)
          : MAX_SYMBOL_RESULTS;
      try {
        const result = await manager.workspaceSymbols(String(input.query));
        const symbols = await normalizeWorkspaceSymbols(
          context.workingDirectory,
          result,
          maxResults
        );
        return successResult(
          createToolResult({
            ok: true,
            code: "LSP_WORKSPACE_SYMBOLS_OK",
            message: "Workspace symbols loaded.",
            data: {
              symbols
            }
          }),
          `[lsp_workspace_symbols] success\n- ${symbols.length} symbol(s)`
        );
      } catch (error) {
        return lspFailureResult("lsp_workspace_symbols", error);
      }
    }
  };
}

function createLspDiagnosticsTool(
  workingDirectory: string,
  manager: LspServerManager
): RuntimeTool {
  return {
    name: "lsp_diagnostics",
    description:
      "Read TypeScript or JavaScript diagnostics for a workspace file.",
    family: "lsp",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "workspace-rooted",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative TS/JS file path."
        }
      },
      required: ["path"],
      additionalProperties: false
    },
    getSandboxTargets: pathSandboxTarget,
    validate(input) {
      return validateLspInput(lspDocumentSchema, input);
    },
    async execute(input) {
      const normalized = normalizeDocumentInput(workingDirectory, input);
      if (normalized instanceof Error) {
        return invalidLspInputResult("lsp_diagnostics", normalized.message);
      }
      const readableError = await validateReadableFile(normalized.absolutePath);
      if (readableError) {
        return invalidLspInputResult("lsp_diagnostics", readableError);
      }

      try {
        const diagnostics = await manager.diagnostics(normalized.absolutePath);
        const items = diagnostics.map(normalizeDiagnostic);
        return successResult(
          createToolResult({
            ok: true,
            code: "LSP_DIAGNOSTICS_OK",
            message: "Diagnostics loaded.",
            data: {
              path: normalized.relativePath,
              diagnostics: items
            }
          }),
          `[lsp_diagnostics] success\n- ${items.length} diagnostic(s)`
        );
      } catch (error) {
        return lspFailureResult("lsp_diagnostics", error);
      }
    }
  };
}

function pathSandboxTarget(input: Record<string, JsonValue>): string[] {
  return [typeof input.path === "string" ? input.path : "."];
}

function validateLspInput(
  schema: z.ZodType<Record<string, unknown>>,
  input: Record<string, unknown>
) {
  const validation = validateWithSchema(schema, input);
  if (!validation.ok) {
    return validation;
  }
  if (
    typeof input.path === "string" &&
    !SUPPORTED_TS_JS_EXTENSIONS.has(path.extname(input.path).toLowerCase())
  ) {
    return {
      ok: false,
      issues: [
        {
          field: "path",
          issue: "path must point to a supported TS/JS file."
        }
      ]
    };
  }
  return validation;
}

function normalizeDocumentInput(
  workingDirectory: string,
  input: Record<string, JsonValue>
): NormalizedDocumentInput | Error {
  if (typeof input.path !== "string") {
    return new InvalidLspInputError("path must be a string.");
  }
  if (!SUPPORTED_TS_JS_EXTENSIONS.has(path.extname(input.path).toLowerCase())) {
    return new InvalidLspInputError(
      "path must point to a supported TS/JS file."
    );
  }

  try {
    const absolutePath = normalizeWorkspacePath(workingDirectory, input.path);
    return {
      absolutePath,
      relativePath: toRelativeWorkspacePath(workingDirectory, absolutePath)
    };
  } catch {
    return new InvalidLspInputError("path must stay inside the workspace.");
  }
}

async function normalizePositionInput(
  workingDirectory: string,
  input: Record<string, JsonValue>
): Promise<NormalizedPositionInput | Error> {
  const document = normalizeDocumentInput(workingDirectory, input);
  if (document instanceof Error) {
    return document;
  }
  if (typeof input.line !== "number" || input.line < 1) {
    return new InvalidLspInputError("line must be a positive 1-based number.");
  }
  if (typeof input.character !== "number" || input.character < 0) {
    return new InvalidLspInputError("character must be a 0-based number.");
  }

  try {
    const text = await fs.readFile(document.absolutePath, "utf8");
    const lines = text.split(/\r\n|\r|\n/);
    const lineText = lines[input.line - 1];
    if (lineText === undefined) {
      return new InvalidLspInputError("line is outside the file.");
    }
    if (input.character > lineText.length) {
      return new InvalidLspInputError("character is outside the line.");
    }
  } catch {
    return new InvalidLspInputError("path must point to a readable file.");
  }

  return {
    ...document,
    line: input.line,
    character: input.character
  };
}

async function validateReadableFile(
  absolutePath: string
): Promise<string | null> {
  try {
    await fs.access(absolutePath);
    return null;
  } catch {
    return "path must point to a readable file.";
  }
}

function invalidLspInputResult(toolName: string, message: string) {
  return failureResult(
    createToolResult({
      ok: false,
      code: "INVALID_TOOL_INPUT",
      message
    }),
    `[${toolName}] invalid input\n- ${message}`
  );
}

function lspFailureResult(toolName: string, error: unknown) {
  if (error instanceof LspRequestTimeoutError) {
    return failureResult(
      createToolResult({
        ok: false,
        code: "LSP_REQUEST_TIMEOUT",
        message: error.message
      }),
      `[${toolName}] failed\n- ${error.message}`
    );
  }
  if (error instanceof LspServerUnavailableError) {
    return failureResult(
      createToolResult({
        ok: false,
        code: "LSP_SERVER_UNAVAILABLE",
        message: error.message
      }),
      `[${toolName}] failed\n- ${error.message}`
    );
  }

  const message = error instanceof Error ? error.message : "Unknown LSP error.";
  return failureResult(
    createToolResult({
      ok: false,
      code: "LSP_SERVER_UNAVAILABLE",
      message
    }),
    `[${toolName}] failed\n- ${message}`
  );
}

function hoverToText(hover: Hover | null): string {
  if (!hover) {
    return "";
  }
  return markupToText(hover.contents).slice(0, 4_000);
}

function markupToText(
  value: MarkupContent | MarkedString | MarkedString[]
): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(markupToText).filter(Boolean).join("\n\n");
  }
  if ("value" in value && typeof value.value === "string") {
    return value.value;
  }
  return "";
}

async function normalizeDefinitionLocations(
  workingDirectory: string,
  result: Location | Location[] | LocationLink[] | null
) {
  if (!result) {
    return [];
  }
  const locations = Array.isArray(result) ? result : [result];
  return normalizeLocations(
    workingDirectory,
    locations.map((item) =>
      "targetUri" in item
        ? {
            uri: item.targetUri,
            range: item.targetRange
          }
        : item
    )
  );
}

async function normalizeLocations(
  workingDirectory: string,
  locations: Location[]
) {
  const limited = locations.slice(0, MAX_LOCATION_RESULTS);
  const normalized = [];
  for (const location of limited) {
    let absolutePath: string;
    let relativePath: string;
    try {
      absolutePath = fileURLToPath(location.uri);
      relativePath = toRelativeWorkspacePath(workingDirectory, absolutePath);
    } catch {
      continue;
    }
    normalized.push({
      path: relativePath,
      range: normalizeRange(location.range),
      preview: await readLinePreview(absolutePath, location.range.start.line)
    });
  }
  return normalized;
}

function normalizeDocumentSymbols(result: LspDocumentSymbolResult) {
  if (!result) {
    return [];
  }
  const items = [];
  for (const symbol of result) {
    if (isDocumentSymbol(symbol)) {
      items.push(...flattenDocumentSymbol(symbol));
    } else {
      items.push({
        name: symbol.name,
        kind: symbolKindName(symbol.kind),
        range: normalizeRange(symbol.location.range),
        containerName: symbol.containerName ?? null
      });
    }
  }
  return items;
}

function flattenDocumentSymbol(
  symbol: DocumentSymbol,
  containerName: string | null = null
): Array<Record<string, JsonValue>> {
  const current = {
    name: symbol.name,
    kind: symbolKindName(symbol.kind),
    range: normalizeRange(symbol.range),
    selectionRange: normalizeRange(symbol.selectionRange),
    containerName
  };
  const children = (symbol.children ?? []).flatMap((child) =>
    flattenDocumentSymbol(child, symbol.name)
  );
  return [current, ...children];
}

async function normalizeWorkspaceSymbols(
  workingDirectory: string,
  result: LspWorkspaceSymbolResult,
  maxResults: number
) {
  if (!result) {
    return [];
  }
  const symbols = [];
  for (const symbol of result.slice(0, maxResults)) {
    const location = symbol.location;
    const uri = location.uri;
    let absolutePath: string;
    let relativePath: string;
    try {
      absolutePath = fileURLToPath(uri);
      relativePath = toRelativeWorkspacePath(workingDirectory, absolutePath);
    } catch {
      continue;
    }
    const range = "range" in location ? normalizeRange(location.range) : null;
    symbols.push({
      name: symbol.name,
      kind: symbolKindName(symbol.kind),
      path: relativePath,
      range,
      containerName:
        "containerName" in symbol ? (symbol.containerName ?? null) : null
    });
  }
  return symbols;
}

function normalizeDiagnostic(diagnostic: Diagnostic) {
  return {
    message: diagnostic.message,
    severity: diagnosticSeverityName(diagnostic.severity),
    range: normalizeRange(diagnostic.range),
    source: diagnostic.source ?? null,
    code:
      typeof diagnostic.code === "string" || typeof diagnostic.code === "number"
        ? String(diagnostic.code)
        : null
  };
}

function normalizeRange(range: Range) {
  return {
    start: {
      line: range.start.line + 1,
      character: range.start.character
    },
    end: {
      line: range.end.line + 1,
      character: range.end.character
    }
  };
}

async function readLinePreview(
  absolutePath: string,
  zeroBasedLine: number
): Promise<string> {
  try {
    const text = await fs.readFile(absolutePath, "utf8");
    return (text.split(/\r\n|\r|\n/)[zeroBasedLine] ?? "").trim().slice(0, 240);
  } catch {
    return "";
  }
}

function isDocumentSymbol(
  value: DocumentSymbol | SymbolInformation
): value is DocumentSymbol {
  return "selectionRange" in value;
}

function symbolKindName(kind: SymbolKind): string {
  switch (kind) {
    case SymbolKind.File:
      return "File";
    case SymbolKind.Module:
      return "Module";
    case SymbolKind.Namespace:
      return "Namespace";
    case SymbolKind.Package:
      return "Package";
    case SymbolKind.Class:
      return "Class";
    case SymbolKind.Method:
      return "Method";
    case SymbolKind.Property:
      return "Property";
    case SymbolKind.Field:
      return "Field";
    case SymbolKind.Constructor:
      return "Constructor";
    case SymbolKind.Enum:
      return "Enum";
    case SymbolKind.Interface:
      return "Interface";
    case SymbolKind.Function:
      return "Function";
    case SymbolKind.Variable:
      return "Variable";
    case SymbolKind.Constant:
      return "Constant";
    case SymbolKind.String:
      return "String";
    case SymbolKind.Number:
      return "Number";
    case SymbolKind.Boolean:
      return "Boolean";
    case SymbolKind.Array:
      return "Array";
    case SymbolKind.Object:
      return "Object";
    case SymbolKind.Key:
      return "Key";
    case SymbolKind.Null:
      return "Null";
    case SymbolKind.EnumMember:
      return "EnumMember";
    case SymbolKind.Struct:
      return "Struct";
    case SymbolKind.Event:
      return "Event";
    case SymbolKind.Operator:
      return "Operator";
    case SymbolKind.TypeParameter:
      return "TypeParameter";
    default:
      return `Symbol${kind}`;
  }
}

function diagnosticSeverityName(
  severity: DiagnosticSeverity | undefined
): string {
  if (severity === DiagnosticSeverity.Error) {
    return "error";
  }
  if (severity === DiagnosticSeverity.Warning) {
    return "warning";
  }
  if (severity === DiagnosticSeverity.Information) {
    return "information";
  }
  if (severity === DiagnosticSeverity.Hint) {
    return "hint";
  }
  return "unknown";
}
