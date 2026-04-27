import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type {
  BackgroundTaskClaim,
  BackgroundTaskPayload,
  BackgroundTaskRecord,
  BackgroundTaskRunRecord,
  BackgroundTaskStatus,
  DelegateTaskCard
} from "@ai-app-template/domain";

import { backgroundTaskRuns, backgroundTasks } from "./schema.js";
import type { ProductDatabaseClient } from "./client.js";

type BackgroundTaskRow = typeof backgroundTasks.$inferSelect;
type BackgroundTaskRunRow = typeof backgroundTaskRuns.$inferSelect;

export interface EnqueueBackgroundTaskInput {
  kind: BackgroundTaskRecord["kind"];
  parentSessionId?: string | null;
  childSessionId: string;
  payload: BackgroundTaskPayload;
  taskCard?: DelegateTaskCard | null;
  availableAt?: string | null;
  deadlineAt?: string | null;
  maxAttempts?: number;
}

export interface TaskClaimInput {
  taskId: string;
  runId: string;
  workerId: string;
}

export interface TaskWaitingForInputInput extends TaskClaimInput {
  resultSummary?: string | null;
  taskCard?: DelegateTaskCard | null;
}

export interface TaskWaitingForMainAgentInput extends TaskClaimInput {
  resultSummary?: string | null;
  taskCard?: DelegateTaskCard | null;
}

export interface CompleteTaskInput extends TaskClaimInput {
  resultSummary?: string | null;
  taskCard?: DelegateTaskCard | null;
}

export interface FailTaskInput extends TaskClaimInput {
  errorSummary: string;
  resultSummary?: string | null;
  taskCard?: DelegateTaskCard | null;
}

export interface CancelTaskInput extends TaskClaimInput {
  resultSummary?: string | null;
  taskCard?: DelegateTaskCard | null;
}

export interface RequeueExistingTaskInput {
  taskId: string;
  payload?: BackgroundTaskPayload;
  taskCard?: DelegateTaskCard | null;
  resultSummary?: string | null;
  lastError?: string | null;
  availableAt?: string | null;
  deadlineAt?: string | null;
  maxAttempts?: number;
}

export interface RescheduleQueuedTaskInput {
  taskId: string;
  payload?: BackgroundTaskPayload;
  resultSummary?: string | null;
  lastError?: string | null;
  availableAt?: string | null;
  deadlineAt?: string | null;
}

export interface BackgroundTaskRepository {
  getTask(taskId: string): Promise<BackgroundTaskRecord | null>;
  listTasks(): Promise<BackgroundTaskRecord[]>;
  getWakeupTaskBySessionId(sessionId: string): Promise<BackgroundTaskRecord | null>;
  getRun(runId: string): Promise<BackgroundTaskRunRecord | null>;
  enqueueTask(input: EnqueueBackgroundTaskInput): Promise<BackgroundTaskRecord>;
  claimNextTask(workerId: string): Promise<BackgroundTaskClaim | null>;
  heartbeatTask(input: TaskClaimInput): Promise<BackgroundTaskClaim | null>;
  markTaskRunning(input: TaskClaimInput): Promise<BackgroundTaskClaim>;
  markTaskWaitingForInput(
    input: TaskWaitingForInputInput
  ): Promise<BackgroundTaskClaim>;
  markTaskWaitingForMainAgent(
    input: TaskWaitingForMainAgentInput
  ): Promise<BackgroundTaskClaim>;
  completeTask(input: CompleteTaskInput): Promise<BackgroundTaskClaim>;
  failTask(input: FailTaskInput): Promise<BackgroundTaskClaim>;
  requestCancel(taskId: string): Promise<BackgroundTaskRecord | null>;
  cancelTask(input: CancelTaskInput): Promise<BackgroundTaskClaim>;
  rescheduleQueuedTask(input: RescheduleQueuedTaskInput): Promise<BackgroundTaskRecord>;
  requeueTask(input: RequeueExistingTaskInput): Promise<BackgroundTaskRecord>;
  requeueStaleClaims(staleBefore: string): Promise<BackgroundTaskRecord[]>;
}

function toIsoString(value: string): string {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const tzMatch = normalized.match(/([+-]\d{2})(\d{2})?$/);
  const hasExplicitTimeZone =
    normalized.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(normalized) || tzMatch;
  const parsedValue = tzMatch
    ? normalized.replace(
        /([+-]\d{2})(\d{2})?$/,
        (_, hours: string, minutes?: string) => `${hours}:${minutes ?? "00"}`
      )
    : normalized;

  return new Date(
    hasExplicitTimeZone ? parsedValue : `${normalized}Z`
  ).toISOString();
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function mapTaskRow(row: BackgroundTaskRow): BackgroundTaskRecord {
  return {
    taskId: row.id,
    kind: row.kind,
    status: row.status,
    executor: row.executor as BackgroundTaskRecord["executor"],
    parentSessionId: row.parentSessionId,
    childSessionId: row.childSessionId,
    payload: parseJsonValue(row.payload) as BackgroundTaskPayload,
    taskCard: parseJsonValue(row.taskCard) as DelegateTaskCard | null,
    resultSummary: row.resultSummary,
    lastError: row.lastError,
    availableAt: row.availableAt ? toIsoString(row.availableAt) : null,
    deadlineAt: row.deadlineAt ? toIsoString(row.deadlineAt) : null,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    cancelRequested: row.cancelRequested,
    activeRunId: row.activeRunId,
    claimedBy: row.claimedBy,
    claimedAt: row.claimedAt ? toIsoString(row.claimedAt) : null,
    lastHeartbeatAt: row.lastHeartbeatAt
      ? toIsoString(row.lastHeartbeatAt)
      : null,
    completedAt: row.completedAt ? toIsoString(row.completedAt) : null,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function mapRunRow(row: BackgroundTaskRunRow): BackgroundTaskRunRecord {
  return {
    runId: row.runId,
    taskId: row.taskId,
    status: row.status,
    workerId: row.workerId,
    errorSummary: row.errorSummary,
    resultSummary: row.resultSummary,
    startedAt: toIsoString(row.startedAt),
    finishedAt: row.finishedAt ? toIsoString(row.finishedAt) : null,
    lastHeartbeatAt: row.lastHeartbeatAt
      ? toIsoString(row.lastHeartbeatAt)
      : null,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function buildClaim(
  task: BackgroundTaskRecord,
  run: BackgroundTaskRunRecord
): BackgroundTaskClaim {
  return {
    task: structuredClone(task) as BackgroundTaskRecord,
    run: structuredClone(run) as BackgroundTaskRunRecord
  };
}

function requireActiveTaskStatus(
  task: BackgroundTaskRecord,
  allowed: BackgroundTaskStatus[],
  action: string
): void {
  if (!allowed.includes(task.status)) {
    throw new Error(
      `Cannot ${action} task ${task.taskId} while status is ${task.status}.`
    );
  }
}

function cloneTask(task: BackgroundTaskRecord): BackgroundTaskRecord {
  return structuredClone(task) as BackgroundTaskRecord;
}

function cloneRun(run: BackgroundTaskRunRecord): BackgroundTaskRunRecord {
  return structuredClone(run) as BackgroundTaskRunRecord;
}

function finishTaskClaim(
  task: BackgroundTaskRecord,
  now: string
): BackgroundTaskRecord {
  return {
    ...task,
    activeRunId: null,
    claimedBy: null,
    claimedAt: null,
    lastHeartbeatAt: null,
    cancelRequested: false,
    updatedAt: now
  };
}

function finishRun(
  run: BackgroundTaskRunRecord,
  status: BackgroundTaskStatus,
  now: string,
  patch: {
    errorSummary?: string | null;
    resultSummary?: string | null;
  } = {}
): BackgroundTaskRunRecord {
  return {
    ...run,
    status,
    errorSummary:
      typeof patch.errorSummary === "string" || patch.errorSummary === null
        ? patch.errorSummary
        : run.errorSummary,
    resultSummary:
      typeof patch.resultSummary === "string" || patch.resultSummary === null
        ? patch.resultSummary
        : run.resultSummary,
    finishedAt: now,
    lastHeartbeatAt: now,
    updatedAt: now
  };
}

function resolveTaskResultSummary(input: {
  taskCard?: DelegateTaskCard | null | undefined;
  fallback?: string | null;
}): string | null {
  return input.taskCard?.latestResponse?.summary ?? input.fallback ?? null;
}

function isTaskAvailable(task: BackgroundTaskRecord, now: string): boolean {
  return !task.availableAt || task.availableAt <= now;
}

function compareAvailableTasks(
  left: BackgroundTaskRecord,
  right: BackgroundTaskRecord
): number {
  const leftAvailableAt = left.availableAt ?? left.createdAt;
  const rightAvailableAt = right.availableAt ?? right.createdAt;
  const availableCompare = leftAvailableAt.localeCompare(rightAvailableAt);
  return availableCompare === 0
    ? left.createdAt.localeCompare(right.createdAt)
    : availableCompare;
}

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
      childSessionId: input.childSessionId,
      payload: structuredClone(input.payload) as BackgroundTaskPayload,
      taskCard: structuredClone(input.taskCard ?? null) as DelegateTaskCard | null,
      resultSummary: resolveTaskResultSummary({
        taskCard: input.taskCard,
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

  async heartbeatTask(input: TaskClaimInput): Promise<BackgroundTaskClaim | null> {
    const task = this.tasks.get(input.taskId);
    const run = this.runs.get(input.runId);
    if (!task || !run || task.activeRunId !== input.runId) {
      return null;
    }
    requireActiveTaskStatus(task, ["claimed", "running", "cancelling"], "heartbeat");
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
        taskCard: structuredClone(input.taskCard ?? task.taskCard ?? null),
        resultSummary: resolveTaskResultSummary({
          taskCard: input.taskCard ?? task.taskCard ?? null,
          fallback: input.resultSummary ?? task.resultSummary
        })
      },
      now
    );
    const nextRun = finishRun(run, "waiting_for_input", now, {
      resultSummary: resolveTaskResultSummary({
        taskCard: input.taskCard ?? task.taskCard ?? null,
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
        taskCard: structuredClone(input.taskCard ?? task.taskCard ?? null),
        resultSummary: resolveTaskResultSummary({
          taskCard: input.taskCard ?? task.taskCard ?? null,
          fallback: input.resultSummary ?? task.resultSummary
        })
      },
      now
    );
    const nextRun = finishRun(run, "waiting_for_main_agent", now, {
      resultSummary: resolveTaskResultSummary({
        taskCard: input.taskCard ?? task.taskCard ?? null,
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
          taskCard: structuredClone(input.taskCard ?? task.taskCard ?? null),
          resultSummary: resolveTaskResultSummary({
            taskCard: input.taskCard ?? task.taskCard ?? null,
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
        taskCard: input.taskCard ?? task.taskCard ?? null,
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
          taskCard: structuredClone(input.taskCard ?? task.taskCard ?? null),
          lastError: input.errorSummary,
          resultSummary: resolveTaskResultSummary({
            taskCard: input.taskCard ?? task.taskCard ?? null,
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
        taskCard: input.taskCard ?? task.taskCard ?? null,
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
          taskCard: structuredClone(input.taskCard ?? task.taskCard ?? null),
          resultSummary: resolveTaskResultSummary({
            taskCard: input.taskCard ?? task.taskCard ?? null,
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
        taskCard: input.taskCard ?? task.taskCard ?? null,
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
      payload: structuredClone(input.payload ?? task.payload) as BackgroundTaskPayload,
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
      payload: structuredClone(input.payload ?? task.payload) as BackgroundTaskPayload,
      taskCard: structuredClone(input.taskCard ?? task.taskCard ?? null),
      resultSummary: resolveTaskResultSummary({
        taskCard: input.taskCard ?? task.taskCard ?? null,
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
      maxAttempts: Math.max(1, Math.floor(input.maxAttempts ?? task.maxAttempts)),
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
      const heartbeat = task.lastHeartbeatAt ?? task.claimedAt ?? task.updatedAt;
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

export class PostgresBackgroundTaskRepository
  implements BackgroundTaskRepository
{
  constructor(private readonly db: ProductDatabaseClient) {}

  async getTask(taskId: string): Promise<BackgroundTaskRecord | null> {
    const rows = await this.db
      .select()
      .from(backgroundTasks)
      .where(eq(backgroundTasks.id, taskId))
      .limit(1);
    return rows[0] ? mapTaskRow(rows[0]) : null;
  }

  async listTasks(): Promise<BackgroundTaskRecord[]> {
    const rows = await this.db
      .select()
      .from(backgroundTasks)
      .orderBy(desc(backgroundTasks.updatedAt));
    return rows.map(mapTaskRow);
  }

  async getWakeupTaskBySessionId(
    sessionId: string
  ): Promise<BackgroundTaskRecord | null> {
    const rows = await this.db
      .select()
      .from(backgroundTasks)
      .where(
        and(
          eq(backgroundTasks.kind, "session_wakeup"),
          eq(backgroundTasks.childSessionId, sessionId)
        )
      )
      .orderBy(desc(backgroundTasks.updatedAt))
      .limit(1);
    return rows[0] ? mapTaskRow(rows[0]) : null;
  }

  async getRun(runId: string): Promise<BackgroundTaskRunRecord | null> {
    const rows = await this.db
      .select()
      .from(backgroundTaskRuns)
      .where(eq(backgroundTaskRuns.runId, runId))
      .limit(1);
    return rows[0] ? mapRunRow(rows[0]) : null;
  }

  async enqueueTask(
    input: EnqueueBackgroundTaskInput
  ): Promise<BackgroundTaskRecord> {
    const now = new Date().toISOString();
    const rows = await this.db
      .insert(backgroundTasks)
      .values({
        id: randomUUID(),
        kind: input.kind,
        status: "queued",
        executor: input.payload.executor,
        parentSessionId: input.parentSessionId ?? null,
        childSessionId: input.childSessionId,
        payload: input.payload,
        taskCard: input.taskCard ?? null,
        resultSummary: resolveTaskResultSummary({
          taskCard: input.taskCard,
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
      })
      .returning();
    return mapTaskRow(rows[0]!);
  }

  async claimNextTask(workerId: string): Promise<BackgroundTaskClaim | null> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const now = new Date().toISOString();
      const candidateRows = await this.db
        .select()
        .from(backgroundTasks)
        .where(
          and(
            eq(backgroundTasks.status, "queued"),
            or(isNull(backgroundTasks.availableAt), lte(backgroundTasks.availableAt, now))
          )
        )
        .orderBy(
          asc(sql`coalesce(${backgroundTasks.availableAt}, ${backgroundTasks.createdAt})`),
          asc(backgroundTasks.createdAt)
        )
        .limit(1);
      const candidate = candidateRows[0];
      if (!candidate) {
        return null;
      }

      const runId = randomUUID();
      const claimedRows = await this.db
        .update(backgroundTasks)
        .set({
          status: "claimed",
          activeRunId: runId,
          attemptCount: (candidate.attemptCount ?? 0) + 1,
          claimedBy: workerId,
          claimedAt: now,
          lastHeartbeatAt: now,
          availableAt: null,
          updatedAt: now
        })
        .where(
          and(
            eq(backgroundTasks.id, candidate.id),
            eq(backgroundTasks.status, "queued")
          )
        )
        .returning();
      if (claimedRows.length === 0) {
        continue;
      }

      const runRows = await this.db
        .insert(backgroundTaskRuns)
        .values({
          id: randomUUID(),
          taskId: candidate.id,
          runId,
          status: "claimed",
          workerId,
          errorSummary: null,
          resultSummary: null,
          startedAt: now,
          finishedAt: null,
          lastHeartbeatAt: now,
          createdAt: now,
          updatedAt: now
        })
        .returning();
      return buildClaim(mapTaskRow(claimedRows[0]!), mapRunRow(runRows[0]!));
    }

    return null;
  }

  async heartbeatTask(input: TaskClaimInput): Promise<BackgroundTaskClaim | null> {
    const existing = await this.loadClaim(input.taskId, input.runId);
    if (!existing || existing.task.activeRunId !== input.runId) {
      return null;
    }
    requireActiveTaskStatus(
      existing.task,
      ["claimed", "running", "cancelling"],
      "heartbeat"
    );
    const now = new Date().toISOString();
    return this.persistTaskAndRun(
      {
        ...existing.task,
        lastHeartbeatAt: now,
        updatedAt: now
      },
      {
        ...existing.run,
        lastHeartbeatAt: now,
        updatedAt: now
      }
    );
  }

  async markTaskRunning(input: TaskClaimInput): Promise<BackgroundTaskClaim> {
    const existing = await this.requireClaim(input.taskId, input.runId);
    requireActiveTaskStatus(existing.task, ["claimed"], "mark running");
    const now = new Date().toISOString();
    return this.persistTaskAndRun(
      {
        ...existing.task,
        status: "running",
        claimedBy: input.workerId,
        lastHeartbeatAt: now,
        updatedAt: now
      },
      {
        ...existing.run,
        status: "running",
        workerId: input.workerId,
        lastHeartbeatAt: now,
        updatedAt: now
      }
    );
  }

  async markTaskWaitingForInput(
    input: TaskWaitingForInputInput
  ): Promise<BackgroundTaskClaim> {
    const existing = await this.requireClaim(input.taskId, input.runId);
    requireActiveTaskStatus(
      existing.task,
      ["claimed", "running", "cancelling"],
      "mark waiting for input"
    );
    const now = new Date().toISOString();
    return this.persistTaskAndRun(
      {
        ...finishTaskClaim(
          {
            ...existing.task,
            status: "waiting_for_input",
            taskCard: structuredClone(input.taskCard ?? existing.task.taskCard ?? null),
            resultSummary: resolveTaskResultSummary({
              taskCard: input.taskCard ?? existing.task.taskCard ?? null,
              fallback: input.resultSummary ?? existing.task.resultSummary
            })
          },
          now
        )
      },
      finishRun(existing.run, "waiting_for_input", now, {
        resultSummary: resolveTaskResultSummary({
          taskCard: input.taskCard ?? existing.task.taskCard ?? null,
          fallback: input.resultSummary ?? existing.run.resultSummary
        })
      })
    );
  }

  async markTaskWaitingForMainAgent(
    input: TaskWaitingForMainAgentInput
  ): Promise<BackgroundTaskClaim> {
    const existing = await this.requireClaim(input.taskId, input.runId);
    requireActiveTaskStatus(
      existing.task,
      ["claimed", "running", "cancelling"],
      "mark waiting for main agent"
    );
    const now = new Date().toISOString();
    return this.persistTaskAndRun(
      {
        ...finishTaskClaim(
          {
            ...existing.task,
            status: "waiting_for_main_agent",
            taskCard: structuredClone(input.taskCard ?? existing.task.taskCard ?? null),
            resultSummary: resolveTaskResultSummary({
              taskCard: input.taskCard ?? existing.task.taskCard ?? null,
              fallback: input.resultSummary ?? existing.task.resultSummary
            })
          },
          now
        )
      },
      finishRun(existing.run, "waiting_for_main_agent", now, {
        resultSummary: resolveTaskResultSummary({
          taskCard: input.taskCard ?? existing.task.taskCard ?? null,
          fallback: input.resultSummary ?? existing.run.resultSummary
        })
      })
    );
  }

  async completeTask(input: CompleteTaskInput): Promise<BackgroundTaskClaim> {
    const existing = await this.requireClaim(input.taskId, input.runId);
    requireActiveTaskStatus(
      existing.task,
      ["claimed", "running", "cancelling"],
      "complete"
    );
    const now = new Date().toISOString();
    return this.persistTaskAndRun(
      {
        ...finishTaskClaim(
          {
            ...existing.task,
            status: "completed",
            taskCard: structuredClone(input.taskCard ?? existing.task.taskCard ?? null),
            resultSummary: resolveTaskResultSummary({
              taskCard: input.taskCard ?? existing.task.taskCard ?? null,
              fallback: input.resultSummary ?? existing.task.resultSummary
            }),
            completedAt: now
          },
          now
        ),
        completedAt: now
      },
      finishRun(existing.run, "completed", now, {
        resultSummary: resolveTaskResultSummary({
          taskCard: input.taskCard ?? existing.task.taskCard ?? null,
          fallback: input.resultSummary ?? existing.run.resultSummary
        }),
        errorSummary: null
      })
    );
  }

  async failTask(input: FailTaskInput): Promise<BackgroundTaskClaim> {
    const existing = await this.requireClaim(input.taskId, input.runId);
    requireActiveTaskStatus(existing.task, ["claimed", "running", "cancelling"], "fail");
    const now = new Date().toISOString();
    return this.persistTaskAndRun(
      {
        ...finishTaskClaim(
          {
            ...existing.task,
            status: "failed",
            taskCard: structuredClone(input.taskCard ?? existing.task.taskCard ?? null),
            lastError: input.errorSummary,
            resultSummary: resolveTaskResultSummary({
              taskCard: input.taskCard ?? existing.task.taskCard ?? null,
              fallback: input.resultSummary ?? existing.task.resultSummary
            }),
            completedAt: now
          },
          now
        ),
        completedAt: now
      },
      finishRun(existing.run, "failed", now, {
        errorSummary: input.errorSummary,
        resultSummary: resolveTaskResultSummary({
          taskCard: input.taskCard ?? existing.task.taskCard ?? null,
          fallback: input.resultSummary ?? existing.run.resultSummary
        })
      })
    );
  }

  async requestCancel(taskId: string): Promise<BackgroundTaskRecord | null> {
    const existing = await this.getTask(taskId);
    if (!existing) {
      return null;
    }
    if (
      existing.status === "cancelled" ||
      existing.status === "completed" ||
      existing.status === "failed"
    ) {
      return existing;
    }

    const now = new Date().toISOString();
    const nextStatus =
      existing.status === "queued" ? "cancelled" : "cancelling";
    const rows = await this.db
      .update(backgroundTasks)
      .set({
        status: nextStatus,
        cancelRequested: nextStatus === "cancelling",
        completedAt: nextStatus === "cancelled" ? now : existing.completedAt,
        updatedAt: now
      })
      .where(eq(backgroundTasks.id, taskId))
      .returning();
    return rows[0] ? mapTaskRow(rows[0]) : null;
  }

  async cancelTask(input: CancelTaskInput): Promise<BackgroundTaskClaim> {
    const existing = await this.requireClaim(input.taskId, input.runId);
    requireActiveTaskStatus(
      existing.task,
      ["claimed", "running", "cancelling"],
      "cancel"
    );
    const now = new Date().toISOString();
    return this.persistTaskAndRun(
      {
        ...finishTaskClaim(
          {
            ...existing.task,
            status: "cancelled",
            taskCard: structuredClone(input.taskCard ?? existing.task.taskCard ?? null),
            resultSummary: resolveTaskResultSummary({
              taskCard: input.taskCard ?? existing.task.taskCard ?? null,
              fallback: input.resultSummary ?? existing.task.resultSummary
            }),
            completedAt: now
          },
          now
        ),
        completedAt: now
      },
      finishRun(existing.run, "cancelled", now, {
        resultSummary: resolveTaskResultSummary({
          taskCard: input.taskCard ?? existing.task.taskCard ?? null,
          fallback: input.resultSummary ?? existing.run.resultSummary
        }),
        errorSummary: null
      })
    );
  }

  async rescheduleQueuedTask(
    input: RescheduleQueuedTaskInput
  ): Promise<BackgroundTaskRecord> {
    const task = await this.getTask(input.taskId);
    if (!task) {
      throw new Error(`Unknown task: ${input.taskId}`);
    }
    requireActiveTaskStatus(task, ["queued"], "reschedule queued");

    const now = new Date().toISOString();
    const rows = await this.db
      .update(backgroundTasks)
      .set({
        payload: input.payload ?? task.payload,
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
      })
      .where(and(eq(backgroundTasks.id, task.taskId), eq(backgroundTasks.status, "queued")))
      .returning();
    if (!rows[0]) {
      throw new Error(`Task ${task.taskId} is no longer queued.`);
    }
    return mapTaskRow(rows[0]);
  }

  async requeueTask(
    input: RequeueExistingTaskInput
  ): Promise<BackgroundTaskRecord> {
    const task = await this.getTask(input.taskId);
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
    const rows = await this.db
      .update(backgroundTasks)
      .set({
        status: "queued",
        payload: input.payload ?? task.payload,
        taskCard: input.taskCard ?? task.taskCard,
        resultSummary: resolveTaskResultSummary({
          taskCard: input.taskCard ?? task.taskCard,
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
      })
      .where(eq(backgroundTasks.id, task.taskId))
      .returning();
    return mapTaskRow(rows[0]!);
  }

  async requeueStaleClaims(
    staleBefore: string
  ): Promise<BackgroundTaskRecord[]> {
    const staleRows = await this.db
      .select()
      .from(backgroundTasks)
      .where(
        and(
          inArray(backgroundTasks.status, ["claimed", "running", "cancelling"]),
          lte(backgroundTasks.lastHeartbeatAt, staleBefore)
        )
      );
    const now = new Date().toISOString();
    const changedTasks: BackgroundTaskRecord[] = [];

    for (const row of staleRows) {
      const task = mapTaskRow(row);
      const shouldRetry = task.attemptCount < task.maxAttempts;
      const updatedRows = await this.db
        .update(backgroundTasks)
        .set({
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
        })
        .where(eq(backgroundTasks.id, task.taskId))
        .returning();
      if (task.activeRunId) {
        await this.db
          .update(backgroundTaskRuns)
          .set({
            status: "failed",
            errorSummary: "Worker claim expired before completion.",
            finishedAt: now,
            lastHeartbeatAt: now,
            updatedAt: now
          })
          .where(eq(backgroundTaskRuns.runId, task.activeRunId));
      }
      if (updatedRows[0]) {
        changedTasks.push(mapTaskRow(updatedRows[0]));
      }
    }

    return changedTasks;
  }

  private async loadClaim(
    taskId: string,
    runId: string
  ): Promise<BackgroundTaskClaim | null> {
    const task = await this.getTask(taskId);
    const run = await this.getRun(runId);
    if (!task || !run) {
      return null;
    }
    return buildClaim(task, run);
  }

  private async requireClaim(
    taskId: string,
    runId: string
  ): Promise<BackgroundTaskClaim> {
    const claim = await this.loadClaim(taskId, runId);
    if (!claim || claim.task.activeRunId !== runId) {
      throw new Error(`Unknown active task claim for ${taskId}.`);
    }
    return claim;
  }

  private async persistTaskAndRun(
    task: BackgroundTaskRecord,
    run: BackgroundTaskRunRecord
  ): Promise<BackgroundTaskClaim> {
    await this.db.transaction(async (tx) => {
      await tx
      .update(backgroundTasks)
      .set({
        status: task.status,
        payload: task.payload,
        taskCard: task.taskCard,
        resultSummary: task.resultSummary,
        lastError: task.lastError,
        availableAt: task.availableAt,
        deadlineAt: task.deadlineAt,
        attemptCount: task.attemptCount,
        maxAttempts: task.maxAttempts,
        cancelRequested: task.cancelRequested,
        activeRunId: task.activeRunId,
          claimedBy: task.claimedBy,
          claimedAt: task.claimedAt,
          lastHeartbeatAt: task.lastHeartbeatAt,
          completedAt: task.completedAt,
          updatedAt: task.updatedAt
        })
        .where(eq(backgroundTasks.id, task.taskId));
      await tx
        .update(backgroundTaskRuns)
        .set({
          status: run.status,
          workerId: run.workerId,
          errorSummary: run.errorSummary,
          resultSummary: run.resultSummary,
          finishedAt: run.finishedAt,
          lastHeartbeatAt: run.lastHeartbeatAt,
          updatedAt: run.updatedAt
        })
        .where(eq(backgroundTaskRuns.runId, run.runId));
    });

    return buildClaim(task, run);
  }
}

export function createMemoryBackgroundTaskRepository(): MemoryBackgroundTaskRepository {
  return new MemoryBackgroundTaskRepository();
}

export function createPostgresBackgroundTaskRepository(
  db: ProductDatabaseClient
): PostgresBackgroundTaskRepository {
  return new PostgresBackgroundTaskRepository(db);
}
