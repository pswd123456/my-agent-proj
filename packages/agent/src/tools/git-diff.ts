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

const DEFAULT_CONTEXT_LINES = 3;
const MAX_CONTEXT_LINES = 20;

function normalizeContextLines(value: unknown): number | null {
  if (value === undefined) {
    return DEFAULT_CONTEXT_LINES;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.min(Math.floor(value), MAX_CONTEXT_LINES);
}

function mapGitDiffFailure(
  toolName: string,
  error: unknown
): ReturnType<typeof failureResult> {
  const gitError = error as GitCommandError;
  const code =
    gitError.code === "GIT_NOT_AVAILABLE"
      ? "GIT_NOT_AVAILABLE"
      : gitError.code === "NOT_GIT_REPOSITORY"
        ? "NOT_GIT_REPOSITORY"
        : "GIT_DIFF_FAILED";

  return failureResult(
    createToolResult({
      ok: false,
      code,
      message: gitError.message
    }),
    `[${toolName}] failed\n- ${gitError.message}`
  );
}

function createGitDiffTool(input: {
  name: "git_diff" | "git_diff_cached";
  cached: boolean;
  description: string;
}): RuntimeTool {
  return {
    name: input.name,
    description: input.description,
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
            "Optional workspace-relative paths to scope the git diff query."
        },
        contextLines: {
          type: "number",
          description: "Optional unified diff context line count."
        }
      },
      additionalProperties: false
    },
    getSandboxTargets(toolInput) {
      const paths = normalizePathListInput(toolInput.paths);
      return paths && paths.length > 0 ? paths : ["."];
    },
    validate(toolInput) {
      const issues: Array<{ field: string; issue: string }> = [];
      const pathValidation = validatePathListInput(toolInput.paths);
      if (!pathValidation.ok) {
        issues.push(...(pathValidation.issues ?? []));
      }

      if (normalizeContextLines(toolInput.contextLines) === null) {
        issues.push({
          field: "contextLines",
          issue: "contextLines must be a non-negative number."
        });
      }

      if (issues.length > 0) {
        return {
          ok: false,
          issues
        };
      }

      return {
        ok: true,
        value: toolInput
      };
    },
    async execute(toolInput, context) {
      const contextLines =
        normalizeContextLines(toolInput.contextLines) ?? DEFAULT_CONTEXT_LINES;
      const rawPaths = normalizePathListInput(toolInput.paths) ?? undefined;

      try {
        const normalizedPaths = normalizeGitPaths({
          workingDirectory: context.workingDirectory,
          rawPaths,
          allowWorkspaceEscape: context.allowWorkspaceEscape ?? false
        });
        const stdout = await runGitCommand({
          workingDirectory: context.workingDirectory,
          args: [
            "diff",
            "--no-color",
            "--no-ext-diff",
            `--unified=${contextLines}`,
            ...(input.cached ? ["--cached"] : []),
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
        const diffOutput = truncateGitOutput(stdout);

        return successResult(
          createToolResult({
            ok: true,
            code: "GIT_DIFF_OK",
            message: "Git diff loaded successfully.",
            data: {
              cached: input.cached,
              scopedPaths: normalizedPaths.relativePaths,
              contextLines,
              hasChanges: stdout.length > 0,
              diff: diffOutput.text,
              truncated: diffOutput.truncated
            }
          }),
          `[${input.name}] success\n- ${stdout.length > 0 ? "diff available" : "no changes"}`
        );
      } catch (error) {
        return mapGitDiffFailure(input.name, error);
      }
    }
  };
}

export function createGitDiffToolUncached(): RuntimeTool {
  return createGitDiffTool({
    name: "git_diff",
    cached: false,
    description:
      "Show unstaged git diff output for the workspace or selected paths."
  });
}

export function createGitDiffCachedTool(): RuntimeTool {
  return createGitDiffTool({
    name: "git_diff_cached",
    cached: true,
    description:
      "Show staged git diff output for the workspace or selected paths."
  });
}
