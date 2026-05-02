import { randomUUID } from "node:crypto";

import { describe, expect, test } from "bun:test";

import type { BackgroundTaskRepository } from "../src/background-task-repository.js";

export interface BackgroundTaskRepositoryTestHarness {
  readonly repository: BackgroundTaskRepository;
  testId(suffix: string): string;
  cleanup(): Promise<void>;
}

export type CreateBackgroundTaskRepositoryTestHarness = () =>
  | BackgroundTaskRepositoryTestHarness
  | Promise<BackgroundTaskRepositoryTestHarness>;

function createAgentPayload() {
  return {
    executor: "agent_session" as const,
    message: "Inspect the repo and report back.",
    workingDirectory: "/tmp/workspace",
    model: "MiniMax-M2.7",
    maxTurns: 8,
    enabledCapabilityPacks: ["workspace", "schedule"],
    metadata: { purpose: "background-test" }
  };
}

function createShellPayload(command = "pwd") {
  return {
    executor: "shell_command" as const,
    message: "",
    workingDirectory: "/tmp/workspace",
    model: "MiniMax-M2.7",
    maxTurns: 1,
    enabledCapabilityPacks: ["workspace"],
    metadata: {},
    command,
    timeoutMs: 5_000
  };
}

function createDelegateTaskState(summary: string) {
  return {
    kind: "delegate" as const,
    title: "Inspect implementation",
    objective: "Review the relevant code path.",
    parentTaskSummary: "Parent needs a scoped implementation readout.",
    acceptanceCriteria: ["Summarize the current behavior."],
    constraints: ["Stay within the repository."],
    currentRound: 1,
    latestParentMessage: "Inspect the implementation.",
    latestResponse: {
      kind: "message" as const,
      summary,
      content: summary
    },
    expectedParentReply: "none" as const,
    contextInheritance: "shell_only" as const,
    responseIsolation: true as const
  };
}

async function withRepository(
  createHarness: CreateBackgroundTaskRepositoryTestHarness,
  run: (harness: BackgroundTaskRepositoryTestHarness) => Promise<void>
): Promise<void> {
  const harness = await createHarness();
  try {
    await run(harness);
  } finally {
    await harness.cleanup();
  }
}

export function registerBackgroundTaskRepositoryContractTests(
  name: string,
  createHarness: CreateBackgroundTaskRepositoryTestHarness
): void {
  describe(name, () => {
    test("runs queued -> claimed -> running -> completed lifecycle", async () => {
      await withRepository(createHarness, async ({ repository, testId }) => {
        const task = await repository.enqueueTask({
          kind: "subagent",
          parentSessionId: testId("parent-session"),
          childSessionId: testId(`child-session-${randomUUID()}`),
          payload: createAgentPayload()
        });

        expect(task.status).toBe("queued");
        expect(await repository.listTasks()).toEqual([
          expect.objectContaining({
            taskId: task.taskId,
            parentSessionId: task.parentSessionId,
            childSessionId: task.childSessionId
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
    });

    test("finishes waiting-for-input claims with derived task state summary", async () => {
      await withRepository(createHarness, async ({ repository, testId }) => {
        await repository.enqueueTask({
          kind: "subagent",
          parentSessionId: testId("parent-session"),
          childSessionId: testId(`child-session-${randomUUID()}`),
          payload: createAgentPayload()
        });
        const claim = await repository.claimNextTask("worker-a");

        const waiting = await repository.markTaskWaitingForInput({
          taskId: claim!.task.taskId,
          runId: claim!.run.runId,
          workerId: "worker-a",
          taskState: createDelegateTaskState(
            "Need the parent to choose a file."
          )
        });

        expect(waiting.task.status).toBe("waiting_for_input");
        expect(waiting.task.activeRunId).toBeNull();
        expect(waiting.task.resultSummary).toBe(
          "Need the parent to choose a file."
        );
        expect(waiting.run.status).toBe("waiting_for_input");
        expect(waiting.run.finishedAt).not.toBeNull();
      });
    });

    test("marks running task as cancelling and then cancelled", async () => {
      await withRepository(createHarness, async ({ repository, testId }) => {
        const task = await repository.enqueueTask({
          kind: "cron_job",
          parentSessionId: testId("parent-session"),
          childSessionId: testId(`child-session-${randomUUID()}`),
          payload: createAgentPayload()
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
        expect(cancelled.task.activeRunId).toBeNull();
        expect(cancelled.run.status).toBe("cancelled");
      });
    });

    test("cancels queued shell tasks immediately without creating a child session", async () => {
      await withRepository(createHarness, async ({ repository, testId }) => {
        const task = await repository.enqueueTask({
          kind: "shell_command",
          parentSessionId: testId("parent-session"),
          payload: createShellPayload()
        });

        expect(task.childSessionId).toBeNull();

        const cancelled = await repository.requestCancel(task.taskId);
        expect(cancelled?.status).toBe("cancelled");
        expect(cancelled?.cancelRequested).toBe(false);
        expect(cancelled?.completedAt).not.toBeNull();
      });
    });

    test("requeues stale claimed tasks and closes the stale run record", async () => {
      await withRepository(createHarness, async ({ repository, testId }) => {
        await repository.enqueueTask({
          kind: "subagent",
          parentSessionId: testId("parent-session"),
          childSessionId: testId(`child-session-${randomUUID()}`),
          maxAttempts: 2,
          payload: createAgentPayload()
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
    });

    test("fails stale claims after the max attempt budget is exhausted", async () => {
      await withRepository(createHarness, async ({ repository, testId }) => {
        const task = await repository.enqueueTask({
          kind: "subagent",
          parentSessionId: testId("parent-session"),
          childSessionId: testId(`child-session-${randomUUID()}`),
          maxAttempts: 1,
          payload: createAgentPayload()
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

    test("does not claim queued tasks before availableAt", async () => {
      await withRepository(createHarness, async ({ repository, testId }) => {
        const futureTask = await repository.enqueueTask({
          kind: "subagent",
          parentSessionId: testId("parent-session"),
          childSessionId: testId(`future-child-session-${randomUUID()}`),
          availableAt: new Date(Date.now() + 60_000).toISOString(),
          payload: createAgentPayload()
        });
        await repository.enqueueTask({
          kind: "subagent",
          parentSessionId: testId("parent-session"),
          childSessionId: testId(`ready-child-session-${randomUUID()}`),
          payload: createAgentPayload()
        });

        const claim = await repository.claimNextTask("worker-a");
        expect(claim?.task.childSessionId).toContain("ready-child-session");

        const delayed = await repository.getTask(futureTask.taskId);
        expect(delayed?.status).toBe("queued");
        expect(delayed?.availableAt).toBe(futureTask.availableAt);
      });
    });
  });
}
