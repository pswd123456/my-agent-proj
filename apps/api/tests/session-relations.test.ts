import { describe, expect, test } from "bun:test";
import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  FileSystemLogManager,
  createLogger,
  type SessionSnapshot
} from "@ai-app-template/agent";
import {
  createMemoryBackgroundTaskRepository,
  createMemoryRoutineRepository,
  createMemorySettingsRepository
} from "@ai-app-template/db";

import { createApiApp } from "../src/app.js";

describe("session relation responses", () => {
  test("annotates child sessions with their parent session id", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const backgroundTaskRepository = createMemoryBackgroundTaskRepository();
    const routineRepository = createMemoryRoutineRepository();
    const settingsRepository = createMemorySettingsRepository();
    const logDir = await mkdtemp(path.join(os.tmpdir(), "api-session-rel-"));
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
      settingsRepository,
      backgroundTaskRepository,
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
        return input ?? process.cwd();
      }
    });

    const parent = await sessionManager.createSession({
      workingDirectory: "/tmp/parent",
      userId: "user-a"
    });
    const child = await sessionManager.createSession({
      workingDirectory: "/tmp/child",
      userId: "user-a"
    });
    await backgroundTaskRepository.enqueueTask({
      kind: "subagent",
      parentSessionId: parent.sessionId,
      childSessionId: child.sessionId,
      payload: {
        executor: "agent_session",
        message: "Inspect the parent-child relation.",
        workingDirectory: "/tmp/child",
        model: "MiniMax-M2.7",
        maxTurns: 6,
        enabledCapabilityPacks: ["workspace"],
        metadata: {}
      }
    });

    const listResponse = await app.request("/sessions");
    expect(listResponse.status).toBe(200);
    const listPayload = (await listResponse.json()) as {
      sessions: SessionSnapshot[];
    };
    const childFromList = listPayload.sessions.find(
      (session) => session.sessionId === child.sessionId
    );
    const parentFromList = listPayload.sessions.find(
      (session) => session.sessionId === parent.sessionId
    );

    expect(childFromList?.parentSessionId).toBe(parent.sessionId);
    expect(parentFromList?.parentSessionId ?? null).toBeNull();

    const getResponse = await app.request(`/sessions/${child.sessionId}`);
    expect(getResponse.status).toBe(200);
    const getPayload = (await getResponse.json()) as {
      session: SessionSnapshot;
    };
    expect(getPayload.session.parentSessionId).toBe(parent.sessionId);
  });

  test("deletes a parent session together with its child sessions", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const backgroundTaskRepository = createMemoryBackgroundTaskRepository();
    const routineRepository = createMemoryRoutineRepository();
    const settingsRepository = createMemorySettingsRepository();
    const logDir = await mkdtemp(path.join(os.tmpdir(), "api-session-rel-"));
    const systemLogManager = new FileSystemLogManager(logDir, {
      maxBytes: 4096,
      maxFiles: 2
    });
    const apiLogger = createLogger({
      manager: systemLogManager,
      component: "api"
    });
    const deletedTraceSessionIds: string[] = [];
    const app = createApiApp({
      sessionManager,
      routineRepository,
      settingsRepository,
      backgroundTaskRepository,
      traceManager: {
        async appendEvent() {},
        async readEvents() {
          return [];
        },
        async deleteEvents(sessionId: string) {
          deletedTraceSessionIds.push(sessionId);
        },
        async truncateEventsAfterTurn() {}
      },
      systemLogManager,
      apiLogger,
      buildWorkingDirectory(input) {
        return input ?? process.cwd();
      }
    });

    const parent = await sessionManager.createSession({
      workingDirectory: "/tmp/parent",
      userId: "user-a"
    });
    const child = await sessionManager.createSession({
      workingDirectory: "/tmp/child",
      userId: "user-a"
    });
    await backgroundTaskRepository.enqueueTask({
      kind: "subagent",
      parentSessionId: parent.sessionId,
      childSessionId: child.sessionId,
      payload: {
        executor: "agent_session",
        message: "Inspect the parent-child relation.",
        workingDirectory: "/tmp/child",
        model: "MiniMax-M2.7",
        maxTurns: 6,
        enabledCapabilityPacks: ["workspace"],
        metadata: {}
      }
    });

    const deleteResponse = await app.request(`/sessions/${parent.sessionId}`, {
      method: "DELETE"
    });

    expect(deleteResponse.status).toBe(204);
    expect(await sessionManager.getSession(parent.sessionId)).toBeNull();
    expect(await sessionManager.getSession(child.sessionId)).toBeNull();
    expect(deletedTraceSessionIds).toEqual([child.sessionId, parent.sessionId]);

    const listResponse = await app.request("/sessions");
    expect(listResponse.status).toBe(200);
    const listPayload = (await listResponse.json()) as {
      sessions: SessionSnapshot[];
    };
    expect(listPayload.sessions).toHaveLength(0);
  });
});
