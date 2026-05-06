import { promises as fs } from "node:fs";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  getPathKind,
  normalizeWorkspacePath,
  toRelativeWorkspacePath
} from "./workspace.js";
import {
  createInvalidToolInputResult,
  createToolResult,
  failureResult,
  successResult
} from "./tool-result.js";
import {
  buildToolDescription,
  describeObjectProperty
} from "./tool-description.js";
import {
  getWorkspacePathSandboxTargets,
  validateRequiredWorkspacePath
} from "./workspace-tool-input.js";

export function createCreateDirectoryTool(
  workingDirectory: string
): RuntimeTool {
  return {
    name: "create_directory",
    description: buildToolDescription({
      usageScenarios: [
        "Create a new directory inside the workspace.",
        "Ensure a target directory exists before writing files into it."
      ],
      usageInstructions: [
        describeObjectProperty({
          name: "path",
          type: "string",
          required: true,
          description: "Workspace-relative directory path to create."
        }),
        "Call the tool once with the target directory path."
      ],
      constraints: [
        "If the target already exists as a directory, the call succeeds without changing it.",
        "Fails when the target path already exists as a file."
      ],
      examples: [
        '{"path":"artifacts/reports"}',
        '{"path":"packages/agent/tmp"}'
      ]
    }),
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
      return getWorkspacePathSandboxTargets(input);
    },
    validate(input) {
      const issues = validateRequiredWorkspacePath(input);
      return issues.length > 0
        ? { ok: false, issues }
        : { ok: true, value: input };
    },
    async execute(input, context) {
      const validation = this.validate(input);
      if (!validation.ok) {
        return createInvalidToolInputResult(
          "create_directory",
          validation.issues ?? [],
          "Missing directory path."
        );
      }
      const rawPath = input.path as string;

      try {
        const absolutePath = normalizeWorkspacePath(
          workingDirectory,
          rawPath,
          context.allowWorkspaceEscape
        );
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
