import { describe, expect, test } from "bun:test";

import type { SessionSnapshot } from "@ai-app-template/sdk";

import {
  applyStreamEventToSessionRegistry,
  bootstrapSessions,
  createSessionRegistryState,
  deleteSession,
  deriveRenderedSessions,
  hydrateSelectedSession,
  selectSession,
  upsertSession
} from "./session-registry-manager";

function createSessionSnapshot(
  sessionId: string,
  updatedAt: string
): SessionSnapshot {
  return {
    sessionId,
    createdAt: updatedAt,
    updatedAt,
    workingDirectory: "/tmp/project",
    contextWindow: 32000,
    inputTokensCount: 0,
    promptCacheKey: "",
    messages: [],
    context: {
      status: "ready",
      userId: "user-1",
      currentDateContext: "2026-04-24",
      yoloMode: false,
      planModeEnabled: false,
      taskBriefPath: null,
      workspaceEscapeAllowed: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: [],
      enabledCapabilityPacks: [],
      activeBackgroundTaskCount: 0,
      pendingPermissionRequest: null,
      pendingConfirmationPayload: null,
      pendingUserQuestionPayload: null,
      pendingBackgroundNotifications: [],
      pendingConflictSummary: null,
      firstUserMessage: null,
      lastUserMessage: null
    },
    sessionState: {
      loopState: "waiting for input",
      turnCount: 0,
      lastError: null,
      pendingToolCallIds: [],
      interruptRequested: false,
      historyCompactionsSinceFullCompaction: 0
    }
  };
}

describe("session-registry-manager", () => {
  test("bootstraps selected session from requested id", () => {
    const older = createSessionSnapshot(
      "session-1",
      "2026-04-24T00:00:00.000Z"
    );
    const newer = createSessionSnapshot(
      "session-2",
      "2026-04-24T01:00:00.000Z"
    );

    expect(bootstrapSessions([older, newer], "session-1")).toMatchObject({
      selectedSessionId: "session-1"
    });
  });

  test("hydrates current session and keeps summaries in sync", () => {
    const session = createSessionSnapshot(
      "session-1",
      "2026-04-24T00:00:00.000Z"
    );
    const state = hydrateSelectedSession(createSessionRegistryState(), session);

    expect(state.currentSession?.sessionId).toBe("session-1");
    expect(state.sessions[0]?.sessionId).toBe("session-1");
  });

  test("upserts selected session snapshot", () => {
    const session = createSessionSnapshot(
      "session-1",
      "2026-04-24T00:00:00.000Z"
    );
    const state = hydrateSelectedSession(createSessionRegistryState(), session);
    const updated = {
      ...session,
      updatedAt: "2026-04-24T01:00:00.000Z",
      context: { ...session.context, status: "running" as const }
    };

    const next = upsertSession(state, updated);
    expect(next.currentSession?.context.status).toBe("running");
    expect(deriveRenderedSessions(next)[0]?.sessionId).toBe("session-1");
  });

  test("deleting selected session falls back to next summary", () => {
    const first = createSessionSnapshot(
      "session-1",
      "2026-04-24T00:00:00.000Z"
    );
    const second = createSessionSnapshot(
      "session-2",
      "2026-04-24T01:00:00.000Z"
    );
    const bootstrapped = bootstrapSessions([first, second], "session-2");
    const selected = hydrateSelectedSession(
      selectSession(bootstrapped, "session-2"),
      second
    );

    const next = deleteSession(selected, "session-2");
    expect(next.selectedSessionId).toBe("session-1");
    expect(next.currentSession).toBeNull();
  });

  test("clears the hydrated current session when selecting a different session", () => {
    const first = createSessionSnapshot(
      "session-1",
      "2026-04-24T00:00:00.000Z"
    );
    const second = createSessionSnapshot(
      "session-2",
      "2026-04-24T01:00:00.000Z"
    );
    const state = hydrateSelectedSession(
      bootstrapSessions([first, second], "session-1"),
      first
    );

    const next = selectSession(state, "session-2");
    expect(next.selectedSessionId).toBe("session-2");
    expect(next.currentSession).toBeNull();
  });

  test("applies active stream events through the registry manager", () => {
    const session = createSessionSnapshot(
      "session-1",
      "2026-04-24T00:00:00.000Z"
    );
    const state = hydrateSelectedSession(createSessionRegistryState(), session);

    const next = applyStreamEventToSessionRegistry(state, {
      kind: "permission_approved",
      sessionId: "session-1",
      createdAt: "2026-04-24T00:00:01.000Z",
      turnCount: 1,
      toolCallId: "call-1",
      toolName: "read_file",
      request: {
        toolCallId: "call-1",
        toolName: "read_file",
        toolInput: { path: "../README.md" },
        family: "workspace-file",
        permissionProfile: "always-ask-user",
        summaryText: "读取工作区外文件",
        createdAt: "2026-04-24T00:00:00.000Z"
      }
    });

    expect(next.currentSession?.context.status).toBe("running");
    expect(next.currentSession?.sessionState.loopState).toBe(
      "waiting for tool result"
    );
    expect(deriveRenderedSessions(next)[0]?.status).toBe("running");
  });
});
