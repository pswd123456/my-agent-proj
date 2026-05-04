import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  createPostgresTestSessionManager,
  type PostgresTestSessionManager
} from "../../../tests/helpers/postgres-session-manager.js";
import {
  createManageTaskBriefTool,
  createManageTodoListTool
} from "../src/tools/index.js";
import type { ToolExecutionContext } from "../src/tools/runtime-tool.js";

async function createSessionContext(
  sessionManager: PostgresTestSessionManager,
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
      planModeEnabled: session.context.planModeEnabled,
      taskBriefPath: session.context.taskBriefPath,
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
  test("manage_todo_list action=replace persists a new session todo state and action=get reads it back", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const session = await sessionManager.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "todo-user"
    });

    const replaceResult = await createManageTodoListTool().execute(
      {
        action: "replace",
        items: [
          { content: "Inspect runtime boundaries" },
          { content: "Implement todo tools" }
        ],
        activeIndex: 0
      },
      await createSessionContext(sessionManager, session.sessionId)
    );

    expect(replaceResult.state).toBe("success");
    expect(replaceResult.content).not.toContain("Inspect runtime boundaries");
    expect(replaceResult.content).not.toContain("Implement todo tools");
    expect(replaceResult.content).toContain('"ack": "todo_list_replaced"');
    expect(replaceResult.content).toContain('"itemIds"');
    expect(replaceResult.content).toContain('"hash"');

    const persisted = await sessionManager.getSession(session.sessionId);
    expect(persisted?.context.todoState?.items).toHaveLength(2);
    expect(persisted?.context.todoState?.items[0]?.status).toBe("in_progress");
    expect(persisted?.context.todoState?.activeItemId).toBe(
      persisted?.context.todoState?.items[0]?.id
    );

    const readResult = await createManageTodoListTool().execute(
      { action: "get" },
      await createSessionContext(sessionManager, session.sessionId)
    );
    expect(readResult.state).toBe("success");
    expect(readResult.result.code).toBe("TODO_LIST_READ");
    expect(readResult.displayText).toContain("Inspect runtime boundaries");
  });

  test("manage_todo_list action=update keeps one active item and can clear the todo state", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const session = await sessionManager.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "todo-user"
    });

    await createManageTodoListTool().execute(
      {
        action: "replace",
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
      throw new Error("Expected todo state after manage_todo_list replace");
    }

    const implementId = firstTodo.items[1]?.id;
    const inspectId = firstTodo.items[0]?.id;
    if (!implementId || !inspectId) {
      throw new Error("Expected seeded todo ids");
    }

    const updateResult = await createManageTodoListTool().execute(
      {
        action: "update",
        operations: [
          { type: "set_status", id: inspectId, status: "done" },
          { type: "set_active", id: implementId },
          { type: "append", content: "Add prompt coverage" }
        ]
      },
      await createSessionContext(sessionManager, session.sessionId)
    );

    expect(updateResult.state).toBe("success");
    expect(updateResult.content).not.toContain("Inspect runtime boundaries");
    expect(updateResult.content).not.toContain("Implement todo tools");
    expect(updateResult.content).not.toContain("Add prompt coverage");
    expect(updateResult.content).toContain('"ack": "todo_items_updated"');
    expect(updateResult.content).toContain('"itemIds"');
    expect(updateResult.content).toContain('"hash"');

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
    await createManageTodoListTool().execute(
      {
        action: "update",
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

  test("manage_todo_list schema explains that ids are todo item ids rather than visible numbering", () => {
    const tool = createManageTodoListTool();
    expect(tool.description).toContain("not visible numbering");

    const updateVariant = tool.inputSchema.oneOf?.find(
      (variant) =>
        variant &&
        typeof variant === "object" &&
        "properties" in variant &&
        variant.properties?.action &&
        typeof variant.properties.action === "object" &&
        "const" in variant.properties.action &&
        variant.properties.action.const === "update"
    );
    const operations = updateVariant?.properties?.operations;
    if (
      !operations ||
      typeof operations !== "object" ||
      !("items" in operations)
    ) {
      throw new Error("Expected update operations schema metadata");
    }

    const variants = (
      operations.items as {
        oneOf?: Array<{ properties?: Record<string, unknown> }>;
      }
    ).oneOf;
    if (!variants) {
      throw new Error("Expected oneOf variants for operations");
    }

    for (const type of ["set_status", "set_content", "remove", "set_active"]) {
      const variant = variants.find(
        (candidate) =>
          candidate.properties?.type &&
          typeof candidate.properties.type === "object" &&
          "enum" in candidate.properties.type &&
          Array.isArray(candidate.properties.type.enum) &&
          candidate.properties.type.enum.includes(type)
      );
      expect(variant?.properties?.id).toBeDefined();
      expect(
        typeof variant?.properties?.id === "object" &&
          variant.properties.id !== null &&
          "description" in variant.properties.id &&
          typeof variant.properties.id.description === "string" &&
          variant.properties.id.description
            .toLowerCase()
            .includes("visible list numbering")
      ).toBe(true);
    }
  });

  test("shared invalid input handling stays consistent across todo and task brief tools", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const session = await sessionManager.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "todo-user",
      planModeEnabled: true
    });
    const context = await createSessionContext(
      sessionManager,
      session.sessionId
    );
    const cases = [
      {
        name: "manage_todo_list",
        execute: () =>
          createManageTodoListTool().execute(
            { action: "replace" } as never,
            context
          ),
        expectedField: "items"
      },
      {
        name: "manage_todo_list",
        execute: () =>
          createManageTodoListTool().execute(
            { action: "update" } as never,
            context
          ),
        expectedField: "operations"
      },
      {
        name: "manage_task_brief",
        execute: () =>
          createManageTaskBriefTool().execute(
            { action: "replace" } as never,
            context
          ),
        expectedField: "content"
      },
      {
        name: "manage_task_brief",
        execute: () =>
          createManageTaskBriefTool().execute(
            { action: "edit" } as never,
            context
          ),
        expectedField: "startLine"
      },
      {
        name: "manage_task_brief",
        execute: () =>
          createManageTaskBriefTool().execute(
            { action: "search" } as never,
            context
          ),
        expectedField: "query"
      }
    ];

    for (const testCase of cases) {
      const result = await testCase.execute();
      expect(result.state).toBe("failed");
      expect(result.result.code).toBe("INVALID_TOOL_INPUT");
      expect(result.displayText).toContain(`[${testCase.name}] invalid input`);
      expect(result.result.validationErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: testCase.expectedField
          })
        ])
      );
    }
  });

  test("manage_task_brief action=replace writes the bound markdown file and action=get reads it back", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const session = await sessionManager.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "todo-user",
      planModeEnabled: true
    });

    const initialRead = await createManageTaskBriefTool().execute(
      { action: "get" },
      await createSessionContext(sessionManager, session.sessionId)
    );
    expect(initialRead.state).toBe("success");
    expect(initialRead.result.code).toBe("TASK_BRIEF_READ");
    expect(initialRead.content).toContain('"exists": false');

    const content = [
      "# Task Brief",
      "",
      "## Goal",
      "Jump joy web game",
      "",
      "## Acceptance Criteria",
      "- no file writes"
    ].join("\n");
    const replaceResult = await createManageTaskBriefTool().execute(
      { action: "replace", plan_name: "jump_joy_web_game", content },
      await createSessionContext(sessionManager, session.sessionId)
    );
    expect(replaceResult.state).toBe("success");
    expect(replaceResult.content).not.toContain("Jump joy web game");
    expect(replaceResult.content).not.toContain("Acceptance Criteria");
    expect(replaceResult.content).toContain('"ack": "task_brief_replaced"');
    expect(replaceResult.content).toContain('"path":');
    expect(replaceResult.content).not.toContain('"hash"');
    expect(replaceResult.details).toEqual({
      kind: "task_brief",
      path: path.join(
        "/tmp/workspace",
        ".agents",
        "plans",
        session.sessionId,
        "jump_joy_web_game.md"
      ),
      content,
      operation: "replace"
    });

    const persisted = await sessionManager.getSession(session.sessionId);
    const taskBriefPath = persisted?.context.taskBriefPath;
    expect(taskBriefPath).toBe(
      path.join(
        "/tmp/workspace",
        ".agents",
        "plans",
        session.sessionId,
        "jump_joy_web_game.md"
      )
    );
    if (!taskBriefPath) {
      throw new Error("Expected a bound task brief path.");
    }
    expect(await readFile(taskBriefPath, "utf8")).toBe(content);

    const readResult = await createManageTaskBriefTool().execute(
      { action: "get" },
      await createSessionContext(sessionManager, session.sessionId)
    );
    expect(readResult.state).toBe("success");
    expect(readResult.content).toContain('"exists": true');
    expect(readResult.content).toContain("Jump joy web game");
  });

  test("manage_task_brief supports line windows and returns search line numbers", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const session = await sessionManager.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "todo-user",
      planModeEnabled: true
    });

    const content = [
      "# Task Brief",
      "",
      "## Goal",
      "Jump joy web game",
      "",
      "## Acceptance Criteria",
      "- no file writes",
      "- keep plan mode read only"
    ].join("\n");
    await createManageTaskBriefTool().execute(
      { action: "replace", plan_name: "jump_joy_web_game", content },
      await createSessionContext(sessionManager, session.sessionId)
    );

    const readResult = await createManageTaskBriefTool().execute(
      { action: "read", startLine: 3, endLine: 7 },
      await createSessionContext(sessionManager, session.sessionId)
    );
    expect(readResult.state).toBe("success");
    expect(readResult.content).toContain('"startLine": 3');
    expect(readResult.content).toContain('"endLine": 7');
    expect(readResult.content).toContain("Jump joy web game");
    expect(readResult.content).not.toContain("# Task Brief");

    const searchResult = await createManageTaskBriefTool().execute(
      { action: "search", query: "plan mode", maxResults: 5 },
      await createSessionContext(sessionManager, session.sessionId)
    );
    expect(searchResult.state).toBe("success");
    expect(searchResult.content).toContain('"line": 8');
    expect(searchResult.content).toContain("keep plan mode read only");
  });

  test("manage_task_brief action=edit replaces an inclusive line range", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const session = await sessionManager.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "todo-user",
      planModeEnabled: true
    });

    await createManageTaskBriefTool().execute(
      {
        action: "replace",
        plan_name: "jump_joy_web_game",
        content: [
          "# Task Brief",
          "",
          "## Goal",
          "Jump joy web game",
          "",
          "## Next Checkpoint",
          "Draft v1"
        ].join("\n")
      },
      await createSessionContext(sessionManager, session.sessionId)
    );

    const editResult = await createManageTaskBriefTool().execute(
      {
        action: "edit",
        startLine: 6,
        endLine: 7,
        content: ["## Next Checkpoint", "Draft v2"].join("\n")
      },
      await createSessionContext(sessionManager, session.sessionId)
    );
    expect(editResult.state).toBe("success");
    expect(editResult.content).toContain('"code": "TASK_BRIEF_EDITED"');
    expect(editResult.details).toEqual({
      kind: "task_brief",
      path: path.join(
        "/tmp/workspace",
        ".agents",
        "plans",
        session.sessionId,
        "jump_joy_web_game.md"
      ),
      content: [
        "# Task Brief",
        "",
        "## Goal",
        "Jump joy web game",
        "",
        "## Next Checkpoint",
        "Draft v2"
      ].join("\n"),
      operation: "edit",
      startLine: 6,
      endLine: 7
    });

    const readResult = await createManageTaskBriefTool().execute(
      { action: "read" },
      await createSessionContext(sessionManager, session.sessionId)
    );
    expect(readResult.content).toContain("Draft v2");
    expect(readResult.content).not.toContain("Draft v1");
  });

  test("manage_task_brief action=replace requires plan_name before the first write", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const session = await sessionManager.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "todo-user",
      planModeEnabled: true
    });

    const replaceResult = await createManageTaskBriefTool().execute(
      {
        action: "replace",
        content: "# Task Brief\n\n## Goal\nJump joy web game\n"
      },
      await createSessionContext(sessionManager, session.sessionId)
    );

    expect(replaceResult.state).toBe("failed");
    expect(replaceResult.content).toContain("Provide plan_name");
  });
});
