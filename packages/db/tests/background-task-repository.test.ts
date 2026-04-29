import { describe, expect, test } from "bun:test";

import { createMemoryBackgroundTaskRepository } from "../src/background-task-repository.js";

describe("MemoryBackgroundTaskRepository", () => {
  test("runs queued -> claimed -> running -> completed lifecycle", async () => {
    const repository = createMemoryBackgroundTaskRepository();
    const task = await repository.enqueueTask({
      kind: "subagent",
      parentSessionId: "parent-session",
      childSessionId: "child-session",
      payload: {
        executor: "agent_session",
        message: "Inspect the repo and report back.",
        workingDirectory: "/tmp/workspace",
        model: "MiniMax-M2.7",
        maxTurns: 8,
        enabledCapabilityPacks: ["workspace", "schedule"],
        metadata: { purpose: "background-test" }
      }
    });

    expect(task.status).toBe("queued");
    expect(await repository.listTasks()).toEqual([
      expect.objectContaining({
        taskId: task.taskId,
        parentSessionId: "parent-session",
        childSessionId: "child-session"
      })
    ]);

    const claim = await repository.claimNextTask("worker-a");
    expect(claim?.task.taskId).toBe(task.taskId);
    expect(claim?.task.status).toBe("claimed");

    const running = await repository.markTaskRunning({
      taskId: claim!.task.taskId,
      runId: claim!.run.runId,
      workerId: "worker-a"
    });
    expect(running.task.status).toBe("running");

    const completed = await repository.completeTask({
      taskId: claim!.task.taskId,
      runId: claim!.run.runId,
      workerId: "worker-a",
      resultSummary: "Finished background work."
    });
    expect(completed.task.status).toBe("completed");
    expect(completed.task.resultSummary).toBe("Finished background work.");
    expect(completed.task.activeRunId).toBeNull();
    expect(completed.run.status).toBe("completed");
    expect(completed.run.finishedAt).not.toBeNull();
  });

  test("marks running task as cancelling and then cancelled", async () => {
    const repository = createMemoryBackgroundTaskRepository();
    const task = await repository.enqueueTask({
      kind: "cron_job",
      childSessionId: "child-session",
      payload: {
        executor: "agent_session",
        message: "Do the work.",
        workingDirectory: "/tmp/workspace",
        model: "MiniMax-M2.7",
        maxTurns: 3,
        enabledCapabilityPacks: ["workspace"],
        metadata: {}
      }
    });
    const claim = await repository.claimNextTask("worker-a");
    await repository.markTaskRunning({
      taskId: claim!.task.taskId,
      runId: claim!.run.runId,
      workerId: "worker-a"
    });

    const cancelling = await repository.requestCancel(task.taskId);
    expect(cancelling?.status).toBe("cancelling");
    expect(cancelling?.cancelRequested).toBe(true);

    const cancelled = await repository.cancelTask({
      taskId: claim!.task.taskId,
      runId: claim!.run.runId,
      workerId: "worker-a",
      resultSummary: "Interrupted by request."
    });
    expect(cancelled.task.status).toBe("cancelled");
    expect(cancelled.task.cancelRequested).toBe(false);
    expect(cancelled.run.status).toBe("cancelled");
  });

  test("stores shell tasks without a child session id", async () => {
    const repository = createMemoryBackgroundTaskRepository();
    const task = await repository.enqueueTask({
      kind: "shell_command",
      parentSessionId: "parent-session",
      payload: {
        executor: "shell_command",
        message: "",
        workingDirectory: "/tmp/workspace",
        model: "MiniMax-M2.7",
        maxTurns: 1,
        enabledCapabilityPacks: ["workspace"],
        metadata: {},
        command: "pwd",
        timeoutMs: 5_000
      }
    });

    expect(task.childSessionId).toBeNull();
  });

  test("requeues stale claimed tasks and closes the stale run record", async () => {
    const repository = createMemoryBackgroundTaskRepository();
    await repository.enqueueTask({
      kind: "subagent",
      childSessionId: "child-session",
      maxAttempts: 2,
      payload: {
        executor: "agent_session",
        message: "Do the work.",
        workingDirectory: "/tmp/workspace",
        model: "MiniMax-M2.7",
        maxTurns: 3,
        enabledCapabilityPacks: ["workspace"],
        metadata: {}
      }
    });
    const claim = await repository.claimNextTask("worker-a");
    expect(claim).not.toBeNull();

    const staleBefore = new Date(Date.now() + 60_000).toISOString();
    const changedTasks = await repository.requeueStaleClaims(staleBefore);
    expect(changedTasks).toHaveLength(1);
    expect(changedTasks[0]?.status).toBe("queued");

    const task = await repository.getTask(claim!.task.taskId);
    const run = await repository.getRun(claim!.run.runId);
    expect(task?.status).toBe("queued");
    expect(task?.activeRunId).toBeNull();
    expect(run?.status).toBe("failed");
    expect(run?.errorSummary).toContain("expired");
  });

  test("does not claim queued tasks before availableAt", async () => {
    const repository = createMemoryBackgroundTaskRepository();
    const futureTask = await repository.enqueueTask({
      kind: "subagent",
      childSessionId: "future-child-session",
      availableAt: new Date(Date.now() + 60_000).toISOString(),
      payload: {
        executor: "agent_session",
        message: "Do later work.",
        workingDirectory: "/tmp/workspace",
        model: "MiniMax-M2.7",
        maxTurns: 3,
        enabledCapabilityPacks: ["workspace"],
        metadata: {}
      }
    });
    await repository.enqueueTask({
      kind: "subagent",
      childSessionId: "ready-child-session",
      payload: {
        executor: "agent_session",
        message: "Do ready work.",
        workingDirectory: "/tmp/workspace",
        model: "MiniMax-M2.7",
        maxTurns: 3,
        enabledCapabilityPacks: ["workspace"],
        metadata: {}
      }
    });

    const claim = await repository.claimNextTask("worker-a");
    expect(claim?.task.childSessionId).toBe("ready-child-session");

    const delayed = await repository.getTask(futureTask.taskId);
    expect(delayed?.status).toBe("queued");
    expect(delayed?.availableAt).toBe(futureTask.availableAt);
  });

  test("fails stale claims after the max attempt budget is exhausted", async () => {
    const repository = createMemoryBackgroundTaskRepository();
    const task = await repository.enqueueTask({
      kind: "subagent",
      parentSessionId: "parent-session",
      childSessionId: "child-session",
      maxAttempts: 1,
      payload: {
        executor: "agent_session",
        message: "Do the work.",
        workingDirectory: "/tmp/workspace",
        model: "MiniMax-M2.7",
        maxTurns: 3,
        enabledCapabilityPacks: ["workspace"],
        metadata: {}
      }
    });
    const claim = await repository.claimNextTask("worker-a");
    expect(claim?.task.attemptCount).toBe(1);

    const staleTasks = await repository.requeueStaleClaims(
      new Date(Date.now() + 60_000).toISOString()
    );
    expect(staleTasks).toHaveLength(1);
    expect(staleTasks[0]?.taskId).toBe(task.taskId);
    expect(staleTasks[0]?.status).toBe("failed");
    expect(staleTasks[0]?.lastError).toContain("expired");
    expect(staleTasks[0]?.completedAt).not.toBeNull();
  });
});
