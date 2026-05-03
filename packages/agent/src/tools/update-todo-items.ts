import { z } from "zod";

import { updateTodoState } from "../session/todo-state.js";
import { createTodoWriteAck } from "./planning-tool-result.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  parseToolInput,
  successResult,
  validateWithSchema
} from "./tool-result.js";
import { buildToolDescription } from "./tool-description.js";

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

const TODO_ITEM_ID_DESCRIPTION =
  "Existing todo item id from the current session todo state. Use the real item id returned by todo tools, not the visible list numbering such as 1 or 2.";

function formatDisplayText(
  data: ReturnType<typeof createTodoWriteAck>
): string {
  return [
    "[update_todo_items] success",
    `- active_id: ${
      typeof data.activeItemId === "string" ? data.activeItemId : "none"
    }`,
    `- hash: ${typeof data.hash === "string" ? data.hash : "unknown"}`
  ].join("\n");
}

export function createUpdateTodoItemsTool(): RuntimeTool {
  return {
    name: "update_todo_items",
    description: buildToolDescription({
      usageScenarios: [
        "Update an existing todo list while work progresses.",
        "Mark status, edit content, append items, remove items, or switch the active item."
      ],
      usageInstructions: [
        "Step 1: use get_todo_list first when you need the current todo ids.",
        "Step 2: send operations in the order they should be applied.",
        "Available operation types: set_status, set_content, append, remove, set_active.",
        "For id-based operations, use the real todo item id from session todo state, not the visible list numbering."
      ],
      constraints: [
        "Do not use visible numbering like 1 or 2 as the id value.",
        "set_active accepts an existing item id or null to clear the active item.",
        "Use replace_todo_list when you need to replace the entire list at once."
      ],
      examples: [
        '{"operations":[{"type":"set_status","id":"todo_1","status":"in_progress"},{"type":"append","content":"Run typecheck"}]}',
        '{"operations":[{"type":"set_active","id":"todo_2"},{"type":"set_content","id":"todo_2","content":"Rewrite all built-in tool descriptions"}]}'
      ]
    }),
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
          description:
            "Ordered todo update operations. For set_status, set_content, remove, and set_active, the id field must reference an existing todo item id from the current session todo state, not the visible list numbering.",
          items: {
            oneOf: [
              {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["set_status"] },
                  id: {
                    type: "string",
                    description: TODO_ITEM_ID_DESCRIPTION
                  },
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
                  id: {
                    type: "string",
                    description: TODO_ITEM_ID_DESCRIPTION
                  },
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
                  id: {
                    type: "string",
                    description: TODO_ITEM_ID_DESCRIPTION
                  }
                },
                required: ["type", "id"],
                additionalProperties: false
              },
              {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["set_active"] },
                  id: {
                    type: ["string", "null"],
                    description:
                      "Existing todo item id from the current session todo state, or null to clear the active item. Do not use the visible list numbering."
                  }
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
      const parsed = parseToolInput("update_todo_items", schema, input);
      if (!parsed.ok) {
        return parsed.result;
      }

      try {
        const todoState = updateTodoState({
          current: context.sessionContext.todoState ?? null,
          operations: parsed.data.operations
        });
        await context.sessionManager.updateContext(context.sessionId, {
          todoState
        });
        const data = createTodoWriteAck({
          ack: "todo_items_updated",
          todoState
        });

        return successResult(
          createToolResult({
            ok: true,
            code: "TODO_ITEMS_UPDATED",
            message: todoState
              ? "Updated the session todo list."
              : "Cleared the session todo list.",
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
