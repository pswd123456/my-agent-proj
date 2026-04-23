import { promises as fs } from "node:fs";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  normalizeWorkspacePath,
  readTextFileWithLimit,
  toRelativeWorkspacePath
} from "./workspace.js";
import { createToolResult, failureResult, successResult } from "./tool-result.js";

export function createReadFileTool(workingDirectory: string): RuntimeTool {
  return {
    name: "read_file",
    description: "Read a text file from the workspace.",
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
    getSandboxTargets(input) {
      return [typeof input.path === "string" && input.path.length > 0 ? input.path : "."];
    },
    validate(input) {
      const path = input.path;
      if (typeof path === "string" && path.length > 0) {
        return { ok: true, value: input };
      }

      return {
        ok: false,
        issues: [
          {
            field: "path",
            issue: "path is required."
          }
        ]
      };
    },
    async execute(input, context) {
      const rawPath = input.path;
      if (typeof rawPath !== "string" || rawPath.length === 0) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message: "Missing file path.",
            validationErrors: [
              {
                field: "path",
                issue: "path is required."
              }
            ]
          }),
          "[read_file] invalid input\n- path: path is required."
        );
      }

      const maxCharacters =
        typeof input.maxCharacters === "number" && input.maxCharacters > 0
          ? Math.floor(input.maxCharacters)
          : 12_000;

      try {
        const absolutePath = normalizeWorkspacePath(
          workingDirectory,
          rawPath,
          context.allowWorkspaceEscape
        );
        const stat = await fs.stat(absolutePath);

        if (!stat.isFile()) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "TARGET_NOT_FILE",
              message: "Target is not a file."
            }),
            "[read_file] failed\n- target is not a file"
          );
        }

        const { text, truncated } = await readTextFileWithLimit(
          absolutePath,
          maxCharacters
        );

        return successResult(
          createToolResult({
            ok: true,
            code: "FILE_READ_OK",
            message: "File read successfully.",
            data: {
              path: toRelativeWorkspacePath(workingDirectory, absolutePath),
              truncated,
              content: text
            }
          }),
          `[read_file] success\n- ${toRelativeWorkspacePath(
            workingDirectory,
            absolutePath
          )}`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failureResult(
          createToolResult({
            ok: false,
            code: "READ_FILE_FAILED",
            message
          }),
          `[read_file] failed\n- ${message}`
        );
      }
    }
  };
}
