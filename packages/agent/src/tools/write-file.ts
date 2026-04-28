import { promises as fs } from "node:fs";
import path from "node:path";

import type { ToolResultDetails } from "../types.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  fileVersionsMatch,
  freshSessionReadFailureResult,
  readFileMode,
  readFileVersion,
  requireFreshSessionRead
} from "./fresh-session-read.js";
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

function normalizeDiffLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  return content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

function buildWholeFileDiff(input: {
  path: string;
  originalContent: string | null;
  nextContent: string;
}): {
  action: "create" | "modify";
  addedLineCount: number;
  removedLineCount: number;
  diff: string;
} {
  const originalLines = normalizeDiffLines(input.originalContent ?? "");
  const nextLines = normalizeDiffLines(input.nextContent);
  const action = input.originalContent === null ? "create" : "modify";
  const oldPath = action === "create" ? "/dev/null" : `a/${input.path}`;
  const newPath = `b/${input.path}`;
  const oldCount = originalLines.length;
  const newCount = nextLines.length;
  const oldStart = oldCount === 0 ? 0 : 1;
  const newStart = newCount === 0 ? 0 : 1;

  return {
    action,
    addedLineCount: nextCount(nextLines),
    removedLineCount: nextCount(originalLines),
    diff: [
      `--- ${oldPath}`,
      `+++ ${newPath}`,
      `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      ...originalLines.map((line) => `-${line}`),
      ...nextLines.map((line) => `+${line}`)
    ].join("\n")
  };
}

function nextCount(lines: string[]): number {
  return lines.length;
}

export function createWriteFileTool(workingDirectory: string): RuntimeTool {
  return {
    name: "write_file",
    description:
      "Create a new text file or replace the full content of an existing text file inside the workspace. Existing files MUST be read with read_file in this session before writing. Use apply_patch for line-level edits.",
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
          description: "Full file content to write."
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

      return {
        summaryText: `需要你的确认后才能覆盖已有文件：${toRelativeWorkspacePath(
          workingDirectory,
          absolutePath
        )}`,
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
      if (
        input.mode !== undefined ||
        input.startLine !== undefined ||
        input.endLine !== undefined
      ) {
        issues.push({
          field: "input",
          issue:
            "write_file only supports full-file writes. Use apply_patch for line edits."
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
        const originalContent = existed
          ? await fs.readFile(absolutePath, "utf8")
          : null;
        const readPrecondition = existed
          ? await requireFreshSessionRead({
              workingDirectory,
              absolutePath,
              sessionMessages: context.sessionMessages
            })
          : null;
        if (readPrecondition && !readPrecondition.ok) {
          return freshSessionReadFailureResult({
            toolName: "write_file",
            code: readPrecondition.code,
            path: relativePath
          });
        }

        if (readPrecondition?.ok) {
          const latestStat = await fs.stat(absolutePath);
          if (
            !fileVersionsMatch(
              readPrecondition.version,
              readFileVersion(latestStat)
            )
          ) {
            return freshSessionReadFailureResult({
              toolName: "write_file",
              code: "FILE_CHANGED_SINCE_READ",
              path: relativePath
            });
          }
        }

        const fileChange = buildWholeFileDiff({
          path: relativePath,
          originalContent,
          nextContent: content
        });
        await writeTextFileAtomic(absolutePath, content, {
          ...(readPrecondition?.ok
            ? { mode: readFileMode(readPrecondition.stat) }
            : {})
        });
        const writtenVersion = readFileVersion(await fs.stat(absolutePath));
        const details: ToolResultDetails = {
          kind: "workspace_file_changes",
          files: [
            {
              path: relativePath,
              action: fileChange.action,
              addedLineCount: fileChange.addedLineCount,
              removedLineCount: fileChange.removedLineCount,
              diff: fileChange.diff
            }
          ]
        };

        return successResult(
          createToolResult({
            ok: true,
            code: existed ? "FILE_UPDATED" : "FILE_CREATED",
            message: existed
              ? "File updated successfully."
              : "File created successfully.",
            data: {
              path: relativePath,
              existed,
              fileState: {
                exists: true,
                ...writtenVersion
              }
            }
          }),
          `[write_file] success\n- ${relativePath}`,
          details
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
