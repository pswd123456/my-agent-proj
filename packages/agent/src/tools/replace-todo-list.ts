import { z } from "zod";

import type { DomainJsonValue } from "@ai-app-template/domain";

import { replaceTodoList, TODO_ITEM_LIMIT } from "../session/todo-state.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
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

function toTodoData(
  value: NonNullable<
    import("@ai-app-template/domain").ScheduleSessionContext["todoState"]
  >
): DomainJsonValue {
  return {
    items: value.items.map((item) => ({
      id: item.id,
      content: item.content,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    })),
    activeItemId: value.activeItemId,
    lastUpdatedAt: value.lastUpdatedAt
  };
}

function formatDisplayText(
  value: NonNullable<
    import("@ai-app-template/domain").ScheduleSessionContext["todoState"]
  >
): string {
  const activeItem =
    value.activeItemId === null
      ? null
      : (value.items.find((item) => item.id === value.activeItemId) ?? null);

  return [
    "[replace_todo_list] success",
    `- items: ${value.items.length}`,
    `- active: ${activeItem ? activeItem.content : "none"}`
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
          `[replace_todo_list] invalid input\n${issues
            .map((issue) => `- ${issue.field}: ${issue.issue}`)
            .join("\n")}`
        );
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

        return successResult(
          createToolResult({
            ok: true,
            code: "TODO_LIST_REPLACED",
            message: "Replaced the session todo list.",
            data: toTodoData(todoState)
          }),
          formatDisplayText(todoState)
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
