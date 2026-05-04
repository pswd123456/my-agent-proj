import { randomUUID } from "node:crypto";

import { afterEach } from "bun:test";
import { inArray } from "drizzle-orm";

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
  readonly idPrefix: string;
  readonly trackedSessionIds: ReadonlySet<string>;
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

async function cleanupManager(input: {
  db: ProductDatabaseClient;
  trackedSessionIds: ReadonlySet<string>;
}): Promise<void> {
  const sessionIds = Array.from(input.trackedSessionIds);
  if (sessionIds.length > 0) {
    await input.db
      .delete(agentSessions)
      .where(inArray(agentSessions.id, sessionIds));
  }
  await input.db.$client.end();
}

export async function createPostgresTestSessionManager(): Promise<PostgresTestSessionManager> {
  const db = createPostgresDatabase(resolveTestDatabaseUrl());
  await ensureProductSchema(db);

  const inner = createPostgresSessionManager(db);
  const idPrefix = `test-${randomUUID()}`;
  const trackedSessionIds = new Set<string>();
  let cleanedUp = false;

  const manager = new Proxy(inner, {
    get(target, property, receiver) {
      if (property === "idPrefix") {
        return idPrefix;
      }
      if (property === "trackedSessionIds") {
        return trackedSessionIds;
      }
      if (property === "testId") {
        return (id: string) => `${idPrefix}-${id}`;
      }
      if (property === "cleanup") {
        return async () => {
          if (cleanedUp) {
            return;
          }
          cleanedUp = true;
          activeManagers.delete(manager);
          await cleanupManager({ db, trackedSessionIds });
        };
      }
      if (property === "createSession") {
        return async (
          input: CreateSessionInput = {}
        ): Promise<SessionSnapshot> => {
          const snapshot = await target.createSession({
            ...input
          });
          trackedSessionIds.add(snapshot.sessionId);
          return snapshot;
        };
      }
      if (property === "listSessions") {
        return async (): Promise<SessionSnapshot[]> => {
          const sessions = await target.listSessions();
          return sessions.filter((session) => trackedSessionIds.has(session.sessionId));
        };
      }
      if (property === "appendBlock") {
        return async (
          sessionId: string,
          block: ConversationBlock
        ): Promise<SessionSnapshot> => {
          return target.appendBlock(sessionId, {
            ...block,
            id: block.id.startsWith(`${sessionId}-`) ? block.id : `${sessionId}-${block.id}`
          });
        };
      }
      if (property === "saveSession") {
        return async (snapshot: SessionSnapshot): Promise<SessionSnapshot> => {
          trackedSessionIds.add(snapshot.sessionId);
          return target.saveSession(snapshot);
        };
      }
      if (property === "recover") {
        return async (snapshot: SessionSnapshot): Promise<SessionSnapshot> => {
          trackedSessionIds.add(snapshot.sessionId);
          return target.recover(snapshot);
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
