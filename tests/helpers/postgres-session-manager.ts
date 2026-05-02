import { randomUUID } from "node:crypto";

import { afterEach } from "bun:test";
import { like } from "drizzle-orm";

import {
  createPostgresSessionManager,
  type PostgresSessionManager,
  type SessionManager
} from "../../packages/agent/src/session/index.js";
import type {
  ConversationBlock,
  CreateSessionInput,
  SessionSnapshot
} from "../../packages/agent/src/types.js";
import {
  agentSessions,
  createPostgresDatabase,
  ensureProductSchema,
  resolveDatabaseUrl,
  type ProductDatabaseClient
} from "../../packages/db/src/index.js";

export interface PostgresTestSessionManager extends SessionManager {
  readonly userIdPrefix: string;
  testUserId(userId?: string): string;
  testId(id: string): string;
  cleanup(): Promise<void>;
}

const activeManagers = new Set<PostgresTestSessionManager>();

function resolveTestDatabaseUrl(): string {
  const databaseUrl = resolveDatabaseUrl({
    DATABASE_URL: process.env.TEST_DATABASE_URL
  } as NodeJS.ProcessEnv);
  if (!databaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL is required for session-manager tests. Create a disposable PostgreSQL database, run migrations, and set TEST_DATABASE_URL before running these tests."
    );
  }
  return databaseUrl;
}

function createPrefixedUserId(prefix: string, userId?: string): string {
  const suffix = userId && userId.length > 0 ? userId : "test-user";
  return suffix.startsWith(`${prefix}-`) ? suffix : `${prefix}-${suffix}`;
}

function createPrefixedSnapshot(
  snapshot: SessionSnapshot,
  prefix: string
): SessionSnapshot {
  return {
    ...snapshot,
    context: {
      ...snapshot.context,
      userId: createPrefixedUserId(prefix, snapshot.context.userId)
    }
  };
}

async function cleanupManager(input: {
  db: ProductDatabaseClient;
  userIdPrefix: string;
}): Promise<void> {
  await input.db
    .delete(agentSessions)
    .where(like(agentSessions.userId, `${input.userIdPrefix}-%`));
  await input.db.$client.end();
}

export async function createPostgresTestSessionManager(): Promise<PostgresTestSessionManager> {
  const db = createPostgresDatabase(resolveTestDatabaseUrl());
  await ensureProductSchema(db);

  const inner = createPostgresSessionManager(db);
  const userIdPrefix = `test-${randomUUID()}`;
  let cleanedUp = false;

  const manager = new Proxy(inner, {
    get(target, property, receiver) {
      if (property === "userIdPrefix") {
        return userIdPrefix;
      }
      if (property === "testUserId") {
        return (userId?: string) => createPrefixedUserId(userIdPrefix, userId);
      }
      if (property === "testId") {
        return (id: string) => `${userIdPrefix}-${id}`;
      }
      if (property === "cleanup") {
        return async () => {
          if (cleanedUp) {
            return;
          }
          cleanedUp = true;
          activeManagers.delete(manager);
          await cleanupManager({ db, userIdPrefix });
        };
      }
      if (property === "createSession") {
        return async (
          input: CreateSessionInput = {}
        ): Promise<SessionSnapshot> => {
          return target.createSession({
            ...input,
            userId: createPrefixedUserId(userIdPrefix, input.userId)
          });
        };
      }
      if (property === "listSessions") {
        return async (): Promise<SessionSnapshot[]> => {
          const sessions = await target.listSessions();
          return sessions.filter((session) =>
            session.context.userId.startsWith(`${userIdPrefix}-`)
          );
        };
      }
      if (property === "appendBlock") {
        return async (
          sessionId: string,
          block: ConversationBlock
        ): Promise<SessionSnapshot> => {
          return target.appendBlock(sessionId, {
            ...block,
            id: block.id.startsWith(`${userIdPrefix}-`)
              ? block.id
              : `${userIdPrefix}-${block.id}`
          });
        };
      }
      if (property === "saveSession") {
        return async (snapshot: SessionSnapshot): Promise<SessionSnapshot> => {
          return target.saveSession(
            createPrefixedSnapshot(snapshot, userIdPrefix)
          );
        };
      }
      if (property === "recover") {
        return async (snapshot: SessionSnapshot): Promise<SessionSnapshot> => {
          return target.recover(createPrefixedSnapshot(snapshot, userIdPrefix));
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as PostgresSessionManager & PostgresTestSessionManager;

  activeManagers.add(manager);
  return manager;
}

afterEach(async () => {
  const managers = Array.from(activeManagers);
  activeManagers.clear();

  for (const manager of managers) {
    await manager.cleanup();
  }
});
