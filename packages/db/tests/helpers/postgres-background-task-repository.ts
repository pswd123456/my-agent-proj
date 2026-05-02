import { randomUUID } from "node:crypto";

import { afterEach } from "bun:test";
import { inArray } from "drizzle-orm";

import {
  createPostgresBackgroundTaskRepository,
  type BackgroundTaskRepository
} from "../../src/background-task-repository.js";
import {
  createPostgresDatabase,
  resolveDatabaseUrl,
  type ProductDatabaseClient
} from "../../src/client.js";
import {
  backgroundTaskRuns,
  backgroundTasks,
  ensureProductSchema
} from "../../src/schema.js";
import type { BackgroundTaskRepositoryTestHarness } from "../background-task-repository-contract.js";

export interface PostgresBackgroundTaskRepositoryTestHarness extends BackgroundTaskRepositoryTestHarness {
  readonly taskIdPrefix: string;
}

const activeHarnesses = new Set<PostgresBackgroundTaskRepositoryTestHarness>();

export const hasPostgresTestDatabase = Boolean(
  process.env.TEST_DATABASE_URL?.trim()
);

function resolveTestDatabaseUrl(): string {
  const databaseUrl = resolveDatabaseUrl({
    DATABASE_URL: process.env.TEST_DATABASE_URL
  } as NodeJS.ProcessEnv);
  if (!databaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL is required for background-task repository tests. Create a disposable PostgreSQL database, run migrations, and set TEST_DATABASE_URL before running these tests."
    );
  }
  return databaseUrl;
}

async function cleanupHarness(input: {
  db: ProductDatabaseClient;
  trackedTaskIds: Set<string>;
}): Promise<void> {
  const taskIds = [...input.trackedTaskIds];
  if (taskIds.length > 0) {
    await input.db
      .delete(backgroundTaskRuns)
      .where(inArray(backgroundTaskRuns.taskId, taskIds));
    await input.db
      .delete(backgroundTasks)
      .where(inArray(backgroundTasks.id, taskIds));
  }
  await input.db.$client.end();
}

export async function createPostgresTestBackgroundTaskRepository(): Promise<PostgresBackgroundTaskRepositoryTestHarness> {
  const db = createPostgresDatabase(resolveTestDatabaseUrl());
  await ensureProductSchema(db);

  const inner = createPostgresBackgroundTaskRepository(db);
  const trackedTaskIds = new Set<string>();
  const taskIdPrefix = `test-${randomUUID()}`;
  let cleanedUp = false;

  const repository = new Proxy(inner, {
    get(target, property, receiver) {
      if (property === "enqueueTask") {
        return async (
          ...args: Parameters<BackgroundTaskRepository["enqueueTask"]>
        ) => {
          const task = await target.enqueueTask(...args);
          trackedTaskIds.add(task.taskId);
          return task;
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as BackgroundTaskRepository;

  const harness: PostgresBackgroundTaskRepositoryTestHarness = {
    repository,
    taskIdPrefix,
    testId(suffix: string) {
      return `${taskIdPrefix}-${suffix}`;
    },
    async cleanup() {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      activeHarnesses.delete(harness);
      await cleanupHarness({ db, trackedTaskIds });
    }
  };

  activeHarnesses.add(harness);
  return harness;
}

afterEach(async () => {
  const harnesses = Array.from(activeHarnesses);
  activeHarnesses.clear();

  for (const harness of harnesses) {
    await harness.cleanup();
  }
});
