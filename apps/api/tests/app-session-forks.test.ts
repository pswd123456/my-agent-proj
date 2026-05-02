import { describe, expect, test } from "bun:test";
import {
  createPostgresTestSessionManager,
  type PostgresTestSessionManager
} from "../../../tests/helpers/postgres-session-manager.js";

import {
  createSnapshot,
  type SessionForkCheckpoint,
  type SessionSnapshot
} from "@ai-app-template/agent";
import {
  createMemoryRoutineRepository,
  createMemorySettingsRepository
} from "@ai-app-template/db";

import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createApiApp, type ApiAppDependencies } from "../src/app.js";
import { resolveApiWorkingDirectory } from "../src/working-directory.js";

const workspaceRoot = "/Users/boneda/gitrepo/my-agent-proj";

async function createForkTestApp() {
  const sessionManager = await createPostgresTestSessionManager();
  const routineRepository = createMemoryRoutineRepository();
  const settingsRepository = createMemorySettingsRepository();
  const logDir = await mkdtemp(path.join(os.tmpdir(), "api-fork-log-"));

  const traceManager = {
    async appendEvent() {},
    async readEvents() {
      return [];
    },
    async deleteEvents() {}
  } satisfies ApiAppDependencies["traceManager"];

  const systemLogManager = {
    async append() {},
    async readRecent() {
      return [];
    }
  } as ApiAppDependencies["systemLogManager"];

  const app = createApiApp({
    sessionManager,
    routineRepository,
    settingsRepository,
    traceManager,
    systemLogManager,
    buildWorkingDirectory(input) {
      return resolveApiWorkingDirectory(workspaceRoot, input);
    },
    defaultModel: "MiniMax-M2.7"
  });

  return {
    app,
    sessionManager,
    logDir
  };
}

async function seedCheckpoint(
  sessionManager: PostgresTestSessionManager
): Promise<{
  sourceSession: SessionSnapshot;
  checkpoint: SessionForkCheckpoint;
}> {
  let sourceSession = createSnapshot({
    sessionId: sessionManager.testId("source-session"),
    workingDirectory: "/tmp/workspace",
    model: "MiniMax-M2.7",
    userId: "fork-user"
  });
  sourceSession.messages = [
    {
      id: sessionManager.testId("user-1"),
      kind: "user",
      content: "帮我查一下 runtime",
      createdAt: "2026-05-01T00:00:00.000Z"
    },
    {
      id: sessionManager.testId("assistant-final-1"),
      kind: "assistant",
      content: "我先看 runtime。",
      createdAt: "2026-05-01T00:00:01.000Z"
    }
  ];
  sourceSession.sessionState.turnCount = 1;
  sourceSession.context.firstUserMessage = "帮我查一下 runtime";
  sourceSession.context.lastUserMessage = "帮我查一下 runtime";
  sourceSession = await sessionManager.recover(sourceSession);

  const checkpoint: SessionForkCheckpoint = {
    id: sessionManager.testId("checkpoint-1"),
    sessionId: sourceSession.sessionId,
    assistantMessageId: sessionManager.testId("assistant-final-1"),
    turnCount: 1,
    baseMessageCount: 1,
    responseGroupId: null,
    snapshot: sourceSession,
    promptSeed: {
      system: "system",
      requestMessages: [
        {
          role: "user",
          content: [{ type: "text", text: "帮我查一下 runtime" }]
        }
      ],
      runtimeContextMessages: [],
      tools: [],
      toolChoice: { type: "auto" }
    },
    createdAt: "2026-05-01T00:00:02.000Z",
    updatedAt: "2026-05-01T00:00:02.000Z"
  };
  await sessionManager.saveForkCheckpoint(checkpoint);

  return { sourceSession, checkpoint };
}

describe("session fork endpoints", () => {
  test("lists fork targets and creates a fork session from assistantMessageId", async () => {
    const { app, sessionManager } = await createForkTestApp();
    const { sourceSession, checkpoint } = await seedCheckpoint(sessionManager);

    const targetsResponse = await app.request(
      `/sessions/${sourceSession.sessionId}/fork-targets`
    );
    expect(targetsResponse.status).toBe(200);
    const targetsPayload = (await targetsResponse.json()) as {
      forkTargets: Array<{
        checkpointId?: string | null;
        assistantMessageId: string;
      }>;
    };
    expect(targetsPayload.forkTargets).toEqual([
      expect.objectContaining({
        checkpointId: checkpoint.id,
        assistantMessageId: checkpoint.assistantMessageId
      })
    ]);

    const createForkResponse = await app.request(
      `/sessions/${sourceSession.sessionId}/forks`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assistantMessageId: checkpoint.assistantMessageId
        })
      }
    );

    expect(createForkResponse.status).toBe(201);
    const createForkPayload = (await createForkResponse.json()) as {
      session: SessionSnapshot;
    };
    expect(createForkPayload.session.parentSessionId).toBe(
      sourceSession.sessionId
    );
    expect(createForkPayload.session.parentRelationKind).toBe("fork");
    expect(createForkPayload.session.forkReplayCheckpointId).toBe(
      checkpoint.id
    );
  });
});
