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
    description:
      "Apply a unified diff patch to one or more workspace files after approval. Existing files MUST be read with read_file in this session before modification or deletion.",
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
          description:
            "Unified diff text that updates one or more workspace files."
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
                diff: summary.diff
              }))
            }
          }),
          `[apply_patch] success\n- ${summaries.length} file(s): ${summarizeTargetPaths(
            summaries.map((summary) => summary.path)
          )}`,
          details
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
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
