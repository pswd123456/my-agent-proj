import { describe, expect, test } from "bun:test";

import { createMemoryBackgroundTaskRepository } from "@ai-app-template/db";

import {
  createBackgroundTaskManager,
  createMemorySessionManager,
  runBackgroundTask
} from "../src/index.js";
import { scheduleBackgroundTaskPollWakeup } from "../src/background-tasks/orchestration.js";

function createDelegateTaskCard() {
  return {
    kind: "delegate" as const,
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

    const child = await sessionManager.getSession(task.childSessionId!);
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

  test("does not create a child session for background shell tasks", async () => {
    const sessionManager = createMemorySessionManager();
    const repository = createMemoryBackgroundTaskRepository();
    const manager = createBackgroundTaskManager({
      sessionManager,
      repository
    });

    const task = await manager.enqueueTask({
      kind: "shell_command",
      executor: "shell_command",
      parentSessionId: "parent-session",
      message: "",
      workingDirectory: "/tmp/shell-task",
      model: "MiniMax-M2.7",
      maxTurns: 1,
      enabledCapabilityPacks: ["workspace"],
      command: "pwd",
      timeoutMs: 5_000
    });

    expect(task.childSessionId).toBeNull();
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
      taskState: createDelegateTaskCard()
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
    expect(completedRecord?.taskState?.latestResponse?.kind).toBe("message");
    const wakeupClaim = await manager.claimNextTask("worker-a");
    expect(wakeupClaim?.task.kind).toBe("session_wakeup");
    await runBackgroundTask({
      claim: wakeupClaim!,
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
                finalAnswer: null,
                status: "completed",
                stopReason: "end_turn"
              };
            }
          },
          async dispose() {}
        };
      }
    });

    const waitingTask = await manager.enqueueTask({
      kind: "subagent",
      parentSessionId: parent.sessionId,
      message: "wait",
      workingDirectory: "/tmp/child-wait",
      model: "MiniMax-M2.7",
      maxTurns: 4,
      enabledCapabilityPacks: ["workspace"],
      taskState: createDelegateTaskCard()
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
    expect(waitingRecord?.taskState?.latestResponse?.kind).toBe(
      "needs_main_agent"
    );
    expect(waitingRecord?.taskState?.expectedParentReply).toBe("message");
    const waitingWakeupClaim = await manager.claimNextTask("worker-a");
    expect(waitingWakeupClaim?.task.kind).toBe("session_wakeup");
    await runBackgroundTask({
      claim: waitingWakeupClaim!,
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
                finalAnswer: null,
                status: "completed",
                stopReason: "end_turn"
              };
            }
          },
          async dispose() {}
        };
      }
    });

    const cancelledTask = await manager.enqueueTask({
      kind: "subagent",
      parentSessionId: parent.sessionId,
      message: "cancel",
      workingDirectory: "/tmp/child-cancel",
      model: "MiniMax-M2.7",
      maxTurns: 4,
      enabledCapabilityPacks: ["workspace"],
      taskState: createDelegateTaskCard()
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
    expect(cancelledRecord?.taskState?.latestResponse?.kind).toBe("cancelled");

    const parentAfter = await sessionManager.getSession(parent.sessionId);
    expect(parentAfter?.messages).toHaveLength(0);
  });

  test("injects a parent-session notification and queues a reusable wakeup after subagent completion", async () => {
    const sessionManager = createMemorySessionManager();
    const repository = createMemoryBackgroundTaskRepository();
    const manager = createBackgroundTaskManager({
      sessionManager,
      repository
    });
    const parent = await sessionManager.createSession({
      workingDirectory: "/tmp/parent"
    });
    await sessionManager.updateContext(parent.sessionId, {
      activeBackgroundTaskCount: 1
    });

    const task = await manager.enqueueTask({
      kind: "subagent",
      parentSessionId: parent.sessionId,
      message: "complete",
      workingDirectory: "/tmp/child-complete",
      model: "MiniMax-M2.7",
      maxTurns: 4,
      enabledCapabilityPacks: ["workspace"],
      taskState: createDelegateTaskCard()
    });
    const claim = await manager.claimNextTask("worker-a");

    await runBackgroundTask({
      claim: claim!,
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

    const parentAfter = await sessionManager.getSession(parent.sessionId);
    expect(parentAfter?.context.activeBackgroundTaskCount).toBe(0);
    expect(parentAfter?.context.pendingBackgroundNotifications).toHaveLength(1);
    expect(parentAfter?.context.pendingBackgroundNotifications[0]?.kind).toBe(
      "task_completed"
    );
    expect(
      parentAfter?.context.pendingBackgroundNotifications[0]?.childSessionId
    ).toBe(task.childSessionId);
    expect(parentAfter?.messages).toHaveLength(0);

    const wakeupTask = await repository.getWakeupTaskBySessionId(
      parent.sessionId
    );
    expect(wakeupTask?.kind).toBe("session_wakeup");
    expect(wakeupTask?.status).toBe("queued");
    expect(wakeupTask?.childSessionId).toBe(parent.sessionId);
    expect(task.childSessionId).not.toBe(parent.sessionId);
  });

  test("backs off delegate poll wakeups without running the parent model", async () => {
    const sessionManager = createMemorySessionManager();
    const repository = createMemoryBackgroundTaskRepository();
    const manager = createBackgroundTaskManager({
      sessionManager,
      repository
    });
    const parent = await sessionManager.createSession({
      workingDirectory: "/tmp/parent"
    });

    const delegateTask = await manager.enqueueTask({
      kind: "subagent",
      parentSessionId: parent.sessionId,
      message: "complete",
      workingDirectory: "/tmp/child-complete",
      model: "MiniMax-M2.7",
      maxTurns: 4,
      enabledCapabilityPacks: ["workspace"],
      taskState: createDelegateTaskCard()
    });
    const delegateClaim = await manager.claimNextTask("worker-a");
    expect(delegateClaim?.task.taskId).toBe(delegateTask.taskId);

    await manager.enqueueTask({
      kind: "session_wakeup",
      parentSessionId: parent.sessionId,
      childSessionId: parent.sessionId,
      message: "",
      workingDirectory: parent.workingDirectory,
      model: parent.model,
      maxTurns: 4,
      enabledCapabilityPacks: ["workspace"],
      metadata: {
        reason: "background_task_poll",
        backgroundTaskIds: [delegateTask.taskId],
        nextIntervalMs: 70_000
      },
      maxAttempts: 1
    });
    const pollClaim = await manager.claimNextTask("worker-a");
    expect(pollClaim?.task.kind).toBe("session_wakeup");

    let runtimeCalled = false;
    await runBackgroundTask({
      claim: pollClaim!,
      workerId: "worker-a",
      heartbeatIntervalMs: 10_000,
      sessionManager,
      taskManager: manager,
      async createRuntimeHandle() {
        runtimeCalled = true;
        throw new Error("delegate poll should not run the parent model");
      }
    });

    expect(runtimeCalled).toBe(false);
    const requeuedPoll = await repository.getWakeupTaskBySessionId(parent.sessionId);
    expect(requeuedPoll?.status).toBe("queued");
    expect(requeuedPoll?.availableAt).not.toBeNull();
    expect(requeuedPoll?.payload.metadata).toMatchObject({
      reason: "background_task_poll",
      backgroundTaskIds: [delegateTask.taskId],
      nextIntervalMs: 120_000
    });
    expect(await manager.claimNextTask("worker-a")).toBeNull();
  });

  test("merges new task ids into an existing queued poll wakeup", async () => {
    const sessionManager = createMemorySessionManager();
    const repository = createMemoryBackgroundTaskRepository();
    const manager = createBackgroundTaskManager({
      sessionManager,
      repository
    });
    const parent = await sessionManager.createSession({
      workingDirectory: "/tmp/parent"
    });

    await scheduleBackgroundTaskPollWakeup({
      sessionManager,
      taskManager: manager,
      parentSessionId: parent.sessionId,
      taskIds: ["delegate-a"],
      initialCheckAfterMs: 5_000
    });

    const firstWakeup = await repository.getWakeupTaskBySessionId(
      parent.sessionId
    );
    expect(firstWakeup?.status).toBe("queued");
    expect(firstWakeup?.payload.metadata).toMatchObject({
      reason: "background_task_poll",
      backgroundTaskIds: ["delegate-a"],
      nextIntervalMs: 5_000
    });

    await scheduleBackgroundTaskPollWakeup({
      sessionManager,
      taskManager: manager,
      parentSessionId: parent.sessionId,
      taskIds: ["delegate-b"],
      initialCheckAfterMs: 10_000
    });

    const mergedWakeup = await repository.getWakeupTaskBySessionId(
      parent.sessionId
    );
    expect(mergedWakeup?.taskId).toBe(firstWakeup?.taskId);
    expect(mergedWakeup?.availableAt).toBe(firstWakeup?.availableAt);
    expect(mergedWakeup?.payload.metadata).toMatchObject({
      reason: "background_task_poll",
      backgroundTaskIds: ["delegate-a", "delegate-b"],
      nextIntervalMs: 5_000
    });
  });

  test("expedites a future delegate poll wakeup when the subagent completes", async () => {
    const sessionManager = createMemorySessionManager();
    const repository = createMemoryBackgroundTaskRepository();
    const manager = createBackgroundTaskManager({
      sessionManager,
      repository
    });
    const parent = await sessionManager.createSession({
      workingDirectory: "/tmp/parent"
    });
    await sessionManager.updateContext(parent.sessionId, {
      activeBackgroundTaskCount: 1
    });

    const delegateTask = await manager.enqueueTask({
      kind: "subagent",
      parentSessionId: parent.sessionId,
      message: "complete",
      workingDirectory: "/tmp/child-complete",
      model: "MiniMax-M2.7",
      maxTurns: 4,
      enabledCapabilityPacks: ["workspace"],
      taskState: createDelegateTaskCard()
    });
    const delegateClaim = await manager.claimNextTask("worker-a");
    const futureAvailableAt = new Date(Date.now() + 60_000).toISOString();
    await manager.enqueueTask({
      kind: "session_wakeup",
      parentSessionId: parent.sessionId,
      childSessionId: parent.sessionId,
      message: "",
      workingDirectory: parent.workingDirectory,
      model: parent.model,
      maxTurns: 4,
      enabledCapabilityPacks: ["workspace"],
      metadata: {
        reason: "background_task_poll",
        backgroundTaskIds: [delegateTask.taskId],
        nextIntervalMs: 60_000
      },
      availableAt: futureAvailableAt,
      maxAttempts: 1
    });

    await runBackgroundTask({
      claim: delegateClaim!,
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

    const wakeupTask = await repository.getWakeupTaskBySessionId(parent.sessionId);
    expect(wakeupTask?.status).toBe("queued");
    expect(wakeupTask?.availableAt).toBeNull();
    expect(wakeupTask?.payload.metadata).toMatchObject({
      reason: "background_notification"
    });
  });

  test("keeps notifications queued without wakeup when the parent is waiting for user input", async () => {
    const sessionManager = createMemorySessionManager();
    const repository = createMemoryBackgroundTaskRepository();
    const manager = createBackgroundTaskManager({
      sessionManager,
      repository
    });
    const parent = await sessionManager.createSession({
      workingDirectory: "/tmp/parent"
    });
    await sessionManager.updateContext(parent.sessionId, {
      activeBackgroundTaskCount: 1,
      status: "waiting_for_user_question"
    });

    await manager.enqueueTask({
      kind: "subagent",
      parentSessionId: parent.sessionId,
      message: "wait",
      workingDirectory: "/tmp/child-wait",
      model: "MiniMax-M2.7",
      maxTurns: 4,
      enabledCapabilityPacks: ["workspace"],
      taskState: createDelegateTaskCard()
    });
    const claim = await manager.claimNextTask("worker-a");

    await runBackgroundTask({
      claim: claim!,
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

    const parentAfter = await sessionManager.getSession(parent.sessionId);
    expect(parentAfter?.context.pendingBackgroundNotifications).toHaveLength(1);
    expect(parentAfter?.context.pendingBackgroundNotifications[0]?.kind).toBe(
      "task_waiting"
    );
    expect(
      await repository.getWakeupTaskBySessionId(parent.sessionId)
    ).toBeNull();
  });
});
