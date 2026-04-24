import { describe, expect, test } from "bun:test";

import type { SessionSnapshot } from "@ai-app-template/sdk";

import {
  canInterruptSessionExecution,
  getSessionDisplayState
} from "./session-workbench-state";

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

describe("getSessionDisplayState", () => {
  test("prefers permission pause over generic waiting input", () => {
    const session = createSessionSnapshot();
    session.context.status = "waiting_for_permission";
    session.context.pendingPermissionRequest = {
      toolCallId: "call-1",
      toolName: "read_file",
      toolInput: { path: "../README.md" },
      family: "workspace-file",
      permissionProfile: "always-ask-user",
      summaryText: "读取工作区外文件",
      createdAt: "2026-04-24T00:00:00.000Z"
    };

    expect(
      getSessionDisplayState({
        loopState: session.sessionState.loopState,
        status: session.context.status,
        pendingToolCallIds: session.sessionState.pendingToolCallIds,
        interruptRequested: session.sessionState.interruptRequested,
        pendingPermission: Boolean(session.context.pendingPermissionRequest),
        pendingConfirmation: Boolean(session.context.pendingConfirmationPayload)
      })
    ).toMatchObject({
      label: "等待权限确认",
      isWaitingForUser: true,
      isActiveExecution: false
    });
  });

  test("describes conflict confirmation separately from plain input", () => {
    const session = createSessionSnapshot();
    session.context.status = "waiting_for_conflict_confirmation";
    session.context.pendingConfirmationPayload = {
      summaryText: "已有日程冲突",
      proposedItems: [],
      createdAt: "2026-04-24T00:00:00.000Z"
    };

    expect(
      getSessionDisplayState({
        loopState: session.sessionState.loopState,
        status: session.context.status,
        pendingToolCallIds: session.sessionState.pendingToolCallIds,
        interruptRequested: session.sessionState.interruptRequested,
        pendingPermission: Boolean(session.context.pendingPermissionRequest),
        pendingConfirmation: Boolean(session.context.pendingConfirmationPayload)
      }).label
    ).toBe("等待冲突确认");
  });

  test("keeps tool-result waits active even before context status refreshes", () => {
    const session = createSessionSnapshot();
    session.context.status = "running";
    session.sessionState.loopState = "waiting for tool result";
    session.sessionState.pendingToolCallIds = ["call-1", "call-2"];

    expect(
      getSessionDisplayState({
        loopState: session.sessionState.loopState,
        status: session.context.status,
        pendingToolCallIds: session.sessionState.pendingToolCallIds,
        interruptRequested: session.sessionState.interruptRequested,
        pendingPermission: Boolean(session.context.pendingPermissionRequest),
        pendingConfirmation: Boolean(session.context.pendingConfirmationPayload)
      })
    ).toMatchObject({
      label: "等待工具结果 · 2",
      isActiveExecution: true
    });
  });
});
