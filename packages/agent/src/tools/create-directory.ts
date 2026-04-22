import { promises as fs } from "node:fs";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  getPathKind,
  normalizeWorkspacePath,
  toRelativeWorkspacePath
} from "./workspace.js";
import { createToolResult, failureResult, successResult } from "./tool-result.js";

export function createCreateDirectoryTool(
  workingDirectory: string
): RuntimeTool {
  return {
    name: "create_directory",
    description: "Create a directory inside the workspace.",
    family: "workspace-file",
    isReadOnly: false,
    hasExternalSideEffect: true,
    permissionProfile: "allow",
    sandboxProfile: "workspace-rooted",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path relative to the workspace root."
        }
      },
      required: ["path"],
      additionalProperties: false
    },
    getSandboxTargets(input) {
      return [typeof input.path === "string" && input.path.length > 0 ? input.path : "."];
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
            message: "Missing directory path.",
            validationErrors: [{ field: "path", issue: "path is required." }]
          }),
          "[create_directory] invalid input"
        );
      }

      try {
        const absolutePath = normalizeWorkspacePath(workingDirectory, rawPath);
        const existingKind = await getPathKind(absolutePath);

        if (existingKind === "file") {
          return failureResult(
            createToolResult({
              ok: false,
              code: "TARGET_EXISTS_AS_FILE",
              message: "Target path already exists as a file."
            }),
            "[create_directory] failed\n- target exists as a file"
          );
        }

        await fs.mkdir(absolutePath, { recursive: true });
        return successResult(
          createToolResult({
            ok: true,
            code:
              existingKind === "directory"
                ? "DIRECTORY_ALREADY_EXISTS"
                : "DIRECTORY_CREATED",
            message:
              existingKind === "directory"
                ? "Directory already exists."
                : "Directory created successfully.",
            data: {
              path: toRelativeWorkspacePath(workingDirectory, absolutePath),
              existed: existingKind === "directory"
            }
          }),
          `[create_directory] success\n- ${toRelativeWorkspacePath(
            workingDirectory,
            absolutePath
          )}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failureResult(
          createToolResult({
            ok: false,
            code: "CREATE_DIRECTORY_FAILED",
            message
          }),
          `[create_directory] failed\n- ${message}`
        );
      }
    }
  };
}
