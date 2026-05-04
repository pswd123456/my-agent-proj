import { describe, expect, test } from "bun:test";

import type {
  CreateCronJobRecordInput,
  CronJobRepository,
  UpdateCronJobRecordInput
} from "@ai-app-template/db";
import type { CronJobRecord } from "@ai-app-template/domain";

import { createManageCronJobsTool } from "../src/tools/index.js";
import type { ToolExecutionContext } from "../src/tools/runtime-tool.js";

function createCronJobRecord(
  overrides: Partial<CronJobRecord> = {}
): CronJobRecord {
  const scheduleMode = overrides.scheduleMode ?? "interval";
  const common = {
    id: overrides.id ?? "cron-1",
    userId: overrides.userId ?? "cron-user",
    name: overrides.name ?? "Daily check",
    prompt: overrides.prompt ?? "Check the project.",
    workingDirectory: overrides.workingDirectory ?? "/tmp/workspace",
    startsAt: overrides.startsAt ?? "2026-05-05T01:00:00.000Z",
    nextRunAt: overrides.nextRunAt ?? "2026-05-05T01:00:00.000Z",
    maxRuns: overrides.maxRuns ?? null,
    runCount: overrides.runCount ?? 0,
    remainingRuns: overrides.remainingRuns ?? null,
    status: overrides.status ?? "active",
    modelOverride: overrides.modelOverride ?? null,
    thinkingEffortOverride: overrides.thinkingEffortOverride ?? null,
    lastRunAt: overrides.lastRunAt ?? null,
    latestRunSessionId: overrides.latestRunSessionId ?? null,
    latestRunStatus: overrides.latestRunStatus ?? null,
    lastError: overrides.lastError ?? null,
    createdAt: overrides.createdAt ?? "2026-05-04T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-05-04T00:00:00.000Z"
  };

  if (scheduleMode === "weekly") {
    return {
      ...common,
      scheduleMode: "weekly",
      intervalUnit: null,
      intervalValue: null,
      weekday: overrides.weekday ?? "monday",
      timeOfDay: overrides.timeOfDay ?? "09:00"
    };
  }

  return {
    ...common,
    scheduleMode: "interval",
    intervalUnit: overrides.intervalUnit ?? "day",
    intervalValue: overrides.intervalValue ?? 1,
    weekday: null,
    timeOfDay: null
  };
}

class MemoryCronJobRepository implements CronJobRepository {
  private nextId = 1;
  readonly jobs: CronJobRecord[] = [];

  async listByUserId(userId: string): Promise<CronJobRecord[]> {
    return this.jobs.filter((job) => job.userId === userId);
  }

  async create(input: CreateCronJobRecordInput): Promise<CronJobRecord> {
    const job = createCronJobRecord({
      id: `cron-${this.nextId++}`,
      userId: input.userId,
      name: input.name,
      prompt: input.prompt,
      workingDirectory: input.workingDirectory,
      startsAt: input.startsAt,
      maxRuns: input.maxRuns ?? null,
      status: input.status ?? "active",
      modelOverride: input.model ?? null,
      thinkingEffortOverride: input.thinkingEffort ?? null,
      scheduleMode: input.scheduleMode,
      ...(input.scheduleMode === "interval"
        ? {
            intervalUnit: input.intervalUnit,
            intervalValue: input.intervalValue
          }
        : {
            weekday: input.weekday,
            timeOfDay: input.timeOfDay
          })
    });
    this.jobs.unshift(job);
    return job;
  }

  async getById(
    userId: string,
    cronJobId: string
  ): Promise<CronJobRecord | null> {
    return (
      this.jobs.find((job) => job.userId === userId && job.id === cronJobId) ??
      null
    );
  }

  async update(
    userId: string,
    cronJobId: string,
    patch: UpdateCronJobRecordInput
  ): Promise<CronJobRecord | null> {
    const index = this.jobs.findIndex(
      (job) => job.userId === userId && job.id === cronJobId
    );
    const existing = this.jobs[index];
    if (!existing) {
      return null;
    }
    const updated = createCronJobRecord({
      ...existing,
      name: patch.name ?? existing.name,
      prompt: patch.prompt ?? existing.prompt,
      workingDirectory: patch.workingDirectory ?? existing.workingDirectory,
      startsAt: patch.startsAt ?? existing.startsAt,
      maxRuns:
        typeof patch.maxRuns !== "undefined" ? patch.maxRuns : existing.maxRuns,
      status: patch.status ?? existing.status,
      modelOverride:
        typeof patch.model !== "undefined"
          ? patch.model
          : existing.modelOverride,
      thinkingEffortOverride:
        typeof patch.thinkingEffort !== "undefined"
          ? patch.thinkingEffort
          : existing.thinkingEffortOverride,
      ...("scheduleMode" in patch && patch.scheduleMode === "interval"
        ? {
            scheduleMode: "interval" as const,
            intervalUnit: patch.intervalUnit,
            intervalValue: patch.intervalValue,
            weekday: null,
            timeOfDay: null
          }
        : {}),
      ...("scheduleMode" in patch && patch.scheduleMode === "weekly"
        ? {
            scheduleMode: "weekly" as const,
            intervalUnit: null,
            intervalValue: null,
            weekday: patch.weekday,
            timeOfDay: patch.timeOfDay
          }
        : {})
    });
    this.jobs[index] = updated;
    return updated;
  }

  async remove(
    userId: string,
    cronJobId: string
  ): Promise<CronJobRecord | null> {
    const index = this.jobs.findIndex(
      (job) => job.userId === userId && job.id === cronJobId
    );
    const [removed] = index >= 0 ? this.jobs.splice(index, 1) : [];
    return removed ?? null;
  }
}

function createContext(
  cronJobRepository: CronJobRepository
): ToolExecutionContext {
  return {
    sessionId: "session-1",
    userId: "cron-user",
    workingDirectory: "/tmp/current-workspace",
    routineRepository: undefined as never,
    cronJobRepository,
    sessionManager: undefined as never,
    sessionContext: {
      status: "running",
      currentDateContext: "2026-05-04T00:00:00.000Z",
      yoloMode: false,
      planModeEnabled: false,
      taskBriefPath: null,
      workspaceEscapeAllowed: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: [],
      todoState: null
    },
    permissionRules: {
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: []
    },
    sessionMessages: []
  };
}

describe("manage_cron_jobs tool", () => {
  test("creates an interval cron job using the current working directory by default", async () => {
    const repository = new MemoryCronJobRepository();
    const result = await createManageCronJobsTool().execute(
      {
        action: "create",
        name: "Daily docs check",
        prompt: "Review docs drift.",
        starts_at: "2026-05-05T01:00:00.000Z",
        schedule_mode: "interval",
        interval_unit: "day",
        interval_value: 1
      },
      createContext(repository)
    );

    expect(result.state).toBe("success");
    expect(result.result.code).toBe("CRON_JOB_CREATED");
    expect(repository.jobs[0]?.workingDirectory).toBe("/tmp/current-workspace");
    expect(result.displayText).toContain("- action: create");
  });

  test("lists, updates, and deletes cron jobs", async () => {
    const repository = new MemoryCronJobRepository();
    repository.jobs.push(
      createCronJobRecord({ id: "cron-existing", userId: "cron-user" })
    );
    const tool = createManageCronJobsTool();
    const context = createContext(repository);

    const listResult = await tool.execute({ action: "list" }, context);
    expect(listResult.state).toBe("success");
    expect(listResult.displayText).toContain("- count: 1");

    const updateResult = await tool.execute(
      {
        action: "update",
        cron_job_id: "cron-existing",
        status: "paused"
      },
      context
    );
    expect(updateResult.state).toBe("success");
    expect(updateResult.result.code).toBe("CRON_JOB_UPDATED");
    expect(repository.jobs[0]?.status).toBe("paused");

    const deleteResult = await tool.execute(
      { action: "delete", cron_job_id: "cron-existing" },
      context
    );
    expect(deleteResult.state).toBe("success");
    expect(deleteResult.result.code).toBe("CRON_JOB_DELETED");
    expect(repository.jobs).toHaveLength(0);
  });

  test("fails cleanly when cron jobs are not configured", async () => {
    const result = await createManageCronJobsTool().execute(
      { action: "list" },
      {
        ...createContext(new MemoryCronJobRepository()),
        cronJobRepository: undefined
      }
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("CRON_JOBS_NOT_CONFIGURED");
  });

  test("returns structured validation errors for empty updates", async () => {
    const result = await createManageCronJobsTool().execute(
      { action: "update", cron_job_id: "cron-1" } as never,
      createContext(new MemoryCronJobRepository())
    );

    expect(result.state).toBe("failed");
    expect(result.result.code).toBe("INVALID_TOOL_INPUT");
    expect(result.displayText).toContain("[manage_cron_jobs] invalid input");
  });
});
