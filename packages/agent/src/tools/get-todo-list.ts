import { z } from "zod";

import type { DomainJsonValue } from "@ai-app-template/domain";

import { formatTodoStateSummary } from "../session/todo-state.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";
import { buildToolDescription } from "./tool-description.js";

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
    description: buildToolDescription({
      usageScenarios: [
        "Read the current session todo list before continuing a long-running task.",
        "Recover the active item and existing todo ids before updating todo state."
      ],
      usageInstructions: [
        "Call the tool with no arguments.",
        "Read items to inspect current todo content and status.",
        "Read activeItemId before using update_todo_items with id-based operations."
      ],
      constraints: [
        "If no todo list exists yet, the tool reports that state instead of fabricating one.",
        "Use replace_todo_list to create a fresh list and update_todo_items to modify an existing one."
      ],
      examples: ["{}"]
    }),
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
