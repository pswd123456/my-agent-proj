import { promises as fs } from "node:fs";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  getPathKind,
  normalizeWorkspacePath,
  toRelativeWorkspacePath
} from "./workspace.js";
import { createToolResult, failureResult, successResult } from "./tool-result.js";
import {
  buildToolDescription,
  describeObjectProperty
} from "./tool-description.js";

export function createDeletePathTool(workingDirectory: string): RuntimeTool {
  return {
    name: "delete_path",
    description: buildToolDescription({
      usageScenarios: [
        "Delete a file or directory when the target may be either kind.",
        "Remove a whole directory tree from the workspace."
      ],
      usageInstructions: [
        describeObjectProperty({
          name: "path",
          type: "string",
          required: true,
          description: "Workspace-relative file or directory path to delete."
        })
      ],
      constraints: [
        "Deletion is destructive and requires approval.",
        "Use delete_file instead when you know the targets are files and want undoable diffs.",
        "Fails if the target path does not exist."
      ],
      examples: ['{"path":"tmp/old-output"}', '{"path":"artifacts/report.json"}']
    }),
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
    async execute(input, context) {
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
        const absolutePath = normalizeWorkspacePath(
          workingDirectory,
          rawPath,
          context.allowWorkspaceEscape
        );
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
