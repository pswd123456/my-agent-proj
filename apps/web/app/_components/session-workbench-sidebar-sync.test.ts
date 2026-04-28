import { describe, expect, test } from "bun:test";

import type { SessionSnapshot } from "@ai-app-template/sdk";
import { toSessionSummary } from "@ai-app-template/sdk";

import { mergeSessionSummary } from "./session-workbench-state";

function createSessionSnapshot(): SessionSnapshot {
  return {
    sessionId: "session-1",
    workingDirectory: "/tmp/workspace",
    model: "MiniMax-M2.7",
    contextWindow: 200_000,
    maxTurns: 50,
    context: {
      userId: "user-1",
      status: "running",
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
    messages: [],
    sessionState: {
      loopState: "running",
      turnCount: 1,
      lastError: null,
      pendingToolCallIds: ["call-1"],
      interruptRequested: false,
      historyCompactionsSinceFullCompaction: 0
    },
    inputTokensCount: 0,
    promptCacheKey: "",
    updatedAt: "2026-04-24T00:00:01.000Z"
  };
}

describe("sidebar session summary sync", () => {
  test("current session snapshot overrides stale sidebar summary", () => {
    const fresh = createSessionSnapshot();
    const stale = {
      ...fresh,
      context: {
        ...fresh.context,
        status: "waiting_for_permission" as const,
        pendingPermissionRequest: {
          toolCallId: "call-1",
          toolName: "read_file",
          toolInput: { path: "../README.md" },
          family: "workspace-file" as const,
          permissionProfile: "always-ask-user" as const,
          summaryText: "读取工作区外文件",
          createdAt: "2026-04-24T00:00:00.000Z"
        }
      },
      sessionState: {
        ...fresh.sessionState,
        loopState: "waiting for input" as const,
        pendingToolCallIds: []
      },
      updatedAt: "2026-04-24T00:00:00.000Z"
    };

    const merged = mergeSessionSummary(
      [toSessionSummary(stale)],
      fresh,
      toSessionSummary
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.status).toBe("running");
    expect(merged[0]?.loopState).toBe("running");
    expect(merged[0]?.pendingPermission).toBe(false);
    expect(merged[0]?.pendingToolCallIds).toEqual(["call-1"]);
  });
});
