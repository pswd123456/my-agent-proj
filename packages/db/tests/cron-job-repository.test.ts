import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, test } from "bun:test";
import { eq, like } from "drizzle-orm";

import {
  createPostgresCronJobRepository,
  createPostgresDatabase,
  cronJobs,
  resolveDatabaseUrl,
  ensureProductSchema
} from "../src/index.js";

const hasPostgresTestDatabase = Boolean(process.env.TEST_DATABASE_URL?.trim());
const describePostgres = hasPostgresTestDatabase ? describe : describe.skip;

function resolveTestDatabaseUrl(): string {
  const databaseUrl = resolveDatabaseUrl({
    DATABASE_URL: process.env.TEST_DATABASE_URL
  } as NodeJS.ProcessEnv);
  if (!databaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for cron job repository tests.");
  }
  return databaseUrl;
}

describePostgres("PostgresCronJobRepository", () => {
  const namePrefix = `test-${randomUUID()}`;
  const db = createPostgresDatabase(resolveTestDatabaseUrl());
  const repository = createPostgresCronJobRepository(db);

  afterEach(async () => {
    await db
      .delete(cronJobs)
      .where(like(cronJobs.name, `${namePrefix}-%`));
  });

  test("creates interval cron jobs with computed next run", async () => {
    await ensureProductSchema(db);
    const cronJob = await repository.create({
      name: `${namePrefix}-清理 trace`,
      prompt: "清理 trace",
      workingDirectory: "/tmp/workspace",
      scheduleMode: "interval",
      intervalUnit: "hour",
      intervalValue: 6,
      startsAt: "2026-05-02T09:00:00+08:00",
      maxRuns: 3
    });

    expect(cronJob.scheduleMode).toBe("interval");
    expect(cronJob.nextRunAt).toBe("2026-05-02T01:00:00.000Z");
    expect(cronJob.remainingRuns).toBe(3);
  });

  test("updates weekly cron jobs and clears overrides", async () => {
    await ensureProductSchema(db);
    const created = await repository.create({
      name: `${namePrefix}-周报`,
      prompt: "写周报",
      workingDirectory: "/tmp/workspace",
      scheduleMode: "weekly",
      weekday: "friday",
      timeOfDay: "18:30",
      startsAt: "2026-05-02T09:00:00+08:00",
      model: "MiniMax-M2.7",
      thinkingEffort: "high"
    });

    const updated = await repository.update(created.id, {
      scheduleMode: "interval",
      intervalUnit: "day",
      intervalValue: 2,
      model: null,
      thinkingEffort: null,
      status: "paused"
    });

    expect(updated?.scheduleMode).toBe("interval");
    expect(updated?.intervalUnit).toBe("day");
    expect(updated?.modelOverride).toBeNull();
    expect(updated?.thinkingEffortOverride).toBeNull();
    expect(updated?.status).toBe("paused");
  });

  test("deletes cron jobs by user id and id", async () => {
    await ensureProductSchema(db);
    const created = await repository.create({
      name: `${namePrefix}-周报`,
      prompt: "写周报",
      workingDirectory: "/tmp/workspace",
      scheduleMode: "weekly",
      weekday: "friday",
      timeOfDay: "18:30",
      startsAt: "2026-05-02T09:00:00+08:00"
    });

    const removed = await repository.remove(created.id);
    expect(removed?.id).toBe(created.id);

    const remaining = await db
      .select()
      .from(cronJobs)
      .where(eq(cronJobs.id, created.id));
    expect(remaining).toHaveLength(0);
  });
});
