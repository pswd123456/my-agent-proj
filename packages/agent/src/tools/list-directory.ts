import { promises as fs } from "node:fs";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  normalizeWorkspacePath,
  toRelativeWorkspacePath
} from "./workspace.js";
import { createToolResult, failureResult, successResult } from "./tool-result.js";
import { buildToolDescription } from "./tool-description.js";

export function createListDirectoryTool(workingDirectory: string): RuntimeTool {
  return {
    name: "list_directory",
    description: buildToolDescription({
      usageScenarios: [
        "Inspect the immediate entries inside a known directory.",
        "Check whether a file or subdirectory exists at a path.",
        "Get a quick local directory view without walking the whole tree."
      ],
      usageInstructions: [
        "Set path to a workspace-relative directory path.",
        "Omit path or use . to list the workspace root.",
        "Read the returned entries array for name and kind."
      ],
      constraints: [
        "Only lists one directory level; it does not recurse.",
        "Fails if the target is not a directory.",
        "Use find_files for filtered file discovery across many directories."
      ],
      examples: ['{"path":"apps/web/app/_components"}', '{"path":"."}']
    }),
    family: "workspace-file",
    isReadOnly: true,
    hasExternalSideEffect: false,
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
      additionalProperties: false
    },
    getSandboxTargets(input) {
      return [typeof input.path === "string" && input.path.length > 0 ? input.path : "."];
    },
    validate(input) {
      return { ok: true, value: input };
    },
    async execute(input, context) {
      const rawPath =
        typeof input.path === "string" && input.path.length > 0
          ? input.path
          : ".";

      try {
        const absolutePath = normalizeWorkspacePath(
          workingDirectory,
          rawPath,
          context.allowWorkspaceEscape
        );
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
