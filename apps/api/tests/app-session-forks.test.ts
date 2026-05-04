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
import { createMemoryRoutineRepository } from "@ai-app-template/db";

import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createTestSettingsConfigStore } from "./helpers/settings-config-store.js";
import { createApiApp, type ApiAppDependencies } from "../src/app.js";
import { resolveApiWorkingDirectory } from "../src/working-directory.js";

const workspaceRoot = "/Users/boneda/gitrepo/my-agent-proj";

async function createForkTestApp() {
  const sessionManager = await createPostgresTestSessionManager();
  const routineRepository = createMemoryRoutineRepository();
  const { settingsConfigStore } = await createTestSettingsConfigStore();
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
    settingsConfigStore,
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
    settingsConfigStore,
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
    model: "MiniMax-M2.7"
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

async function seedIntermediateCheckpoint(
  sessionManager: PostgresTestSessionManager
): Promise<{
  sourceSession: SessionSnapshot;
  checkpoint: SessionForkCheckpoint;
}> {
  let sourceSession = createSnapshot({
    sessionId: sessionManager.testId("source-intermediate-session"),
    workingDirectory: "/tmp/workspace",
    model: "MiniMax-M2.7"
  });
  sourceSession.messages = [
    {
      id: sessionManager.testId("user-1"),
      kind: "user",
      content: "帮我查一下 runtime",
      createdAt: "2026-05-01T00:00:00.000Z"
    },
    {
      id: sessionManager.testId("assistant-progress-1"),
      kind: "assistant",
      content: "我先看 runtime。",
      createdAt: "2026-05-01T00:00:01.000Z",
      responseGroupId: "group-1"
    },
    {
      id: sessionManager.testId("tool-call-1"),
      kind: "tool call",
      toolCallId: sessionManager.testId("tool-call-1"),
      toolName: "read_file",
      input: { path: "packages/agent/src/runtime/run-loop.ts" },
      state: "success",
      createdAt: "2026-05-01T00:00:02.000Z",
      responseGroupId: "group-1"
    },
    {
      id: sessionManager.testId("tool-result-1"),
      kind: "tool result",
      toolCallId: sessionManager.testId("tool-call-1"),
      toolName: "read_file",
      output: "file body",
      isError: false,
      state: "success",
      createdAt: "2026-05-01T00:00:03.000Z",
      responseGroupId: "group-1"
    }
  ];
  sourceSession.sessionState.turnCount = 1;
  sourceSession.context.firstUserMessage = "帮我查一下 runtime";
  sourceSession.context.lastUserMessage = "帮我查一下 runtime";
  sourceSession.context.status = "running";
  sourceSession = await sessionManager.recover(sourceSession);

  const checkpoint: SessionForkCheckpoint = {
    id: sessionManager.testId("checkpoint-intermediate-1"),
    sessionId: sourceSession.sessionId,
    assistantMessageId: sessionManager.testId("assistant-progress-1"),
    turnCount: 1,
    baseMessageCount: 1,
    responseGroupId: "group-1",
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
    createdAt: "2026-05-01T00:00:04.000Z",
    updatedAt: "2026-05-01T00:00:04.000Z"
  };
  await sessionManager.saveForkCheckpoint(checkpoint);

  return { sourceSession, checkpoint };
}

async function seedRewriteScenario(input: {
  sessionManager: PostgresTestSessionManager;
  settingsConfigStore: Awaited<ReturnType<typeof createTestSettingsConfigStore>>["settingsConfigStore"];
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
  await input.settingsConfigStore.updateGlobalSettings({
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
          cacheCreationInputTokens: 2,
          cacheReadInputTokens: 3
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
          cacheCreationInputTokens: 5,
          cacheReadInputTokens: 7
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
    const { app, sessionManager, settingsConfigStore, setTraceRecords } =
      await createForkTestApp();
    const { session, latestCheckpoint } = await seedRewriteScenario({
      sessionManager,
      settingsConfigStore,
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

  test("does not expose intermediate assistant checkpoints as fork targets", async () => {
    const { app, sessionManager } = await createForkTestApp();
    const { sourceSession, checkpoint } =
      await seedIntermediateCheckpoint(sessionManager);

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
    expect(targetsPayload.forkTargets).toEqual([]);

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
    expect(createForkResponse.status).toBe(409);
    expect(await createForkResponse.json()).toEqual({
      error:
        "Only final assistant responses can be forked. Intermediate progress messages are not valid fork targets."
    });
  });

  test("recovers the latest rewrite target and prunes later checkpoints and trace", async () => {
    const {
      app,
      sessionManager,
      settingsConfigStore,
      setTraceRecords,
      getTraceRecords
    } = await createForkTestApp();
    const { session, firstCheckpoint, latestCheckpoint } = await seedRewriteScenario({
      sessionManager,
      settingsConfigStore,
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
      traceRecords: TraceRecord[];
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
    expect(payload.session.inputTokensCount).toBe(16);
    expect(payload.traceRecords.map((record) => record.event.turnCount)).toEqual([
      1
    ]);
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

  test("keeps current model and thinking effort when recovering a rewrite target", async () => {
    const { app, sessionManager, settingsConfigStore, setTraceRecords } =
      await createForkTestApp();
    const { session, latestCheckpoint } = await seedRewriteScenario({
      sessionManager,
      settingsConfigStore,
      setTraceRecords
    });

    const updateResponse = await app.request(
      `/sessions/${session.sessionId}/settings`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "deepseek-v4-pro",
          thinkingEffort: "max"
        })
      }
    );
    expect(updateResponse.status).toBe(200);

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
    };
    expect(payload.session.model).toBe("deepseek-v4-pro");
    expect(payload.session.context.thinkingEffort).toBe("max");
  });

  test("rejects rewrites that do not target the latest rewriteable user message", async () => {
    const { app, sessionManager, settingsConfigStore, setTraceRecords } =
      await createForkTestApp();
    const { session, firstCheckpoint, latestCheckpoint } = await seedRewriteScenario({
      sessionManager,
      settingsConfigStore,
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
