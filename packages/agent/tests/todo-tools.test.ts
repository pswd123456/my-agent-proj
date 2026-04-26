import { describe, expect, test } from "bun:test";

import { createMemorySessionManager } from "../src/session/index.js";
import {
  createGetTodoListTool,
  createReplaceTodoListTool,
  createUpdateTodoItemsTool
} from "../src/tools/index.js";
import type { ToolExecutionContext } from "../src/tools/runtime-tool.js";

async function createSessionContext(
  sessionManager: ReturnType<typeof createMemorySessionManager>,
  sessionId: string
): Promise<ToolExecutionContext> {
  const session = await sessionManager.getSession(sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }

  return {
    sessionId: session.sessionId,
    userId: session.context.userId,
    workingDirectory: session.workingDirectory,
    routineRepository: undefined as never,
    sessionManager,
    sessionContext: {
      status: session.context.status,
      currentDateContext: session.context.currentDateContext,
      yoloMode: session.context.yoloMode,
      workspaceEscapeAllowed: session.context.workspaceEscapeAllowed,
      shellAllowPatterns: session.context.shellAllowPatterns,
      shellDenyPatterns: session.context.shellDenyPatterns,
      toolAllowList: session.context.toolAllowList,
      toolAskList: session.context.toolAskList,
      toolDenyList: session.context.toolDenyList,
      todoState: session.context.todoState ?? null
    },
    permissionRules: {
      shellAllowPatterns: session.context.shellAllowPatterns,
      shellDenyPatterns: session.context.shellDenyPatterns,
      toolAllowList: session.context.toolAllowList,
      toolAskList: session.context.toolAskList,
      toolDenyList: session.context.toolDenyList
    },
    sessionMessages: session.messages
  };
}

describe("todo tools", () => {
  test("replace_todo_list persists a new session todo state and get_todo_list reads it back", async () => {
    const sessionManager = createMemorySessionManager();
    const session = await sessionManager.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "todo-user"
    });

    const replaceResult = await createReplaceTodoListTool().execute(
      {
        items: [
          { content: "Inspect runtime boundaries" },
          { content: "Implement todo tools" }
        ],
        activeIndex: 0
      },
      await createSessionContext(sessionManager, session.sessionId)
    );

    expect(replaceResult.state).toBe("success");

    const persisted = await sessionManager.getSession(session.sessionId);
    expect(persisted?.context.todoState?.items).toHaveLength(2);
    expect(persisted?.context.todoState?.items[0]?.status).toBe("in_progress");
    expect(persisted?.context.todoState?.activeItemId).toBe(
      persisted?.context.todoState?.items[0]?.id
    );

    const readResult = await createGetTodoListTool().execute(
      {},
      await createSessionContext(sessionManager, session.sessionId)
    );
    expect(readResult.state).toBe("success");
    expect(readResult.result.code).toBe("TODO_LIST_READ");
    expect(readResult.displayText).toContain("Inspect runtime boundaries");
  });

  test("update_todo_items keeps one active item and can clear the todo state", async () => {
    const sessionManager = createMemorySessionManager();
    const session = await sessionManager.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "todo-user"
    });

    await createReplaceTodoListTool().execute(
      {
        items: [
          { content: "Inspect runtime boundaries" },
          { content: "Implement todo tools" }
        ],
        activeIndex: 0
      },
      await createSessionContext(sessionManager, session.sessionId)
    );

    const firstSnapshot = await sessionManager.getSession(session.sessionId);
    const firstTodo = firstSnapshot?.context.todoState;
    if (!firstTodo) {
      throw new Error("Expected todo state after replace_todo_list");
    }

    const implementId = firstTodo.items[1]?.id;
    const inspectId = firstTodo.items[0]?.id;
    if (!implementId || !inspectId) {
      throw new Error("Expected seeded todo ids");
    }

    const updateResult = await createUpdateTodoItemsTool().execute(
      {
        operations: [
          { type: "set_status", id: inspectId, status: "done" },
          { type: "set_active", id: implementId },
          { type: "append", content: "Add prompt coverage" }
        ]
      },
      await createSessionContext(sessionManager, session.sessionId)
    );

    expect(updateResult.state).toBe("success");

    const secondSnapshot = await sessionManager.getSession(session.sessionId);
    const secondTodo = secondSnapshot?.context.todoState;
    expect(secondTodo?.activeItemId).toBe(implementId);
    expect(
      secondTodo?.items.find((item) => item.id === inspectId)?.status
    ).toBe("done");
    expect(
      secondTodo?.items.find((item) => item.id === implementId)?.status
    ).toBe("in_progress");
    expect(secondTodo?.items.map((item) => item.content)).toContain(
      "Add prompt coverage"
    );

    const todoIds = secondTodo?.items.map((item) => item.id) ?? [];
    await createUpdateTodoItemsTool().execute(
      {
        operations: todoIds.map((id) => ({
          type: "remove" as const,
          id
        }))
      },
      await createSessionContext(sessionManager, session.sessionId)
    );

    const clearedSnapshot = await sessionManager.getSession(session.sessionId);
    expect(clearedSnapshot?.context.todoState).toBeNull();
  });
});
