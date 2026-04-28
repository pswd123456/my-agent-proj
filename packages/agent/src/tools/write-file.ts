import { promises as fs } from "node:fs";
import path from "node:path";

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
