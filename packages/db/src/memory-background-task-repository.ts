import { randomUUID } from "node:crypto";

import type {
  BackgroundTaskClaim,
  BackgroundTaskPayload,
  BackgroundTaskRecord,
  BackgroundTaskRunRecord,
  BackgroundTaskState
} from "@ai-app-template/domain";

import {
  buildCancelRequestTask,
  buildClaim,
  buildClaimedTaskAndRun,
  buildFinishedTaskClaim,
  buildHeartbeatTaskClaim,
  buildRequeuedTask,
  buildRescheduledQueuedTask,
  buildRunningTaskClaim,
  buildStaleClaimTransition,
  buildWaitingTaskClaim,
  cloneRun,
  cloneTask,
  compareAvailableTasks,
  isTaskAvailable,
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
    const claim = buildClaimedTaskAndRun({
      task: nextTask,
      runId,
      workerId,
      now
    });
    this.tasks.set(claim.task.taskId, claim.task);
    this.runs.set(runId, claim.run);
    return buildClaim(claim.task, claim.run);
  }

  async heartbeatTask(
    input: TaskClaimInput
  ): Promise<BackgroundTaskClaim | null> {
    const task = this.tasks.get(input.taskId);
    const run = this.runs.get(input.runId);
    if (!task || !run || task.activeRunId !== input.runId) {
      return null;
    }
    const now = new Date().toISOString();
    const claim = buildHeartbeatTaskClaim({
      claim: { task, run },
      now
    });
    this.tasks.set(task.taskId, claim.task);
    this.runs.set(run.runId, claim.run);
    return buildClaim(claim.task, claim.run);
  }

  async markTaskRunning(input: TaskClaimInput): Promise<BackgroundTaskClaim> {
    const task = this.tasks.get(input.taskId);
    const run = this.runs.get(input.runId);
    if (!task || !run || task.activeRunId !== input.runId) {
      throw new Error(`Unknown active task claim for ${input.taskId}.`);
    }
    const now = new Date().toISOString();
    const claim = buildRunningTaskClaim({
      claim: { task, run },
      workerId: input.workerId,
      now
    });
    this.tasks.set(task.taskId, claim.task);
    this.runs.set(run.runId, claim.run);
    return buildClaim(claim.task, claim.run);
  }

  async markTaskWaitingForInput(
    input: TaskWaitingForInputInput
  ): Promise<BackgroundTaskClaim> {
    const task = this.tasks.get(input.taskId);
    const run = this.runs.get(input.runId);
    if (!task || !run || task.activeRunId !== input.runId) {
      throw new Error(`Unknown active task claim for ${input.taskId}.`);
    }
    const now = new Date().toISOString();
    const claim = buildWaitingTaskClaim(
      { task, run },
      input,
      now,
      "waiting_for_input"
    );
    this.tasks.set(task.taskId, claim.task);
    this.runs.set(run.runId, claim.run);
    return buildClaim(claim.task, claim.run);
  }

  async markTaskWaitingForMainAgent(
    input: TaskWaitingForMainAgentInput
  ): Promise<BackgroundTaskClaim> {
    const task = this.tasks.get(input.taskId);
    const run = this.runs.get(input.runId);
    if (!task || !run || task.activeRunId !== input.runId) {
      throw new Error(`Unknown active task claim for ${input.taskId}.`);
    }
    const now = new Date().toISOString();
    const claim = buildWaitingTaskClaim(
      { task, run },
      input,
      now,
      "waiting_for_main_agent"
    );
    this.tasks.set(task.taskId, claim.task);
    this.runs.set(run.runId, claim.run);
    return buildClaim(claim.task, claim.run);
  }

  async completeTask(input: CompleteTaskInput): Promise<BackgroundTaskClaim> {
    const task = this.tasks.get(input.taskId);
    const run = this.runs.get(input.runId);
    if (!task || !run || task.activeRunId !== input.runId) {
      throw new Error(`Unknown active task claim for ${input.taskId}.`);
    }
    const now = new Date().toISOString();
    const claim = buildFinishedTaskClaim({ task, run }, input, now, "completed");
    this.tasks.set(task.taskId, claim.task);
    this.runs.set(run.runId, claim.run);
    return buildClaim(claim.task, claim.run);
  }

  async failTask(input: FailTaskInput): Promise<BackgroundTaskClaim> {
    const task = this.tasks.get(input.taskId);
    const run = this.runs.get(input.runId);
    if (!task || !run || task.activeRunId !== input.runId) {
      throw new Error(`Unknown active task claim for ${input.taskId}.`);
    }
    const now = new Date().toISOString();
    const claim = buildFinishedTaskClaim({ task, run }, input, now, "failed");
    this.tasks.set(task.taskId, claim.task);
    this.runs.set(run.runId, claim.run);
    return buildClaim(claim.task, claim.run);
  }

  async requestCancel(taskId: string): Promise<BackgroundTaskRecord | null> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }
    const now = new Date().toISOString();
    const nextTask = buildCancelRequestTask(task, now);
    this.tasks.set(task.taskId, nextTask);
    return cloneTask(nextTask);
  }

  async cancelTask(input: CancelTaskInput): Promise<BackgroundTaskClaim> {
    const task = this.tasks.get(input.taskId);
    const run = this.runs.get(input.runId);
    if (!task || !run || task.activeRunId !== input.runId) {
      throw new Error(`Unknown active task claim for ${input.taskId}.`);
    }
    const now = new Date().toISOString();
    const claim = buildFinishedTaskClaim({ task, run }, input, now, "cancelled");
    this.tasks.set(task.taskId, claim.task);
    this.runs.set(run.runId, claim.run);
    return buildClaim(claim.task, claim.run);
  }

  async rescheduleQueuedTask(
    input: RescheduleQueuedTaskInput
  ): Promise<BackgroundTaskRecord> {
    const task = this.tasks.get(input.taskId);
    if (!task) {
      throw new Error(`Unknown task: ${input.taskId}`);
    }
    const now = new Date().toISOString();
    const nextTask = buildRescheduledQueuedTask(task, input, now);
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
    const now = new Date().toISOString();
    const nextTask = buildRequeuedTask(task, input, now);
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

      const run = task.activeRunId ? this.runs.get(task.activeRunId) : null;
      const transition = buildStaleClaimTransition({ task, run, now });
      const nextTask = transition.task;
      this.tasks.set(task.taskId, nextTask);
      if (transition.run) {
        this.runs.set(transition.run.runId, transition.run);
      }
      changedTasks.push(cloneTask(nextTask));
    }
    return changedTasks;
  }
}

export function createMemoryBackgroundTaskRepository(): MemoryBackgroundTaskRepository {
  return new MemoryBackgroundTaskRepository();
}
