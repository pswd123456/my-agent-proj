import { promises as fs } from "node:fs";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  normalizeWorkspacePath,
  toRelativeWorkspacePath
} from "./workspace.js";
import {
  createToolResult,
  failureResult,
  successResult
} from "./tool-result.js";

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
  const lines = content.split("\n");
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
              code: "TARGET_NOT_FILE",
              message: "Target is not a file."
            }),
            "[read_file] failed\n- target is not a file"
          );
        }

        const text = await fs.readFile(absolutePath, "utf8");
        const lineRange = readLineRange(
          text,
          startLine,
          endLine,
          maxCharacters
        );

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
              content: lineRange.content
            }
          }),
          `[read_file] success\n- ${toRelativeWorkspacePath(
            workingDirectory,
            absolutePath
          )}`
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
