import { promises as fs } from "node:fs";

import type { ToolResultDetails } from "../types.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  fileVersionsMatch,
  freshSessionReadFailureResult,
  readFileVersion,
  requireFreshSessionRead
} from "./fresh-session-read.js";
import {
  getPathKind,
  normalizeWorkspacePath,
  toRelativeWorkspacePath
} from "./workspace.js";
import {
  applyUnifiedPatch,
  buildUnifiedFilePatchFromContents
} from "./unified-patch.js";
import {
  createToolResult,
  failureResult,
  successResult
} from "./tool-result.js";
import {
  buildToolDescription,
  describeObjectProperty
} from "./tool-description.js";

function normalizeEditableText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function detectLineEnding(value: string): "\r\n" | "\n" {
  return value.includes("\r\n") ? "\r\n" : "\n";
}

function restoreLineEndings(value: string, lineEnding: "\r\n" | "\n"): string {
  return lineEnding === "\r\n" ? value.replace(/\n/g, "\r\n") : value;
}

function normalizeQuotes(value: string): string {
  return value
    .replaceAll("‘", "'")
    .replaceAll("’", "'")
    .replaceAll("“", '"')
    .replaceAll("”", '"');
}

function findActualString(
  fileContent: string,
  searchString: string
): string | null {
  if (fileContent.includes(searchString)) {
    return searchString;
  }

  const normalizedFileContent = normalizeQuotes(fileContent);
  const normalizedSearchString = normalizeQuotes(searchString);
  const searchIndex = normalizedFileContent.indexOf(normalizedSearchString);
  if (searchIndex === -1) {
    return null;
  }

  return fileContent.slice(searchIndex, searchIndex + searchString.length);
}

function countOccurrences(input: { content: string; search: string }): number {
  if (input.search.length === 0) {
    return 0;
  }

  let count = 0;
  let index = 0;
  while (index <= input.content.length) {
    const nextIndex = input.content.indexOf(input.search, index);
    if (nextIndex === -1) {
      return count;
    }
    count += 1;
    index = nextIndex + input.search.length;
  }

  return count;
}

function replaceFirst(input: {
  content: string;
  oldString: string;
  newString: string;
}): string {
  const index = input.content.indexOf(input.oldString);
  if (index === -1) {
    return input.content;
  }

  if (
    input.newString === "" &&
    !input.oldString.endsWith("\n") &&
    input.content.startsWith(`${input.oldString}\n`, index)
  ) {
    return [
      input.content.slice(0, index),
      input.content.slice(index + input.oldString.length + 1)
    ].join("");
  }

  return [
    input.content.slice(0, index),
    input.newString,
    input.content.slice(index + input.oldString.length)
  ].join("");
}

function applyEdit(input: {
  content: string;
  oldString: string;
  newString: string;
  replaceAll: boolean;
}): string {
  if (input.replaceAll) {
    return input.content.split(input.oldString).join(input.newString);
  }

  return replaceFirst(input);
}

function summarizeTargetPath(path: string): string {
  return path.length > 0 ? path : "target file";
}

export function createEditFileTool(workingDirectory: string): RuntimeTool {
  return {
    name: "edit_file",
    description: buildToolDescription({
      usageScenarios: [
        "Replace a unique string or small adjacent block in an existing workspace file.",
        "Delete local content by setting newString to an empty string.",
        "Replace every occurrence of an exact string in one file with replaceAll."
      ],
      usageInstructions: [
        "Read before edit: read the existing file with read_file in this session before editing.",
        describeObjectProperty({
          name: "path",
          type: "string",
          required: true,
          description: "Workspace-relative path of the existing file to edit."
        }),
        describeObjectProperty({
          name: "oldString",
          type: "string",
          required: true,
          description:
            "Exact current text to replace. Copy it from read_file output and omit any line-number prefix."
        }),
        describeObjectProperty({
          name: "newString",
          type: "string",
          required: true,
          description:
            "Replacement text. Use an empty string to delete oldString."
        }),
        describeObjectProperty({
          name: "replaceAll",
          type: "boolean",
          description:
            "Set true only when every occurrence of oldString in the file should be replaced."
        }),
        "Step 2: if oldString is not unique, add nearby unchanged lines to oldString or set replaceAll when all matches should change.",
        "Step 3: do not write unified diff syntax; edit_file generates the diff itself for review, undo, and reapply."
      ],
      constraints: [
        "Existing files MUST be read with read_file in this session before editing.",
        "oldString must be non-empty and must match the current file exactly after normalizing CRLF to LF.",
        "oldString must identify one occurrence unless replaceAll is true.",
        "Use write_file for creating files or replacing a whole file; use edit_file for localized edits.",
        "Do not include line numbers from read_file output in oldString or newString.",
        "Do not rewrite unrelated surrounding code, markup, configuration, or prose when only local content needs to change."
      ],
      examples: [
        {
          path: "apps/web/app/page.tsx",
          oldString: "        <p>Old copy</p>",
          newString: "        <p>New copy</p>"
        },
        {
          path: "README.md",
          oldString: "Remove this sentence.",
          newString: ""
        },
        {
          path: "src/config.ts",
          oldString: "legacyName",
          newString: "currentName",
          replaceAll: true
        }
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
          description: "Existing file path relative to the workspace root."
        },
        oldString: {
          type: "string",
          description:
            "Exact current text to replace. It must be unique unless replaceAll is true."
        },
        newString: {
          type: "string",
          description:
            "Replacement text. Use an empty string to delete oldString."
        },
        replaceAll: {
          type: "boolean",
          description:
            "Replace every occurrence of oldString. Defaults to false."
        }
      },
      required: ["path", "oldString", "newString"],
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
        summaryText: `需要你的确认后才能编辑文件：${toRelativeWorkspacePath(
          workingDirectory,
          absolutePath
        )}`,
        contextNote:
          "编辑文件会先校验本 session 内最近一次 read_file 的文件版本，并返回可撤销和重新应用的 diff。"
      };
    },
    validate(input) {
      const issues: Array<{ field: string; issue: string }> = [];
      if (typeof input.path !== "string" || input.path.trim().length === 0) {
        issues.push({ field: "path", issue: "path is required." });
      }
      if (typeof input.oldString !== "string" || input.oldString.length === 0) {
        issues.push({
          field: "oldString",
          issue: "oldString must be a non-empty string."
        });
      }
      if (typeof input.newString !== "string") {
        issues.push({
          field: "newString",
          issue: "newString must be a string."
        });
      }
      if (
        input.replaceAll !== undefined &&
        typeof input.replaceAll !== "boolean"
      ) {
        issues.push({
          field: "replaceAll",
          issue: "replaceAll must be a boolean when provided."
        });
      }
      if (
        input.patch !== undefined ||
        input.startLine !== undefined ||
        input.endLine !== undefined ||
        input.content !== undefined
      ) {
        issues.push({
          field: "input",
          issue:
            "edit_file uses path, oldString, newString, and optional replaceAll. Do not pass patch, startLine, endLine, or content."
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
            message: "Invalid edit_file input.",
            validationErrors: validation.issues ?? []
          }),
          `[edit_file] invalid input\n${(validation.issues ?? [])
            .map((issue) => `- ${issue.field}: ${issue.issue}`)
            .join("\n")}`
        );
      }

      const rawPath = input.path as string;
      const oldString = normalizeEditableText(input.oldString as string);
      const newString = normalizeEditableText(input.newString as string);
      const replaceAll = input.replaceAll === true;

      if (oldString === newString) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "NO_CHANGES",
            message:
              "No changes to make because oldString and newString are identical."
          }),
          "[edit_file] failed\n- oldString and newString are identical"
        );
      }

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
        const pathKind = await getPathKind(absolutePath);
        if (pathKind === "missing") {
          return failureResult(
            createToolResult({
              ok: false,
              code: "PATH_NOT_FOUND",
              message: "Target file does not exist.",
              data: { path: relativePath }
            }),
            `[edit_file] failed\n- target file does not exist: ${relativePath}`
          );
        }
        if (pathKind !== "file") {
          return failureResult(
            createToolResult({
              ok: false,
              code: "TARGET_NOT_FILE",
              message: "Target is not a file.",
              data: { path: relativePath, kind: pathKind }
            }),
            `[edit_file] failed\n- target is not a file: ${relativePath}`
          );
        }

        const readPrecondition = await requireFreshSessionRead({
          workingDirectory,
          absolutePath,
          sessionMessages: context.sessionMessages
        });
        if (!readPrecondition.ok) {
          return freshSessionReadFailureResult({
            toolName: "edit_file",
            code: readPrecondition.code,
            path: relativePath
          });
        }

        const latestStat = await fs.stat(absolutePath);
        if (
          !fileVersionsMatch(
            readPrecondition.version,
            readFileVersion(latestStat)
          )
        ) {
          return freshSessionReadFailureResult({
            toolName: "edit_file",
            code: "FILE_CHANGED_SINCE_READ",
            path: relativePath
          });
        }

        const originalContent = await fs.readFile(absolutePath, "utf8");
        const lineEnding = detectLineEnding(originalContent);
        const normalizedOriginalContent =
          normalizeEditableText(originalContent);
        const actualOldString = findActualString(
          normalizedOriginalContent,
          oldString
        );
        if (!actualOldString) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "STRING_NOT_FOUND",
              message:
                "oldString was not found in the current file. Copy the exact current text from read_file and retry.",
              data: { path: relativePath }
            }),
            `[edit_file] failed\n- oldString not found in ${relativePath}`
          );
        }

        const matchCount = countOccurrences({
          content: normalizedOriginalContent,
          search: actualOldString
        });
        if (matchCount > 1 && !replaceAll) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "STRING_NOT_UNIQUE",
              message:
                "oldString matched multiple locations. Include more surrounding context to identify one occurrence, or set replaceAll true to replace every match.",
              data: { path: relativePath, matchCount }
            }),
            `[edit_file] failed\n- oldString matched ${matchCount} locations in ${relativePath}`
          );
        }

        const nextNormalizedContent = applyEdit({
          content: normalizedOriginalContent,
          oldString: actualOldString,
          newString,
          replaceAll
        });
        if (nextNormalizedContent === normalizedOriginalContent) {
          return failureResult(
            createToolResult({
              ok: false,
              code: "NO_CHANGES",
              message: "The requested edit did not change the file.",
              data: { path: relativePath }
            }),
            `[edit_file] failed\n- no changes applied to ${relativePath}`
          );
        }

        const patch = buildUnifiedFilePatchFromContents({
          path: relativePath,
          originalContent: normalizedOriginalContent,
          nextContent: nextNormalizedContent
        });
        const summaries = await applyUnifiedPatch({
          workingDirectory,
          patch: { files: [patch] },
          allowWorkspaceEscape: context.allowWorkspaceEscape ?? false
        });
        const summary = summaries[0];
        if (!summary) {
          throw new Error("Edit produced no file change summary.");
        }

        const details: ToolResultDetails = {
          kind: "workspace_file_changes",
          files: [
            {
              path: summary.path,
              action: summary.action,
              addedLineCount: summary.addedLineCount,
              removedLineCount: summary.removedLineCount,
              diff: summary.diff
            }
          ]
        };

        const writtenContent =
          lineEnding === "\r\n"
            ? restoreLineEndings(nextNormalizedContent, lineEnding)
            : nextNormalizedContent;

        return successResult(
          createToolResult({
            ok: true,
            code: "FILE_EDITED",
            message: "File edited successfully.",
            data: {
              path: relativePath,
              replacementCount: replaceAll ? matchCount : 1,
              replaceAll,
              fileState: summary.fileState.exists
                ? {
                    exists: true,
                    sizeBytes: summary.fileState.sizeBytes,
                    modifiedAtMs: summary.fileState.modifiedAtMs
                  }
                : { exists: false },
              changedCharacters: Math.abs(
                writtenContent.length - originalContent.length
              )
            }
          }),
          `[edit_file] success\n- ${summarizeTargetPath(relativePath)}`,
          details
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failureResult(
          createToolResult({
            ok: false,
            code: "EDIT_FILE_FAILED",
            message
          }),
          `[edit_file] failed\n- ${message}`
        );
      }
    }
  };
}
