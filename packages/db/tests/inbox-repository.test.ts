import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, test } from "bun:test";
import { like } from "drizzle-orm";

import {
  createMemoryInboxBindingRepository,
  createPostgresDatabase,
  createPostgresInboxBindingRepository,
  ensureProductSchema,
  inboxBindings,
  resolveDatabaseUrl
} from "../src/index.js";

const hasPostgresTestDatabase = Boolean(process.env.TEST_DATABASE_URL?.trim());
const describePostgres = hasPostgresTestDatabase ? describe : describe.skip;

function resolveTestDatabaseUrl(): string {
  const databaseUrl = resolveDatabaseUrl({
    DATABASE_URL: process.env.TEST_DATABASE_URL
  } as NodeJS.ProcessEnv);
  if (!databaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL is required for inbox repository tests."
    );
  }
  return databaseUrl;
}

describe("MemoryInboxBindingRepository", () => {
  test("creates bindings and tracks active session, settings, and update ids", async () => {
    const repository = createMemoryInboxBindingRepository();
    const binding = await repository.getOrCreate({
      channel: "telegram",
      externalChatId: "123"
    });

    expect(binding.activeSessionId).toBeNull();
    expect(binding.settings.responseOutputMode).toBe("final");

    const withSession = await repository.updateActiveSession(
      binding.id,
      "session-1"
    );
    expect(withSession?.activeSessionId).toBe("session-1");

    const withSettings = await repository.updateSettings(binding.id, {
      responseOutputMode: "all"
    });
    expect(withSettings?.settings.responseOutputMode).toBe("all");

    const processed = await repository.markUpdateProcessed(binding.id, 10);
    expect(processed?.lastUpdateId).toBe(10);
    await expect(
      repository.markUpdateProcessed(binding.id, 10)
    ).resolves.toBeNull();
    await expect(
      repository.markUpdateProcessed(binding.id, 9)
    ).resolves.toBeNull();
  });
});

describePostgres("PostgresInboxBindingRepository", () => {
  const chatIdPrefix = `test-${randomUUID()}`;
  const db = createPostgresDatabase(resolveTestDatabaseUrl());
  const repository = createPostgresInboxBindingRepository(db);

  afterEach(async () => {
    await db
      .delete(inboxBindings)
      .where(like(inboxBindings.externalChatId, `${chatIdPrefix}-%`));
  });

  test("round-trips telegram inbox bindings", async () => {
    await ensureProductSchema(db);
    const binding = await repository.getOrCreate({
      channel: "telegram",
      externalChatId: `${chatIdPrefix}-456`
    });

    const fetched = await repository.getByChannelExternalChat(
      "telegram",
      `${chatIdPrefix}-456`
    );
    expect(fetched?.id).toBe(binding.id);

    await repository.updateActiveSession(binding.id, "session-456");
    await repository.updateSettings(binding.id, { responseOutputMode: "all" });
    const processed = await repository.markUpdateProcessed(binding.id, 42);

    expect(processed?.activeSessionId).toBe("session-456");
    expect(processed?.settings.responseOutputMode).toBe("all");
    expect(processed?.lastUpdateId).toBe(42);
    await expect(
      repository.markUpdateProcessed(binding.id, 42)
    ).resolves.toBeNull();
  });
});
