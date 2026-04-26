import { z } from "zod";

import { readTaskBrief } from "../session/task-brief.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";

const schema = z.object({}).strict();
const MAX_TASK_BRIEF_CHARACTERS = 20_000;

function formatDisplayText(input: {
  path: string | null;
  exists: boolean;
  truncated: boolean;
}): string {
  return [
    "[get_task_brief] success",
    `- path: ${input.path ?? "none"}`,
    `- exists: ${input.exists ? "yes" : "no"}`,
    `- truncated: ${input.truncated ? "yes" : "no"}`
  ].join("\n");
}

export function createGetTaskBriefTool(): RuntimeTool {
  return {
    name: "get_task_brief",
    description:
      "Read the current session task brief markdown file that anchors plan mode work.",
    family: "planning",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    validate(input) {
      return validateWithSchema(schema, input);
    },
    async execute(_input, context) {
      const brief = readTaskBrief(
        context.sessionContext.taskBriefPath,
        MAX_TASK_BRIEF_CHARACTERS
      );

      return successResult(
        createToolResult({
          ok: true,
          code: "TASK_BRIEF_READ",
          message: brief.exists
            ? "Read the current session task brief."
            : "The current session task brief file does not exist yet.",
          data: {
            path: brief.path,
            exists: brief.exists,
            content: brief.content,
            truncated: brief.truncated
          }
        }),
        formatDisplayText(brief)
      );
    }
  };
}
