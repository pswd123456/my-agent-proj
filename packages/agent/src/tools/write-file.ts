import { promises as fs } from "node:fs";
import path from "node:path";

import type { ToolResultDetails } from "../types.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  fileVersionsMatch,
  freshSessionReadFailureResult,
  readFileMode,
  readFileVersion,
  requireFreshSessionRead
} from "./fresh-session-read.js";
import {
  getPathKind,
  normalizeWorkspacePath,
  toRelativeWorkspacePath,
  writeTextFileAtomic
} from "./workspace.js";
import {
  createToolResult,
  failureResult,
  successResult
} from "./tool-result.js";
import {
  buildToolDescription,
  describeObjectProperty
} from "./tool-description.js";

function normalizeDiffLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  return content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

function buildWholeFileDiff(input: {
  path: string;
  originalContent: string | null;
  nextContent: string;
}): {
  action: "create" | "modify";
  addedLineCount: number;
  removedLineCount: number;
  diff: string;
} {
  const originalLines = normalizeDiffLines(input.originalContent ?? "");
  const nextLines = normalizeDiffLines(input.nextContent);
  const action = input.originalContent === null ? "create" : "modify";
  const oldPath = action === "create" ? "/dev/null" : `a/${input.path}`;
  const newPath = `b/${input.path}`;
  const oldCount = originalLines.length;
  const newCount = nextLines.length;
  const oldStart = oldCount === 0 ? 0 : 1;
  const newStart = newCount === 0 ? 0 : 1;

  return {
    action,
    addedLineCount: nextCount(nextLines),
    removedLineCount: nextCount(originalLines),
    diff: [
      `--- ${oldPath}`,
      `+++ ${newPath}`,
      `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      ...originalLines.map((line) => `-${line}`),
      ...nextLines.map((line) => `+${line}`)
    ].join("\n")
  };
}

function nextCount(lines: string[]): number {
  return lines.length;
}

function detectLocalizedExistingFileEdit(input: {
  originalContent: string;
  nextContent: string;
}): {
  isLocalized: boolean;
  oldChangedLineCount: number;
  newChangedLineCount: number;
} {
  const originalLines = normalizeDiffLines(input.originalContent);
  const nextLines = normalizeDiffLines(input.nextContent);

  let prefixCount = 0;
  while (
    prefixCount < originalLines.length &&
    prefixCount < nextLines.length &&
    originalLines[prefixCount] === nextLines[prefixCount]
  ) {
    prefixCount += 1;
  }

  let suffixCount = 0;
  while (
    suffixCount < originalLines.length - prefixCount &&
    suffixCount < nextLines.length - prefixCount &&
    originalLines[originalLines.length - 1 - suffixCount] ===
      nextLines[nextLines.length - 1 - suffixCount]
  ) {
    suffixCount += 1;
  }

  const oldChangedLineCount = Math.max(
    0,
    originalLines.length - prefixCount - suffixCount
  );
  const newChangedLineCount = Math.max(
    0,
    nextLines.length - prefixCount - suffixCount
  );
  const changedLineBudget = Math.max(oldChangedLineCount, newChangedLineCount);
  const preservedEdgeLines = prefixCount + suffixCount;

  return {
    isLocalized:
      changedLineBudget > 0 &&
      changedLineBudget <= 8 &&
      preservedEdgeLines > 0,
    oldChangedLineCount,
    newChangedLineCount
  };
}

export function createWriteFileTool(workingDirectory: string): RuntimeTool {
  return {
    name: "write_file",
    description: buildToolDescription({
      usageScenarios: [
        "Create a new text file.",
        "Replace the full content of an existing text file.",
        "Write generated or rewritten whole-file content after you have decided the complete target content."
      ],
      usageInstructions: [
        "Step 1: set path to the workspace-relative file path.",
        describeObjectProperty({
          name: "content",
          type: "string",
          required: true,
          description: "Full file content to write."
        }),
        "Step 2: if the target file already exists, read it with read_file in this session before writing.",
        "Step 3: use apply_patch instead of write_file for line-level edits.",
        "Step 4: if you only need to remove or change one sentence, one string literal, or a few nearby lines in an existing file, stay on apply_patch.",
        "Step 5: even if you can describe the whole next file content, do not switch to write_file for a one-line text removal task."
      ],
      constraints: [
        "Existing files MUST be read with read_file in this session before writing.",
        "write_file only supports full-file writes; line edits are rejected.",
        "Do not use write_file for localized edits to an existing file just because apply_patch needs a smaller or more exact hunk.",
        "Do not use write_file for a one-line sentence or string removal in an existing file after apply_patch fails; reread and retry a smaller patch instead.",
        "Do not use write_file to simplify, normalize, or rewrite unchanged surrounding structure during a local content removal.",
        "The parent directory must already exist.",
        "Directory targets are rejected."
      ],
      examples: [
        '{"path":"notes/todo.md","content":"# Todo\\n- item 1\\n"}',
        '{"path":"packages/agent/src/generated.ts","content":"export const value = 1;\\n"}'
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
        path: {
          type: "string",
          description: "File path relative to the workspace root."
        },
        content: {
          type: "string",
          description: "Full file content to write."
        }
      },
      required: ["path", "content"],
      additionalProperties: false
    },
    getSandboxTargets(input) {
      return [
        typeof input.path === "string" && input.path.length > 0
          ? input.path
          : "."
      ];
    },
    async getPermissionRequest(input, context) {
      const rawPath = typeof input.path === "string" ? input.path : "";
      if (!rawPath) {
        return null;
      }

      const absolutePath = normalizeWorkspacePath(
        workingDirectory,
        rawPath,
        context.allowWorkspaceEscape
      );
      if ((await getPathKind(absolutePath)) !== "file") {
        return null;
      }

      return {
        summaryText: `需要你的确认后才能覆盖已有文件：${toRelativeWorkspacePath(
          workingDirectory,
          absolutePath
        )}`,
        contextNote:
          "已有文件写入会先校验本 session 内最近一次 read_file 的文件版本。"
      };
    },
    validate(input) {
      const issues: Array<{ field: string; issue: string }> = [];
      if (typeof input.path !== "string" || input.path.length === 0) {
        issues.push({ field: "path", issue: "path is required." });
      }
      if (typeof input.content !== "string") {
        issues.push({ field: "content", issue: "content must be a string." });
      }
      if (
        input.mode !== undefined ||
        input.startLine !== undefined ||
        input.endLine !== undefined
      ) {
        issues.push({
          field: "input",
          issue:
            "write_file only supports full-file writes. Use apply_patch for line edits."
        });
      }

      if (issues.length > 0) {
        return { ok: false, issues };
      }

      return { ok: true, value: input };
    },
    async execute(input, context) {
      const validation = this.validate(input);
      if (!validation.ok) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message: "Invalid write_file input.",
            validationErrors: validation.issues ?? []
          }),
          `[write_file] invalid input\n${(validation.issues ?? [])
            .map((issue) => `- ${issue.field}: ${issue.issue}`)
            .join("\n")}`
        );
      }

      const rawPath = input.path as string;
      const content = input.content as string;

      try {
        const absolutePath = normalizeWorkspacePath(
          workingDirectory,
          rawPath,
          context.allowWorkspaceEscape
        );
        const relativePath = toRelativeWorkspacePath(
          workingDirectory,
          absolutePath
        );
        const parentDirectory = path.dirname(absolutePath);
        const parentKind = await getPathKind(parentDirectory);
        if (parentKind !== "directory") {
          return failureResult(
            createToolResult({
              ok: false,
              code: "WRITE_FILE_PARENT_MISSING",
              message: "Parent directory does not exist."
            }),
            "[write_file] failed\n- parent directory does not exist"
          );
        }

        const pathKind = await getPathKind(absolutePath);
        if (pathKind === "directory") {
          return failureResult(
            createToolResult({
              ok: false,
              code: "TARGET_NOT_FILE",
              message: "Target is not a file."
            }),
            "[write_file] failed\n- target is not a file"
          );
        }

        const existed = pathKind === "file";
        const originalContent = existed
          ? await fs.readFile(absolutePath, "utf8")
          : null;
        if (existed && originalContent !== null && originalContent !== content) {
          const localizedEdit = detectLocalizedExistingFileEdit({
            originalContent,
            nextContent: content
          });
          if (localizedEdit.isLocalized) {
            return failureResult(
              createToolResult({
                ok: false,
                code: "WRITE_FILE_LOCALIZED_EDIT",
                message:
                  "This existing-file write only changes a small local range. Use apply_patch so unchanged surrounding structure and behavior stay exact."
              }),
              [
                "[write_file] failed",
                "- localized existing-file edit detected; use apply_patch instead",
                `- changed old lines: ${localizedEdit.oldChangedLineCount}, changed new lines: ${localizedEdit.newChangedLineCount}`,
                "- recovery: reread the narrow range, keep unchanged surrounding lines exact, and change only the target content"
              ].join("\n")
            );
          }
        }
        const readPrecondition = existed
          ? await requireFreshSessionRead({
              workingDirectory,
              absolutePath,
              sessionMessages: context.sessionMessages
            })
          : null;
        if (readPrecondition && !readPrecondition.ok) {
          return freshSessionReadFailureResult({
            toolName: "write_file",
            code: readPrecondition.code,
            path: relativePath
          });
        }

        if (readPrecondition?.ok) {
          const latestStat = await fs.stat(absolutePath);
          if (
            !fileVersionsMatch(
              readPrecondition.version,
              readFileVersion(latestStat)
            )
          ) {
            return freshSessionReadFailureResult({
              toolName: "write_file",
              code: "FILE_CHANGED_SINCE_READ",
              path: relativePath
            });
          }
        }

        const fileChange = buildWholeFileDiff({
          path: relativePath,
          originalContent,
          nextContent: content
        });
        await writeTextFileAtomic(absolutePath, content, {
          ...(readPrecondition?.ok
            ? { mode: readFileMode(readPrecondition.stat) }
            : {})
        });
        const writtenVersion = readFileVersion(await fs.stat(absolutePath));
        const details: ToolResultDetails = {
          kind: "workspace_file_changes",
          files: [
            {
              path: relativePath,
              action: fileChange.action,
              addedLineCount: fileChange.addedLineCount,
              removedLineCount: fileChange.removedLineCount,
              diff: fileChange.diff
            }
          ]
        };

        return successResult(
          createToolResult({
            ok: true,
            code: existed ? "FILE_UPDATED" : "FILE_CREATED",
            message: existed
              ? "File updated successfully."
              : "File created successfully.",
            data: {
              path: relativePath,
              existed,
              fileState: {
                exists: true,
                ...writtenVersion
              }
            }
          }),
          `[write_file] success\n- ${relativePath}`,
          details
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failureResult(
          createToolResult({
            ok: false,
            code: "WRITE_FILE_FAILED",
            message
          }),
          `[write_file] failed\n- ${message}`
        );
      }
    }
  };
}
