import { readFileSync } from "node:fs";

import { z } from "zod";

import { normalizeTaskBriefPath } from "../session/task-brief.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";

const schema = z
  .object({
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().positive().optional(),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional()
  })
  .superRefine((value, context) => {
    if (
      typeof value.startLine === "number" &&
      typeof value.endLine === "number" &&
      value.endLine < value.startLine
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endLine"],
        message: "endLine must be greater than or equal to startLine."
      });
    }
  });

const MAX_TASK_BRIEF_CHARACTERS = 20_000;

interface ReadWindowRequest {
  startLine: number;
  endLine: number | null;
}

function normalizeReadWindowRequest(
  input: z.infer<typeof schema>
): ReadWindowRequest {
  if (typeof input.offset === "number" || typeof input.limit === "number") {
    const offset = input.offset ?? 0;
    const limit = input.limit ?? null;
    return {
      startLine: offset + 1,
      endLine: limit === null ? null : offset + limit
    };
  }

  return {
    startLine: input.startLine ?? 1,
    endLine: input.endLine ?? null
  };
}

function splitLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  return content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

function readLineRange(input: {
  content: string;
  startLine: number;
  endLine: number | null;
  maxCharacters: number;
}): {
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
} {
  const lines = splitLines(input.content);
  const totalLines = lines.length;
  const normalizedEndLine = input.endLine ?? totalLines;
  const selectedLines = lines.slice(input.startLine - 1, normalizedEndLine);
  const selectedContent = selectedLines.join("\n");

  if (selectedContent.length <= input.maxCharacters) {
    return {
      content: selectedContent,
      startLine: input.startLine,
      endLine: Math.min(normalizedEndLine, totalLines),
      totalLines,
      truncated: false
    };
  }

  return {
    content: selectedContent.slice(0, input.maxCharacters),
    startLine: input.startLine,
    endLine: Math.min(normalizedEndLine, totalLines),
    totalLines,
    truncated: true
  };
}

function formatDisplayText(input: {
  path: string | null;
  exists: boolean;
  startLine: number | null;
  endLine: number | null;
  totalLines: number;
  truncated: boolean;
}): string {
  return [
    "[read_task_brief] success",
    `- path: ${input.path ?? "none"}`,
    `- exists: ${input.exists ? "yes" : "no"}`,
    `- lines: ${
      input.startLine === null || input.endLine === null
        ? "none"
        : `${input.startLine}-${input.endLine}`
    }`,
    `- total lines: ${input.totalLines}`,
    `- truncated: ${input.truncated ? "yes" : "no"}`
  ].join("\n");
}

export function createReadTaskBriefTool(): RuntimeTool {
  return {
    name: "read_task_brief",
    description:
      "Read the current session task brief with optional 1-based line windows.",
    family: "planning",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        offset: { type: "number" },
        limit: { type: "number" },
        startLine: { type: "number" },
        endLine: { type: "number" }
      },
      additionalProperties: false
    },
    validate(input) {
      return validateWithSchema(schema, input);
    },
    async execute(input, context) {
      const parsed = schema.parse(input);
      const normalizedPath = normalizeTaskBriefPath(
        context.sessionContext.taskBriefPath
      );
      const window = normalizeReadWindowRequest(parsed);

      if (!normalizedPath) {
        return successResult(
          createToolResult({
            ok: true,
            code: "TASK_BRIEF_READ",
            message: "The current session does not have a bound task brief path.",
            data: {
              path: null,
              exists: false,
              content: null,
              startLine: null,
              endLine: null,
              totalLines: 0,
              truncated: false
            }
          }),
          formatDisplayText({
            path: null,
            exists: false,
            startLine: null,
            endLine: null,
            totalLines: 0,
            truncated: false
          })
        );
      }

      try {
        const content = readFileSync(normalizedPath, "utf8");
        const range = readLineRange({
          content,
          startLine: window.startLine,
          endLine: window.endLine,
          maxCharacters: MAX_TASK_BRIEF_CHARACTERS
        });

        return successResult(
          createToolResult({
            ok: true,
            code: "TASK_BRIEF_READ",
            message: "Read the current session task brief.",
            data: {
              path: normalizedPath,
              exists: true,
              content: range.content,
              startLine: range.startLine,
              endLine: range.endLine,
              totalLines: range.totalLines,
              truncated: range.truncated
            }
          }),
          formatDisplayText({
            path: normalizedPath,
            exists: true,
            startLine: range.startLine,
            endLine: range.endLine,
            totalLines: range.totalLines,
            truncated: range.truncated
          })
        );
      } catch {
        return successResult(
          createToolResult({
            ok: true,
            code: "TASK_BRIEF_READ",
            message: "The current session task brief file does not exist yet.",
            data: {
              path: normalizedPath,
              exists: false,
              content: null,
              startLine: null,
              endLine: null,
              totalLines: 0,
              truncated: false
            }
          }),
          formatDisplayText({
            path: normalizedPath,
            exists: false,
            startLine: null,
            endLine: null,
            totalLines: 0,
            truncated: false
          })
        );
      }
    }
  };
}
