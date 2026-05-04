import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import type {
  CreateCronJobPayload,
  CronJobRecord,
  UpdateCronJobPayload
} from "@ai-app-template/domain";
import {
  normalizeCronTimeOfDay,
  normalizeCronTimestamp,
  resolveCronJobNextRunAt,
  resolveCronJobRemainingRuns,
  type CronJobStatus
} from "@ai-app-template/domain";

import type { ProductDatabaseClient } from "./client.js";
import { agentSessions, backgroundTasks, cronJobs } from "./schema.js";

export type CreateCronJobRecordInput = CreateCronJobPayload;

export type UpdateCronJobRecordInput = UpdateCronJobPayload;

export interface CronJobRepository {
  list(): Promise<CronJobRecord[]>;
  create(input: CreateCronJobRecordInput): Promise<CronJobRecord>;
  getById(cronJobId: string): Promise<CronJobRecord | null>;
  update(
    cronJobId: string,
    patch: UpdateCronJobRecordInput
  ): Promise<CronJobRecord | null>;
  remove(cronJobId: string): Promise<CronJobRecord | null>;
}

type CronJobRow = typeof cronJobs.$inferSelect;
type CronJobInsert = typeof cronJobs.$inferInsert;
type CronJobUpdateSet = Partial<Omit<CronJobInsert, "id" | "createdAt">>;

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

function resolveRunnableStatus(
  status: CronJobStatus | undefined,
  runCount: number,
  maxRuns: number | null
): CronJobStatus {
  if (typeof maxRuns === "number" && runCount >= maxRuns) {
    return "completed";
  }

  if (status === "completed") {
    return "completed";
  }

  return status === "paused" ? "paused" : "active";
}

function buildInsertValues(input: CreateCronJobRecordInput): CronJobInsert {
  const now = new Date().toISOString();
  const startsAt = normalizeCronTimestamp(input.startsAt);
  const status = resolveRunnableStatus(input.status, 0, input.maxRuns ?? null);
  const nextRunAt =
    status === "completed"
      ? null
      : resolveCronJobNextRunAt({
          scheduleMode: input.scheduleMode,
          startsAt,
          intervalUnit:
            input.scheduleMode === "interval" ? input.intervalUnit : null,
          intervalValue:
            input.scheduleMode === "interval" ? input.intervalValue : null,
          weekday: input.scheduleMode === "weekly" ? input.weekday : null,
          timeOfDay:
            input.scheduleMode === "weekly" ? input.timeOfDay : null,
          runCount: 0,
          maxRuns: input.maxRuns ?? null,
          status
        });

  return {
    id: randomUUID(),
    name: input.name,
    prompt: input.prompt,
    workingDirectory: input.workingDirectory,
    scheduleMode: input.scheduleMode,
    intervalUnit:
      input.scheduleMode === "interval" ? input.intervalUnit : null,
    intervalValue:
      input.scheduleMode === "interval" ? input.intervalValue : null,
    weekday: input.scheduleMode === "weekly" ? input.weekday : null,
    timeOfDay:
      input.scheduleMode === "weekly"
        ? normalizeCronTimeOfDay(input.timeOfDay)
        : null,
    startsAt,
    nextRunAt,
    maxRuns: input.maxRuns ?? null,
    runCount: 0,
    status,
    modelOverride: input.model ?? null,
    thinkingEffortOverride: input.thinkingEffort ?? null,
    lastRunAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now
  };
}

function buildUpdatedRow(
  existing: CronJobRow,
  patch: UpdateCronJobRecordInput
): CronJobUpdateSet {
  const scheduleMode =
    "scheduleMode" in patch && patch.scheduleMode
      ? patch.scheduleMode
      : existing.scheduleMode;
  const startsAt =
    typeof patch.startsAt === "string"
      ? normalizeCronTimestamp(patch.startsAt)
      : toIsoString(existing.startsAt);
  const intervalUnit =
    scheduleMode === "interval"
      ? "scheduleMode" in patch && patch.scheduleMode === "interval"
        ? patch.intervalUnit
        : existing.intervalUnit
      : null;
  const intervalValue =
    scheduleMode === "interval"
      ? "scheduleMode" in patch && patch.scheduleMode === "interval"
        ? patch.intervalValue
        : existing.intervalValue
      : null;
  const weekday =
    scheduleMode === "weekly"
      ? "scheduleMode" in patch && patch.scheduleMode === "weekly"
        ? patch.weekday
        : existing.weekday
      : null;
  const timeOfDay =
    scheduleMode === "weekly"
      ? normalizeCronTimeOfDay(
          "scheduleMode" in patch && patch.scheduleMode === "weekly"
            ? patch.timeOfDay
            : (existing.timeOfDay ?? "09:00")
        )
      : null;
  const maxRuns =
    typeof patch.maxRuns === "number" || patch.maxRuns === null
      ? patch.maxRuns
      : existing.maxRuns;
  const status = resolveRunnableStatus(
    patch.status ?? existing.status,
    existing.runCount,
    maxRuns
  );
  const nextRunAt =
    status === "completed"
      ? null
      : resolveCronJobNextRunAt({
          scheduleMode,
          startsAt,
          intervalUnit,
          intervalValue,
          weekday,
          timeOfDay,
          runCount: existing.runCount,
          maxRuns,
          status
        });

  return {
    name: typeof patch.name === "string" ? patch.name : existing.name,
    prompt: typeof patch.prompt === "string" ? patch.prompt : existing.prompt,
    workingDirectory:
      typeof patch.workingDirectory === "string"
        ? patch.workingDirectory
        : existing.workingDirectory,
    scheduleMode,
    intervalUnit,
    intervalValue,
    weekday,
    timeOfDay,
    startsAt,
    nextRunAt,
    maxRuns,
    status,
    modelOverride:
      typeof patch.model === "string" || patch.model === null
        ? patch.model
        : existing.modelOverride,
    thinkingEffortOverride:
      typeof patch.thinkingEffort === "string" || patch.thinkingEffort === null
        ? patch.thinkingEffort
        : existing.thinkingEffortOverride,
    updatedAt: new Date().toISOString()
  };
}

function mapCronJobRow(
  row: CronJobRow,
  latestRun: {
    sessionId: string | null;
    status: string | null;
    lastError: string | null;
  } = {
    sessionId: null,
    status: null,
    lastError: null
  }
): CronJobRecord {
  const common = {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    workingDirectory: row.workingDirectory,
    startsAt: toIsoString(row.startsAt),
    nextRunAt: row.nextRunAt ? toIsoString(row.nextRunAt) : null,
    maxRuns: row.maxRuns,
    runCount: row.runCount,
    remainingRuns: resolveCronJobRemainingRuns({
      maxRuns: row.maxRuns,
      runCount: row.runCount
    }),
    status: row.status,
    modelOverride: row.modelOverride,
    thinkingEffortOverride: row.thinkingEffortOverride,
    lastRunAt: row.lastRunAt ? toIsoString(row.lastRunAt) : null,
    latestRunSessionId: latestRun.sessionId,
    latestRunStatus: latestRun.status,
    lastError: latestRun.lastError ?? row.lastError,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };

  if (row.scheduleMode === "interval") {
    return {
      ...common,
      scheduleMode: "interval",
      intervalUnit: row.intervalUnit ?? "minute",
      intervalValue: row.intervalValue ?? 1,
      weekday: null,
      timeOfDay: null
    };
  }

  return {
    ...common,
    scheduleMode: "weekly",
    intervalUnit: null,
    intervalValue: null,
    weekday: row.weekday ?? "monday",
    timeOfDay: row.timeOfDay ?? "09:00"
  };
}

async function loadLatestRunInfo(
  db: ProductDatabaseClient,
  jobIds: string[]
): Promise<
  Map<
    string,
    {
      sessionId: string | null;
      status: string | null;
      lastError: string | null;
    }
  >
> {
  const result = new Map<
    string,
    {
      sessionId: string | null;
      status: string | null;
      lastError: string | null;
    }
  >();
  if (jobIds.length === 0) {
    return result;
  }

  const sessionRows = await db
    .select({
      sessionId: agentSessions.id,
      cronJobId: agentSessions.cronJobId,
      createdAt: agentSessions.createdAt
    })
    .from(agentSessions)
    .where(inArray(agentSessions.cronJobId, jobIds))
    .orderBy(desc(agentSessions.createdAt));

  const latestSessionIdByJobId = new Map<string, string>();
  for (const row of sessionRows) {
    const cronJobId = row.cronJobId?.trim();
    if (!cronJobId || latestSessionIdByJobId.has(cronJobId)) {
      continue;
    }
    latestSessionIdByJobId.set(cronJobId, row.sessionId);
  }

  if (latestSessionIdByJobId.size === 0) {
    return result;
  }

  const taskRows = await db
    .select({
      childSessionId: backgroundTasks.childSessionId,
      status: backgroundTasks.status,
      lastError: backgroundTasks.lastError
    })
    .from(backgroundTasks)
    .where(
      and(
        eq(backgroundTasks.kind, "cron_job"),
        inArray(backgroundTasks.childSessionId, [
          ...latestSessionIdByJobId.values()
        ])
      )
    );
  const taskBySessionId = new Map<
    string,
    {
      status: string | null;
      lastError: string | null;
    }
  >();
  for (const row of taskRows) {
    if (!row.childSessionId || taskBySessionId.has(row.childSessionId)) {
      continue;
    }
    taskBySessionId.set(row.childSessionId, {
      status: row.status,
      lastError: row.lastError
    });
  }

  for (const [cronJobId, sessionId] of latestSessionIdByJobId) {
    const task = taskBySessionId.get(sessionId);
    result.set(cronJobId, {
      sessionId,
      status: task?.status ?? null,
      lastError: task?.lastError ?? null
    });
  }

  return result;
}

export class PostgresCronJobRepository implements CronJobRepository {
  constructor(private readonly db: ProductDatabaseClient) {}

  async list(): Promise<CronJobRecord[]> {
    const rows = await this.db
      .select()
      .from(cronJobs)
      .orderBy(desc(cronJobs.createdAt));
    const latestRuns = await loadLatestRunInfo(
      this.db,
      rows.map((row) => row.id)
    );
    return rows.map((row) => mapCronJobRow(row, latestRuns.get(row.id)));
  }

  async create(input: CreateCronJobRecordInput): Promise<CronJobRecord> {
    const rows = await this.db
      .insert(cronJobs)
      .values(buildInsertValues(input))
      .returning();
    return mapCronJobRow(rows[0]!);
  }

  async getById(cronJobId: string): Promise<CronJobRecord | null> {
    const rows = await this.db
      .select()
      .from(cronJobs)
      .where(eq(cronJobs.id, cronJobId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    const latestRuns = await loadLatestRunInfo(this.db, [row.id]);
    return mapCronJobRow(row, latestRuns.get(row.id));
  }

  async update(
    cronJobId: string,
    patch: UpdateCronJobRecordInput
  ): Promise<CronJobRecord | null> {
    const existingRows = await this.db
      .select()
      .from(cronJobs)
      .where(eq(cronJobs.id, cronJobId))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) {
      return null;
    }

    const rows = await this.db
      .update(cronJobs)
      .set(buildUpdatedRow(existing, patch))
      .where(eq(cronJobs.id, cronJobId))
      .returning();
    const row = rows[0];
    if (!row) {
      return null;
    }
    const latestRuns = await loadLatestRunInfo(this.db, [row.id]);
    return mapCronJobRow(row, latestRuns.get(row.id));
  }

  async remove(cronJobId: string): Promise<CronJobRecord | null> {
    const rows = await this.db
      .delete(cronJobs)
      .where(eq(cronJobs.id, cronJobId))
      .returning();
    return rows[0] ? mapCronJobRow(rows[0]) : null;
  }
}

export function createPostgresCronJobRepository(
  db: ProductDatabaseClient
): PostgresCronJobRepository {
  return new PostgresCronJobRepository(db);
}
