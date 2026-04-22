import { promises as fs } from "node:fs";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  getPathKind,
  normalizeWorkspacePath,
  toRelativeWorkspacePath
} from "./workspace.js";
import { createToolResult, failureResult, successResult } from "./tool-result.js";

export function createDeletePathTool(workingDirectory: string): RuntimeTool {
  return {
    name: "delete_path",
    description: "Delete a file or directory from the workspace after approval.",
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
          description: "File or directory path relative to the workspace root."
        }
      },
      required: ["path"],
      additionalProperties: false
    },
    getSandboxTargets(input) {
      return [typeof input.path === "string" && input.path.length > 0 ? input.path : "."];
    },
    async getPermissionRequest(input) {
      const rawPath = typeof input.path === "string" ? input.path : "";
      if (!rawPath) {
        return null;
      }

      const absolutePath = normalizeWorkspacePath(workingDirectory, rawPath);
      return {
        summaryText: `需要你的确认后才能删除工作区路径：${toRelativeWorkspacePath(
          workingDirectory,
          absolutePath
        )}`,
        contextNote: "删除路径属于破坏性操作。"
      };
    },
    validate(input) {
      if (typeof input.path === "string" && input.path.length > 0) {
        return { ok: true, value: input };
      }

      return {
        ok: false,
        issues: [{ field: "path", issue: "path is required." }]
      };
    },
    async execute(input) {
      const rawPath = typeof input.path === "string" ? input.path : "";
      if (!rawPath) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message: "Missing path.",
            validationErrors: [{ field: "path", issue: "path is required." }]
          }),
          "[delete_path] invalid input"
        );
      }

      try {
        const absolutePath = normalizeWorkspacePath(workingDirectory, rawPath);
        const existingKind = await getPathKind(absolutePath);
        if (existingKind === "missing") {
          return failureResult(
            createToolResult({
              ok: false,
              code: "PATH_NOT_FOUND",
              message: "Target path does not exist."
            }),
            "[delete_path] failed\n- target path does not exist"
          );
        }

        await fs.rm(absolutePath, { recursive: true, force: false });
        return successResult(
          createToolResult({
            ok: true,
            code: "PATH_DELETED",
            message: "Path deleted successfully.",
            data: {
              path: toRelativeWorkspacePath(workingDirectory, absolutePath),
              kind: existingKind
            }
          }),
          `[delete_path] success\n- ${toRelativeWorkspacePath(
            workingDirectory,
            absolutePath
          )}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failureResult(
          createToolResult({
            ok: false,
            code: "DELETE_PATH_FAILED",
            message
          }),
          `[delete_path] failed\n- ${message}`
        );
      }
    }
  };
}
