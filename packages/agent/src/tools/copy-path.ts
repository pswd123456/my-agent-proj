import { promises as fs } from "node:fs";
import path from "node:path";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  getPathKind,
  normalizeWorkspacePath,
  toRelativeWorkspacePath
} from "./workspace.js";
import { createToolResult, failureResult, successResult } from "./tool-result.js";

export function createCopyPathTool(workingDirectory: string): RuntimeTool {
  return {
    name: "copy_path",
    description: "Copy a workspace file or directory, asking before overwrite.",
    family: "workspace-file",
    isReadOnly: false,
    hasExternalSideEffect: true,
    permissionProfile: "destructive-only",
    sandboxProfile: "workspace-rooted",
    inputSchema: {
      type: "object",
      properties: {
        source_path: {
          type: "string",
          description: "Source path relative to the workspace root."
        },
        target_path: {
          type: "string",
          description: "Destination path relative to the workspace root."
        }
      },
      required: ["source_path", "target_path"],
      additionalProperties: false
    },
    getSandboxTargets(input) {
      return [
        typeof input.source_path === "string" && input.source_path.length > 0
          ? input.source_path
          : ".",
        typeof input.target_path === "string" && input.target_path.length > 0
          ? input.target_path
          : "."
      ];
    },
    async getPermissionRequest(input) {
      const sourcePath =
        typeof input.source_path === "string" ? input.source_path : "";
      const targetPath =
        typeof input.target_path === "string" ? input.target_path : "";
      if (!sourcePath || !targetPath) {
        return null;
      }

      const absoluteTarget = normalizeWorkspacePath(workingDirectory, targetPath);
      if ((await getPathKind(absoluteTarget)) === "missing") {
        return null;
      }

      return {
        summaryText: `需要你的确认后才能覆盖复制目标：${toRelativeWorkspacePath(
          workingDirectory,
          absoluteTarget
        )}`,
        contextNote: "复制到已存在目标路径时需要审批。"
      };
    },
    validate(input) {
      const issues: Array<{ field: string; issue: string }> = [];
      if (typeof input.source_path !== "string" || input.source_path.length === 0) {
        issues.push({ field: "source_path", issue: "source_path is required." });
      }
      if (typeof input.target_path !== "string" || input.target_path.length === 0) {
        issues.push({ field: "target_path", issue: "target_path is required." });
      }

      if (issues.length > 0) {
        return { ok: false, issues };
      }

      return { ok: true, value: input };
    },
    async execute(input) {
      const sourcePath =
        typeof input.source_path === "string" ? input.source_path : "";
      const targetPath =
        typeof input.target_path === "string" ? input.target_path : "";
      if (!sourcePath || !targetPath) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message: "Missing source_path or target_path.",
            validationErrors: [
              ...(!sourcePath
                ? [{ field: "source_path", issue: "source_path is required." }]
                : []),
              ...(!targetPath
                ? [{ field: "target_path", issue: "target_path is required." }]
                : [])
            ]
          }),
          "[copy_path] invalid input"
        );
      }

      try {
        const absoluteSource = normalizeWorkspacePath(workingDirectory, sourcePath);
        const absoluteTarget = normalizeWorkspacePath(workingDirectory, targetPath);
        const sourceKind = await getPathKind(absoluteSource);
        if (sourceKind === "missing") {
          return failureResult(
            createToolResult({
              ok: false,
              code: "SOURCE_NOT_FOUND",
              message: "Source path does not exist."
            }),
            "[copy_path] failed\n- source path does not exist"
          );
        }

        const targetParentKind = await getPathKind(path.dirname(absoluteTarget));
        if (targetParentKind !== "directory") {
          return failureResult(
            createToolResult({
              ok: false,
              code: "TARGET_PARENT_MISSING",
              message: "Target parent directory does not exist."
            }),
            "[copy_path] failed\n- target parent directory does not exist"
          );
        }

        await fs.cp(absoluteSource, absoluteTarget, {
          recursive: sourceKind === "directory",
          force: true
        });
        return successResult(
          createToolResult({
            ok: true,
            code: "PATH_COPIED",
            message: "Path copied successfully.",
            data: {
              source_path: toRelativeWorkspacePath(workingDirectory, absoluteSource),
              target_path: toRelativeWorkspacePath(workingDirectory, absoluteTarget),
              kind: sourceKind
            }
          }),
          `[copy_path] success\n- ${toRelativeWorkspacePath(
            workingDirectory,
            absoluteSource
          )} -> ${toRelativeWorkspacePath(workingDirectory, absoluteTarget)}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failureResult(
          createToolResult({
            ok: false,
            code: "COPY_PATH_FAILED",
            message
          }),
          `[copy_path] failed\n- ${message}`
        );
      }
    }
  };
}
