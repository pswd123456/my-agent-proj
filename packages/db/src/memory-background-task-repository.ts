import { randomUUID } from "node:crypto";

import type {
  BackgroundTaskClaim,
  BackgroundTaskPayload,
  BackgroundTaskRecord,
  BackgroundTaskRunRecord,
  BackgroundTaskState
} from "@ai-app-template/domain";

import {
  buildClaim,
  cloneRun,
  cloneTask,
  compareAvailableTasks,
  finishRun,
  finishTaskClaim,
  isTaskAvailable,
  requireActiveTaskStatus,
  resolveTaskResultSummary,
  type BackgroundTaskRepository,
  type CancelTaskInput,
  type CompleteTaskInput,
  type EnqueueBackgroundTaskInput,
  type FailTaskInput,
  type RequeueExistingTaskInput,
  type RescheduleQueuedTaskInput,
  type TaskClaimInput,
  type TaskWaitingForInputInput,
  type TaskWaitingForMainAgentInput
} from "./background-task-repository-shared.js";

export class MemoryBackgroundTaskRepository implements BackgroundTaskRepository {
  private readonly tasks = new Map<string, BackgroundTaskRecord>();
  private readonly runs = new Map<string, BackgroundTaskRunRecord>();

  async getTask(taskId: string): Promise<BackgroundTaskRecord | null> {
    const task = this.tasks.get(taskId);
    return task ? cloneTask(task) : null;
  }

  async listTasks(): Promise<BackgroundTaskRecord[]> {
    return [...this.tasks.values()]
      .map((task) => cloneTask(task))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getWakeupTaskBySessionId(
    sessionId: string
  ): Promise<BackgroundTaskRecord | null> {
    const task = [...this.tasks.values()]
      .filter(
        (candidate) =>
          candidate.kind === "session_wakeup" &&
          candidate.childSessionId === sessionId
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    return task ? cloneTask(task) : null;
  }

  async getRun(runId: string): Promise<BackgroundTaskRunRecord | null> {
    const run = this.runs.get(runId);
    return run ? cloneRun(run) : null;
  }

  async enqueueTask(
    input: EnqueueBackgroundTaskInput
  ): Promise<BackgroundTaskRecord> {
    const now = new Date().toISOString();
    const task: BackgroundTaskRecord = {
      taskId: randomUUID(),
      kind: input.kind,
      status: "queued",
      executor: input.payload.executor,
      parentSessionId: input.parentSessionId ?? null,
      childSessionId: input.childSessionId ?? null,
      payload: structuredClone(input.payload) as BackgroundTaskPayload,
      taskState: structuredClone(
        input.taskState ?? null
      ) as BackgroundTaskState | null,
      resultSummary: resolveTaskResultSummary({
        taskState: input.taskState,
        fallback: null
      }),
      lastError: null,
      availableAt: input.availableAt ?? null,
      deadlineAt: input.deadlineAt ?? null,
      attemptCount: 0,
      maxAttempts: Math.max(1, Math.floor(input.maxAttempts ?? 1)),
      cancelRequested: false,
      activeRunId: null,
      claimedBy: null,
      claimedAt: null,
      lastHeartbeatAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now
    };
    this.tasks.set(task.taskId, task);
    return cloneTask(task);
  }

  async claimNextTask(workerId: string): Promise<BackgroundTaskClaim | null> {
    const now = new Date().toISOString();
    const nextTask = [...this.tasks.values()]
      .filter((task) => task.status === "queued" && isTaskAvailable(task, now))
      .sort(compareAvailableTasks)[0];

    if (!nextTask) {
      return null;
    }

    const runId = randomUUID();
    const claimedTask: BackgroundTaskRecord = {
      ...nextTask,
      status: "claimed",
      activeRunId: runId,
      attemptCount: nextTask.attemptCount + 1,
      claimedBy: workerId,
      claimedAt: now,
      lastHeartbeatAt: now,
      availableAt: null,
      updatedAt: now
    };
    const run: BackgroundTaskRunRecord = {
      runId,
      taskId: claimedTask.taskId,
      status: "claimed",
      workerId,
      errorSummary: null,
      resultSummary: null,
      startedAt: now,
      finishedAt: null,
      lastHeartbeatAt: now,
      createdAt: now,
      updatedAt: now
    };
    this.tasks.set(claimedTask.taskId, claimedTask);
    this.runs.set(runId, run);
    return buildClaim(claimedTask, run);
  }

  async heartbeatTask(
    input: TaskClaimInput
  ): Promise<BackgroundTaskClaim | null> {
    const task = this.tasks.get(input.taskId);
    const run = this.runs.get(input.runId);
    if (!task || !run || task.activeRunId !== input.runId) {
      return null;
    }
    requireActiveTaskStatus(
      task,
      ["claimed", "running", "cancelling"],
      "heartbeat"
    );
    const now = new Date().toISOString();
    const nextTask = {
      ...task,
      lastHeartbeatAt: now,
      updatedAt: now
    };
    const nextRun = {
      ...run,
      lastHeartbeatAt: now,
      updatedAt: now
    };
    this.tasks.set(task.taskId, nextTask);
    this.runs.set(run.runId, nextRun);
    return buildClaim(nextTask, nextRun);
  }

  async markTaskRunning(input: TaskClaimInput): Promise<BackgroundTaskClaim> {
    const task = this.tasks.get(input.taskId);
    const run = this.runs.get(input.runId);
    if (!task || !run || task.activeRunId !== input.runId) {
      throw new Error(`Unknown active task claim for ${input.taskId}.`);
    }
    requireActiveTaskStatus(task, ["claimed"], "mark running");
    const now = new Date().toISOString();
    const nextTask = {
      ...task,
      status: "running" as const,
      claimedBy: input.workerId,
      lastHeartbeatAt: now,
      updatedAt: now
    };
    const nextRun = {
      ...run,
      status: "running" as const,
      workerId: input.workerId,
      lastHeartbeatAt: now,
      updatedAt: now
    };
    this.tasks.set(task.taskId, nextTask);
    this.runs.set(run.runId, nextRun);
    return buildClaim(nextTask, nextRun);
  }

  async markTaskWaitingForInput(
    input: TaskWaitingForInputInput
  ): Promise<BackgroundTaskClaim> {
    const task = this.tasks.get(input.taskId);
    const run = this.runs.get(input.runId);
    if (!task || !run || task.activeRunId !== input.runId) {
      throw new Error(`Unknown active task claim for ${input.taskId}.`);
    }
    requireActiveTaskStatus(
      task,
      ["claimed", "running", "cancelling"],
      "mark waiting for input"
    );
    const now = new Date().toISOString();
    const nextTask = finishTaskClaim(
      {
        ...task,
        status: "waiting_for_input",
        taskState: structuredClone(input.taskState ?? task.taskState ?? null),
        resultSummary: resolveTaskResultSummary({
          taskState: input.taskState ?? task.taskState ?? null,
          fallback: input.resultSummary ?? task.resultSummary
        })
      },
      now
    );
    const nextRun = finishRun(run, "waiting_for_input", now, {
      resultSummary: resolveTaskResultSummary({
        taskState: input.taskState ?? task.taskState ?? null,
        fallback: input.resultSummary ?? run.resultSummary
      })
    });
    this.tasks.set(task.taskId, nextTask);
    this.runs.set(run.runId, nextRun);
    return buildClaim(nextTask, nextRun);
  }

  async markTaskWaitingForMainAgent(
    input: TaskWaitingForMainAgentInput
  ): Promise<BackgroundTaskClaim> {
    const task = this.tasks.get(input.taskId);
    const run = this.runs.get(input.runId);
    if (!task || !run || task.activeRunId !== input.runId) {
      throw new Error(`Unknown active task claim for ${input.taskId}.`);
    }
    requireActiveTaskStatus(
      task,
      ["claimed", "running", "cancelling"],
      "mark waiting for main agent"
    );
    const now = new Date().toISOString();
    const nextTask = finishTaskClaim(
      {
        ...task,
        status: "waiting_for_main_agent",
        taskState: structuredClone(input.taskState ?? task.taskState ?? null),
        resultSummary: resolveTaskResultSummary({
          taskState: input.taskState ?? task.taskState ?? null,
          fallback: input.resultSummary ?? task.resultSummary
        })
      },
      now
    );
    const nextRun = finishRun(run, "waiting_for_main_agent", now, {
      resultSummary: resolveTaskResultSummary({
        taskState: input.taskState ?? task.taskState ?? null,
        fallback: input.resultSummary ?? run.resultSummary
      })
    });
    this.tasks.set(task.taskId, nextTask);
    this.runs.set(run.runId, nextRun);
    return buildClaim(nextTask, nextRun);
  }

  async completeTask(input: CompleteTaskInput): Promise<BackgroundTaskClaim> {
    const task = this.tasks.get(input.taskId);
    const run = this.runs.get(input.runId);
    if (!task || !run || task.activeRunId !== input.runId) {
      throw new Error(`Unknown active task claim for ${input.taskId}.`);
    }
    requireActiveTaskStatus(
      task,
      ["claimed", "running", "cancelling"],
      "complete"
    );
    const now = new Date().toISOString();
    const nextTask = {
      ...finishTaskClaim(
        {
          ...task,
          status: "completed",
          taskState: structuredClone(input.taskState ?? task.taskState ?? null),
          resultSummary: resolveTaskResultSummary({
            taskState: input.taskState ?? task.taskState ?? null,
            fallback: input.resultSummary ?? task.resultSummary
          }),
          completedAt: now
        },
        now
      ),
      completedAt: now
    };
    const nextRun = finishRun(run, "completed", now, {
      resultSummary: resolveTaskResultSummary({
        taskState: input.taskState ?? task.taskState ?? null,
        fallback: input.resultSummary ?? run.resultSummary
      }),
      errorSummary: null
    });
    this.tasks.set(task.taskId, nextTask);
    this.runs.set(run.runId, nextRun);
    return buildClaim(nextTask, nextRun);
  }

  async failTask(input: FailTaskInput): Promise<BackgroundTaskClaim> {
    const task = this.tasks.get(input.taskId);
    const run = this.runs.get(input.runId);
    if (!task || !run || task.activeRunId !== input.runId) {
      throw new Error(`Unknown active task claim for ${input.taskId}.`);
    }
    requireActiveTaskStatus(task, ["claimed", "running", "cancelling"], "fail");
    const now = new Date().toISOString();
    const nextTask = {
      ...finishTaskClaim(
        {
          ...task,
          status: "failed",
          taskState: structuredClone(input.taskState ?? task.taskState ?? null),
          lastError: input.errorSummary,
          resultSummary: resolveTaskResultSummary({
            taskState: input.taskState ?? task.taskState ?? null,
            fallback: input.resultSummary ?? task.resultSummary
          }),
          completedAt: now
        },
        now
      ),
      completedAt: now
    };
    const nextRun = finishRun(run, "failed", now, {
      errorSummary: input.errorSummary,
      resultSummary: resolveTaskResultSummary({
        taskState: input.taskState ?? task.taskState ?? null,
        fallback: input.resultSummary ?? run.resultSummary
      })
    });
    this.tasks.set(task.taskId, nextTask);
    this.runs.set(run.runId, nextRun);
    return buildClaim(nextTask, nextRun);
  }

  async requestCancel(taskId: string): Promise<BackgroundTaskRecord | null> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }
    if (
      task.status === "cancelled" ||
      task.status === "completed" ||
      task.status === "failed"
    ) {
      return cloneTask(task);
    }

    const now = new Date().toISOString();
    if (task.status === "queued") {
      const cancelledTask = {
        ...task,
        status: "cancelled" as const,
        cancelRequested: false,
        completedAt: now,
        updatedAt: now
      };
      this.tasks.set(task.taskId, cancelledTask);
      return cloneTask(cancelledTask);
    }

    const nextTask = {
      ...task,
      status: "cancelling" as const,
      cancelRequested: true,
      updatedAt: now
    };
    this.tasks.set(task.taskId, nextTask);
    return cloneTask(nextTask);
  }

  async cancelTask(input: CancelTaskInput): Promise<BackgroundTaskClaim> {
    const task = this.tasks.get(input.taskId);
    const run = this.runs.get(input.runId);
    if (!task || !run || task.activeRunId !== input.runId) {
      throw new Error(`Unknown active task claim for ${input.taskId}.`);
    }
    requireActiveTaskStatus(
      task,
      ["claimed", "running", "cancelling"],
      "cancel"
    );
    const now = new Date().toISOString();
    const nextTask = {
      ...finishTaskClaim(
        {
          ...task,
          status: "cancelled",
          taskState: structuredClone(input.taskState ?? task.taskState ?? null),
          resultSummary: resolveTaskResultSummary({
            taskState: input.taskState ?? task.taskState ?? null,
            fallback: input.resultSummary ?? task.resultSummary
          }),
          completedAt: now
        },
        now
      ),
      completedAt: now
    };
    const nextRun = finishRun(run, "cancelled", now, {
      resultSummary: resolveTaskResultSummary({
        taskState: input.taskState ?? task.taskState ?? null,
        fallback: input.resultSummary ?? run.resultSummary
      }),
      errorSummary: null
    });
    this.tasks.set(task.taskId, nextTask);
    this.runs.set(run.runId, nextRun);
    return buildClaim(nextTask, nextRun);
  }

  async rescheduleQueuedTask(
    input: RescheduleQueuedTaskInput
  ): Promise<BackgroundTaskRecord> {
    const task = this.tasks.get(input.taskId);
    if (!task) {
      throw new Error(`Unknown task: ${input.taskId}`);
    }
    requireActiveTaskStatus(task, ["queued"], "reschedule queued");

    const now = new Date().toISOString();
    const nextTask: BackgroundTaskRecord = {
      ...task,
      payload: structuredClone(
        input.payload ?? task.payload
      ) as BackgroundTaskPayload,
      resultSummary:
        typeof input.resultSummary === "string" || input.resultSummary === null
          ? input.resultSummary
          : task.resultSummary,
      lastError:
        typeof input.lastError === "string" || input.lastError === null
          ? input.lastError
          : task.lastError,
      availableAt:
        typeof input.availableAt === "string" || input.availableAt === null
          ? input.availableAt
          : task.availableAt,
      deadlineAt:
        typeof input.deadlineAt === "string" || input.deadlineAt === null
          ? input.deadlineAt
          : task.deadlineAt,
      updatedAt: now
    };
    this.tasks.set(task.taskId, nextTask);
    return cloneTask(nextTask);
  }

  async requeueTask(
    input: RequeueExistingTaskInput
  ): Promise<BackgroundTaskRecord> {
    const task = this.tasks.get(input.taskId);
    if (!task) {
      throw new Error(`Unknown task: ${input.taskId}`);
    }
    if (
      task.status === "queued" ||
      task.status === "claimed" ||
      task.status === "running" ||
      task.status === "cancelling"
    ) {
      throw new Error(`Task ${task.taskId} is already active.`);
    }

    const now = new Date().toISOString();
    const nextTask: BackgroundTaskRecord = {
      ...task,
      status: "queued",
      payload: structuredClone(
        input.payload ?? task.payload
      ) as BackgroundTaskPayload,
      taskState: structuredClone(input.taskState ?? task.taskState ?? null),
      resultSummary: resolveTaskResultSummary({
        taskState: input.taskState ?? task.taskState ?? null,
        fallback: input.resultSummary ?? task.resultSummary
      }),
      lastError:
        typeof input.lastError === "string" || input.lastError === null
          ? input.lastError
          : task.lastError,
      availableAt:
        typeof input.availableAt === "string" || input.availableAt === null
          ? input.availableAt
          : null,
      deadlineAt:
        typeof input.deadlineAt === "string" || input.deadlineAt === null
          ? input.deadlineAt
          : task.deadlineAt,
      attemptCount: 0,
      maxAttempts: Math.max(
        1,
        Math.floor(input.maxAttempts ?? task.maxAttempts)
      ),
      cancelRequested: false,
      activeRunId: null,
      claimedBy: null,
      claimedAt: null,
      lastHeartbeatAt: null,
      completedAt: null,
      updatedAt: now
    };
    this.tasks.set(task.taskId, nextTask);
    return cloneTask(nextTask);
  }

  async requeueStaleClaims(
    staleBefore: string
  ): Promise<BackgroundTaskRecord[]> {
    const changedTasks: BackgroundTaskRecord[] = [];
    const now = new Date().toISOString();
    for (const task of this.tasks.values()) {
      if (
        task.status !== "claimed" &&
        task.status !== "running" &&
        task.status !== "cancelling"
      ) {
        continue;
      }
      const heartbeat =
        task.lastHeartbeatAt ?? task.claimedAt ?? task.updatedAt;
      if (heartbeat > staleBefore) {
        continue;
      }

      const shouldRetry = task.attemptCount < task.maxAttempts;
      const nextTask: BackgroundTaskRecord = {
        ...task,
        status: shouldRetry ? "queued" : "failed",
        cancelRequested: false,
        activeRunId: null,
        claimedBy: null,
        claimedAt: null,
        lastHeartbeatAt: null,
        lastError: shouldRetry
          ? task.lastError
          : "Worker claim expired before completion.",
        completedAt: shouldRetry ? null : now,
        updatedAt: now
      };
      this.tasks.set(task.taskId, nextTask);
      if (task.activeRunId) {
        const run = this.runs.get(task.activeRunId);
        if (run) {
          this.runs.set(
            run.runId,
            finishRun(run, "failed", now, {
              errorSummary: "Worker claim expired before completion."
            })
          );
        }
      }
      changedTasks.push(cloneTask(nextTask));
    }
    return changedTasks;
  }
}

export function createMemoryBackgroundTaskRepository(): MemoryBackgroundTaskRepository {
  return new MemoryBackgroundTaskRepository();
}
