import { promises as fs } from "node:fs";
import path from "node:path";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  getPathKind,
  normalizeWorkspacePath,
  toRelativeWorkspacePath
} from "./workspace.js";
import { createToolResult, failureResult, successResult } from "./tool-result.js";

export function createWriteFileTool(workingDirectory: string): RuntimeTool {
  return {
    name: "write_file",
    description: "Write a text file inside the workspace, creating it when the path does not exist.",
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
          description: "Full text content to write."
        }
      },
      required: ["path", "content"],
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
      if ((await getPathKind(absolutePath)) !== "file") {
        return null;
      }

      return {
        summaryText: `需要你的确认后才能覆盖已有文件：${toRelativeWorkspacePath(
          workingDirectory,
          absolutePath
        )}`,
        contextNote: "新建文件可直接执行，但覆盖已有文件属于高风险写入。"
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

      if (issues.length > 0) {
        return { ok: false, issues };
      }

      return { ok: true, value: input };
    },
    async execute(input) {
      const rawPath = typeof input.path === "string" ? input.path : "";
      const content = typeof input.content === "string" ? input.content : null;

      if (!rawPath || content === null) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message: "Missing file path or content.",
            validationErrors: [
              ...(!rawPath
                ? [{ field: "path", issue: "path is required." }]
                : []),
              ...(content === null
                ? [{ field: "content", issue: "content must be a string." }]
                : [])
            ]
          }),
          "[write_file] invalid input"
        );
      }

      try {
        const absolutePath = normalizeWorkspacePath(workingDirectory, rawPath);
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

        const existed = (await getPathKind(absolutePath)) === "file";
        await fs.writeFile(absolutePath, content, "utf8");

        return successResult(
          createToolResult({
            ok: true,
            code: existed ? "FILE_UPDATED" : "FILE_CREATED",
            message: existed
              ? "File updated successfully."
              : "File created successfully.",
            data: {
              path: toRelativeWorkspacePath(workingDirectory, absolutePath),
              existed
            }
          }),
          `[write_file] success\n- ${toRelativeWorkspacePath(
            workingDirectory,
            absolutePath
          )}`
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
