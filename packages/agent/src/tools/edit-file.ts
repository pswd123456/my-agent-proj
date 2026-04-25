import { promises as fs } from "node:fs";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  getPathKind,
  normalizeWorkspacePath,
  toRelativeWorkspacePath,
  writeTextFileAtomic
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

function detectNewline(content: string): "\r\n" | "\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function splitEditableLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  return content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

function splitReplacementLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  return content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

function hasFinalNewline(content: string): boolean {
  return content.endsWith("\n");
}

function applyLineEdit(input: {
  originalContent: string;
  startLine: number;
  endLine: number;
  replacement: string;
}): { content: string; replacedLineCount: number; newLineCount: number } {
  const lines = splitEditableLines(input.originalContent);
  const replacementLines = splitReplacementLines(input.replacement);
  const newline = detectNewline(input.originalContent);
  const before = lines.slice(0, input.startLine - 1);
  const after = lines.slice(input.endLine);
  const nextLines = [...before, ...replacementLines, ...after];
  const nextContent = `${nextLines.join(newline)}${
    hasFinalNewline(input.originalContent) || input.replacement.endsWith("\n")
      ? newline
      : ""
  }`;

  return {
    content: nextContent,
    replacedLineCount: input.endLine - input.startLine + 1,
    newLineCount: replacementLines.length
  };
}

function createLineDiff(input: {
  path: string;
  originalLines: string[];
  replacementLines: string[];
  startLine: number;
}): string {
  const oldCount = input.originalLines.length;
  const newCount = input.replacementLines.length;
  const lines = [
    `--- ${input.path}`,
    `+++ ${input.path}`,
    `@@ -${input.startLine},${oldCount} +${input.startLine},${newCount} @@`,
    ...input.originalLines.map((line) => `- ${line}`),
    ...input.replacementLines.map((line) => `+ ${line}`)
  ];
  const diff = lines.join("\n");

  return diff.length > 12_000 ? `${diff.slice(0, 12_000)}\n...[truncated]` : diff;
}

export function createEditFileTool(workingDirectory: string): RuntimeTool {
  return {
    name: "edit_file",
    description:
      "Replace an inclusive 1-based line range in a text file inside the workspace.",
    family: "workspace-file",
    isReadOnly: false,
    hasExternalSideEffect: true,
    permissionProfile: "destructive-only",
    sandboxProfile: "workspace-rooted",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to the workspace root."
        },
        startLine: {
          type: "number",
          description: "1-based first line to replace."
        },
        endLine: {
          type: "number",
          description: "1-based last line to replace, inclusive."
        },
        content: {
          type: "string",
          description: "Replacement text for the selected line range."
        }
      },
      required: ["path", "startLine", "endLine", "content"],
      additionalProperties: false
    },
    getSandboxTargets(input) {
      return [
        typeof input.path === "string" && input.path.length > 0
          ? input.path
          : "."
      ];
    },
    async getPermissionRequest(input, context) {
      const rawPath = typeof input.path === "string" ? input.path : "";
      if (!rawPath) {
        return null;
      }

      const absolutePath = normalizeWorkspacePath(
        workingDirectory,
        rawPath,
        context.allowWorkspaceEscape
      );
      if ((await getPathKind(absolutePath)) !== "file") {
        return null;
      }

      return {
        summaryText: `需要你的确认后才能编辑文件：${toRelativeWorkspacePath(
          workingDirectory,
          absolutePath
        )}`,
        contextNote: "行级编辑会修改已有文件内容，属于高风险写入。"
      };
    },
    validate(input) {
      const issues: Array<{ field: string; issue: string }> = [];
      if (typeof input.path !== "string" || input.path.length === 0) {
        issues.push({ field: "path", issue: "path is required." });
      }
      const startLine = normalizePositiveInteger(input.startLine);
      const endLine = normalizePositiveInteger(input.endLine);
      if (startLine === null) {
        issues.push({
          field: "startLine",
          issue: "startLine must be a positive number."
        });
      }
      if (endLine === null) {
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
      if (typeof input.content !== "string") {
        issues.push({ field: "content", issue: "content must be a string." });
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
            message: "Invalid edit_file input.",
            validationErrors: validation.issues ?? []
          }),
          `[edit_file] invalid input\n${(validation.issues ?? [])
            .map((issue) => `- ${issue.field}: ${issue.issue}`)
            .join("\n")}`
        );
      }

      const rawPath = input.path as string;
      const startLine = Math.floor(input.startLine as number);
      const endLine = Math.floor(input.endLine as number);
      const replacement = input.content as string;

      try {
        const absolutePath = normalizeWorkspacePath(
          workingDirectory,
          rawPath,
          context.allowWorkspaceEscape
        );
        if ((await getPathKind(absolutePath)) !== "file") {
          return failureResult(
            createToolResult({
              ok: false,
              code: "TARGET_NOT_FILE",
              message: "Target is not a file."
            }),
            "[edit_file] failed\n- target is not a file"
          );
        }

        const originalStat = await fs.stat(absolutePath);
        const originalContent = await fs.readFile(absolutePath, "utf8");
        const totalLines = splitEditableLines(originalContent).length;
        if (startLine > totalLines || endLine > totalLines) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "LINE_RANGE_OUT_OF_BOUNDS",
              message: "Line range is outside the file.",
              data: {
                path: toRelativeWorkspacePath(workingDirectory, absolutePath),
                totalLines
              }
            }),
            `[edit_file] failed\n- line range is outside the file\n- total lines: ${totalLines}`
          );
        }

        const edit = applyLineEdit({
          originalContent,
          startLine,
          endLine,
          replacement
        });
        const relativePath = toRelativeWorkspacePath(workingDirectory, absolutePath);
        const originalLines = splitEditableLines(originalContent).slice(
          startLine - 1,
          endLine
        );
        const replacementLines = splitReplacementLines(replacement);
        const diff = createLineDiff({
          path: relativePath,
          originalLines,
          replacementLines,
          startLine
        });
        const latestStat = await fs.stat(absolutePath);
        const staleWarning =
          latestStat.mtimeMs !== originalStat.mtimeMs ||
          latestStat.size !== originalStat.size
            ? "File metadata changed while preparing this edit; newer content may have been overwritten."
            : null;
        await writeTextFileAtomic(absolutePath, edit.content, {
          mode: originalStat.mode
        });
        const warnings = staleWarning ? [staleWarning] : [];

        return successResult(
          createToolResult({
            ok: true,
            code: "FILE_EDITED",
            message: "File edited successfully.",
            data: {
              path: relativePath,
              startLine,
              endLine,
              replacedLineCount: edit.replacedLineCount,
              newLineCount: edit.newLineCount,
              diff,
              ...(warnings.length > 0 ? { warnings } : {})
            }
          }),
          `[edit_file] success\n- ${toRelativeWorkspacePath(
            workingDirectory,
            absolutePath
          )}\n- replaced lines ${startLine}-${endLine}${
            warnings.length > 0 ? "\n- warnings emitted" : ""
          }`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failureResult(
          createToolResult({
            ok: false,
            code: "EDIT_FILE_FAILED",
            message
          }),
          `[edit_file] failed\n- ${message}`
        );
      }
    }
  };
}
