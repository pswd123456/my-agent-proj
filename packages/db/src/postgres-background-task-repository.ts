import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type {
  BackgroundTaskClaim,
  BackgroundTaskRecord,
  BackgroundTaskRunRecord
} from "@ai-app-template/domain";

import type { ProductDatabaseClient } from "./client.js";
import { backgroundTaskRuns, backgroundTasks } from "./schema.js";
import {
  buildClaim,
  finishRun,
  finishTaskClaim,
  mapRunRow,
  mapTaskRow,
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

export class PostgresBackgroundTaskRepository implements BackgroundTaskRepository {
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
        childSessionId: input.childSessionId ?? null,
        payload: input.payload,
        taskState: input.taskState ?? null,
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
            or(
              isNull(backgroundTasks.availableAt),
              lte(backgroundTasks.availableAt, now)
            )
          )
        )
        .orderBy(
          asc(
            sql`coalesce(${backgroundTasks.availableAt}, ${backgroundTasks.createdAt})`
          ),
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

  async heartbeatTask(
    input: TaskClaimInput
  ): Promise<BackgroundTaskClaim | null> {
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
            taskState: structuredClone(
              input.taskState ?? existing.task.taskState ?? null
            ),
            resultSummary: resolveTaskResultSummary({
              taskState: input.taskState ?? existing.task.taskState ?? null,
              fallback: input.resultSummary ?? existing.task.resultSummary
            })
          },
          now
        )
      },
      finishRun(existing.run, "waiting_for_input", now, {
        resultSummary: resolveTaskResultSummary({
          taskState: input.taskState ?? existing.task.taskState ?? null,
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
            taskState: structuredClone(
              input.taskState ?? existing.task.taskState ?? null
            ),
            resultSummary: resolveTaskResultSummary({
              taskState: input.taskState ?? existing.task.taskState ?? null,
              fallback: input.resultSummary ?? existing.task.resultSummary
            })
          },
          now
        )
      },
      finishRun(existing.run, "waiting_for_main_agent", now, {
        resultSummary: resolveTaskResultSummary({
          taskState: input.taskState ?? existing.task.taskState ?? null,
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
            taskState: structuredClone(
              input.taskState ?? existing.task.taskState ?? null
            ),
            resultSummary: resolveTaskResultSummary({
              taskState: input.taskState ?? existing.task.taskState ?? null,
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
          taskState: input.taskState ?? existing.task.taskState ?? null,
          fallback: input.resultSummary ?? existing.run.resultSummary
        }),
        errorSummary: null
      })
    );
  }

  async failTask(input: FailTaskInput): Promise<BackgroundTaskClaim> {
    const existing = await this.requireClaim(input.taskId, input.runId);
    requireActiveTaskStatus(
      existing.task,
      ["claimed", "running", "cancelling"],
      "fail"
    );
    const now = new Date().toISOString();
    return this.persistTaskAndRun(
      {
        ...finishTaskClaim(
          {
            ...existing.task,
            status: "failed",
            taskState: structuredClone(
              input.taskState ?? existing.task.taskState ?? null
            ),
            lastError: input.errorSummary,
            resultSummary: resolveTaskResultSummary({
              taskState: input.taskState ?? existing.task.taskState ?? null,
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
          taskState: input.taskState ?? existing.task.taskState ?? null,
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
            taskState: structuredClone(
              input.taskState ?? existing.task.taskState ?? null
            ),
            resultSummary: resolveTaskResultSummary({
              taskState: input.taskState ?? existing.task.taskState ?? null,
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
          taskState: input.taskState ?? existing.task.taskState ?? null,
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
          typeof input.resultSummary === "string" ||
          input.resultSummary === null
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
      .where(
        and(
          eq(backgroundTasks.id, task.taskId),
          eq(backgroundTasks.status, "queued")
        )
      )
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
        taskState: input.taskState ?? task.taskState,
        resultSummary: resolveTaskResultSummary({
          taskState: input.taskState ?? task.taskState,
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
          taskState: task.taskState,
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

export function createPostgresBackgroundTaskRepository(
  db: ProductDatabaseClient
): PostgresBackgroundTaskRepository {
  return new PostgresBackgroundTaskRepository(db);
}
