import { z } from "zod";

import type { DomainJsonValue } from "@ai-app-template/domain";

import { updateTodoState } from "../session/todo-state.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  successResult,
  validateWithSchema
} from "./tool-result.js";

const operationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_status"),
    id: z.string().min(1),
    status: z.enum(["pending", "in_progress", "done", "cancelled"])
  }),
  z.object({
    type: z.literal("set_content"),
    id: z.string().min(1),
    content: z.string().min(1)
  }),
  z.object({
    type: z.literal("append"),
    content: z.string().min(1)
  }),
  z.object({
    type: z.literal("remove"),
    id: z.string().min(1)
  }),
  z.object({
    type: z.literal("set_active"),
    id: z.string().min(1).nullable()
  })
]);

const schema = z.object({
  operations: z.array(operationSchema).min(1)
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
  value: import("@ai-app-template/domain").ScheduleSessionContext["todoState"]
): string {
  if (!value || value.items.length === 0) {
    return "[update_todo_items] success\n- items: 0\n- active: none";
  }

  const activeItem =
    value.activeItemId === null
      ? null
      : (value.items.find((item) => item.id === value.activeItemId) ?? null);

  return [
    "[update_todo_items] success",
    `- items: ${value.items.length}`,
    `- active: ${activeItem ? activeItem.content : "none"}`
  ].join("\n");
}

export function createUpdateTodoItemsTool(): RuntimeTool {
  return {
    name: "update_todo_items",
    description:
      "Update session todo items as work progresses by marking status, editing text, appending, removing, or switching the active item.",
    family: "planning",
    isReadOnly: false,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        operations: {
          type: "array",
          items: {
            oneOf: [
              {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["set_status"] },
                  id: { type: "string" },
                  status: {
                    type: "string",
                    enum: ["pending", "in_progress", "done", "cancelled"]
                  }
                },
                required: ["type", "id", "status"],
                additionalProperties: false
              },
              {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["set_content"] },
                  id: { type: "string" },
                  content: { type: "string" }
                },
                required: ["type", "id", "content"],
                additionalProperties: false
              },
              {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["append"] },
                  content: { type: "string" }
                },
                required: ["type", "content"],
                additionalProperties: false
              },
              {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["remove"] },
                  id: { type: "string" }
                },
                required: ["type", "id"],
                additionalProperties: false
              },
              {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["set_active"] },
                  id: { type: ["string", "null"] }
                },
                required: ["type", "id"],
                additionalProperties: false
              }
            ]
          }
        }
      },
      required: ["operations"],
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
          `[update_todo_items] invalid input\n${issues
            .map((issue) => `- ${issue.field}: ${issue.issue}`)
            .join("\n")}`
        );
      }

      try {
        const todoState = updateTodoState({
          current: context.sessionContext.todoState ?? null,
          operations: parsed.data.operations
        });
        await context.sessionManager.updateContext(context.sessionId, {
          todoState
        });

        return successResult(
          createToolResult({
            ok: true,
            code: "TODO_ITEMS_UPDATED",
            message: todoState
              ? "Updated the session todo list."
              : "Cleared the session todo list.",
            ...(todoState ? { data: toTodoData(todoState) } : {})
          }),
          formatDisplayText(todoState)
        );
      } catch (error) {
        return failureResult(
          createToolResult({
            ok: false,
            code: "INVALID_TOOL_INPUT",
            message:
              error instanceof Error
                ? error.message
                : "Unable to update todo items."
          }),
          `[update_todo_items] invalid input\n- ${
            error instanceof Error
              ? error.message
              : "Unable to update todo items."
          }`
        );
      }
    }
  };
}
