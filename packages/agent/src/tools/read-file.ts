import { promises as fs } from "node:fs";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  buildJsonResult,
  normalizeWorkspacePath,
  readTextFileWithLimit,
  toRelativeWorkspacePath
} from "./workspace.js";

export function createReadFileTool(workingDirectory: string): RuntimeTool {
  return {
    name: "read_file",
    description: "Read a text file from the workspace.",
    isReadOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to the workspace root."
        },
        maxCharacters: {
          type: "number",
          description: "Optional character limit for the returned content."
        }
      },
      required: ["path"],
      additionalProperties: false
    },
    async execute(input) {
      const rawPath = input.path;
      if (typeof rawPath !== "string" || rawPath.length === 0) {
        return {
          state: "failed",
          content: buildJsonResult({ error: "Missing file path." }),
          error: "Missing file path."
        };
      }

      const maxCharacters =
        typeof input.maxCharacters === "number" && input.maxCharacters > 0
          ? Math.floor(input.maxCharacters)
          : 12_000;

      try {
        const absolutePath = normalizeWorkspacePath(workingDirectory, rawPath);
        const stat = await fs.stat(absolutePath);

        if (!stat.isFile()) {
          return {
            state: "failed",
            content: buildJsonResult({ error: "Target is not a file." }),
            error: "Target is not a file."
          };
        }

        const { text, truncated } = await readTextFileWithLimit(
          absolutePath,
          maxCharacters
        );

        return {
          state: "success",
          content: buildJsonResult({
            path: toRelativeWorkspacePath(workingDirectory, absolutePath),
            truncated,
            content: text
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
