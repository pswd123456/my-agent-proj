import { describe, expect, test } from "bun:test";

import {
  getTodoStateFromToolResultEvent,
  isTodoToolName
} from "./session-todo-state";

describe("session-todo-state", () => {
  test("recognizes built-in todo tools", () => {
    expect(isTodoToolName("replace_todo_list")).toBe(true);
    expect(isTodoToolName("read_file")).toBe(false);
  });

  test("extracts todo state from structured tool output", () => {
    const todoState = getTodoStateFromToolResultEvent({
      kind: "tool_result",
      sessionId: "session-1",
      createdAt: "2026-04-26T00:00:00.000Z",
      turnCount: 1,
      toolCallId: "tool-call-1",
      toolName: "replace_todo_list",
      isError: false,
      output: JSON.stringify({
        ok: true,
        code: "TODO_LIST_REPLACED",
        message: "Replaced the session todo list.",
        data: {
          items: [
            {
              id: "item-1",
              content: "实现 todo 面板",
              status: "in_progress",
              createdAt: "2026-04-26T00:00:00.000Z",
              updatedAt: "2026-04-26T00:00:00.000Z"
            }
          ],
          activeItemId: "item-1",
          lastUpdatedAt: "2026-04-26T00:00:00.000Z"
        }
      })
    });

    expect(todoState).toEqual({
      items: [
        {
          id: "item-1",
          content: "实现 todo 面板",
          status: "in_progress",
          createdAt: "2026-04-26T00:00:00.000Z",
          updatedAt: "2026-04-26T00:00:00.000Z"
        }
      ],
      activeItemId: "item-1",
      lastUpdatedAt: "2026-04-26T00:00:00.000Z"
    });
  });

  test("clears the local todo view when todo tools return no data", () => {
    const todoState = getTodoStateFromToolResultEvent({
      kind: "tool_result",
      sessionId: "session-1",
      createdAt: "2026-04-26T00:00:00.000Z",
      turnCount: 2,
      toolCallId: "tool-call-2",
      toolName: "update_todo_items",
      isError: false,
      output: JSON.stringify({
        ok: true,
        code: "TODO_ITEMS_UPDATED",
        message: "Cleared the session todo list."
      })
    });

    expect(todoState).toBeNull();
  });
});
