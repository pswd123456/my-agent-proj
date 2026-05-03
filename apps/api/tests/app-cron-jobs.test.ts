import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { CronJobRecord } from "@ai-app-template/domain";
import type { CronJobRepository } from "@ai-app-template/db";
import {
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_MINIMAX_MODEL,
  FileSystemLogManager,
  createLogger
} from "@ai-app-template/agent";
import {
  createMemoryRoutineRepository,
  createMemorySettingsRepository
} from "@ai-app-template/db";

import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";
import { createApiApp } from "../src/app.js";
import { resolveApiWorkingDirectory } from "../src/working-directory.js";

const workspaceRoot = "/Users/boneda/gitrepo/my-agent-proj";

function createCronJobRecord(
  overrides: Partial<CronJobRecord> = {}
): CronJobRecord {
  const scheduleMode = overrides.scheduleMode ?? "interval";
  const common = {
    id: "cron-1",
    userId: "user-1",
    name: "清理 trace",
    prompt: "清理 trace",
    workingDirectory: resolveApiWorkingDirectory(workspaceRoot),
    startsAt: "2026-05-03T01:00:00.000Z",
    nextRunAt: "2026-05-03T01:00:00.000Z",
    maxRuns: null,
    runCount: 0,
    remainingRuns: null,
    status: "active" as const,
    modelOverride: null,
    thinkingEffortOverride: null,
    lastRunAt: null,
    latestRunSessionId: null,
    latestRunStatus: null,
    lastError: null,
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:00:00.000Z"
  };

  if (scheduleMode === "weekly") {
    return {
      ...common,
      scheduleMode: "weekly",
      intervalUnit: null,
      intervalValue: null,
      weekday: "friday",
      timeOfDay: "18:30",
      ...overrides
    };
  }

  return {
    ...common,
    scheduleMode: "interval",
    intervalUnit: "hour",
    intervalValue: 6,
    weekday: null,
    timeOfDay: null,
    ...overrides
  };
}

async function createCronTestApp(
  repository: CronJobRepository
): Promise<{
  app: ReturnType<typeof createApiApp>;
  sessionManager: Awaited<ReturnType<typeof createPostgresTestSessionManager>>;
}> {
  const sessionManager = await createPostgresTestSessionManager();
  const routineRepository = createMemoryRoutineRepository();
  const settingsRepository = createMemorySettingsRepository();
  const logDir = await mkdtemp(path.join(os.tmpdir(), "api-cron-log-"));
  const systemLogManager = new FileSystemLogManager(logDir, {
    maxBytes: 4096,
    maxFiles: 2
  });
  const apiLogger = createLogger({
    manager: systemLogManager,
    component: "api"
  });

  const app = createApiApp({
    sessionManager,
    routineRepository,
    cronJobRepository: repository,
    settingsRepository,
    traceManager: {
      async appendEvent() {},
      async readEvents() {
        return [];
      },
      async deleteEvents() {},
      async truncateEventsAfterTurn() {}
    },
    systemLogManager,
    apiLogger,
    buildWorkingDirectory(input) {
      return resolveApiWorkingDirectory(workspaceRoot, input);
    },
    defaultModel: DEFAULT_MINIMAX_MODEL,
    modelService: {
      listModels() {
        return [];
      },
      getDefaultModel() {
        return DEFAULT_MINIMAX_MODEL;
      },
      isModelSupported(model) {
        return (
          model === DEFAULT_MINIMAX_MODEL || model === DEFAULT_DEEPSEEK_MODEL
        );
      },
      isModelAvailable(model) {
        return (
          model === DEFAULT_MINIMAX_MODEL || model === DEFAULT_DEEPSEEK_MODEL
        );
      },
      supportsThinking() {
        return true;
      },
      getThinkingEfforts(model) {
        return model === DEFAULT_DEEPSEEK_MODEL ? ["high", "max"] : [];
      },
      assertModelAvailable(model) {
        if (
          model !== DEFAULT_MINIMAX_MODEL &&
          model !== DEFAULT_DEEPSEEK_MODEL
        ) {
          throw new Error(`Unsupported model: ${model}`);
        }

        return model;
      }
    }
  });

  return { app, sessionManager };
}

describe("createApiApp cron jobs", () => {
  test("lists cron jobs for the resolved user id", async () => {
    let requestedUserId: string | null = null;
    const repository: CronJobRepository = {
      async listByUserId(userId) {
        requestedUserId = userId;
        return [createCronJobRecord({ userId })];
      },
      async create() {
        throw new Error("not used");
      },
      async getById() {
        throw new Error("not used");
      },
      async update() {
        throw new Error("not used");
      },
      async remove() {
        throw new Error("not used");
      }
    };
    const { app } = await createCronTestApp(repository);

    const response = await app.request("/users/cron-list-user/cron-jobs");

    expect(response.status).toBe(200);
    expect(requestedUserId).toBe("cron-list-user");
    const payload = (await response.json()) as { cronJobs: CronJobRecord[] };
    expect(payload.cronJobs).toHaveLength(1);
    expect(payload.cronJobs[0]?.userId).toBe("cron-list-user");
  });

  test("creates cron jobs with normalized working directory and model override", async () => {
    let createInput: Record<string, unknown> | null = null;
    const repository: CronJobRepository = {
      async listByUserId() {
        return [];
      },
      async create(input) {
        createInput = input;
        return createCronJobRecord({
          userId: input.userId,
          scheduleMode: "weekly",
          intervalUnit: null,
          intervalValue: null,
          weekday: "friday",
          timeOfDay: "18:30",
          workingDirectory: input.workingDirectory,
          modelOverride: input.model ?? null,
          thinkingEffortOverride: input.thinkingEffort ?? null
        });
      },
      async getById() {
        throw new Error("not used");
      },
      async update() {
        throw new Error("not used");
      },
      async remove() {
        throw new Error("not used");
      }
    };
    const { app } = await createCronTestApp(repository);

    const response = await app.request("/users/cron-create-user/cron-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "周报",
        prompt: "写周报",
        workingDirectory: "apps/web",
        scheduleMode: "weekly",
        weekday: "friday",
        timeOfDay: "18:30",
        startsAt: "2026-05-03T09:00:00+08:00",
        maxRuns: 4,
        model: DEFAULT_DEEPSEEK_MODEL,
        thinkingEffort: "high"
      })
    });

    expect(response.status).toBe(201);
    expect(createInput).toMatchObject({
      userId: "cron-create-user",
      workingDirectory: resolveApiWorkingDirectory(workspaceRoot, "apps/web"),
      model: DEFAULT_DEEPSEEK_MODEL,
      thinkingEffort: "high",
      scheduleMode: "weekly",
      weekday: "friday",
      timeOfDay: "18:30",
      maxRuns: 4
    });
    const payload = (await response.json()) as { cronJob: CronJobRecord };
    expect(payload.cronJob.modelOverride).toBe(DEFAULT_DEEPSEEK_MODEL);
    expect(payload.cronJob.workingDirectory).toBe(
      resolveApiWorkingDirectory(workspaceRoot, "apps/web")
    );
  });

  test("rejects mixed weekly and interval patch payloads before calling the repository", async () => {
    let updateCalls = 0;
    const repository: CronJobRepository = {
      async listByUserId() {
        return [];
      },
      async create() {
        throw new Error("not used");
      },
      async getById() {
        throw new Error("not used");
      },
      async update() {
        updateCalls += 1;
        return null;
      },
      async remove() {
        throw new Error("not used");
      }
    };
    const { app } = await createCronTestApp(repository);

    const response = await app.request("/users/cron-update-user/cron-jobs/cron-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheduleMode: "interval",
        intervalUnit: "hour",
        intervalValue: 2,
        weekday: "friday"
      })
    });

    expect(response.status).toBe(400);
    expect(updateCalls).toBe(0);
  });

  test("returns 404 when deleting a missing cron job", async () => {
    const repository: CronJobRepository = {
      async listByUserId() {
        return [];
      },
      async create() {
        throw new Error("not used");
      },
      async getById() {
        throw new Error("not used");
      },
      async update() {
        throw new Error("not used");
      },
      async remove() {
        return null;
      }
    };
    const { app } = await createCronTestApp(repository);

    const response = await app.request("/users/cron-delete-user/cron-jobs/missing", {
      method: "DELETE"
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Cron job not found." });
  });
});
