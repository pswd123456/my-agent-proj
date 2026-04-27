import { promises as fs } from "node:fs";
import path from "node:path";

import type { ToolResultDetails } from "../types.js";
import type { RuntimeTool, ToolExecutionContext } from "./runtime-tool.js";
import { findLatestReadMetadataForPath } from "./read-file-metadata.js";
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

type WriteFileMode = "replace" | "edit_lines";

function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

function normalizeMode(value: unknown): WriteFileMode | null {
  if (value === undefined || value === "replace") {
    return "replace";
  }
  if (value === "edit_lines") {
    return "edit_lines";
  }
  return null;
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

  return diff.length > 12_000
    ? `${diff.slice(0, 12_000)}\n...[truncated]`
    : diff;
}

function readFileVersion(stat: Awaited<ReturnType<typeof fs.stat>>): {
  sizeBytes: number;
  modifiedAtMs: number;
} {
  return {
    sizeBytes: typeof stat.size === "bigint" ? Number(stat.size) : stat.size,
    modifiedAtMs:
      typeof stat.mtimeMs === "bigint" ? Number(stat.mtimeMs) : stat.mtimeMs
  };
}

function readFileMode(stat: Awaited<ReturnType<typeof fs.stat>>): number {
  return typeof stat.mode === "bigint" ? Number(stat.mode) : stat.mode;
}

function versionsMatch(
  left: { sizeBytes: number; modifiedAtMs: number },
  right: { sizeBytes: number; modifiedAtMs: number }
): boolean {
  return (
    left.sizeBytes === right.sizeBytes &&
    left.modifiedAtMs === right.modifiedAtMs
  );
}

async function requireFreshSessionRead(input: {
  workingDirectory: string;
  absolutePath: string;
  sessionMessages: ToolExecutionContext["sessionMessages"];
}): Promise<
  | {
      ok: true;
      stat: Awaited<ReturnType<typeof fs.stat>>;
      version: { sizeBytes: number; modifiedAtMs: number };
    }
  | { ok: false; code: "FILE_WRITE_REQUIRES_READ" | "FILE_CHANGED_SINCE_READ" }
> {
  const currentStat = await fs.stat(input.absolutePath);
  const currentVersion = readFileVersion(currentStat);
  const previousRead = findLatestReadMetadataForPath({
    sessionMessages: input.sessionMessages,
    workingDirectory: input.workingDirectory,
    absolutePath: input.absolutePath
  });

  if (!previousRead) {
    return { ok: false, code: "FILE_WRITE_REQUIRES_READ" };
  }

  if (!versionsMatch(previousRead, currentVersion)) {
    return { ok: false, code: "FILE_CHANGED_SINCE_READ" };
  }

  return { ok: true, stat: currentStat, version: currentVersion };
}

function staleWriteFailure(input: {
  code: "FILE_WRITE_REQUIRES_READ" | "FILE_CHANGED_SINCE_READ";
  path: string;
}) {
  if (input.code === "FILE_WRITE_REQUIRES_READ") {
    return failureResult(
      createToolResult({
        ok: false,
        code: "FILE_WRITE_REQUIRES_READ",
        message:
          "Existing files must be read with read_file in the current session before write_file can modify them.",
        data: { path: input.path }
      }),
      `[write_file] failed\n- read_file required before writing ${input.path}`
    );
  }

  return failureResult(
    createToolResult({
      ok: false,
      code: "FILE_CHANGED_SINCE_READ",
      message:
        "The file changed after the last read_file result in this session. Read it again before writing.",
      data: { path: input.path }
    }),
    `[write_file] failed\n- file changed since last read; read_file required before writing ${input.path}`
  );
}

export function createWriteFileTool(workingDirectory: string): RuntimeTool {
  return {
    name: "write_file",
    description:
      "Create or modify a text file inside the workspace. Existing files MUST be read with read_file in this session before writing. Use mode='replace' for full content replacement or mode='edit_lines' with startLine/endLine for an inclusive line-range edit.",
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
        content: {
          type: "string",
          description:
            "Full file content for mode='replace', or replacement text for mode='edit_lines'."
        },
        mode: {
          type: "string",
          enum: ["replace", "edit_lines"],
          description:
            "Write mode. Defaults to 'replace'. Use 'edit_lines' to replace an inclusive line range."
        },
        startLine: {
          type: "number",
          description:
            "1-based first line to replace. Required when mode='edit_lines'."
        },
        endLine: {
          type: "number",
          description:
            "1-based last line to replace, inclusive. Required when mode='edit_lines'."
        }
      },
      required: ["path", "content"],
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

      const mode = normalizeMode(input.mode);
      return {
        summaryText: `需要你的确认后才能${
          mode === "edit_lines" ? "编辑" : "覆盖"
        }已有文件：${toRelativeWorkspacePath(workingDirectory, absolutePath)}`,
        contextNote:
          "已有文件写入会先校验本 session 内最近一次 read_file 的文件版本。"
      };
    },
    validate(input) {
      const issues: Array<{ field: string; issue: string }> = [];
      if (typeof input.path !== "string" || input.path.length === 0) {
        issues.push({ field: "path", issue: "path is required." });
      }
      if (typeof input.content !== "string") {
        issues.push({ field: "content", issue: "content must be a string." });
      }

      const mode = normalizeMode(input.mode);
      if (mode === null) {
        issues.push({
          field: "mode",
          issue: "mode must be either replace or edit_lines."
        });
      }

      const startLine = normalizePositiveInteger(input.startLine);
      const endLine = normalizePositiveInteger(input.endLine);
      if (mode === "edit_lines") {
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
      } else if (input.startLine !== undefined || input.endLine !== undefined) {
        issues.push({
          field: "mode",
          issue: "startLine and endLine are only valid with mode edit_lines."
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
            message: "Invalid write_file input.",
            validationErrors: validation.issues ?? []
          }),
          `[write_file] invalid input\n${(validation.issues ?? [])
            .map((issue) => `- ${issue.field}: ${issue.issue}`)
            .join("\n")}`
        );
      }

      const rawPath = input.path as string;
      const content = input.content as string;
      const mode = normalizeMode(input.mode) ?? "replace";

      try {
        const absolutePath = normalizeWorkspacePath(
          workingDirectory,
          rawPath,
          context.allowWorkspaceEscape
        );
        const relativePath = toRelativeWorkspacePath(
          workingDirectory,
          absolutePath
        );
        const parentDirectory = path.dirname(absolutePath);
        const parentKind = await getPathKind(parentDirectory);
        if (parentKind !== "directory") {
          return failureResult(
            createToolResult({
              ok: false,
              code: "WRITE_FILE_PARENT_MISSING",
              message: "Parent directory does not exist."
            }),
            "[write_file] failed\n- parent directory does not exist"
          );
        }

        const pathKind = await getPathKind(absolutePath);
        if (pathKind === "directory") {
          return failureResult(
            createToolResult({
              ok: false,
              code: "TARGET_NOT_FILE",
              message: "Target is not a file."
            }),
            "[write_file] failed\n- target is not a file"
          );
        }

        const existed = pathKind === "file";
        const readPrecondition = existed
          ? await requireFreshSessionRead({
              workingDirectory,
              absolutePath,
              sessionMessages: context.sessionMessages
            })
          : null;
        if (readPrecondition && !readPrecondition.ok) {
          return staleWriteFailure({
            code: readPrecondition.code,
            path: relativePath
          });
        }

        if (mode === "edit_lines") {
          if (!existed || !readPrecondition?.ok) {
            return failureResult(
              createToolResult({
                ok: false,
                code: "TARGET_NOT_FILE",
                message: "Line edits require an existing file."
              }),
              "[write_file] failed\n- target is not a file"
            );
          }

          const startLine = Math.floor(input.startLine as number);
          const endLine = Math.floor(input.endLine as number);
          const originalContent = await fs.readFile(absolutePath, "utf8");
          const totalLines = splitEditableLines(originalContent).length;
          if (startLine > totalLines || endLine > totalLines) {
            return failureResult(
              createToolResult({
                ok: false,
                code: "LINE_RANGE_OUT_OF_BOUNDS",
                message: "Line range is outside the file.",
                data: {
                  path: relativePath,
                  totalLines
                }
              }),
              `[write_file] failed\n- line range is outside the file\n- total lines: ${totalLines}`
            );
          }

          const latestStat = await fs.stat(absolutePath);
          if (
            !versionsMatch(
              readPrecondition.version,
              readFileVersion(latestStat)
            )
          ) {
            return staleWriteFailure({
              code: "FILE_CHANGED_SINCE_READ",
              path: relativePath
            });
          }

          const edit = applyLineEdit({
            originalContent,
            startLine,
            endLine,
            replacement: content
          });
          const originalLines = splitEditableLines(originalContent).slice(
            startLine - 1,
            endLine
          );
          const replacementLines = splitReplacementLines(content);
          const diff = createLineDiff({
            path: relativePath,
            originalLines,
            replacementLines,
            startLine
          });
          await writeTextFileAtomic(absolutePath, edit.content, {
            mode: readFileMode(readPrecondition.stat)
          });
          const details: ToolResultDetails = {
            kind: "workspace_file_changes",
            files: [
              {
                path: relativePath,
                action: "modify",
                addedLineCount: replacementLines.length,
                removedLineCount: originalLines.length,
                diff
              }
            ]
          };

          return successResult(
            createToolResult({
              ok: true,
              code: "FILE_EDITED",
              message: "File edited successfully.",
              data: {
                path: relativePath,
                mode,
                startLine,
                endLine,
                replacedLineCount: edit.replacedLineCount,
                newLineCount: edit.newLineCount,
                diff
              }
            }),
            `[write_file] success\n- ${relativePath}\n- replaced lines ${startLine}-${endLine}`,
            details
          );
        }

        if (readPrecondition?.ok) {
          const latestStat = await fs.stat(absolutePath);
          if (
            !versionsMatch(
              readPrecondition.version,
              readFileVersion(latestStat)
            )
          ) {
            return staleWriteFailure({
              code: "FILE_CHANGED_SINCE_READ",
              path: relativePath
            });
          }
        }

        await writeTextFileAtomic(absolutePath, content, {
          ...(readPrecondition?.ok
            ? { mode: readFileMode(readPrecondition.stat) }
            : {})
        });

        return successResult(
          createToolResult({
            ok: true,
            code: existed ? "FILE_UPDATED" : "FILE_CREATED",
            message: existed
              ? "File updated successfully."
              : "File created successfully.",
            data: {
              path: relativePath,
              mode,
              existed
            }
          }),
          `[write_file] success\n- ${relativePath}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failureResult(
          createToolResult({
            ok: false,
            code: "WRITE_FILE_FAILED",
            message
          }),
          `[write_file] failed\n- ${message}`
        );
      }
    }
  };
}
