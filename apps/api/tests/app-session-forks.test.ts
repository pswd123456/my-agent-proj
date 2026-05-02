import { describe, expect, test } from "bun:test";
import {
  createPostgresTestSessionManager,
  type PostgresTestSessionManager
} from "../../../tests/helpers/postgres-session-manager.js";

import {
  createSnapshot,
  type SessionForkCheckpoint,
  type SessionSnapshot,
  type TraceRecord
} from "@ai-app-template/agent";
import {
  createMemoryRoutineRepository,
  createMemorySettingsRepository,
  type MemorySettingsRepository
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
  let traceRecords: TraceRecord[] = [];

  const traceManager = {
    async appendEvent() {},
    async readEvents(sessionId: string) {
      return traceRecords.filter((record) => record.sessionId === sessionId);
    },
    async deleteEvents(sessionId: string) {
      traceRecords = traceRecords.filter((record) => record.sessionId !== sessionId);
    },
    async truncateEventsAfterTurn(sessionId: string, turnCount: number) {
      traceRecords = traceRecords.filter(
        (record) =>
          record.sessionId !== sessionId || record.event.turnCount < turnCount
      );
    }
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
    settingsRepository,
    getTraceRecords() {
      return traceRecords;
    },
    setTraceRecords(records: TraceRecord[]) {
      traceRecords = records;
    },
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

async function seedRewriteScenario(input: {
  sessionManager: PostgresTestSessionManager;
  settingsRepository: MemorySettingsRepository;
  setTraceRecords(records: TraceRecord[]): void;
}): Promise<{
  session: SessionSnapshot;
  firstCheckpoint: SessionForkCheckpoint;
  latestCheckpoint: SessionForkCheckpoint;
}> {
  let session = createSnapshot({
    sessionId: input.sessionManager.testId("rewrite-session"),
    workingDirectory: "/tmp/workspace",
    model: "MiniMax-M2.7",
    userId: "rewrite-user",
    firstUserMessage: "先看 runtime",
    lastUserMessage: "继续检查 checkpoint"
  });
  session.messages = [
    {
      id: input.sessionManager.testId("user-1"),
      kind: "user",
      content: "先看 runtime",
      source: "user",
      createdAt: "2026-05-01T00:00:00.000Z"
    },
    {
      id: input.sessionManager.testId("assistant-1"),
      kind: "assistant",
      content: "我先看 runtime。",
      createdAt: "2026-05-01T00:00:01.000Z"
    },
    {
      id: input.sessionManager.testId("user-2"),
      kind: "user",
      content: "继续检查 checkpoint",
      source: "user",
      createdAt: "2026-05-01T00:00:02.000Z"
    },
    {
      id: input.sessionManager.testId("assistant-2"),
      kind: "assistant",
      content: "我继续检查 checkpoint。",
      createdAt: "2026-05-01T00:00:03.000Z"
    },
    {
      id: input.sessionManager.testId("hook-run-end"),
      kind: "user",
      content: "本轮摘要已记录",
      source: "hook_message",
      hookEvent: "run_end",
      hookTitle: "收尾 hook",
      createdAt: "2026-05-01T00:00:04.000Z"
    }
  ];
  session.sessionState.turnCount = 2;
  session.context.status = "waiting_for_user_input";
  session = await input.sessionManager.recover(session);

  const firstCheckpoint: SessionForkCheckpoint = {
    id: input.sessionManager.testId("checkpoint-1"),
    sessionId: session.sessionId,
    assistantMessageId: input.sessionManager.testId("assistant-1"),
    turnCount: 1,
    baseMessageCount: 1,
    responseGroupId: null,
    snapshot: session,
    promptSeed: {
      system: "system",
      requestMessages: [
        {
          role: "user",
          content: [{ type: "text", text: "先看 runtime" }]
        }
      ],
      runtimeContextMessages: [],
      tools: [],
      toolChoice: { type: "auto" }
    },
    createdAt: "2026-05-01T00:00:02.000Z",
    updatedAt: "2026-05-01T00:00:02.000Z"
  };
  const latestCheckpoint: SessionForkCheckpoint = {
    id: input.sessionManager.testId("checkpoint-2"),
    sessionId: session.sessionId,
    assistantMessageId: input.sessionManager.testId("assistant-2"),
    turnCount: 2,
    baseMessageCount: 3,
    responseGroupId: null,
    snapshot: session,
    promptSeed: {
      system: "system",
      requestMessages: [
        {
          role: "user",
          content: [{ type: "text", text: "继续检查 checkpoint" }]
        }
      ],
      runtimeContextMessages: [],
      tools: [],
      toolChoice: { type: "auto" }
    },
    createdAt: "2026-05-01T00:00:05.000Z",
    updatedAt: "2026-05-01T00:00:05.000Z"
  };

  await input.sessionManager.saveForkCheckpoint(firstCheckpoint);
  await input.sessionManager.saveForkCheckpoint(latestCheckpoint);
  await input.settingsRepository.update(session.context.userId, {
    userContextHooks: [
      {
        id: "hook-run-end",
        event: "run_end",
        title: "收尾 hook",
        content: "本轮摘要已记录",
        enabled: true
      }
    ]
  });
  input.setTraceRecords([
    {
      sessionId: session.sessionId,
      createdAt: "2026-05-01T00:00:01.500Z",
      event: {
        kind: "response",
        turnCount: 1,
        stopReason: "end_turn",
        usage: {
          inputTokens: 11,
          outputTokens: 5,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0
        },
        content: []
      }
    },
    {
      sessionId: session.sessionId,
      createdAt: "2026-05-01T00:00:03.500Z",
      event: {
        kind: "response",
        turnCount: 2,
        stopReason: "end_turn",
        usage: {
          inputTokens: 17,
          outputTokens: 7,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0
        },
        content: []
      }
    }
  ]);

  return { session, firstCheckpoint, latestCheckpoint };
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
      rewriteTarget: {
        checkpointId: string;
        userMessageId: string;
        turnCount: number;
      } | null;
    };
    expect(targetsPayload.forkTargets).toEqual([
      expect.objectContaining({
        checkpointId: checkpoint.id,
        assistantMessageId: checkpoint.assistantMessageId
      })
    ]);
    expect(targetsPayload.rewriteTarget).toEqual({
      checkpointId: checkpoint.id,
      userMessageId: sourceSession.messages[0]?.id,
      turnCount: 1
    });

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

  test("prefers persisted hook metadata and returns the latest rewriteable user target", async () => {
    const { app, sessionManager, settingsRepository, setTraceRecords } =
      await createForkTestApp();
    const { session, latestCheckpoint } = await seedRewriteScenario({
      sessionManager,
      settingsRepository,
      setTraceRecords
    });

    const response = await app.request(`/sessions/${session.sessionId}/fork-targets`);
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      rewriteTarget: {
        checkpointId: string;
        userMessageId: string;
        turnCount: number;
      } | null;
    };

    expect(payload.rewriteTarget).toEqual({
      checkpointId: latestCheckpoint.id,
      userMessageId: session.messages[2]?.id,
      turnCount: 2
    });
  });

  test("recovers the latest rewrite target and prunes later checkpoints and trace", async () => {
    const {
      app,
      sessionManager,
      settingsRepository,
      setTraceRecords,
      getTraceRecords
    } = await createForkTestApp();
    const { session, firstCheckpoint, latestCheckpoint } = await seedRewriteScenario({
      sessionManager,
      settingsRepository,
      setTraceRecords
    });

    const response = await app.request(
      `/sessions/${session.sessionId}/rewrite-target/recover`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkpointId: latestCheckpoint.id,
          userMessageId: session.messages[2]?.id
        })
      }
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      session: SessionSnapshot;
      rewriteTarget: {
        checkpointId: string;
        userMessageId: string;
        turnCount: number;
      } | null;
      forkTargets: Array<{ checkpointId?: string | null; turnCount: number }>;
    };

    expect(payload.session.messages.map((block) => block.id)).toEqual([
      session.messages[0]?.id,
      session.messages[1]?.id
    ]);
    expect(payload.session.sessionState.turnCount).toBe(1);
    expect(payload.session.context.lastUserMessage).toBe("先看 runtime");
    expect(payload.session.inputTokensCount).toBe(11);
    expect(payload.forkTargets.map((target) => target.turnCount)).toEqual([1]);
    expect(payload.rewriteTarget).toEqual({
      checkpointId: firstCheckpoint.id,
      userMessageId: session.messages[0]?.id,
      turnCount: 1
    });

    const checkpoints = await sessionManager.listForkCheckpoints(session.sessionId);
    expect(checkpoints.map((checkpoint) => checkpoint.turnCount)).toEqual([1]);
    expect(
      getTraceRecords().map((record) => record.event.turnCount)
    ).toEqual([1]);
  });

  test("rejects rewrites that do not target the latest rewriteable user message", async () => {
    const { app, sessionManager, settingsRepository, setTraceRecords } =
      await createForkTestApp();
    const { session, firstCheckpoint, latestCheckpoint } = await seedRewriteScenario({
      sessionManager,
      settingsRepository,
      setTraceRecords
    });

    const response = await app.request(
      `/sessions/${session.sessionId}/rewrite-target/recover`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkpointId: firstCheckpoint.id,
          userMessageId: session.messages[0]?.id
        })
      }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Only the latest rewriteable user message can be rewritten."
    });

    const unchanged = await sessionManager.getForkCheckpoint(latestCheckpoint.id);
    expect(unchanged?.turnCount).toBe(2);
  });
});
