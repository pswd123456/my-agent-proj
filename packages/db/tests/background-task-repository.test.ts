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

  test("requeues stale claimed tasks and closes the stale run record", async () => {
    const repository = createMemoryBackgroundTaskRepository();
    await repository.enqueueTask({
      kind: "subagent",
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
    expect(claim).not.toBeNull();

    const staleBefore = new Date(Date.now() + 60_000).toISOString();
    const changedCount = await repository.requeueStaleClaims(staleBefore);
    expect(changedCount).toBe(1);

    const task = await repository.getTask(claim!.task.taskId);
    const run = await repository.getRun(claim!.run.runId);
    expect(task?.status).toBe("queued");
    expect(task?.activeRunId).toBeNull();
    expect(run?.status).toBe("failed");
    expect(run?.errorSummary).toContain("expired");
  });
});

