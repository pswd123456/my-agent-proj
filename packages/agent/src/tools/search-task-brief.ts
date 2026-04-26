import { readFileSync } from "node:fs";

import { z } from "zod";

import { normalizeTaskBriefPath } from "../session/task-brief.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";

const DEFAULT_MAX_RESULTS = 20;
const MAX_RESULTS_LIMIT = 100;

const schema = z.object({
  query: z.string().min(1),
  regex: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  maxResults: z.number().int().positive().max(MAX_RESULTS_LIMIT).optional()
});

function splitLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  return content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
}

function formatDisplayText(input: {
  path: string | null;
  exists: boolean;
  matchCount: number;
  truncated: boolean;
}): string {
  return [
    "[search_task_brief] success",
    `- path: ${input.path ?? "none"}`,
    `- exists: ${input.exists ? "yes" : "no"}`,
    `- matches: ${input.matchCount}`,
    `- truncated: ${input.truncated ? "yes" : "no"}`
  ].join("\n");
}

export function createSearchTaskBriefTool(): RuntimeTool {
  return {
    name: "search_task_brief",
    description:
      "Search the current session task brief and return matching line numbers.",
    family: "planning",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        regex: { type: "boolean" },
        caseSensitive: { type: "boolean" },
        maxResults: { type: "number" }
      },
      required: ["query"],
      additionalProperties: false
    },
    validate(input) {
      return validateWithSchema(schema, input);
    },
    async execute(input, context) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "input",
          issue: issue.message
        }));
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message: "Tool input validation failed.",
            validationErrors: issues
          }),
          `[search_task_brief] invalid input\n${issues
            .map((issue) => `- ${issue.field}: ${issue.issue}`)
            .join("\n")}`
        );
      }

      const normalizedPath = normalizeTaskBriefPath(
        context.sessionContext.taskBriefPath
      );
      if (!normalizedPath) {
        return successResult(
          createToolResult({
            ok: true,
            code: "TASK_BRIEF_SEARCHED",
            message: "The current session does not have a bound task brief path.",
            data: {
              path: null,
              exists: false,
              query: parsed.data.query,
              regex: parsed.data.regex ?? false,
              caseSensitive: parsed.data.caseSensitive ?? false,
              matches: [],
              truncated: false
            }
          }),
          formatDisplayText({
            path: null,
            exists: false,
            matchCount: 0,
            truncated: false
          })
        );
      }

      let content: string;
      try {
        content = readFileSync(normalizedPath, "utf8");
      } catch {
        return successResult(
          createToolResult({
            ok: true,
            code: "TASK_BRIEF_SEARCHED",
            message: "The current session task brief file does not exist yet.",
            data: {
              path: normalizedPath,
              exists: false,
              query: parsed.data.query,
              regex: parsed.data.regex ?? false,
              caseSensitive: parsed.data.caseSensitive ?? false,
              matches: [],
              truncated: false
            }
          }),
          formatDisplayText({
            path: normalizedPath,
            exists: false,
            matchCount: 0,
            truncated: false
          })
        );
      }

      const flags = parsed.data.caseSensitive ? "" : "i";
      let matcher: RegExp;
      if (parsed.data.regex) {
        try {
          matcher = new RegExp(parsed.data.query, flags);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Invalid regular expression.";
          return failureResult(
            createToolResult({
              ok: false,
              code: "INVALID_TOOL_INPUT",
              message
            }),
            `[search_task_brief] invalid input\n- ${message}`
          );
        }
      } else {
        const escaped = parsed.data.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        matcher = new RegExp(escaped, flags);
      }

      const maxResults = parsed.data.maxResults ?? DEFAULT_MAX_RESULTS;
      const matches: Array<{ line: number; snippet: string }> = [];
      for (const [index, line] of splitLines(content).entries()) {
        if (!matcher.test(line)) {
          continue;
        }
        matches.push({
          line: index + 1,
          snippet: line
        });
        if (matches.length >= maxResults) {
          break;
        }
      }

      const totalMatchCount = splitLines(content).reduce((count, line) => {
        if (matcher.global || matcher.sticky) {
          matcher.lastIndex = 0;
        }
        return matcher.test(line) ? count + 1 : count;
      }, 0);
      const truncated = totalMatchCount > matches.length;

      return successResult(
        createToolResult({
          ok: true,
          code: "TASK_BRIEF_SEARCHED",
          message: "Searched the current session task brief.",
          data: {
            path: normalizedPath,
            exists: true,
            query: parsed.data.query,
            regex: parsed.data.regex ?? false,
            caseSensitive: parsed.data.caseSensitive ?? false,
            matches,
            truncated
          }
        }),
        formatDisplayText({
          path: normalizedPath,
          exists: true,
          matchCount: matches.length,
          truncated
        })
      );
    }
  };
}
