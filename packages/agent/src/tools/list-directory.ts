import { promises as fs } from "node:fs";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  buildJsonResult,
  normalizeWorkspacePath,
  toRelativeWorkspacePath
} from "./workspace.js";

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
    async execute(input) {
      const rawPath =
        typeof input.path === "string" && input.path.length > 0
          ? input.path
          : ".";

      try {
        const absolutePath = normalizeWorkspacePath(workingDirectory, rawPath);
        const stat = await fs.stat(absolutePath);

        if (!stat.isDirectory()) {
          return {
            state: "failed",
            content: buildJsonResult({ error: "Target is not a directory." }),
            error: "Target is not a directory."
          };
        }

        const entries = await fs.readdir(absolutePath, {
          withFileTypes: true
        });

        return {
          state: "success",
          content: buildJsonResult({
            path: toRelativeWorkspacePath(workingDirectory, absolutePath),
            entries: entries
              .map((entry) => ({
                name: entry.name,
                kind: entry.isDirectory() ? "directory" : "file"
              }))
              .sort((left, right) => left.name.localeCompare(right.name))
          })
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          state: "failed",
          content: buildJsonResult({ error: message }),
          error: message
        };
      }
    }
  };
}
