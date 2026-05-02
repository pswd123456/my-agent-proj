import { promises as fs } from "node:fs";
import path from "node:path";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  successResult
} from "./tool-result.js";
import {
  getPathKind,
  normalizeWorkspacePath,
  toRelativeWorkspacePath
} from "./workspace.js";

type ManagePathAction = "copy" | "move";

function isManagePathAction(value: unknown): value is ManagePathAction {
  return value === "copy" || value === "move";
}

function actionLabel(action: ManagePathAction): string {
  return action === "copy" ? "复制" : "移动";
}

export function createManagePathTool(workingDirectory: string): RuntimeTool {
  return {
    name: "manage_path",
    description:
      "Copy or move a workspace file or directory. Use action=copy to duplicate a path and action=move to rename or relocate it.",
    family: "workspace-file",
    isReadOnly: false,
    hasExternalSideEffect: true,
    permissionProfile: "destructive-only",
    sandboxProfile: "workspace-rooted",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["copy", "move"],
          description: "Path operation to perform."
        },
        source_path: {
          type: "string",
          description: "Source path relative to the workspace root."
        },
        target_path: {
          type: "string",
          description: "Destination path relative to the workspace root."
        }
      },
      required: ["action", "source_path", "target_path"],
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
    async getPermissionRequest(input, context) {
      const rawAction = input.action;
      const action: ManagePathAction | null = isManagePathAction(rawAction)
        ? rawAction
        : null;
      const sourcePath =
        typeof input.source_path === "string" ? input.source_path : "";
      const targetPath =
        typeof input.target_path === "string" ? input.target_path : "";
      if (!action || !sourcePath || !targetPath) {
        return null;
      }

      const absoluteSource = normalizeWorkspacePath(
        workingDirectory,
        sourcePath,
        context.allowWorkspaceEscape
      );
      const absoluteTarget = normalizeWorkspacePath(
        workingDirectory,
        targetPath,
        context.allowWorkspaceEscape
      );

      if (action === "copy") {
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
      }

      return {
        summaryText: `需要你的确认后才能移动路径：${toRelativeWorkspacePath(
          workingDirectory,
          absoluteSource
        )} -> ${toRelativeWorkspacePath(workingDirectory, absoluteTarget)}`,
        contextNote: "移动或重命名路径属于破坏性操作。"
      };
    },
    validate(input) {
      const issues: Array<{ field: string; issue: string }> = [];
      if (!isManagePathAction(input.action)) {
        issues.push({
          field: "action",
          issue: 'action must be either "copy" or "move".'
        });
      }
      if (
        typeof input.source_path !== "string" ||
        input.source_path.length === 0
      ) {
        issues.push({
          field: "source_path",
          issue: "source_path is required."
        });
      }
      if (
        typeof input.target_path !== "string" ||
        input.target_path.length === 0
      ) {
        issues.push({
          field: "target_path",
          issue: "target_path is required."
        });
      }

      if (issues.length > 0) {
        return { ok: false, issues };
      }

      return { ok: true, value: input };
    },
    async execute(input, context) {
      const rawAction = input.action;
      const action: ManagePathAction | null = isManagePathAction(rawAction)
        ? rawAction
        : null;
      const sourcePath =
        typeof input.source_path === "string" ? input.source_path : "";
      const targetPath =
        typeof input.target_path === "string" ? input.target_path : "";
      const validationErrors = [
        ...(!action
          ? [
              {
                field: "action",
                issue: 'action must be either "copy" or "move".'
              }
            ]
          : []),
        ...(!sourcePath
          ? [{ field: "source_path", issue: "source_path is required." }]
          : []),
        ...(!targetPath
          ? [{ field: "target_path", issue: "target_path is required." }]
          : [])
      ];
      if (validationErrors.length > 0 || !action) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message: "Missing or invalid action, source_path, or target_path.",
            validationErrors
          }),
          "[manage_path] invalid input"
        );
      }

      try {
        const absoluteSource = normalizeWorkspacePath(
          workingDirectory,
          sourcePath,
          context.allowWorkspaceEscape
        );
        const absoluteTarget = normalizeWorkspacePath(
          workingDirectory,
          targetPath,
          context.allowWorkspaceEscape
        );
        const sourceKind = await getPathKind(absoluteSource);
        if (sourceKind === "missing") {
          return failureResult(
            createToolResult({
              ok: false,
              code: "SOURCE_NOT_FOUND",
              message: "Source path does not exist."
            }),
            "[manage_path] failed\n- source path does not exist"
          );
        }

        const targetParentKind = await getPathKind(
          path.dirname(absoluteTarget)
        );
        if (targetParentKind !== "directory") {
          return failureResult(
            createToolResult({
              ok: false,
              code: "TARGET_PARENT_MISSING",
              message: "Target parent directory does not exist."
            }),
            "[manage_path] failed\n- target parent directory does not exist"
          );
        }

        if (action === "copy") {
          await fs.cp(absoluteSource, absoluteTarget, {
            recursive: sourceKind === "directory",
            force: true
          });
        } else {
          await fs.rename(absoluteSource, absoluteTarget);
        }

        const relativeSource = toRelativeWorkspacePath(
          workingDirectory,
          absoluteSource
        );
        const relativeTarget = toRelativeWorkspacePath(
          workingDirectory,
          absoluteTarget
        );
        return successResult(
          createToolResult({
            ok: true,
            code: action === "copy" ? "PATH_COPIED" : "PATH_MOVED",
            message: `Path ${action === "copy" ? "copied" : "moved"} successfully.`,
            data: {
              action,
              source_path: relativeSource,
              target_path: relativeTarget,
              kind: sourceKind
            }
          }),
          `[manage_path] success\n- ${actionLabel(
            action
          )}: ${relativeSource} -> ${relativeTarget}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failureResult(
          createToolResult({
            ok: false,
            code: action === "copy" ? "COPY_PATH_FAILED" : "MOVE_PATH_FAILED",
            message
          }),
          `[manage_path] failed\n- ${message}`
        );
      }
    }
  };
}
