import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";

import { z } from "zod";

import { normalizeTaskBriefPath } from "../session/task-brief.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  parseToolInput,
  successResult,
  validateWithSchema
} from "./tool-result.js";
import { writeTextFileAtomic } from "./workspace.js";

const schema = z
  .object({
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    content: z.string()
  })
  .superRefine((value, context) => {
    if (value.endLine < value.startLine) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endLine"],
        message: "endLine must be greater than or equal to startLine."
      });
    }
  });

function detectNewline(content: string): "\r\n" | "\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function splitEditableLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  return content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

function splitReplacementLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  return content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

function hasFinalNewline(content: string): boolean {
  return content.endsWith("\n");
}

function applyLineEdit(input: {
  originalContent: string;
  startLine: number;
  endLine: number;
  replacement: string;
}): { content: string; replacedLineCount: number; newLineCount: number } {
  const lines = splitEditableLines(input.originalContent);
  const replacementLines = splitReplacementLines(input.replacement);
  const newline = detectNewline(input.originalContent);
  const before = lines.slice(0, input.startLine - 1);
  const after = lines.slice(input.endLine);
  const nextLines = [...before, ...replacementLines, ...after];
  const nextContent = `${nextLines.join(newline)}${
    hasFinalNewline(input.originalContent) || input.replacement.endsWith("\n")
      ? newline
      : ""
  }`;

  return {
    content: nextContent,
    replacedLineCount: input.endLine - input.startLine + 1,
    newLineCount: replacementLines.length
  };
}

function createLineDiff(input: {
  path: string;
  originalLines: string[];
  replacementLines: string[];
  startLine: number;
}): string {
  const oldCount = input.originalLines.length;
  const newCount = input.replacementLines.length;
  const lines = [
    `--- ${input.path}`,
    `+++ ${input.path}`,
    `@@ -${input.startLine},${oldCount} +${input.startLine},${newCount} @@`,
    ...input.originalLines.map((line) => `- ${line}`),
    ...input.replacementLines.map((line) => `+ ${line}`)
  ];
  const diff = lines.join("\n");

  return diff.length > 12_000 ? `${diff.slice(0, 12_000)}\n...[truncated]` : diff;
}

export function createEditTaskBriefTool(): RuntimeTool {
  return {
    name: "edit_task_brief",
    description:
      "Replace an inclusive 1-based line range in the current session task brief. Use replace_task_brief to create the first brief or fully rewrite it.",
    family: "planning",
    isReadOnly: false,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        startLine: { type: "number" },
        endLine: { type: "number" },
        content: { type: "string" }
      },
      required: ["startLine", "endLine", "content"],
      additionalProperties: false
    },
    validate(input) {
      return validateWithSchema(schema, input);
    },
    async execute(input, context) {
      const parsed = parseToolInput("edit_task_brief", schema, input);
      if (!parsed.ok) {
        return parsed.result;
      }

      const taskBriefPath = normalizeTaskBriefPath(
        context.sessionContext.taskBriefPath
      );
      if (!taskBriefPath) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "TASK_BRIEF_PATH_UNAVAILABLE",
            message:
              "This session does not have a bound task brief path yet. Create the first brief with replace_task_brief."
          }),
          [
            "[edit_task_brief] failed",
            "- no bound task brief path",
            "- create the first brief with replace_task_brief"
          ].join("\n")
        );
      }

      let originalContent: string;
      let originalStat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        originalStat = await fs.stat(taskBriefPath);
        originalContent = await fs.readFile(taskBriefPath, "utf8");
      } catch {
        return failureResult(
          createToolResult({
            ok: false,
            code: "TASK_BRIEF_NOT_FOUND",
            message:
              "The current task brief file does not exist yet. Create it with replace_task_brief first."
          }),
          [
            "[edit_task_brief] failed",
            "- task brief file does not exist yet",
            "- create it with replace_task_brief first"
          ].join("\n")
        );
      }

      const lines = splitEditableLines(originalContent);
      const totalLines = lines.length;
      if (
        parsed.data.startLine > totalLines ||
        parsed.data.endLine > totalLines
      ) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "LINE_RANGE_OUT_OF_BOUNDS",
            message: "Line range is outside the task brief.",
            data: {
              path: taskBriefPath,
              totalLines
            }
          }),
          [
            "[edit_task_brief] failed",
            "- line range is outside the task brief",
            `- total lines: ${totalLines}`
          ].join("\n")
        );
      }

      const edit = applyLineEdit({
        originalContent,
        startLine: parsed.data.startLine,
        endLine: parsed.data.endLine,
        replacement: parsed.data.content
      });
      const originalLines = lines.slice(
        parsed.data.startLine - 1,
        parsed.data.endLine
      );
      const replacementLines = splitReplacementLines(parsed.data.content);
      const diff = createLineDiff({
        path: taskBriefPath,
        originalLines,
        replacementLines,
        startLine: parsed.data.startLine
      });

      await writeTextFileAtomic(taskBriefPath, edit.content, {
        mode: originalStat.mode
      });
      const hash = createHash("sha256").update(edit.content).digest("hex");

      return successResult(
        createToolResult({
          ok: true,
          code: "TASK_BRIEF_EDITED",
          message: "Edited the current session task brief.",
          data: {
            path: taskBriefPath,
            startLine: parsed.data.startLine,
            endLine: parsed.data.endLine,
            replacedLineCount: edit.replacedLineCount,
            newLineCount: edit.newLineCount,
            hash,
            diff
          }
        }),
        [
          "[edit_task_brief] success",
          `- path: ${taskBriefPath}`,
          `- replaced lines ${parsed.data.startLine}-${parsed.data.endLine}`
        ].join("\n"),
        {
          kind: "task_brief",
          path: taskBriefPath,
          content: edit.content,
          operation: "edit",
          startLine: parsed.data.startLine,
          endLine: parsed.data.endLine
        }
      );
    }
  };
}
