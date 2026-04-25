import { describe, expect, test } from "bun:test";

import type { SessionSnapshot } from "@ai-app-template/sdk";

import {
  applyStreamEventToSessionState,
  beginSessionInterrupt,
  beginSessionSubmission,
  createSessionUiState,
  rollbackSessionUiState
} from "./session-state-manager";

function createSessionSnapshot(): SessionSnapshot {
  return {
    sessionId: "session-1",
    workingDirectory: "/tmp/workspace",
    model: "MiniMax-M2.7",
    contextWindow: 200_000,
    maxTurns: 50,
    context: {
      userId: "user-1",
      status: "waiting_for_user_input",
      currentDateContext: "2026-04-24",
      yoloMode: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: [],
      enabledCapabilityPacks: [],
      pendingPermissionRequest: {
        toolCallId: "call-1",
        toolName: "read_file",
        toolInput: { path: "../README.md" },
        family: "workspace-file",
        permissionProfile: "always-ask-user",
        summaryText: "读取工作区外文件",
        createdAt: "2026-04-24T00:00:00.000Z"
      },
      pendingConfirmationPayload: null,
      pendingConflictSummary: null,
      lastUserMessage: null
    },
    messages: [],
    sessionState: {
      loopState: "waiting for input",
      turnCount: 0,
      lastError: null,
      pendingToolCallIds: [],
      interruptRequested: false
    },
    inputTokensCount: 0,
    promptCacheKey: "",
    updatedAt: "2026-04-24T00:00:00.000Z"
  };
}

describe("session-state-manager", () => {
  test("marks session as running immediately when submission begins", () => {
    const state = beginSessionSubmission(
      createSessionUiState(createSessionSnapshot())
    );

    expect(state.submitting).toBe(true);
    expect(state.session?.context.status).toBe("running");
    expect(state.session?.sessionState.loopState).toBe("running");
  });

  test("clears pending permission and keeps running after approval event", () => {
    const base = beginSessionSubmission(
      createSessionUiState(createSessionSnapshot())
    );

    const next = applyStreamEventToSessionState(base, {
      kind: "permission_approved",
      sessionId: "session-1",
      createdAt: "2026-04-24T00:00:01.000Z",
      turnCount: 1,
      toolCallId: "call-1",
      toolName: "read_file",
      request: base.session!.context.pendingPermissionRequest!
    });

    expect(next.submitting).toBe(false);
    expect(next.session?.context.status).toBe("running");
    expect(next.session?.context.pendingPermissionRequest).toBeNull();
    expect(next.session?.sessionState.loopState).toBe("running");
    expect(next.session?.sessionState.pendingToolCallIds).toEqual(["call-1"]);
  });

  test("restores the previous session snapshot when submit fails before events arrive", () => {
    const original = createSessionSnapshot();
    const optimistic = beginSessionSubmission(createSessionUiState(original));

    const rolledBack = rollbackSessionUiState(optimistic, original.sessionId);

    expect(rolledBack.submitting).toBe(false);
    expect(rolledBack.interruptingSessionId).toBeNull();
    expect(rolledBack.optimisticSessionSnapshot).toBeNull();
    expect(rolledBack.session).toEqual(original);
  });

  test("restores the previous interrupt flag when interrupt fails", () => {
    const original = createSessionSnapshot();
    original.context.status = "running";
    original.sessionState.loopState = "running";
    const optimistic = beginSessionInterrupt(
      createSessionUiState(original),
      original.sessionId
    );

    const rolledBack = rollbackSessionUiState(optimistic, original.sessionId);

    expect(rolledBack.submitting).toBe(false);
    expect(rolledBack.interruptingSessionId).toBeNull();
    expect(rolledBack.optimisticSessionSnapshot).toBeNull();
    expect(rolledBack.session).toEqual(original);
  });
});
