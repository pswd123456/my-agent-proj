import { randomUUID } from "node:crypto";

import { and, asc, eq, lte, notInArray } from "drizzle-orm";

import {
  DEFAULT_SESSION_MODEL,
  normalizeThinkingEffort,
  resolveCronJobNextRunAt,
  type SessionSettingsRecord
} from "@ai-app-template/domain";
import type { ProductDatabaseClient } from "@ai-app-template/db";
import { agentSessions, backgroundTasks, cronJobs } from "@ai-app-template/db";
import type { ModelService } from "../models/index.js";
import type { SettingsConfigStore } from "../settings-config/index.js";

import { buildSessionPersistenceValues } from "../session/session-row-mapper.js";
import { createSnapshot } from "../session/shared.js";

const CRON_TASK_DEADLINE_MS = 10 * 60_000;

export interface DispatchNextDueCronJobInput {
  excludeCronJobIds?: string[];
}

export type DispatchNextDueCronJobResult =
  | {
      outcome: "dispatched";
      cronJobId: string;
      sessionId: string;
      taskId: string;
    }
  | {
      outcome: "failed";
      cronJobId: string;
      error: string;
    };

type CronJobRow = typeof cronJobs.$inferSelect;

function resolveModel(input: {
  cronJob: CronJobRow;
  settings: SessionSettingsRecord;
  modelService?: ModelService;
}): string {
  const candidate =
    input.cronJob.modelOverride?.trim() ||
    input.settings.model ||
    input.modelService?.getDefaultModel() ||
    DEFAULT_SESSION_MODEL;

  if (!input.modelService) {
    return candidate;
  }

  return input.modelService.assertModelAvailable(candidate);
}

async function markDispatchFailure(input: {
  db: ProductDatabaseClient;
  cronJob: CronJobRow;
  error: string;
}): Promise<void> {
  const nextRunAt = input.cronJob.nextRunAt;
  if (!nextRunAt) {
    return;
  }

  await input.db
    .update(cronJobs)
    .set({
      lastError: input.error,
      updatedAt: new Date().toISOString()
    })
    .where(
      and(
        eq(cronJobs.id, input.cronJob.id),
        eq(cronJobs.status, input.cronJob.status),
        eq(cronJobs.runCount, input.cronJob.runCount),
        eq(cronJobs.nextRunAt, nextRunAt)
      )
    );
}

export class CronJobDispatcher {
  constructor(
    private readonly db: ProductDatabaseClient,
    private readonly settingsConfigStore: SettingsConfigStore,
    private readonly modelService?: ModelService
  ) {}

  async dispatchNextDueCronJob(
    input: DispatchNextDueCronJobInput = {}
  ): Promise<DispatchNextDueCronJobResult | null> {
    const attempted = new Set(input.excludeCronJobIds ?? []);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const now = new Date().toISOString();
      const filters = [
        eq(cronJobs.status, "active"),
        lte(cronJobs.nextRunAt, now)
      ];
      if (attempted.size > 0) {
        filters.push(notInArray(cronJobs.id, [...attempted]));
      }

      const candidateRows = await this.db
        .select()
        .from(cronJobs)
        .where(and(...filters))
        .orderBy(asc(cronJobs.nextRunAt), asc(cronJobs.createdAt))
        .limit(1);
      const candidate = candidateRows[0];
      if (!candidate) {
        return null;
      }
      if (!candidate.nextRunAt) {
        attempted.add(candidate.id);
        continue;
      }
      const candidateNextRunAt = candidate.nextRunAt;

      attempted.add(candidate.id);

      try {
        const settings =
          await this.settingsConfigStore.getEffectiveSettings(
            candidate.workingDirectory
          );
        const dispatchResult = await this.db.transaction(async (tx) => {
          const model = resolveModel({
            cronJob: candidate,
            settings,
            ...(this.modelService ? { modelService: this.modelService } : {})
          });
          const sessionId = randomUUID();
          const taskId = randomUUID();
          const nextRunCount = candidate.runCount + 1;
          const nextStatus =
            typeof candidate.maxRuns === "number" &&
            nextRunCount >= candidate.maxRuns
              ? "completed"
              : "active";
          const nextRunAt =
            nextStatus === "completed"
              ? null
              : resolveCronJobNextRunAt({
                  scheduleMode: candidate.scheduleMode,
                  startsAt: candidate.startsAt,
                  intervalUnit: candidate.intervalUnit,
                  intervalValue: candidate.intervalValue,
                  weekday: candidate.weekday,
                  timeOfDay: candidate.timeOfDay,
                  runCount: nextRunCount,
                  maxRuns: candidate.maxRuns,
                  status: nextStatus
                });
          const snapshot = createSnapshot({
            sessionId,
            cronJobId: candidate.id,
            workingDirectory: candidate.workingDirectory,
            model,
            thinkingEffort: normalizeThinkingEffort(
              candidate.thinkingEffortOverride ?? settings.thinkingEffort
            ),
            yoloMode: settings.yoloMode,
            contextWindow: settings.contextWindow,
            maxTurns: settings.maxTurns,
            shellAllowPatterns: settings.shellAllowPatterns,
            shellDenyPatterns: settings.shellDenyPatterns,
            toolAllowList: settings.toolAllowList,
            toolAskList: settings.toolAskList,
            toolDenyList: settings.toolDenyList,
            enabledCapabilityPacks: settings.enabledCapabilityPacks
          });

          const updatedRows = await tx
            .update(cronJobs)
            .set({
              nextRunAt,
              runCount: nextRunCount,
              status: nextStatus,
              lastRunAt: now,
              lastError: null,
              updatedAt: now
            })
            .where(
              and(
                eq(cronJobs.id, candidate.id),
                eq(cronJobs.status, "active"),
                eq(cronJobs.runCount, candidate.runCount),
                eq(cronJobs.nextRunAt, candidateNextRunAt)
              )
            )
            .returning({ id: cronJobs.id });
          if (updatedRows.length === 0) {
            return null;
          }

          await tx.insert(agentSessions).values(buildSessionPersistenceValues(snapshot));
          await tx.insert(backgroundTasks).values({
            id: taskId,
            kind: "cron_job",
            status: "queued",
            executor: "agent_session",
            parentSessionId: null,
            childSessionId: sessionId,
            payload: {
              executor: "agent_session",
              message: candidate.prompt,
              workingDirectory: candidate.workingDirectory,
              model,
              maxTurns: settings.maxTurns,
              enabledCapabilityPacks: settings.enabledCapabilityPacks,
              metadata: {
                cronJobId: candidate.id
              }
            },
            taskState: null,
            resultSummary: null,
            lastError: null,
            availableAt: null,
            deadlineAt: new Date(Date.now() + CRON_TASK_DEADLINE_MS).toISOString(),
            attemptCount: 0,
            maxAttempts: 1,
            cancelRequested: false,
            activeRunId: null,
            claimedBy: null,
            claimedAt: null,
            lastHeartbeatAt: null,
            completedAt: null,
            createdAt: now,
            updatedAt: now
          });

          return { sessionId, taskId };
        });

        if (!dispatchResult) {
          continue;
        }

        return {
          outcome: "dispatched",
          cronJobId: candidate.id,
          sessionId: dispatchResult.sessionId,
          taskId: dispatchResult.taskId
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        await markDispatchFailure({
          db: this.db,
          cronJob: candidate,
          error: errorMessage
        });
        return {
          outcome: "failed",
          cronJobId: candidate.id,
          error: errorMessage
        };
      }
    }

    return null;
  }
}

export function createCronJobDispatcher(input: {
  db: ProductDatabaseClient;
  settingsConfigStore: SettingsConfigStore;
  modelService?: ModelService;
}): CronJobDispatcher {
  return new CronJobDispatcher(
    input.db,
    input.settingsConfigStore,
    input.modelService
  );
}
