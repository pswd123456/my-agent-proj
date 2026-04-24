import { describe, expect, test } from "bun:test";

import type { SessionSnapshot } from "@ai-app-template/sdk";

import { canInterruptSessionExecution } from "./session-workbench-state";

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
      pendingPermissionRequest: null,
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

describe("canInterruptSessionExecution", () => {
  test("returns true while submitting even before the session snapshot flips to running", () => {
    expect(
      canInterruptSessionExecution({
        session: createSessionSnapshot(),
        submitting: true
      })
    ).toBe(true);
  });

  test("returns true for an active running session", () => {
    const session = createSessionSnapshot();
    session.context.status = "running";
    session.sessionState.loopState = "running";

    expect(
      canInterruptSessionExecution({
        session,
        submitting: false
      })
    ).toBe(true);
  });

  test("returns false for a waiting permission pause", () => {
    const session = createSessionSnapshot();
    session.context.status = "waiting_for_permission";

    expect(
      canInterruptSessionExecution({
        session,
        submitting: false
      })
    ).toBe(false);
  });
});
