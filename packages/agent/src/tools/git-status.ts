import type { JsonValue } from "../types.js";

import type { RuntimeTool } from "./runtime-tool.js";
import {
  normalizeGitPaths,
  normalizePathListInput,
  runGitCommand,
  truncateGitOutput,
  validatePathListInput,
  type GitCommandError
} from "./git-shared.js";
import { createToolResult, failureResult, successResult } from "./tool-result.js";

function parseStatusEntries(lines: string[]): Array<Record<string, JsonValue>> {
  return lines
    .filter(Boolean)
    .map((line) => {
      if (line.startsWith("?? ")) {
        return {
          path: line.slice(3),
          indexStatus: "?",
          workTreeStatus: "?",
          untracked: true
        } satisfies Record<string, JsonValue>;
      }

      const status = line.slice(0, 2);
      const pathPart = line.slice(3);
      const renameSeparator = pathPart.indexOf(" -> ");

      return {
        path:
          renameSeparator >= 0
            ? pathPart.slice(renameSeparator + 4)
            : pathPart,
        ...(renameSeparator >= 0
          ? {
              originalPath: pathPart.slice(0, renameSeparator)
            }
          : {}),
        indexStatus: status[0] ?? " ",
        workTreeStatus: status[1] ?? " "
      } satisfies Record<string, JsonValue>;
    });
}

function mapGitStatusFailure(
  toolName: string,
  error: unknown
): ReturnType<typeof failureResult> {
  const gitError = error as GitCommandError;
  const code =
    gitError.code === "GIT_NOT_AVAILABLE"
      ? "GIT_NOT_AVAILABLE"
      : gitError.code === "NOT_GIT_REPOSITORY"
        ? "NOT_GIT_REPOSITORY"
        : "GIT_STATUS_FAILED";

  return failureResult(
    createToolResult({
      ok: false,
      code,
      message: gitError.message
    }),
    `[${toolName}] failed\n- ${gitError.message}`
  );
}

export function createGitStatusTool(): RuntimeTool {
  return {
    name: "git_status",
    description: "Inspect the current git working tree status without modifying the repository.",
    family: "workspace-file",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "workspace-rooted",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: {
            type: "string"
          },
          description:
            "Optional workspace-relative paths to scope the git status query."
        }
      },
      additionalProperties: false
    },
    getSandboxTargets(input) {
      const paths = normalizePathListInput(input.paths);
      return paths && paths.length > 0 ? paths : ["."];
    },
    validate(input) {
      const pathValidation = validatePathListInput(input.paths);
      if (!pathValidation.ok) {
        return {
          ok: false,
          issues: pathValidation.issues ?? []
        };
      }

      return {
        ok: true,
        value: input
      };
    },
    async execute(input, context) {
      const rawPaths = normalizePathListInput(input.paths) ?? undefined;

      try {
        const normalizedPaths = normalizeGitPaths({
          workingDirectory: context.workingDirectory,
          rawPaths,
          allowWorkspaceEscape: context.allowWorkspaceEscape ?? false
        });
        const stdout = await runGitCommand({
          workingDirectory: context.workingDirectory,
          args: [
            "status",
            "--short",
            "--branch",
            "--untracked-files=all",
            "--porcelain=v1",
            ...(normalizedPaths.relativePaths.length > 0
              ? ["--", ...normalizedPaths.relativePaths]
              : [])
          ],
          ...(context.abortSignal
            ? {
                abortSignal: context.abortSignal
              }
            : {})
        });

        const lines = stdout.replace(/\r\n/g, "\n").trimEnd().split("\n");
        const branchLine = lines[0]?.startsWith("## ")
          ? lines.shift()?.slice(3) ?? ""
          : "";
        const entries = parseStatusEntries(lines);
        const rawOutput = truncateGitOutput(stdout);

        return successResult(
          createToolResult({
            ok: true,
            code: "GIT_STATUS_OK",
            message: "Git status loaded successfully.",
            data: {
              branch: branchLine,
              clean: entries.length === 0,
              entries,
              scopedPaths: normalizedPaths.relativePaths,
              raw: rawOutput.text,
              truncated: rawOutput.truncated
            }
          }),
          `[git_status] success\n- ${entries.length === 0 ? "clean" : `${entries.length} changed path(s)`}`
        );
      } catch (error) {
        return mapGitStatusFailure("git_status", error);
      }
    }
  };
}
