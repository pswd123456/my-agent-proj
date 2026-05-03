import { createReadStream, promises as fs } from "node:fs";
import readline from "node:readline";

import type { JsonValue } from "../types.js";
import type { RuntimeTool, ToolExecutionContext } from "./runtime-tool.js";
import {
  assessRepeatedWorkspaceActivity,
  normalizeWorkspacePath,
  toRelativeWorkspacePath
} from "./workspace.js";
import {
  createToolResult,
  failureResult,
  successResult
} from "./tool-result.js";
import {
  buildToolDescription,
  describeObjectProperty
} from "./tool-description.js";
import { estimateTextTokens } from "../runtime/token-budget.js";
import { findPreviousReadMetadata } from "./read-file-metadata.js";

const MAX_SAFE_READ_FILE_BYTES = 2_000_000;
const MAX_SAFE_OUTPUT_CHARACTERS = 200_000;
const MAX_SAFE_OUTPUT_TOKENS = 25_000;
const BINARY_SAMPLE_BYTES = 4_096;
const UNCHANGED_READ_STUB =
  "File unchanged since last read. Reuse the previous content already in context.";

function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

interface ReadWindowRequest {
  offset: number;
  limit: number | null;
  startLine: number;
  endLine: number | null;
}

interface ReadWindowResult {
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}

function normalizeReadWindowRequest(
  input: Record<string, JsonValue>
): ReadWindowRequest {
  const legacyStartLine = normalizePositiveInteger(input.startLine);
  const legacyEndLine = normalizePositiveInteger(input.endLine);
  const offset = normalizeNonNegativeInteger(input.offset);
  const limit = normalizePositiveInteger(input.limit);

  if (offset !== null || limit !== null) {
    const normalizedOffset = offset ?? 0;
    const normalizedLimit = limit;
    return {
      offset: normalizedOffset,
      limit: normalizedLimit,
      startLine: normalizedOffset + 1,
      endLine:
        normalizedLimit === null ? null : normalizedOffset + normalizedLimit
    };
  }

  const startLine = legacyStartLine ?? 1;
  return {
    offset: startLine - 1,
    limit: legacyEndLine === null ? null : legacyEndLine - startLine + 1,
    startLine,
    endLine: legacyEndLine
  };
}

function readLineRange(
  content: string,
  startLine: number | null,
  endLine: number | null,
  maxCharacters: number | null
): ReadWindowResult {
  const lines =
    content.length === 0
      ? []
      : content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const totalLines = lines.length;
  const normalizedStartLine = startLine ?? 1;
  const normalizedEndLine = endLine ?? totalLines;
  const selectedLines = lines.slice(normalizedStartLine - 1, normalizedEndLine);
  const selectedContent = selectedLines.join("\n");

  if (maxCharacters === null || selectedContent.length <= maxCharacters) {
    return {
      content: selectedContent,
      startLine: normalizedStartLine,
      endLine: normalizedEndLine,
      totalLines,
      truncated: false
    };
  }

  return {
    content: selectedContent.slice(0, maxCharacters),
    startLine: normalizedStartLine,
    endLine: normalizedEndLine,
    totalLines,
    truncated: true
  };
}

async function readLineRangeFromStream(input: {
  filePath: string;
  startLine: number;
  endLine: number;
  maxCharacters: number;
}): Promise<ReadWindowResult> {
  const stream = createReadStream(input.filePath, { encoding: "utf8" });
  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  let totalLines = 0;
  let content = "";
  let truncated = false;

  try {
    for await (const line of lineReader) {
      totalLines += 1;
      if (totalLines < input.startLine || totalLines > input.endLine) {
        continue;
      }

      if (truncated) {
        continue;
      }

      const nextSegment = content.length === 0 ? line : `\n${line}`;
      const remaining = input.maxCharacters - content.length;
      if (nextSegment.length <= remaining) {
        content += nextSegment;
        continue;
      }

      content += nextSegment.slice(0, Math.max(0, remaining));
      truncated = true;
    }
  } finally {
    lineReader.close();
    stream.destroy();
  }

  return {
    content,
    startLine: input.startLine,
    endLine: Math.min(input.endLine, totalLines),
    totalLines,
    truncated
  };
}

function readFileVersion(stat: Awaited<ReturnType<typeof fs.stat>>): {
  sizeBytes: number;
  modifiedAt: string;
  modifiedAtMs: number;
} {
  const sizeBytes =
    typeof stat.size === "bigint" ? Number(stat.size) : stat.size;
  const modifiedAtMs =
    typeof stat.mtimeMs === "bigint" ? Number(stat.mtimeMs) : stat.mtimeMs;

  return {
    sizeBytes,
    modifiedAt: stat.mtime.toISOString(),
    modifiedAtMs
  };
}

function isProbablyBinary(sample: Buffer): boolean {
  if (sample.length === 0) {
    return false;
  }

  let suspiciousBytes = 0;
  for (const value of sample) {
    if (value === 0) {
      return true;
    }
    if (
      value < 7 ||
      (value > 14 && value < 32 && value !== 9 && value !== 10 && value !== 13)
    ) {
      suspiciousBytes += 1;
    }
  }

  return suspiciousBytes / sample.length > 0.3;
}

export function createReadFileTool(workingDirectory: string): RuntimeTool {
  return {
    name: "read_file",
    description: buildToolDescription({
      usageScenarios: [
        "Read a workspace text file after you already know the target path.",
        "Inspect only the relevant section of a file before editing, reviewing, or answering a code question.",
        "Page through large files without loading the whole file into model context."
      ],
      usageInstructions: [
        "Step 1: if the relevant section is unknown, call search_text first to find the file and line numbers.",
        "Step 2: set path to the workspace-relative file path.",
        "Step 3: choose exactly one line-window form.",
        describeObjectProperty({
          name: "startLine",
          type: "number",
          description:
            "1-based first line to read; use together with endLine when you already know the line range."
        }),
        describeObjectProperty({
          name: "endLine",
          type: "number",
          description:
            "1-based inclusive last line to read; use together with startLine."
        }),
        describeObjectProperty({
          name: "offset",
          type: "number",
          description:
            "0-based line offset for paging; use together with limit when reading adjacent windows."
        }),
        describeObjectProperty({
          name: "limit",
          type: "number",
          description:
            "Number of lines to read starting from offset."
        }),
        describeObjectProperty({
          name: "maxCharacters",
          type: "number",
          description:
            "Optional output cap after the line window is selected."
        })
      ],
      constraints: [
        "Use search_text first before read_file when the relevant section is not already known.",
        "Use exactly one window form: either {startLine,endLine} or {offset,limit}. Never combine the two forms.",
        "For large or uncertain files, read a narrow window instead of the whole file.",
        "read_file is for text files only; binary files and oversized outputs are rejected.",
        "If the tool says the file is unchanged, reuse the previous content already in context instead of rereading it."
      ],
      examples: [
        '{"path":"apps/web/app/_components/session-workbench-conversation.tsx","startLine":3025,"endLine":3045}',
        '{"path":"packages/agent/src/prompt.ts","offset":100,"limit":40}',
        '{"path":"README.md","startLine":1,"endLine":40,"maxCharacters":4000}'
      ]
    }),
    family: "workspace-file",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "workspace-rooted",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to the workspace root."
        },
        maxCharacters: {
          type: "number",
          description:
            "Optional character cap for the returned content. This does not select lines; use it only after choosing a line window."
        },
        offset: {
          type: "number",
          description:
            "Optional 0-based line offset. Use with limit only; do not include startLine or endLine."
        },
        limit: {
          type: "number",
          description:
            "Optional line count to read starting from offset. Use with offset only; do not include startLine or endLine."
        },
        startLine: {
          type: "number",
          description:
            "Optional 1-based first line to read. Use with endLine; do not include offset or limit."
        },
        endLine: {
          type: "number",
          description:
            "Optional 1-based last line to read, inclusive. Use with startLine; do not include offset or limit."
        }
      },
      required: ["path"],
      additionalProperties: false
    },
    getSandboxTargets(input) {
      return [
        typeof input.path === "string" && input.path.length > 0
          ? input.path
          : "."
      ];
    },
    validate(input) {
      const issues: Array<{ field: string; issue: string }> = [];
      const path = input.path;
      if (typeof path !== "string" || path.length === 0) {
        issues.push({
          field: "path",
          issue: "path is required."
        });
      }

      const startLine = normalizePositiveInteger(input.startLine);
      const endLine = normalizePositiveInteger(input.endLine);
      const offset = normalizeNonNegativeInteger(input.offset);
      const limit = normalizePositiveInteger(input.limit);
      if (input.startLine !== undefined && startLine === null) {
        issues.push({
          field: "startLine",
          issue: "startLine must be a positive number."
        });
      }
      if (input.endLine !== undefined && endLine === null) {
        issues.push({
          field: "endLine",
          issue: "endLine must be a positive number."
        });
      }
      if (input.offset !== undefined && offset === null) {
        issues.push({
          field: "offset",
          issue: "offset must be a non-negative number."
        });
      }
      if (input.limit !== undefined && limit === null) {
        issues.push({
          field: "limit",
          issue: "limit must be a positive number."
        });
      }
      const maxCharacters = normalizePositiveInteger(input.maxCharacters);
      if (input.maxCharacters !== undefined && maxCharacters === null) {
        issues.push({
          field: "maxCharacters",
          issue: "maxCharacters must be a positive number."
        });
      }
      if (
        (input.offset !== undefined || input.limit !== undefined) &&
        (input.startLine !== undefined || input.endLine !== undefined)
      ) {
        issues.push({
          field: "lineWindow",
          issue:
            "Choose exactly one read window syntax: either {offset, limit} or {startLine, endLine}. Remove limit/offset when using startLine/endLine; remove startLine/endLine when using offset/limit."
        });
      }
      if (startLine !== null && endLine !== null && endLine < startLine) {
        issues.push({
          field: "endLine",
          issue: "endLine must be greater than or equal to startLine."
        });
      }

      if (issues.length > 0) {
        return { ok: false, issues };
      }

      return { ok: true, value: input };
    },
    async execute(input, context) {
      const validation = this.validate(input);
      if (!validation.ok) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message: "Invalid read_file input.",
            validationErrors: validation.issues ?? []
          }),
          `[read_file] invalid input\n${(validation.issues ?? [])
            .map((issue) => `- ${issue.field}: ${issue.issue}`)
            .join("\n")}`
        );
      }

      const rawPath = input.path;
      if (typeof rawPath !== "string" || rawPath.length === 0) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message: "Missing file path.",
            validationErrors: [
              {
                field: "path",
                issue: "path is required."
              }
            ]
          }),
          "[read_file] invalid input\n- path: path is required."
        );
      }

      const maxCharacters = normalizePositiveInteger(input.maxCharacters);
      const readWindow = normalizeReadWindowRequest(input);

      try {
        const repeatedActivity = assessRepeatedWorkspaceActivity({
          toolName: "read_file",
          toolInput: input,
          workingDirectory,
          sessionMessages: context.sessionMessages
        });
        if (repeatedActivity.shouldBlock) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "REPEATED_WORKSPACE_ACCESS_BLOCKED",
              message:
                "Repeated read_file calls for the same target were blocked to stop a loop.",
              data: {
                repeatCount: repeatedActivity.repeatCount
              }
            }),
            `[read_file] blocked\n- repeated reads detected (${repeatedActivity.repeatCount} recent attempts)`
          );
        }

        const absolutePath = normalizeWorkspacePath(
          workingDirectory,
          rawPath,
          context.allowWorkspaceEscape
        );
        const stat = await fs.stat(absolutePath);
        const fileVersion = readFileVersion(stat);

        if (!stat.isFile()) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "TARGET_NOT_REGULAR_FILE",
              message: "Target is not a regular file."
            }),
            "[read_file] failed\n- target is not a regular file"
          );
        }

        const previousReadMetadata = findPreviousReadMetadata({
          sessionMessages: context.sessionMessages,
          workingDirectory,
          currentInput: input
        });
        const warnings = repeatedActivity.shouldWarn
          ? [
              `Repeated reads of the same target were detected (${repeatedActivity.repeatCount} recent attempts).`
            ]
          : [];

        if (
          previousReadMetadata &&
          previousReadMetadata.sizeBytes === fileVersion.sizeBytes &&
          previousReadMetadata.modifiedAtMs === fileVersion.modifiedAtMs
        ) {
          return successResult(
            createToolResult({
              ok: true,
              code: "FILE_READ_UNCHANGED_STUB",
              message: "File unchanged since last read.",
              data: {
                path: previousReadMetadata.path,
                offset: previousReadMetadata.offset,
                limit: previousReadMetadata.limit,
                startLine: previousReadMetadata.startLine,
                endLine: previousReadMetadata.endLine,
                totalLines: previousReadMetadata.totalLines,
                truncated: false,
                deduplicated: true,
                sizeBytes: previousReadMetadata.sizeBytes,
                modifiedAt: previousReadMetadata.modifiedAt,
                modifiedAtMs: previousReadMetadata.modifiedAtMs,
                content: UNCHANGED_READ_STUB,
                ...(warnings.length > 0 ? { warnings } : {})
              }
            }),
            `[read_file] success\n- ${previousReadMetadata.path}\n- unchanged stub returned${warnings.length > 0 ? "\n- warnings emitted" : ""}`
          );
        }

        if (stat.size > MAX_SAFE_READ_FILE_BYTES && readWindow.limit === null) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "READ_FILE_TOO_LARGE",
              message:
                "File is larger than the safe full-read limit. Use search_text to locate the relevant content first, then retry read_file with offset and limit or a finite line range.",
              data: {
                sizeBytes: stat.size,
                maxBytes: MAX_SAFE_READ_FILE_BYTES
              }
            }),
            `[read_file] failed\n- file exceeds safe full-read limit (${stat.size} bytes); use search_text first, then retry with offset and limit`
          );
        }

        const handle = await fs.open(absolutePath, "r");
        const sample = Buffer.alloc(Math.min(BINARY_SAMPLE_BYTES, stat.size));
        try {
          if (sample.length > 0) {
            await handle.read(sample, 0, sample.length, 0);
          }
        } finally {
          await handle.close();
        }
        if (isProbablyBinary(sample)) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "BINARY_FILE_NOT_SUPPORTED",
              message:
                "Binary files are not supported by read_file. Use a narrower text target."
            }),
            "[read_file] failed\n- binary files are not supported"
          );
        }

        if (
          maxCharacters !== null &&
          maxCharacters > MAX_SAFE_OUTPUT_CHARACTERS
        ) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "READ_OUTPUT_LIMIT_EXCEEDED",
              message:
                "Requested output exceeds the safe limit. Use search_text to locate the relevant content first, then narrow the line range, reduce maxCharacters, or retry read_file with offset and limit.",
              data: {
                maxOutputCharacters: MAX_SAFE_OUTPUT_CHARACTERS
              }
            }),
            `[read_file] failed\n- requested output exceeds ${MAX_SAFE_OUTPUT_CHARACTERS} characters; use search_text first, then retry with offset and limit`
          );
        }
        const outputCharacterLimit =
          maxCharacters ?? MAX_SAFE_OUTPUT_CHARACTERS;

        let lineRange: ReadWindowResult;
        if (stat.size > MAX_SAFE_READ_FILE_BYTES) {
          lineRange = await readLineRangeFromStream({
            filePath: absolutePath,
            startLine: readWindow.startLine,
            endLine: readWindow.endLine ?? Number.MAX_SAFE_INTEGER,
            maxCharacters: outputCharacterLimit
          });
        } else {
          const text = await fs.readFile(absolutePath, "utf8");
          const fullRange = readLineRange(
            text,
            readWindow.startLine,
            readWindow.endLine,
            null
          );
          if (
            maxCharacters === null &&
            fullRange.content.length > MAX_SAFE_OUTPUT_CHARACTERS
          ) {
            return failureResult(
              createToolResult({
                ok: false,
                code: "READ_OUTPUT_LIMIT_EXCEEDED",
                message:
                  "Requested output exceeds the safe limit. Use search_text to locate the relevant content first, then narrow the line range or retry read_file with offset and limit.",
                data: {
                  maxOutputCharacters: MAX_SAFE_OUTPUT_CHARACTERS
                }
              }),
              `[read_file] failed\n- requested output exceeds ${MAX_SAFE_OUTPUT_CHARACTERS} characters; use search_text first, then retry with offset and limit`
            );
          }
          lineRange = readLineRange(
            text,
            readWindow.startLine,
            readWindow.endLine,
            outputCharacterLimit
          );
        }

        if (maxCharacters === null && lineRange.truncated) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "READ_OUTPUT_LIMIT_EXCEEDED",
              message:
                "Requested output exceeds the safe limit. Use search_text to locate the relevant content first, then narrow the line range or retry read_file with offset and limit.",
              data: {
                maxOutputCharacters: MAX_SAFE_OUTPUT_CHARACTERS
              }
            }),
            `[read_file] failed\n- requested output exceeds ${MAX_SAFE_OUTPUT_CHARACTERS} characters; use search_text first, then retry with offset and limit`
          );
        }

        const estimatedOutputTokens = estimateTextTokens(lineRange.content);
        if (estimatedOutputTokens > MAX_SAFE_OUTPUT_TOKENS) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "READ_OUTPUT_TOKEN_LIMIT_EXCEEDED",
              message:
                "Requested output exceeds the safe token limit. Use search_text to locate the relevant content first, then narrow the line range or retry read_file with offset and limit.",
              data: {
                estimatedTokens: estimatedOutputTokens,
                maxOutputTokens: MAX_SAFE_OUTPUT_TOKENS
              }
            }),
            `[read_file] failed\n- requested output exceeds ${MAX_SAFE_OUTPUT_TOKENS} tokens; use search_text first, then retry with offset and limit`
          );
        }

        return successResult(
          createToolResult({
            ok: true,
            code: "FILE_READ_OK",
            message: "File read successfully.",
            data: {
              path: toRelativeWorkspacePath(workingDirectory, absolutePath),
              offset: readWindow.offset,
              limit: readWindow.limit,
              truncated: lineRange.truncated,
              startLine: lineRange.startLine,
              endLine: lineRange.endLine,
              totalLines: lineRange.totalLines,
              deduplicated: false,
              sizeBytes: fileVersion.sizeBytes,
              modifiedAt: fileVersion.modifiedAt,
              modifiedAtMs: fileVersion.modifiedAtMs,
              content: lineRange.content,
              ...(warnings.length > 0 ? { warnings } : {})
            }
          }),
          `[read_file] success\n- ${toRelativeWorkspacePath(
            workingDirectory,
            absolutePath
          )}${warnings.length > 0 ? "\n- warnings emitted" : ""}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failureResult(
          createToolResult({
            ok: false,
            code: "READ_FILE_FAILED",
            message
          }),
          `[read_file] failed\n- ${message}`
        );
      }
    }
  };
}
