import { promises as fs } from "node:fs";

import type { ToolResultDetails } from "../types.js";
import {
  fileVersionsMatch,
  freshSessionReadFailureResult,
  readFileVersion,
  requireFreshSessionRead
} from "./fresh-session-read.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  successResult
} from "./tool-result.js";
import {
  buildToolDescription,
  describeObjectProperty
} from "./tool-description.js";
import {
  getPathKind,
  normalizeWorkspacePath,
  toRelativeWorkspacePath
} from "./workspace.js";

interface DeleteFileTarget {
  absolutePath: string;
  relativePath: string;
}

interface DeleteFileChange {
  path: string;
  action: "delete";
  addedLineCount: number;
  removedLineCount: number;
  diff: string;
}

function normalizeInputPaths(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<string>();
  const paths: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") {
      continue;
    }

    const path = item.trim();
    if (!path || seen.has(path)) {
      continue;
    }

    seen.add(path);
    paths.push(path);
  }

  return paths;
}

function normalizeDiffLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  return content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

function buildDeleteFileChange(input: {
  path: string;
  content: string;
}): DeleteFileChange {
  const originalLines = normalizeDiffLines(input.content);
  const oldCount = originalLines.length;
  const oldStart = oldCount === 0 ? 0 : 1;

  return {
    path: input.path,
    action: "delete",
    addedLineCount: 0,
    removedLineCount: oldCount,
    diff: [
      `--- a/${input.path}`,
      "+++ /dev/null",
      `@@ -${oldStart},${oldCount} +0,0 @@`,
      ...originalLines.map((line) => `-${line}`)
    ].join("\n")
  };
}

function summarizePaths(paths: string[]): string {
  if (paths.length <= 3) {
    return paths.join(", ");
  }

  return `${paths.slice(0, 3).join(", ")} +${paths.length - 3} more`;
}

export function createDeleteFileTool(workingDirectory: string): RuntimeTool {
  return {
    name: "delete_file",
    description: buildToolDescription({
      usageScenarios: [
        "Delete one or more existing files from the workspace.",
        "Remove files while keeping an undoable diff in the tool result."
      ],
      usageInstructions: [
        describeObjectProperty({
          name: "paths",
          type: "array",
          required: true,
          description:
            "One or more workspace-relative file paths to delete."
        }),
        "Read each existing target file with read_file in this session before deletion."
      ],
      constraints: [
        "Directories are not supported; use delete_path when the target may be a directory.",
        "Deletion is destructive and requires approval.",
        "Existing files must have current session file state from read_file before deletion."
      ],
      examples: [
        '{"paths":["tmp/debug.log"]}',
        '{"paths":["packages/agent/tmp/a.txt","packages/agent/tmp/b.txt"]}'
      ]
    }),
    family: "workspace-file",
    isReadOnly: false,
    hasExternalSideEffect: true,
    permissionProfile: "destructive-only",
    sandboxProfile: "workspace-rooted",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description:
            "One or more file paths relative to the workspace root. Directories are not supported."
        }
      },
      required: ["paths"],
      additionalProperties: false
    },
    getSandboxTargets(input) {
      const paths = normalizeInputPaths(input.paths);
      return paths.length > 0 ? paths : ["."];
    },
    async getPermissionRequest(input, context) {
      const paths = normalizeInputPaths(input.paths);
      if (paths.length === 0) {
        return null;
      }

      const relativePaths = paths.map((rawPath) =>
        toRelativeWorkspacePath(
          workingDirectory,
          normalizeWorkspacePath(
            workingDirectory,
            rawPath,
            context.allowWorkspaceEscape
          )
        )
      );

      return {
        summaryText: `需要你的确认后才能删除 ${relativePaths.length} 个文件：${summarizePaths(
          relativePaths
        )}`,
        contextNote:
          "删除文件属于破坏性操作；成功后会返回可撤销和重新应用的 diff。"
      };
    },
    validate(input) {
      const paths = normalizeInputPaths(input.paths);
      if (paths.length > 0) {
        return { ok: true, value: { paths } };
      }

      return {
        ok: false,
        issues: [
          { field: "paths", issue: "paths must include at least one path." }
        ]
      };
    },
    async execute(input, context) {
      const rawPaths = normalizeInputPaths(input.paths);
      if (rawPaths.length === 0) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message: "Missing paths.",
            validationErrors: [
              { field: "paths", issue: "paths must include at least one path." }
            ]
          }),
          "[delete_file] invalid input"
        );
      }

      try {
        const targets: DeleteFileTarget[] = rawPaths.map((rawPath) => {
          const absolutePath = normalizeWorkspacePath(
            workingDirectory,
            rawPath,
            context.allowWorkspaceEscape
          );
          return {
            absolutePath,
            relativePath: toRelativeWorkspacePath(
              workingDirectory,
              absolutePath
            )
          };
        });

        const changes: DeleteFileChange[] = [];

        for (const target of targets) {
          const existingKind = await getPathKind(target.absolutePath);
          if (existingKind === "missing") {
            return failureResult(
              createToolResult({
                ok: false,
                code: "PATH_NOT_FOUND",
                message: "Target file does not exist.",
                data: { path: target.relativePath }
              }),
              `[delete_file] failed\n- target file does not exist: ${target.relativePath}`
            );
          }

          if (existingKind !== "file") {
            return failureResult(
              createToolResult({
                ok: false,
                code: "TARGET_NOT_FILE",
                message: "Target is not a file.",
                data: { path: target.relativePath, kind: existingKind }
              }),
              `[delete_file] failed\n- target is not a file: ${target.relativePath}`
            );
          }

          const readPrecondition = await requireFreshSessionRead({
            workingDirectory,
            absolutePath: target.absolutePath,
            sessionMessages: context.sessionMessages
          });
          if (!readPrecondition.ok) {
            return freshSessionReadFailureResult({
              toolName: "delete_file",
              code: readPrecondition.code,
              path: target.relativePath
            });
          }

          const latestStat = await fs.stat(target.absolutePath);
          if (
            !fileVersionsMatch(
              readPrecondition.version,
              readFileVersion(latestStat)
            )
          ) {
            return freshSessionReadFailureResult({
              toolName: "delete_file",
              code: "FILE_CHANGED_SINCE_READ",
              path: target.relativePath
            });
          }

          const content = await fs.readFile(target.absolutePath, "utf8");
          changes.push(
            buildDeleteFileChange({
              path: target.relativePath,
              content
            })
          );
        }

        for (const target of targets) {
          await fs.rm(target.absolutePath, { force: false });
        }

        const details: ToolResultDetails = {
          kind: "workspace_file_changes",
          files: changes.map((change) => ({
            path: change.path,
            action: change.action,
            addedLineCount: change.addedLineCount,
            removedLineCount: change.removedLineCount,
            diff: change.diff
          }))
        };

        return successResult(
          createToolResult({
            ok: true,
            code: "FILES_DELETED",
            message: "Files deleted successfully.",
            data: {
              fileCount: targets.length,
              files: targets.map((target) => ({
                path: target.relativePath,
                fileState: { exists: false }
              }))
            }
          }),
          `[delete_file] success\n- ${targets.length} file(s): ${summarizePaths(
            targets.map((target) => target.relativePath)
          )}`,
          details
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failureResult(
          createToolResult({
            ok: false,
            code: "DELETE_FILE_FAILED",
            message
          }),
          `[delete_file] failed\n- ${message}`
        );
      }
    }
  };
}
