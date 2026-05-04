import { z } from "zod";

import type { DomainJsonValue } from "@ai-app-template/domain";

import {
  formatTodoStateSummary,
  replaceTodoList,
  TODO_ITEM_LIMIT,
  updateTodoState
} from "../session/todo-state.js";
import { createTodoWriteAck } from "./planning-tool-result.js";
import type { RuntimeTool } from "./runtime-tool.js";
import {
  createToolResult,
  failureResult,
  parseToolInput,
  successResult,
  validateWithSchema
} from "./tool-result.js";
import {
  buildToolDescription,
  describeObjectProperty
} from "./tool-description.js";

const TODO_ITEM_ID_DESCRIPTION =
  "Existing todo item id from the current session todo state. Use the real item id returned by todo tools, not the visible list numbering such as 1 or 2.";

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

const getSchema = z.object({ action: z.literal("get") }).strict();

const replaceSchema = z
  .object({
    action: z.literal("replace"),
    items: z
      .array(
        z.object({
          content: z.string().min(1)
        })
      )
      .min(1)
      .max(TODO_ITEM_LIMIT),
    activeIndex: z.number().int().min(0).optional()
  })
  .strict();

const updateSchema = z
  .object({
    action: z.literal("update"),
    operations: z.array(operationSchema).min(1)
  })
  .strict();

const schema = z.discriminatedUnion("action", [
  getSchema,
  replaceSchema,
  updateSchema
]);

type ManageTodoListInput = z.infer<typeof schema>;

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

function formatTodoWriteDisplayText(
  action: "replace" | "update",
  data: ReturnType<typeof createTodoWriteAck>
): string {
  return [
    "[manage_todo_list] success",
    `- action: ${action}`,
    `- active_id: ${
      typeof data.activeItemId === "string" ? data.activeItemId : "none"
    }`,
    `- hash: ${typeof data.hash === "string" ? data.hash : "unknown"}`
  ].join("\n");
}

function executeGet(context: Parameters<RuntimeTool["execute"]>[1]) {
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
    `[manage_todo_list] success\n- action: get\n${formatTodoStateSummary(
      todoState
    )}`
  );
}

async function executeReplace(
  input: Extract<ManageTodoListInput, { action: "replace" }>,
  context: Parameters<RuntimeTool["execute"]>[1]
) {
  try {
    const todoState = replaceTodoList({
      items: input.items,
      ...(typeof input.activeIndex === "number"
        ? { activeIndex: input.activeIndex }
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
      formatTodoWriteDisplayText("replace", data)
    );
  } catch (error) {
    return failureResult(
      createToolResult({
        ok: false,
        code: "INVALID_TOOL_INPUT",
        message: error instanceof Error ? error.message : "Invalid todo list."
      }),
      `[manage_todo_list] invalid input\n- ${
        error instanceof Error ? error.message : "Invalid todo list."
      }`
    );
  }
}

async function executeUpdate(
  input: Extract<ManageTodoListInput, { action: "update" }>,
  context: Parameters<RuntimeTool["execute"]>[1]
) {
  try {
    const todoState = updateTodoState({
      current: context.sessionContext.todoState ?? null,
      operations: input.operations
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
      formatTodoWriteDisplayText("update", data)
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
      `[manage_todo_list] invalid input\n- ${
        error instanceof Error ? error.message : "Unable to update todo items."
      }`
    );
  }
}

export function createManageTodoListTool(): RuntimeTool {
  return {
    name: "manage_todo_list",
    description: buildToolDescription({
      usageScenarios: [
        "Read, replace, or update the current session todo list.",
        "Track progress during long-running work while keeping todo operations in one tool."
      ],
      usageInstructions: [
        describeObjectProperty({
          name: "action",
          type: '"get" | "replace" | "update"',
          required: true,
          description: "Choose whether to read, replace, or update todo state."
        }),
        "Use action=get when you need current todo ids or the active item.",
        "Use action=replace with items and optional activeIndex to create a fresh list.",
        "Use action=update with ordered operations for status, content, append, remove, or active-item changes.",
        "For id-based update operations, use real todo item ids from action=get, not visible numbering."
      ],
      constraints: [
        "action=replace replaces the full todo list state.",
        "action=update requires at least one operation.",
        "Do not use visible numbering like 1 or 2 as an id value.",
        `The number of items is capped by the session todo limit of ${TODO_ITEM_LIMIT}.`
      ],
      examples: [
        '{"action":"get"}',
        '{"action":"replace","items":[{"content":"Inspect current tool contracts"},{"content":"Update tests"}],"activeIndex":0}',
        '{"action":"update","operations":[{"type":"set_status","id":"todo_1","status":"in_progress"},{"type":"append","content":"Run typecheck"}]}'
      ]
    }),
    family: "planning",
    isReadOnly: false,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      oneOf: [
        {
          type: "object",
          properties: {
            action: { const: "get" }
          },
          required: ["action"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "replace" },
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
          required: ["action", "items"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            action: { const: "update" },
            operations: {
              type: "array",
              description:
                "Ordered todo update operations. For set_status, set_content, remove, and set_active, id must reference an existing todo item id, not visible list numbering.",
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
          required: ["action", "operations"],
          additionalProperties: false
        }
      ]
    },
    validate(input) {
      return validateWithSchema(schema, input);
    },
    async execute(input, context) {
      const parsed = parseToolInput("manage_todo_list", schema, input);
      if (!parsed.ok) {
        return parsed.result;
      }

      if (parsed.data.action === "get") {
        return executeGet(context);
      }
      if (parsed.data.action === "replace") {
        return executeReplace(parsed.data, context);
      }
      return executeUpdate(parsed.data, context);
    }
  };
}
