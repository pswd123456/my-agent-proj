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
  mapRunRow,
  mapTaskRow,
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
      const claim = buildClaimedTaskAndRun({
        task: mapTaskRow(candidate),
        runId,
        workerId,
        now
      });
      const claimedRows = await this.db
        .update(backgroundTasks)
        .set({
          status: claim.task.status,
          activeRunId: claim.task.activeRunId,
          attemptCount: claim.task.attemptCount,
          claimedBy: claim.task.claimedBy,
          claimedAt: claim.task.claimedAt,
          lastHeartbeatAt: claim.task.lastHeartbeatAt,
          availableAt: claim.task.availableAt,
          updatedAt: claim.task.updatedAt
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
          taskId: claim.run.taskId,
          runId: claim.run.runId,
          status: claim.run.status,
          workerId: claim.run.workerId,
          errorSummary: claim.run.errorSummary,
          resultSummary: claim.run.resultSummary,
          startedAt: claim.run.startedAt,
          finishedAt: claim.run.finishedAt,
          lastHeartbeatAt: claim.run.lastHeartbeatAt,
          createdAt: claim.run.createdAt,
          updatedAt: claim.run.updatedAt
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
    const now = new Date().toISOString();
    const claim = buildHeartbeatTaskClaim({ claim: existing, now });
    return this.persistTaskAndRun(claim.task, claim.run);
  }

  async markTaskRunning(input: TaskClaimInput): Promise<BackgroundTaskClaim> {
    const existing = await this.requireClaim(input.taskId, input.runId);
    const now = new Date().toISOString();
    const claim = buildRunningTaskClaim({
      claim: existing,
      workerId: input.workerId,
      now
    });
    return this.persistTaskAndRun(claim.task, claim.run);
  }

  async markTaskWaitingForInput(
    input: TaskWaitingForInputInput
  ): Promise<BackgroundTaskClaim> {
    const existing = await this.requireClaim(input.taskId, input.runId);
    const now = new Date().toISOString();
    const claim = buildWaitingTaskClaim(
      existing,
      input,
      now,
      "waiting_for_input"
    );
    return this.persistTaskAndRun(claim.task, claim.run);
  }

  async markTaskWaitingForMainAgent(
    input: TaskWaitingForMainAgentInput
  ): Promise<BackgroundTaskClaim> {
    const existing = await this.requireClaim(input.taskId, input.runId);
    const now = new Date().toISOString();
    const claim = buildWaitingTaskClaim(
      existing,
      input,
      now,
      "waiting_for_main_agent"
    );
    return this.persistTaskAndRun(claim.task, claim.run);
  }

  async completeTask(input: CompleteTaskInput): Promise<BackgroundTaskClaim> {
    const existing = await this.requireClaim(input.taskId, input.runId);
    const now = new Date().toISOString();
    const claim = buildFinishedTaskClaim(existing, input, now, "completed");
    return this.persistTaskAndRun(claim.task, claim.run);
  }

  async failTask(input: FailTaskInput): Promise<BackgroundTaskClaim> {
    const existing = await this.requireClaim(input.taskId, input.runId);
    const now = new Date().toISOString();
    const claim = buildFinishedTaskClaim(existing, input, now, "failed");
    return this.persistTaskAndRun(claim.task, claim.run);
  }

  async requestCancel(taskId: string): Promise<BackgroundTaskRecord | null> {
    const existing = await this.getTask(taskId);
    if (!existing) {
      return null;
    }
    const now = new Date().toISOString();
    const nextTask = buildCancelRequestTask(existing, now);
    const rows = await this.db
      .update(backgroundTasks)
      .set({
        status: nextTask.status,
        cancelRequested: nextTask.cancelRequested,
        completedAt: nextTask.completedAt,
        updatedAt: nextTask.updatedAt
      })
      .where(eq(backgroundTasks.id, taskId))
      .returning();
    return rows[0] ? mapTaskRow(rows[0]) : null;
  }

  async cancelTask(input: CancelTaskInput): Promise<BackgroundTaskClaim> {
    const existing = await this.requireClaim(input.taskId, input.runId);
    const now = new Date().toISOString();
    const claim = buildFinishedTaskClaim(existing, input, now, "cancelled");
    return this.persistTaskAndRun(claim.task, claim.run);
  }

  async rescheduleQueuedTask(
    input: RescheduleQueuedTaskInput
  ): Promise<BackgroundTaskRecord> {
    const task = await this.getTask(input.taskId);
    if (!task) {
      throw new Error(`Unknown task: ${input.taskId}`);
    }
    const now = new Date().toISOString();
    const nextTask = buildRescheduledQueuedTask(task, input, now);
    const rows = await this.db
      .update(backgroundTasks)
      .set({
        payload: nextTask.payload,
        resultSummary: nextTask.resultSummary,
        lastError: nextTask.lastError,
        availableAt: nextTask.availableAt,
        deadlineAt: nextTask.deadlineAt,
        updatedAt: nextTask.updatedAt
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
    const now = new Date().toISOString();
    const nextTask = buildRequeuedTask(task, input, now);
    const rows = await this.db
      .update(backgroundTasks)
      .set({
        status: nextTask.status,
        payload: nextTask.payload,
        taskState: nextTask.taskState,
        resultSummary: nextTask.resultSummary,
        lastError: nextTask.lastError,
        availableAt: nextTask.availableAt,
        deadlineAt: nextTask.deadlineAt,
        attemptCount: nextTask.attemptCount,
        maxAttempts: nextTask.maxAttempts,
        cancelRequested: nextTask.cancelRequested,
        activeRunId: nextTask.activeRunId,
        claimedBy: nextTask.claimedBy,
        claimedAt: nextTask.claimedAt,
        lastHeartbeatAt: nextTask.lastHeartbeatAt,
        completedAt: nextTask.completedAt,
        updatedAt: nextTask.updatedAt
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
      const transition = buildStaleClaimTransition({
        task,
        run: task.activeRunId
          ? await this.getRun(task.activeRunId)
          : null,
        now
      });
      const updatedRows = await this.db
        .update(backgroundTasks)
        .set({
          status: transition.task.status,
          cancelRequested: transition.task.cancelRequested,
          activeRunId: transition.task.activeRunId,
          claimedBy: transition.task.claimedBy,
          claimedAt: transition.task.claimedAt,
          lastHeartbeatAt: transition.task.lastHeartbeatAt,
          lastError: transition.task.lastError,
          completedAt: transition.task.completedAt,
          updatedAt: transition.task.updatedAt
        })
        .where(eq(backgroundTasks.id, task.taskId))
        .returning();
      if (transition.run) {
        await this.db
          .update(backgroundTaskRuns)
          .set({
            status: transition.run.status,
            errorSummary: transition.run.errorSummary,
            resultSummary: transition.run.resultSummary,
            finishedAt: transition.run.finishedAt,
            lastHeartbeatAt: transition.run.lastHeartbeatAt,
            updatedAt: transition.run.updatedAt
          })
          .where(eq(backgroundTaskRuns.runId, transition.run.runId));
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
