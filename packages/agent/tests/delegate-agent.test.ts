import { describe, expect, test } from "bun:test";

import {
  createMemoryBackgroundTaskRepository,
  createMemoryRoutineRepository
} from "@ai-app-template/db";

import {
  createBackgroundTaskManager,
  createDelegateAgentService,
  createDelegateAgentTool,
  createMemorySessionManager
} from "../src/index.js";
import { executeToolAction } from "../src/runtime/tool-execution.js";
import { ToolRegistry } from "../src/tools/registry.js";

function createTaskCard() {
  return {
    title: "Inspect implementation",
    objective: "Read the implementation in isolation.",
    parentTaskSummary: "Parent needs a scoped summary.",
    acceptanceCriteria: ["Return a concise response."],
    constraints: ["Stay inside the workspace."],
    currentRound: 1,
    latestParentMessage: "Inspect the implementation.",
    latestResponse: null,
    expectedParentReply: "none" as const,
    contextInheritance: "shell_only" as const,
    responseIsolation: true as const
  };
}

describe("delegate agent service", () => {
  test("starts an isolated child session and requeues the same delegate for follow-up", async () => {
    const sessionManager = createMemorySessionManager();
    const repository = createMemoryBackgroundTaskRepository();
    const taskManager = createBackgroundTaskManager({
      sessionManager,
      repository
    });
    const service = createDelegateAgentService({
      sessionManager,
      taskManager
    });

    const parent = await sessionManager.createSession({
      workingDirectory: "/tmp/parent",
      model: "MiniMax-M2.7",
      userId: "user-a",
      yoloMode: true,
      toolAllowList: ["read_file"]
    });

    const started = await service.startDelegate({
      parentSessionId: parent.sessionId,
      title: "Inspect parser",
      objective: "Read the parser code path.",
      parentTaskSummary: "Main agent needs a local parser summary.",
      acceptanceCriteria: ["Summarize parser behavior."],
      constraints: ["Do not modify files."],
      message: "Start with parser.ts."
    });

    expect(started.status).toBe("queued");
    expect(started.round).toBe(1);
    expect(started.latestResponse).toBeNull();

    const task = await taskManager.getTask(started.delegateId);
    const child = task && (await sessionManager.getSession(task.childSessionId));
    expect(task?.parentSessionId).toBe(parent.sessionId);
    expect(child?.workingDirectory).toBe("/tmp/parent");
    expect(child?.model).toBe("MiniMax-M2.7");
    expect(child?.context.userId).toBe("user-a");
    expect(child?.context.yoloMode).toBe(false);
    expect(child?.context.toolAllowList).toEqual([]);
    expect(
      (await sessionManager.getSession(parent.sessionId))?.context
        .activeBackgroundTaskCount
    ).toBe(1);

    const claim = await taskManager.claimNextTask("worker-a");
    expect(claim?.task.taskId).toBe(started.delegateId);
    await taskManager.completeTask({
      taskId: claim!.task.taskId,
      runId: claim!.run.runId,
      workerId: "worker-a",
      taskCard: {
        ...claim!.task.taskCard!,
        latestResponse: {
          kind: "message",
          summary: "Parser inspected.",
          content: "Parser inspected.",
          request: null
        }
      }
    });

    const replied = await service.replyToDelegate(
      started.delegateId,
      "Now inspect the related tests."
    );
    expect(replied.delegateId).toBe(started.delegateId);
    expect(replied.status).toBe("queued");
    expect(replied.round).toBe(2);

    const requeued = await taskManager.getTask(started.delegateId);
    expect(requeued?.payload.message).toBe("Now inspect the related tests.");
    expect(requeued?.taskCard?.latestParentMessage).toBe(
      "Now inspect the related tests."
    );
    expect(requeued?.childSessionId).toBe(task?.childSessionId);
    expect(
      (await sessionManager.getSession(parent.sessionId))?.context
        .activeBackgroundTaskCount
    ).toBe(2);

    const parentAfter = await sessionManager.getSession(parent.sessionId);
    expect(parentAfter?.messages).toHaveLength(0);
  });
});

describe("delegate agent tool", () => {
  test("describes explicit actions and rejects mixed start inputs with a clear fix", async () => {
    const registry = new ToolRegistry().register(createDelegateAgentTool());
    const anthropicTool = registry.toAnthropicTools()[0];

    expect(anthropicTool.description).toContain("Examples:");
    expect(anthropicTool.description).toContain('"action":"start"');
    expect(anthropicTool.description).toContain('"action":"permission"');

    const sessionManager = createMemorySessionManager();
    const repository = createMemoryBackgroundTaskRepository();
    const routineRepository = createMemoryRoutineRepository();
    const taskManager = createBackgroundTaskManager({
      sessionManager,
      repository
    });
    const service = createDelegateAgentService({
      sessionManager,
      taskManager
    });
    const parent = await sessionManager.createSession({
      workingDirectory: "/tmp/parent",
      userId: "user-a"
    });

    const result = await executeToolAction({
      sessionManager,
      routineRepository,
      toolRegistry: registry,
      delegateAgentService: service,
      traceManager: undefined,
      session: parent,
      turnCount: 1,
      toolCallId: "delegate-invalid-start",
      toolName: "delegate_agent",
      toolInput: {
        action: "start",
        delegate_id: "delegate-1",
        title: "Inspect parser",
        objective: "Read the parser code path.",
        parent_task_summary: "Parent needs a parser summary."
      },
      eventSink: undefined
    });

    expect(result.kind).toBe("completed");
    if (result.kind !== "completed") {
      throw new Error("Expected invalid input to complete with an error.");
    }

    const output = JSON.parse(result.output.content) as { message: string };
    expect(output.message).toContain(
      "To create a new delegate, remove delegate_id and provide title, objective, and parent_task_summary."
    );
    expect(result.output.displayText).toContain("invalid input");
  });

  test("returns delegate views without exposing child session ids and resolves permission decisions", async () => {
    const sessionManager = createMemorySessionManager();
    const repository = createMemoryBackgroundTaskRepository();
    const routineRepository = createMemoryRoutineRepository();
    const taskManager = createBackgroundTaskManager({
      sessionManager,
      repository
    });
    const service = createDelegateAgentService({
      sessionManager,
      taskManager
    });

    const parent = await sessionManager.createSession({
      workingDirectory: "/tmp/parent",
      userId: "user-a"
    });

    const toolRegistry = new ToolRegistry().register(createDelegateAgentTool());
    const started = await executeToolAction({
      sessionManager,
      routineRepository,
      toolRegistry,
      delegateAgentService: service,
      traceManager: undefined,
      session: parent,
      turnCount: 1,
      toolCallId: "delegate-start",
      toolName: "delegate_agent",
      toolInput: {
        action: "start",
        title: "Inspect parser",
        objective: "Read the parser code path.",
        parent_task_summary: "Parent needs a parser summary."
      },
      eventSink: undefined
    });
    expect(started.kind).toBe("completed");
    if (started.kind !== "completed") {
      throw new Error("Expected delegate start to complete.");
    }

    const output = JSON.parse(started.output.content) as {
      data: {
        delegate_id: string;
        latest_response: unknown;
      };
    };
    expect(output.data.delegate_id).toBeTruthy();
    expect(started.output.content).not.toContain("childSessionId");

    const task = await taskManager.getTask(output.data.delegate_id);
    const claim = await taskManager.claimNextTask("worker-a");
    expect(claim?.task.taskId).toBe(task?.taskId);
    await taskManager.markTaskWaitingForMainAgent({
      taskId: claim!.task.taskId,
      runId: claim!.run.runId,
      workerId: "worker-a",
      taskCard: {
        ...createTaskCard(),
        latestResponse: {
          kind: "needs_main_agent",
          summary: "Need permission to run shell command.",
          content: "Need permission to run shell command.",
          request: {
            kind: "permission_request",
            summary: "Need permission to run shell command.",
            data: {
              toolName: "run_shell_command",
              summaryText: "Need permission to run shell command."
            }
          }
        },
        expectedParentReply: "permission_decision"
      }
    });

    const resumed = await executeToolAction({
      sessionManager,
      routineRepository,
      toolRegistry,
      delegateAgentService: service,
      traceManager: undefined,
      session: parent,
      turnCount: 2,
      toolCallId: "delegate-approve",
      toolName: "delegate_agent",
      toolInput: {
        action: "permission",
        delegate_id: output.data.delegate_id,
        permission_decision: "approve"
      },
      eventSink: undefined
    });
    expect(resumed.kind).toBe("completed");
    if (resumed.kind !== "completed") {
      throw new Error("Expected permission resolution to complete.");
    }
    const resumedOutput = JSON.parse(resumed.output.content) as {
      data: {
        status: string;
        expected_parent_reply: string;
      };
    };
    expect(resumedOutput.data.status).toBe("queued");
    expect(resumedOutput.data.expected_parent_reply).toBe("none");

    const requeued = await taskManager.getTask(output.data.delegate_id);
    expect(requeued?.payload.permissionReply).toBe(true);
    expect(requeued?.payload.message).toBe("yes");
    expect(
      (await sessionManager.getSession(parent.sessionId))?.context
        .activeBackgroundTaskCount
    ).toBe(2);
  });

  test("normalizes unblocking wait options and rejects them for get", async () => {
    const sessionManager = createMemorySessionManager();
    const repository = createMemoryBackgroundTaskRepository();
    const routineRepository = createMemoryRoutineRepository();
    const taskManager = createBackgroundTaskManager({
      sessionManager,
      repository
    });
    const service = createDelegateAgentService({
      sessionManager,
      taskManager
    });
    const parent = await sessionManager.createSession({
      workingDirectory: "/tmp/parent",
      userId: "user-a"
    });
    const toolRegistry = new ToolRegistry().register(createDelegateAgentTool());

    const started = await executeToolAction({
      sessionManager,
      routineRepository,
      toolRegistry,
      delegateAgentService: service,
      traceManager: undefined,
      session: parent,
      turnCount: 1,
      toolCallId: "delegate-start-unblocking",
      toolName: "delegate_agent",
      toolInput: {
        action: "start",
        title: "Inspect parser",
        objective: "Read the parser code path.",
        parent_task_summary: "Parent needs a parser summary.",
        wait_mode: "unblocking",
        initial_check_after_ms: 999_999
      },
      eventSink: undefined
    });
    expect(started.kind).toBe("completed");
    if (started.kind !== "completed") {
      throw new Error("Expected delegate start to complete.");
    }
    const startedOutput = JSON.parse(started.output.content) as {
      data: {
        delegate_id: string;
        wait_mode: string;
        initial_check_after_ms: number;
      };
    };
    expect(startedOutput.data.wait_mode).toBe("unblocking");
    expect(startedOutput.data.initial_check_after_ms).toBe(120_000);

    const invalidGet = await executeToolAction({
      sessionManager,
      routineRepository,
      toolRegistry,
      delegateAgentService: service,
      traceManager: undefined,
      session: parent,
      turnCount: 2,
      toolCallId: "delegate-get-invalid",
      toolName: "delegate_agent",
      toolInput: {
        action: "get",
        delegate_id: startedOutput.data.delegate_id,
        wait_mode: "unblocking"
      },
      eventSink: undefined
    });
    expect(invalidGet.kind).toBe("completed");
    if (invalidGet.kind !== "completed") {
      throw new Error("Expected invalid get to complete with an error.");
    }
    expect(invalidGet.output.displayText).toContain("invalid input");
    expect(invalidGet.output.displayText).toContain("wait options");
  });
});
