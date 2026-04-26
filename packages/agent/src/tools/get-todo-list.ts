import { z } from "zod";

import type { DomainJsonValue } from "@ai-app-template/domain";

import { formatTodoStateSummary } from "../session/todo-state.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";

const schema = z.object({}).strict();

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

export function createGetTodoListTool(): RuntimeTool {
  return {
    name: "get_todo_list",
    description:
      "Read the current session todo list so long-running work can realign before the next step.",
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
      const todoState = context.sessionContext.todoState ?? null;
      return successResult(
        createToolResult({
          ok: true,
          code: "TODO_LIST_READ",
          message: todoState
            ? "Read the current session todo list."
            : "No session todo list is currently set.",
          ...(todoState ? { data: toTodoData(todoState) } : {})
        }),
        `[get_todo_list] success\n${formatTodoStateSummary(todoState)}`
      );
    }
  };
}
