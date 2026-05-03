import type { RuntimeTool } from "./runtime-tool.js";
import {
  freshSessionReadFailureResult,
  requireFreshSessionRead
} from "./fresh-session-read.js";
import {
  applyUnifiedPatch,
  listPatchTargets,
  parseUnifiedPatch,
  type ParsedUnifiedPatch
} from "./unified-patch.js";
import {
  createToolResult,
  failureResult,
  successResult
} from "./tool-result.js";
import type { ToolResultDetails } from "../types.js";
import {
  getPathKind,
  normalizeWorkspacePath,
  toRelativeWorkspacePath
} from "./workspace.js";
import type { ToolExecutionContext } from "./runtime-tool.js";
import { buildToolDescription } from "./tool-description.js";

const APPLY_PATCH_DESCRIPTION = buildToolDescription({
  usageScenarios: [
    "Make line-level edits to one or more existing workspace files.",
    "Apply small targeted changes after reading the current file content in this session.",
    "Create a new file with unified diff syntax when a patch-based write is preferred."
  ],
  usageInstructions: [
    "Step 1: for every existing file you want to modify or delete, read it with read_file in this session first.",
    "Step 2: provide one complete unified diff string in patch.",
    "Step 3: use --- a/path and +++ b/path for existing files, or --- /dev/null and +++ b/path for file creation.",
    "Step 4: each hunk header must use @@ -oldStart,oldCount +newStart,newCount @@, and the counts must cover the full hunk body.",
    "Step 5: oldStart must point at the first line shown in the hunk body, not the edited line.",
    "Step 6: for simple edits, prefer the smallest exact hunk around the target line instead of rewriting surrounding code.",
    "Step 7: if the task is to remove one visible product sentence or one string literal, delete only the target content and keep surrounding formatting, structure, data flow, and control flow unchanged.",
    "Step 8: leave already-correct containers, wrappers, branches, delimiters, and closing lines untouched when the requested change is only local content removal.",
    "Step 9: in a removal hunk, the removed content itself must be a - line, while unchanged surrounding lines stay as context lines with a leading space.",
    "Step 10: do not normalize or simplify surrounding code, markup, configuration, or prose structure when the user only asked to remove local content.",
    "Step 11: if a patch fails with context mismatch, reread the same narrow range with read_file and retry with a smaller hunk."
  ],
  constraints: [
    "Read before edit: search_text, load_skill, or prior conversation do not satisfy the write precondition for existing files.",
    "Patch hunks must match the current file exactly, including unchanged blank lines.",
    "oldStart is the 1-based line number of the first hunk body line in the current file.",
    "hunk counts must equal context+deleted lines for old and context+added lines for new.",
    "Header counts must include every unchanged context line shown in the hunk body, not only the changed lines.",
    "Do not rewrite nearby identifiers, strings, indentation, unrelated lines, containers, or surrounding behavior when the requested change is only one visible sentence or one string literal.",
    "When removing local content, do not change conditions, branches, wrappers, delimiters, keys, paths, or other surrounding structure around that content.",
    "Do not invert control flow, collapse wrappers, or normalize equivalent syntax when the request is only local content removal.",
    "For a one-line content deletion, the deleted content line must appear with a - prefix in the hunk body. Any surrounding lines that remain in the file must be kept as unchanged context lines with a leading space.",
    "Do not use apply_patch to rename paths."
  ],
  examples: [
    '{"patch":"--- a/file.txt\\n+++ b/file.txt\\n@@ -1,2 +1,3 @@\\n one\\n two\\n+three"}',
    '{"patch":"--- a/file.txt\\n+++ b/file.txt\\n@@ -2,3 +2,2 @@\\n keep before\\n-remove me\\n keep after"}',
    '{"patch":"--- a/copy.txt\\n+++ b/copy.txt\\n@@ -1,3 +1,2 @@\\n before\\n-remove only this product copy\\n after"}',
    '{"patch":"--- /dev/null\\n+++ b/new.txt\\n@@ -0,0 +1,2 @@\\n+one\\n+two"}'
  ]
});

const PATCH_INPUT_DESCRIPTION = [
  "Complete unified diff text. Use --- a/path and +++ b/path, then @@ -oldStart,oldCount +newStart,newCount @@. oldStart is the 1-based line number of the first hunk body line in the current file, not the changed line.",
  "Each hunk body line starts with exactly one prefix: space for unchanged context, - for deletion, + for addition. An unchanged blank line is a single leading space followed by nothing.",
  "Counts: oldCount = context + deleted lines; newCount = context + added lines. Include unchanged blank lines and every other context line in both counts.",
  "If the hunk body contains 4 context lines plus 1 deleted line and 1 added line, the header counts are old=5 and new=5.",
  "For a request that removes one visible product sentence or one string literal, delete only the target content and keep adjacent identifiers, strings, indentation, structure, control flow, and other formatting unchanged.",
  "When removing local content, keep the surrounding container, branch, key, delimiter, and wrapper lines exactly as they are.",
  "Do not invert control flow, collapse wrappers, rename keys, or normalize equivalent syntax when the request is only to remove local content.",
  "For a one-line content deletion, write the target content line with a - prefix. Keep unchanged surrounding lines as space-prefixed context lines.",
  "Concrete local content removal example: --- a/copy.txt\\n+++ b/copy.txt\\n@@ -1,3 +1,2 @@\\n before\\n-remove only this product copy\\n after",
  "Example modify: --- a/file.txt\\n+++ b/file.txt\\n@@ -1,2 +1,3 @@\\n one\\n two\\n+three",
  "Example remove one line: --- a/file.txt\\n+++ b/file.txt\\n@@ -2,3 +2,2 @@\\n keep before\\n-remove me\\n keep after",
  "Example delete with leading blank context: --- a/file.md\\n+++ b/file.md\\n@@ -15,6 +15,5 @@\\n \\n line A\\n line B\\n-old line\\n \\n heading",
  "Example create: --- /dev/null\\n+++ b/new.txt\\n@@ -0,0 +1,2 @@\\n+one\\n+two"
].join(" ");

function addPatchRecoveryHint(message: string): string {
  if (
    message.includes("Patch context mismatch") ||
    message.includes("Patch deletion mismatch") ||
    message.includes("Patch hunk counts did not match")
  ) {
    return [
      message,
      "Recovery: reread the same narrow range and retry a smaller hunk.",
      "Keep unchanged surrounding lines as space-prefixed context lines, and make the deleted target content the only - line.",
      "Do not switch to write_file for this localized edit."
    ].join(" ");
  }

  return message;
}

function summarizeTargetPaths(targets: string[]): string {
  if (targets.length === 0) {
    return "1 patch";
  }
  if (targets.length <= 3) {
    return targets.join(", ");
  }

  return `${targets.slice(0, 3).join(", ")} +${targets.length - 3} more`;
}

async function requirePatchFreshSessionReads(input: {
  workingDirectory: string;
  patch: ParsedUnifiedPatch;
  context: ToolExecutionContext;
}): Promise<
  | { ok: true }
  | {
      ok: false;
      code: "FILE_WRITE_REQUIRES_READ" | "FILE_CHANGED_SINCE_READ";
      path: string;
    }
> {
  for (const filePatch of input.patch.files) {
    if (filePatch.action === "create") {
      continue;
    }

    const absoluteTargetPath = normalizeWorkspacePath(
      input.workingDirectory,
      filePatch.targetPath,
      input.context.allowWorkspaceEscape
    );
    if ((await getPathKind(absoluteTargetPath)) !== "file") {
      continue;
    }

    const readPrecondition = await requireFreshSessionRead({
      workingDirectory: input.workingDirectory,
      absolutePath: absoluteTargetPath,
      sessionMessages: input.context.sessionMessages
    });
    if (!readPrecondition.ok) {
      return {
        ok: false,
        code: readPrecondition.code,
        path: toRelativeWorkspacePath(
          input.workingDirectory,
          absoluteTargetPath
        )
      };
    }
  }

  return { ok: true };
}

export function createApplyPatchTool(workingDirectory: string): RuntimeTool {
  return {
    name: "apply_patch",
    description: APPLY_PATCH_DESCRIPTION,
    family: "workspace-file",
    isReadOnly: false,
    hasExternalSideEffect: true,
    permissionProfile: "destructive-only",
    sandboxProfile: "workspace-rooted",
    inputSchema: {
      type: "object",
      properties: {
        patch: {
          type: "string",
          description: PATCH_INPUT_DESCRIPTION
        }
      },
      required: ["patch"],
      additionalProperties: false
    },
    getSandboxTargets(input) {
      if (typeof input.patch !== "string") {
        return ["."];
      }

      const targets = listPatchTargets(input.patch);
      return targets.length > 0 ? targets : ["."];
    },
    async getPermissionRequest(input) {
      if (typeof input.patch !== "string" || input.patch.trim().length === 0) {
        return null;
      }

      const targets = listPatchTargets(input.patch);
      return {
        summaryText: `需要你的确认后才能应用补丁：${summarizeTargetPaths(targets)}`,
        contextNote:
          "补丁会按 diff 语义修改工作区文件；已有文件修改会先校验本 session 内最近一次 read_file 的文件版本。"
      };
    },
    validate(input) {
      if (typeof input.patch !== "string" || input.patch.trim().length === 0) {
        return {
          ok: false,
          issues: [
            {
              field: "patch",
              issue: "patch must be a non-empty string."
            }
          ]
        };
      }

      const parsedPatch = parseUnifiedPatch(input.patch);
      if (!parsedPatch.ok) {
        return {
          ok: false,
          issues: [
            {
              field: "patch",
              issue: parsedPatch.error
            }
          ]
        };
      }

      return {
        ok: true,
        value: input
      };
    },
    async execute(input, context) {
      if (typeof input.patch !== "string" || input.patch.trim().length === 0) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message: "Invalid apply_patch input.",
            validationErrors: [
              {
                field: "patch",
                issue: "patch must be a non-empty string."
              }
            ]
          }),
          "[apply_patch] invalid input\n- patch: patch must be a non-empty string."
        );
      }

      const parsedPatch = parseUnifiedPatch(input.patch);
      if (!parsedPatch.ok) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_PATCH",
            message: parsedPatch.error
          }),
          `[apply_patch] failed\n- ${parsedPatch.error}`
        );
      }

      try {
        const readPrecondition = await requirePatchFreshSessionReads({
          workingDirectory,
          patch: parsedPatch.value,
          context
        });
        if (!readPrecondition.ok) {
          return freshSessionReadFailureResult({
            toolName: "apply_patch",
            code: readPrecondition.code,
            path: readPrecondition.path
          });
        }

        const summaries = await applyUnifiedPatch({
          workingDirectory,
          patch: parsedPatch.value,
          allowWorkspaceEscape: context.allowWorkspaceEscape ?? false
        });
        const details: ToolResultDetails = {
          kind: "workspace_file_changes",
          files: summaries.map((summary) => ({
            path: summary.path,
            action: summary.action,
            addedLineCount: summary.addedLineCount,
            removedLineCount: summary.removedLineCount,
            diff: summary.diff
          }))
        };

        return successResult(
          createToolResult({
            ok: true,
            code: "PATCH_APPLIED",
            message: "Patch applied successfully.",
            data: {
              fileCount: summaries.length,
              files: summaries.map((summary) => ({
                path: summary.path,
                action: summary.action,
                hunkCount: summary.hunkCount,
                addedLineCount: summary.addedLineCount,
                removedLineCount: summary.removedLineCount,
                diff: summary.diff,
                fileState: summary.fileState.exists
                  ? {
                      exists: true,
                      sizeBytes: summary.fileState.sizeBytes,
                      modifiedAtMs: summary.fileState.modifiedAtMs
                    }
                  : { exists: false }
              }))
            }
          }),
          `[apply_patch] success\n- ${summaries.length} file(s): ${summarizeTargetPaths(
            summaries.map((summary) => summary.path)
          )}`,
          details
        );
      } catch (error) {
        const message = addPatchRecoveryHint(
          error instanceof Error ? error.message : String(error)
        );
        return failureResult(
          createToolResult({
            ok: false,
            code: "PATCH_APPLY_FAILED",
            message
          }),
          `[apply_patch] failed\n- ${message}`
        );
      }
    }
  };
}
