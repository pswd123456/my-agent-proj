import type { RuntimeTool } from "./runtime-tool.js";
import {
  normalizeGitPaths,
  normalizePathListInput,
  runGitCommand,
  truncateGitOutput,
  validatePathListInput,
  type GitCommandError
} from "./git-shared.js";
import {
  createToolResult,
  failureResult,
  successResult
} from "./tool-result.js";
import {
  buildToolDescription,
  describeObjectProperty
} from "./tool-description.js";

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

export function createGitDiffTool(): RuntimeTool {
  return {
    name: "git_diff",
    description: buildToolDescription({
      usageScenarios: [
        "Inspect unstaged or staged git diff output.",
        "Review changes for the whole workspace or for selected paths."
      ],
      usageInstructions: [
        "Optionally provide paths to scope the diff.",
        describeObjectProperty({
          name: "cached",
          type: "boolean",
          description:
            "Set true to inspect staged changes instead of unstaged changes."
        }),
        describeObjectProperty({
          name: "contextLines",
          type: "number",
          description: "Optional unified diff context line count."
        })
      ],
      constraints: [
        "This is read-only and does not modify git state.",
        "cached=false or omitted shows unstaged changes; cached=true shows staged changes.",
        "Fails outside a git repository."
      ],
      examples: [
        "{}",
        '{"paths":["packages/agent/src/tools/read-file.ts"],"contextLines":5}'
      ]
    }),
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
        },
        cached: {
          type: "boolean",
          description:
            "Whether to show staged changes instead of unstaged changes."
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
      const cached = toolInput.cached === true;

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
            ...(cached ? ["--cached"] : []),
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
              cached,
              scopedPaths: normalizedPaths.relativePaths,
              contextLines,
              hasChanges: stdout.length > 0,
              diff: diffOutput.text,
              truncated: diffOutput.truncated
            }
          }),
          `[git_diff] success\n- ${stdout.length > 0 ? "diff available" : "no changes"}`
        );
      } catch (error) {
        return mapGitDiffFailure("git_diff", error);
      }
    }
  };
}
