import { promises as fs } from "node:fs";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  buildJsonResult,
  normalizeWorkspacePath,
  toRelativeWorkspacePath,
  walkFiles
} from "./workspace.js";

export function createSearchTextTool(workingDirectory: string): RuntimeTool {
  return {
    name: "search_text",
    description: "Search for a text fragment across workspace files.",
    isReadOnly: true,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text fragment to look for."
        },
        path: {
          type: "string",
          description: "Optional search root relative to the workspace root."
        },
        maxResults: {
          type: "number",
          description: "Optional result limit."
        }
      },
      required: ["query"],
      additionalProperties: false
    },
    async execute(input) {
      const query = typeof input.query === "string" ? input.query.trim() : "";

      if (!query) {
        return {
          state: "failed",
          content: buildJsonResult({ error: "Missing search query." }),
          error: "Missing search query."
        };
      }

      const searchRoot =
        typeof input.path === "string" && input.path.length > 0
          ? input.path
          : ".";
      const maxResults =
        typeof input.maxResults === "number" && input.maxResults > 0
          ? Math.floor(input.maxResults)
          : 20;

      try {
        const absoluteRoot = normalizeWorkspacePath(workingDirectory, searchRoot);
        const files = await walkFiles(absoluteRoot, 250);
        const matches: Array<{
          path: string;
          line: number;
          snippet: string;
        }> = [];

        for (const filePath of files) {
          if (matches.length >= maxResults) {
            break;
          }

          const stat = await fs.stat(filePath);
          if (stat.size > 1_000_000) {
            continue;
          }

          let text: string;
          try {
            text = await fs.readFile(filePath, "utf8");
          } catch {
            continue;
          }

          const lines = text.split(/\r?\n/);
          for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            if (typeof line !== "string") {
              continue;
            }
            if (!line.includes(query)) {
              continue;
            }

            matches.push({
              path: toRelativeWorkspacePath(workingDirectory, filePath),
              line: index + 1,
              snippet: line.trim()
            });

            if (matches.length >= maxResults) {
              break;
            }
          }
        }

        return {
          state: "success",
          content: buildJsonResult({
            root: toRelativeWorkspacePath(workingDirectory, absoluteRoot),
            query,
            matches
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
