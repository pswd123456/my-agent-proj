import { z } from "zod";

import { replaceTodoList, TODO_ITEM_LIMIT } from "../session/todo-state.js";
import { createTodoWriteAck } from "./planning-tool-result.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  parseToolInput,
  successResult,
  validateWithSchema
} from "./tool-result.js";

const schema = z.object({
  items: z
    .array(
      z.object({
        content: z.string().min(1)
      })
    )
    .min(1)
    .max(TODO_ITEM_LIMIT),
  activeIndex: z.number().int().min(0).optional()
});

function formatDisplayText(
  data: ReturnType<typeof createTodoWriteAck>
): string {
  return [
    "[replace_todo_list] success",
    `- active_id: ${
      typeof data.activeItemId === "string" ? data.activeItemId : "none"
    }`,
    `- hash: ${typeof data.hash === "string" ? data.hash : "unknown"}`
  ].join("\n");
}

export function createReplaceTodoListTool(): RuntimeTool {
  return {
    name: "replace_todo_list",
    description:
      "Create or fully replace the session todo list when a task clearly needs a fresh multi-step plan.",
    family: "planning",
    isReadOnly: false,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: { type: "string" }
            },
            required: ["content"],
            additionalProperties: false
          }
        },
        activeIndex: { type: "number" }
      },
      required: ["items"],
      additionalProperties: false
    },
    validate(input) {
      return validateWithSchema(schema, input);
    },
    async execute(input, context) {
      const parsed = parseToolInput("replace_todo_list", schema, input);
      if (!parsed.ok) {
        return parsed.result;
      }

      try {
        const todoState = replaceTodoList({
          items: parsed.data.items,
          ...(typeof parsed.data.activeIndex === "number"
            ? { activeIndex: parsed.data.activeIndex }
            : {})
        });
        await context.sessionManager.updateContext(context.sessionId, {
          todoState
        });
        const data = createTodoWriteAck({
          ack: "todo_list_replaced",
          todoState
        });

        return successResult(
          createToolResult({
            ok: true,
            code: "TODO_LIST_REPLACED",
            message: "Replaced the session todo list.",
            data
          }),
          formatDisplayText(data)
        );
      } catch (error) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message:
              error instanceof Error ? error.message : "Invalid todo list."
          }),
          `[replace_todo_list] invalid input\n- ${
            error instanceof Error ? error.message : "Invalid todo list."
          }`
        );
      }
    }
  };
}
