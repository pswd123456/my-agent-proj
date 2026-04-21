import { promises as fs } from "node:fs";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  normalizeWorkspacePath,
  toRelativeWorkspacePath
} from "./workspace.js";
import { createToolResult, failureResult, successResult } from "./tool-result.js";

export function createListDirectoryTool(workingDirectory: string): RuntimeTool {
  return {
    name: "list_directory",
    description: "List files and folders in a workspace directory.",
    isReadOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path relative to the workspace root."
        }
      },
      additionalProperties: false
    },
    validate(input) {
      return { ok: true, value: input };
    },
    async execute(input) {
      const rawPath =
        typeof input.path === "string" && input.path.length > 0
          ? input.path
          : ".";

      try {
        const absolutePath = normalizeWorkspacePath(workingDirectory, rawPath);
        const stat = await fs.stat(absolutePath);

        if (!stat.isDirectory()) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "TARGET_NOT_DIRECTORY",
              message: "Target is not a directory."
            }),
            "[list_directory] failed\n- target is not a directory"
          );
        }

        const entries = await fs.readdir(absolutePath, {
          withFileTypes: true
        });

        const result = {
          path: toRelativeWorkspacePath(workingDirectory, absolutePath),
          entries: entries
            .map((entry) => ({
              name: entry.name,
              kind: entry.isDirectory() ? "directory" : "file"
            }))
            .sort((left, right) => left.name.localeCompare(right.name))
        };

        return successResult(
          createToolResult({
            ok: true,
            code: "DIRECTORY_LIST_OK",
            message: "Directory listed successfully.",
            data: result
          }),
          `[list_directory] success\n- ${result.path}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failureResult(
          createToolResult({
            ok: false,
            code: "LIST_DIRECTORY_FAILED",
            message
          }),
          `[list_directory] failed\n- ${message}`
        );
      }
    }
  };
}
