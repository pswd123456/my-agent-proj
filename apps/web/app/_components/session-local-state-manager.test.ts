import { describe, expect, test } from "bun:test";

import type { SessionSnapshot } from "@ai-app-template/sdk";

import {
  applyStreamEventToSessionLocalState,
  beginSessionLocalInterrupt,
  beginSessionLocalSubmission,
  createSessionLocalStateMap,
  getSessionLocalStateBucket,
  finishSessionLocalSubmission,
  upsertSessionLocalState
} from "./session-local-state-manager";

function createSessionSnapshot(sessionId: string): SessionSnapshot {
  return {
    sessionId,
    createdAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:00:00.000Z",
    workingDirectory: `/tmp/${sessionId}`,
    model: "MiniMax-M2.7",
    contextWindow: 32000,
    maxTurns: 20,
    inputTokensCount: 0,
    promptCacheKey: "",
    messages: [],
    context: {
      status: "waiting_for_user_input",
      userId: "user-1",
      currentDateContext: "2026-05-03",
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

describe("session-local-state-manager", () => {
  test("keeps concurrent main-session submissions isolated", () => {
    const sessionA = createSessionSnapshot("session-a");
    const sessionB = createSessionSnapshot("session-b");

    let map = createSessionLocalStateMap();
    map = upsertSessionLocalState(map, sessionA);
    map = upsertSessionLocalState(map, sessionB);
    map = beginSessionLocalSubmission({
      map,
      session: sessionA,
      pendingUserMessage: {
        createdAt: "2026-05-03T00:00:01.000Z",
        text: "run a"
      }
    });
    map = beginSessionLocalSubmission({
      map,
      session: sessionB,
      pendingUserMessage: {
        createdAt: "2026-05-03T00:00:02.000Z",
        text: "run b"
      }
    });
    map = beginSessionLocalInterrupt(map, sessionB.sessionId);
    map = finishSessionLocalSubmission(map, sessionA.sessionId);

    const bucketA = getSessionLocalStateBucket(map, sessionA.sessionId);
    const bucketB = getSessionLocalStateBucket(map, sessionB.sessionId);

    expect(bucketA?.uiState.submitting).toBe(false);
    expect(bucketA?.messageManagerState.pendingUserMessage).toBeNull();
    expect(bucketB?.uiState.submitting).toBe(true);
    expect(bucketB?.uiState.interruptingSessionId).toBe(sessionB.sessionId);
    expect(bucketB?.messageManagerState.pendingUserMessage?.text).toBe("run b");
  });

  test("preserves another session bucket while refreshing a different session", () => {
    const sessionA = createSessionSnapshot("session-a");
    const sessionB = createSessionSnapshot("session-b");

    let map = createSessionLocalStateMap();
    map = upsertSessionLocalState(map, sessionA);
    map = upsertSessionLocalState(map, sessionB);
    map = beginSessionLocalSubmission({
      map,
      session: sessionA,
      pendingUserMessage: {
        createdAt: "2026-05-03T00:00:01.000Z",
        text: "keep running"
      }
    });
    map = upsertSessionLocalState(map, {
      ...sessionB,
      updatedAt: "2026-05-03T00:00:03.000Z",
      context: {
        ...sessionB.context,
        status: "running"
      },
      sessionState: {
        ...sessionB.sessionState,
        loopState: "running"
      }
    });

    const bucketA = getSessionLocalStateBucket(map, sessionA.sessionId);
    const bucketB = getSessionLocalStateBucket(map, sessionB.sessionId);

    expect(bucketA?.uiState.submitting).toBe(true);
    expect(bucketA?.messageManagerState.pendingUserMessage?.text).toBe(
      "keep running"
    );
    expect(bucketB?.uiState.session?.sessionState.loopState).toBe("running");
  });

  test("applies non-selected session stream events only to that session bucket", () => {
    const sessionA = createSessionSnapshot("session-a");
    const sessionB = createSessionSnapshot("session-b");

    let map = createSessionLocalStateMap();
    map = upsertSessionLocalState(map, sessionA);
    map = upsertSessionLocalState(map, sessionB);
    map = beginSessionLocalSubmission({
      map,
      session: sessionA,
      pendingUserMessage: {
        createdAt: "2026-05-03T00:00:01.000Z",
        text: "run a"
      }
    });
    map = beginSessionLocalSubmission({
      map,
      session: sessionB,
      pendingUserMessage: {
        createdAt: "2026-05-03T00:00:02.000Z",
        text: "run b"
      }
    });
    map = applyStreamEventToSessionLocalState(map, {
      kind: "permission_request",
      sessionId: sessionB.sessionId,
      createdAt: "2026-05-03T00:00:03.000Z",
      turnCount: 1,
      toolCallId: "tool-1",
      toolName: "read_file",
      request: {
        toolCallId: "tool-1",
        toolName: "read_file",
        toolInput: { path: "README.md" },
        family: "workspace-file",
        permissionProfile: "always-ask-user",
        summaryText: "Read file",
        createdAt: "2026-05-03T00:00:03.000Z"
      }
    });

    const bucketA = getSessionLocalStateBucket(map, sessionA.sessionId);
    const bucketB = getSessionLocalStateBucket(map, sessionB.sessionId);

    expect(bucketA?.messageManagerState.streamEvents).toHaveLength(0);
    expect(bucketA?.uiState.submitting).toBe(true);
    expect(bucketB?.messageManagerState.streamEvents).toHaveLength(1);
    expect(bucketB?.uiState.submitting).toBe(false);
    expect(bucketB?.uiState.session?.context.status).toBe(
      "waiting_for_permission"
    );
  });
});
