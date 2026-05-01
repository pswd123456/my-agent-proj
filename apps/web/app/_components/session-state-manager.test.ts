import { describe, expect, test } from "bun:test";

import type { SessionSnapshot } from "@ai-app-template/sdk";

import {
  applyStreamEventToSessionState,
  beginSessionInterrupt,
  beginSessionSubmission,
  createSessionUiState,
  rollbackSessionUiState,
  setSessionSnapshot
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
      pendingUserQuestionPayload: null,
      pendingConflictSummary: null,
      firstUserMessage: null,
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
    const snapshot = createSessionSnapshot();
    snapshot.context.pendingUserQuestionPayload = {
      questions: [
        {
          questionText: "先做 CLI 还是 Web？",
          options: []
        }
      ],
      createdAt: "2026-04-24T00:00:00.000Z"
    };
    const state = beginSessionSubmission(createSessionUiState(snapshot));

    expect(state.submitting).toBe(true);
    expect(state.session?.context.status).toBe("running");
    expect(state.session?.context.pendingUserQuestionPayload).toBeNull();
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

  test("clears the interrupting marker when a refreshed snapshot is no longer interrupting", () => {
    const running = createSessionSnapshot();
    running.context.status = "running";
    running.sessionState.loopState = "running";
    const interrupting = beginSessionInterrupt(
      createSessionUiState(running),
      running.sessionId
    );

    const stopped = createSessionSnapshot();
    stopped.sessionState.loopState = "interrupted";
    stopped.sessionState.interruptRequested = false;
    stopped.context.status = "waiting_for_user_input";
    const refreshed = setSessionSnapshot(interrupting, stopped);

    expect(refreshed.interruptingSessionId).toBeNull();
    expect(refreshed.session?.sessionState.interruptRequested).toBe(false);
  });

  test("clears the submitting flag when a refreshed snapshot is already interrupted", () => {
    const running = createSessionSnapshot();
    running.context.status = "running";
    running.sessionState.loopState = "running";
    const submitting = beginSessionSubmission(createSessionUiState(running));
    const interrupting = beginSessionInterrupt(submitting, running.sessionId);

    const stopped = createSessionSnapshot();
    stopped.context.status = "waiting_for_user_input";
    stopped.sessionState.loopState = "interrupted";
    stopped.sessionState.interruptRequested = false;

    const refreshed = setSessionSnapshot(interrupting, stopped);

    expect(refreshed.submitting).toBe(false);
    expect(refreshed.interruptingSessionId).toBeNull();
    expect(refreshed.session?.sessionState.loopState).toBe("interrupted");
  });

  test("updates todo state from streamed get_todo_list results", () => {
    const session = createSessionSnapshot();
    session.context.status = "running";
    session.context.pendingPermissionRequest = null;
    session.sessionState.loopState = "waiting for tool result";
    session.sessionState.pendingToolCallIds = ["tool-call-1"];

    const next = applyStreamEventToSessionState(createSessionUiState(session), {
      kind: "tool_result",
      sessionId: session.sessionId,
      createdAt: "2026-04-26T00:00:01.000Z",
      turnCount: 1,
      toolCallId: "tool-call-1",
      toolName: "get_todo_list",
      isError: false,
      output: JSON.stringify({
        ok: true,
        code: "TODO_LIST_READ",
        message: "Read the current session todo list.",
        data: {
          items: [
            {
              id: "item-1",
              content: "做前端可视化",
              status: "in_progress",
              createdAt: "2026-04-26T00:00:00.000Z",
              updatedAt: "2026-04-26T00:00:01.000Z"
            },
            {
              id: "item-2",
              content: "补状态同步",
              status: "pending",
              createdAt: "2026-04-26T00:00:00.000Z",
              updatedAt: "2026-04-26T00:00:00.000Z"
            }
          ],
          activeItemId: "item-1",
          lastUpdatedAt: "2026-04-26T00:00:01.000Z"
        }
      })
    });

    expect(next.session?.context.todoState).toEqual({
      items: [
        {
          id: "item-1",
          content: "做前端可视化",
          status: "in_progress",
          createdAt: "2026-04-26T00:00:00.000Z",
          updatedAt: "2026-04-26T00:00:01.000Z"
        },
        {
          id: "item-2",
          content: "补状态同步",
          status: "pending",
          createdAt: "2026-04-26T00:00:00.000Z",
          updatedAt: "2026-04-26T00:00:00.000Z"
        }
      ],
      activeItemId: "item-1",
      lastUpdatedAt: "2026-04-26T00:00:01.000Z"
    });
    expect(next.session?.sessionState.pendingToolCallIds).toEqual([]);
    expect(next.session?.sessionState.loopState).toBe("running");
  });

  test("switches into waiting clarification as soon as the question event arrives", () => {
    const session = createSessionSnapshot();
    session.context.pendingPermissionRequest = null;
    session.context.status = "running";
    session.sessionState.loopState = "running";

    const next = applyStreamEventToSessionState(createSessionUiState(session), {
      kind: "user_question_request",
      sessionId: session.sessionId,
      createdAt: "2026-04-26T00:00:01.000Z",
      turnCount: 1,
      question: {
        questions: [
          {
            questionText: "先做 CLI 还是 Web？",
            options: []
          }
        ],
        createdAt: "2026-04-26T00:00:01.000Z"
      }
    });

    expect(next.submitting).toBe(false);
    expect(next.session?.context.status).toBe("waiting_for_user_question");
    expect(
      next.session?.context.pendingUserQuestionPayload?.questions[0]
        ?.questionText
    ).toBe("先做 CLI 还是 Web？");
    expect(next.session?.sessionState.loopState).toBe("waiting for input");
  });

  test("keeps the composer locked after run_complete until final refresh finishes", () => {
    const session = createSessionSnapshot();
    session.context.pendingPermissionRequest = null;
    session.context.status = "running";
    session.sessionState.loopState = "running";
    const base = beginSessionSubmission(createSessionUiState(session));
    const completedSession = {
      ...session,
      context: {
        ...session.context,
        status: "completed" as const
      },
      sessionState: {
        ...session.sessionState,
        loopState: "completed" as const
      }
    };

    const next = applyStreamEventToSessionState(base, {
      kind: "run_complete",
      sessionId: session.sessionId,
      createdAt: "2026-04-26T00:00:02.000Z",
      turnCount: 1,
      status: "completed",
      stopReason: "end_turn",
      session: completedSession
    });

    expect(next.submitting).toBe(true);
    expect(next.session).toBe(completedSession);
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
