import { promises as fs } from "node:fs";

import type { RuntimeTool } from "./runtime-tool.js";
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

const MAX_SAFE_READ_FILE_BYTES = 2_000_000;
const MAX_SAFE_OUTPUT_CHARACTERS = 200_000;
const BINARY_SAMPLE_BYTES = 4_096;

function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

function readLineRange(
  content: string,
  startLine: number | null,
  endLine: number | null,
  maxCharacters: number | null
): {
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
} {
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
    description: "Read a text file from the workspace.",
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
          description: "Optional character limit for the returned content."
        },
        startLine: {
          type: "number",
          description: "Optional 1-based first line to read."
        },
        endLine: {
          type: "number",
          description: "Optional 1-based last line to read, inclusive."
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
      const maxCharacters = normalizePositiveInteger(input.maxCharacters);
      if (input.maxCharacters !== undefined && maxCharacters === null) {
        issues.push({
          field: "maxCharacters",
          issue: "maxCharacters must be a positive number."
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
      const startLine = normalizePositiveInteger(input.startLine);
      const endLine = normalizePositiveInteger(input.endLine);

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

        if (stat.size > MAX_SAFE_READ_FILE_BYTES) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "READ_FILE_TOO_LARGE",
              message:
                "File is larger than the safe read limit. Narrow the target before reading.",
              data: {
                sizeBytes: stat.size,
                maxBytes: MAX_SAFE_READ_FILE_BYTES
              }
            }),
            `[read_file] failed\n- file exceeds safe read limit (${stat.size} bytes)`
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

        const text = await fs.readFile(absolutePath, "utf8");
        const fullRange = readLineRange(text, startLine, endLine, null);
        if (
          maxCharacters !== null &&
          maxCharacters > MAX_SAFE_OUTPUT_CHARACTERS
        ) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "READ_OUTPUT_LIMIT_EXCEEDED",
              message:
                "Requested output exceeds the safe limit. Narrow the line range or reduce maxCharacters.",
              data: {
                maxOutputCharacters: MAX_SAFE_OUTPUT_CHARACTERS
              }
            }),
            `[read_file] failed\n- requested output exceeds ${MAX_SAFE_OUTPUT_CHARACTERS} characters`
          );
        }
        if (
          maxCharacters === null &&
          fullRange.content.length > MAX_SAFE_OUTPUT_CHARACTERS
        ) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "READ_OUTPUT_LIMIT_EXCEEDED",
              message:
                "Requested output exceeds the safe limit. Narrow the line range or reduce maxCharacters.",
              data: {
                maxOutputCharacters: MAX_SAFE_OUTPUT_CHARACTERS
              }
            }),
            `[read_file] failed\n- requested output exceeds ${MAX_SAFE_OUTPUT_CHARACTERS} characters`
          );
        }
        const lineRange = readLineRange(
          text,
          startLine,
          endLine,
          maxCharacters ?? MAX_SAFE_OUTPUT_CHARACTERS
        );
        const warnings = repeatedActivity.shouldWarn
          ? [
              `Repeated reads of the same target were detected (${repeatedActivity.repeatCount} recent attempts).`
            ]
          : [];

        return successResult(
          createToolResult({
            ok: true,
            code: "FILE_READ_OK",
            message: "File read successfully.",
            data: {
              path: toRelativeWorkspacePath(workingDirectory, absolutePath),
              truncated: lineRange.truncated,
              startLine: lineRange.startLine,
              endLine: lineRange.endLine,
              totalLines: lineRange.totalLines,
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
