import { describe, expect, test } from "bun:test";

import { createMemoryBackgroundTaskRepository } from "@ai-app-template/db";

import {
  createBackgroundTaskManager,
  createMemorySessionManager,
  runBackgroundTask
} from "../src/index.js";

function createDelegateTaskCard() {
  return {
    title: "Inspect implementation",
    objective: "Review the relevant code path.",
    parentTaskSummary: "Parent needs a scoped implementation readout.",
    acceptanceCriteria: ["Summarize the current behavior."],
    constraints: ["Stay within the repository."],
    currentRound: 1,
    latestParentMessage: "Inspect the implementation.",
    latestResponse: null,
    expectedParentReply: "none" as const,
    contextInheritance: "shell_only" as const,
    responseIsolation: true as const
  };
}

describe("background task manager", () => {
  test("enqueue creates an isolated child session and preserves the parent session", async () => {
    const sessionManager = createMemorySessionManager();
    const repository = createMemoryBackgroundTaskRepository();
    const manager = createBackgroundTaskManager({
      sessionManager,
      repository
    });

    const parent = await sessionManager.createSession({
      workingDirectory: "/tmp/parent",
      userId: "user-a",
      yoloMode: true,
      maxTurns: 12,
      toolAllowList: ["read_file"]
    });

    const task = await manager.enqueueTask({
      kind: "subagent",
      parentSessionId: parent.sessionId,
      message: "Inspect the implementation.",
      workingDirectory: "/tmp/child",
      model: "MiniMax-M2.7",
      maxTurns: 6,
      enabledCapabilityPacks: ["workspace"]
    });

    const child = await sessionManager.getSession(task.childSessionId);
    expect(child).not.toBeNull();
    expect(child?.sessionId).not.toBe(parent.sessionId);
    expect(child?.workingDirectory).toBe("/tmp/child");
    expect(child?.context.userId).toBe("cli-user");
    expect(child?.context.yoloMode).toBe(false);
    expect(child?.context.toolAllowList).toEqual([]);

    const refreshedParent = await sessionManager.getSession(parent.sessionId);
    expect(refreshedParent?.messages).toHaveLength(0);
    expect(refreshedParent?.workingDirectory).toBe("/tmp/parent");
  });

  test("surfaces invalid task transitions through the manager", async () => {
    const sessionManager = createMemorySessionManager();
    const repository = createMemoryBackgroundTaskRepository();
    const manager = createBackgroundTaskManager({
      sessionManager,
      repository
    });

    const task = await manager.enqueueTask({
      kind: "subagent",
      message: "Inspect the implementation.",
      workingDirectory: "/tmp/child",
      model: "MiniMax-M2.7",
      maxTurns: 6,
      enabledCapabilityPacks: ["workspace"]
    });

    await expect(
      manager.completeTask({
        taskId: task.taskId,
        runId: "missing-run",
        workerId: "worker-a"
      })
    ).rejects.toThrow("Unknown active task claim");
  });
});

describe("background task runner", () => {
  test("maps completed, waiting, and cancelled runtime results without polluting the parent session", async () => {
    const sessionManager = createMemorySessionManager();
    const repository = createMemoryBackgroundTaskRepository();
    const manager = createBackgroundTaskManager({
      sessionManager,
      repository
    });
    const parent = await sessionManager.createSession({
      workingDirectory: "/tmp/parent",
      userId: "user-a"
    });

    const completedTask = await manager.enqueueTask({
      kind: "subagent",
      parentSessionId: parent.sessionId,
      message: "complete",
      workingDirectory: "/tmp/child-complete",
      model: "MiniMax-M2.7",
      maxTurns: 4,
      enabledCapabilityPacks: ["workspace"],
      taskCard: createDelegateTaskCard()
    });
    const completedClaim = await manager.claimNextTask("worker-a");
    await runBackgroundTask({
      claim: completedClaim!,
      workerId: "worker-a",
      heartbeatIntervalMs: 10_000,
      sessionManager,
      taskManager: manager,
      async createRuntimeHandle(session) {
        return {
          runtime: {
            async run() {
              return {
                session: structuredClone(session!),
                finalAnswer: "done",
                status: "completed",
                stopReason: "end_turn"
              };
            }
          },
          async dispose() {}
        };
      }
    });
    const completedRecord = await repository.getTask(completedTask.taskId);
    expect(completedRecord?.status).toBe("completed");
    expect(completedRecord?.taskCard?.latestResponse?.kind).toBe("message");

    const waitingTask = await manager.enqueueTask({
      kind: "subagent",
      parentSessionId: parent.sessionId,
      message: "wait",
      workingDirectory: "/tmp/child-wait",
      model: "MiniMax-M2.7",
      maxTurns: 4,
      enabledCapabilityPacks: ["workspace"],
      taskCard: createDelegateTaskCard()
    });
    const waitingClaim = await manager.claimNextTask("worker-a");
    await runBackgroundTask({
      claim: waitingClaim!,
      workerId: "worker-a",
      heartbeatIntervalMs: 10_000,
      sessionManager,
      taskManager: manager,
      async createRuntimeHandle(session) {
        const waitingSession = structuredClone(session!);
        waitingSession.context.status = "waiting_for_user_question";
        waitingSession.context.pendingUserQuestionPayload = {
          questionText: "Which file should I inspect first?",
          options: [],
          createdAt: new Date().toISOString()
        };
        waitingSession.sessionState.loopState = "waiting for input";
        return {
          runtime: {
            async run() {
              return {
                session: waitingSession,
                finalAnswer: null,
                status: "waiting for input",
                stopReason: "tool_use"
              };
            }
          },
          async dispose() {}
        };
      }
    });
    const waitingRecord = await repository.getTask(waitingTask.taskId);
    expect(waitingRecord?.status).toBe("waiting_for_main_agent");
    expect(waitingRecord?.taskCard?.latestResponse?.kind).toBe(
      "needs_main_agent"
    );
    expect(waitingRecord?.taskCard?.expectedParentReply).toBe("message");

    const cancelledTask = await manager.enqueueTask({
      kind: "subagent",
      parentSessionId: parent.sessionId,
      message: "cancel",
      workingDirectory: "/tmp/child-cancel",
      model: "MiniMax-M2.7",
      maxTurns: 4,
      enabledCapabilityPacks: ["workspace"],
      taskCard: createDelegateTaskCard()
    });
    const cancelledClaim = await manager.claimNextTask("worker-a");
    await runBackgroundTask({
      claim: cancelledClaim!,
      workerId: "worker-a",
      heartbeatIntervalMs: 10_000,
      sessionManager,
      taskManager: manager,
      async createRuntimeHandle(session) {
        const interruptedSession = structuredClone(session!);
        interruptedSession.sessionState.loopState = "interrupted";
        return {
          runtime: {
            async run() {
              return {
                session: interruptedSession,
                finalAnswer: null,
                status: "interrupted",
                stopReason: "interrupted_by_user"
              };
            }
          },
          async dispose() {}
        };
      }
    });
    const cancelledRecord = await repository.getTask(cancelledTask.taskId);
    expect(cancelledRecord?.status).toBe("cancelled");
    expect(cancelledRecord?.taskCard?.latestResponse?.kind).toBe("cancelled");

    const parentAfter = await sessionManager.getSession(parent.sessionId);
    expect(parentAfter?.messages).toHaveLength(0);
  });
});
