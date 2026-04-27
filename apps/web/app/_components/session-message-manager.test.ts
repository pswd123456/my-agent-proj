import { describe, expect, test } from "bun:test";

import type { RunStreamEvent, SessionSnapshot } from "@ai-app-template/sdk";

import {
  appendMessageManagerEvent,
  buildMessageManagerProjection,
  createMessageManagerState,
  registerMessageManagerCollapsedFlows
} from "./session-message-manager";

function createSession(messages: SessionSnapshot["messages"]): SessionSnapshot {
  return {
    sessionId: "session-1",
    workingDirectory: "/tmp/workspace",
    model: "MiniMax-M2.7",
    contextWindow: 200_000,
    maxTurns: 50,
    context: {
      userId: "user-1",
      status: "waiting_for_user_input",
      currentDateContext: "2026-04-27",
      yoloMode: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: [],
      enabledCapabilityPacks: [],
      pendingPermissionRequest: null,
      pendingConfirmationPayload: null,
      pendingUserQuestionPayload: null,
      pendingConflictSummary: null,
      lastUserMessage: null
    },
    messages,
    sessionState: {
      loopState: "waiting for input",
      turnCount: 1,
      lastError: null,
      pendingToolCallIds: [],
      interruptRequested: false
    },
    inputTokensCount: 0,
    promptCacheKey: "",
    updatedAt: "2026-04-27T00:00:00.000Z"
  };
}

function userBlock(
  id: string,
  content: string,
  createdAt: string
): Extract<SessionSnapshot["messages"][number], { kind: "user" }> {
  return { id, kind: "user", content, createdAt };
}

function assistantBlock(
  id: string,
  content: string,
  createdAt: string
): Extract<SessionSnapshot["messages"][number], { kind: "assistant" }> {
  return { id, kind: "assistant", content, createdAt };
}

function thinkingBlock(
  id: string,
  content: string,
  signature: string,
  createdAt: string
): Extract<SessionSnapshot["messages"][number], { kind: "assistant thinking" }> {
  return { id, kind: "assistant thinking", content, signature, createdAt };
}

function compactKinds(projection: ReturnType<typeof buildMessageManagerProjection>) {
  return projection.conversation.visibleItems.map((item) => {
    if (item.type !== "timeline") {
      return item.type;
    }

    if (item.item.type === "event") {
      return item.item.event.kind;
    }

    if (item.item.type === "pending-user") {
      return "pending-user";
    }

    return item.item.block.kind;
  });
}

describe("session-message-manager", () => {
  test("dedupes persisted assistant output against the active stream overlay", () => {
    let state = createMessageManagerState();
    state = appendMessageManagerEvent(state, {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:03.000Z",
      turnCount: 1,
      assistantMessageId: "assistant-1",
      text: "已经整理好了。",
      snapshot: "已经整理好了。"
    });

    const projection = buildMessageManagerProjection({
      session: createSession([
        userBlock("user-1", "看下这个问题", "2026-04-27T00:00:01.000Z"),
        assistantBlock(
          "assistant-1",
          "已经整理好了。",
          "2026-04-27T00:00:04.000Z"
        )
      ]),
      traceRecords: [],
      debugConversationView: false,
      state
    });

    expect(compactKinds(projection)).toEqual(["user", "assistant_text"]);
  });

  test("dedupes persisted thinking blocks against streamed thinking snapshots", () => {
    let state = createMessageManagerState();
    state = appendMessageManagerEvent(state, {
      kind: "thinking",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:02.000Z",
      turnCount: 1,
      thinkingMessageId: "thinking-1",
      text: "先检查当前状态。",
      signature: "sig-1"
    });

    const projection = buildMessageManagerProjection({
      session: createSession([
        userBlock("user-1", "排查一下", "2026-04-27T00:00:01.000Z"),
        thinkingBlock(
          "thinking-block-1",
          "先检查当前状态。",
          "sig-1",
          "2026-04-27T00:00:03.000Z"
        )
      ]),
      traceRecords: [],
      debugConversationView: true,
      state
    });

    expect(compactKinds(projection)).toEqual(["user", "thinking"]);
  });

  test("merges tool call, permission, and tool result into one compact execution item", () => {
    let state = createMessageManagerState();
    const toolCall: Extract<RunStreamEvent, { kind: "tool_call" }> = {
      kind: "tool_call",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:02.000Z",
      turnCount: 1,
      toolCallId: "tool-1",
      toolName: "edit_file",
      input: { path: "apps/web/app/page.tsx" }
    };
    state = appendMessageManagerEvent(state, toolCall);
    state = appendMessageManagerEvent(state, {
      kind: "permission_approved",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:03.000Z",
      turnCount: 1,
      toolCallId: "tool-1",
      toolName: "edit_file",
      request: {
        toolCallId: "tool-1",
        toolName: "edit_file",
        toolInput: { path: "apps/web/app/page.tsx" },
        family: "workspace-file",
        permissionProfile: "always-ask-user",
        summaryText: "需要确认后才能修改文件",
        createdAt: "2026-04-27T00:00:03.000Z"
      }
    });
    state = appendMessageManagerEvent(state, {
      kind: "tool_result",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:04.000Z",
      turnCount: 1,
      toolCallId: "tool-1",
      toolName: "edit_file",
      output: "ok",
      displayText: "已更新文件",
      isError: false
    });

    const projection = buildMessageManagerProjection({
      session: createSession([
        userBlock("user-1", "帮我改一下", "2026-04-27T00:00:01.000Z")
      ]),
      traceRecords: [],
      debugConversationView: false,
      state
    });

    expect(compactKinds(projection)).toEqual(["user", "compact-tool"]);
    expect(projection.conversation.visibleItems[1]).toMatchObject({
      type: "compact-tool",
      toolCallId: "tool-1",
      status: "success"
    });
  });

  test("keeps narrative order stable within a turn even when thinking arrives later", () => {
    let state = createMessageManagerState();
    state = appendMessageManagerEvent(state, {
      kind: "turn_start",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:02.000Z",
      turnCount: 1,
      session: {
        sessionId: "session-1",
        workingDirectory: "/tmp/workspace",
        model: "MiniMax-M2.7",
        sessionState: {
          loopState: "running",
          turnCount: 1,
          lastError: null,
          pendingToolCallIds: [],
          interruptRequested: false
        }
      }
    });
    state = appendMessageManagerEvent(state, {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:05.000Z",
      turnCount: 1,
      assistantMessageId: "assistant-1",
      text: "先看到了最终答复。",
      snapshot: "先看到了最终答复。"
    });
    state = appendMessageManagerEvent(state, {
      kind: "thinking",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:06.000Z",
      turnCount: 1,
      thinkingMessageId: "thinking-1",
      text: "实际上 thinking trace 到得更晚。",
      signature: "sig-late"
    });

    const projection = buildMessageManagerProjection({
      session: createSession([
        userBlock("user-1", "排一下顺序", "2026-04-27T00:00:01.000Z")
      ]),
      traceRecords: [],
      debugConversationView: true,
      state
    });

    expect(compactKinds(projection)).toEqual([
      "turn_start",
      "user",
      "thinking",
      "assistant_text"
    ]);
  });

  test("surfaces collapsed flow metadata and hides the assistant during auto-collapse", () => {
    let state = createMessageManagerState();
    state = appendMessageManagerEvent(state, {
      kind: "thinking",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:02.000Z",
      turnCount: 1,
      thinkingMessageId: "thinking-1",
      text: "先检查文件。",
      signature: "sig-1"
    });
    state = appendMessageManagerEvent(state, {
      kind: "tool_call",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:03.000Z",
      turnCount: 1,
      toolCallId: "tool-1",
      toolName: "read_file",
      input: { path: "apps/web/app/page.tsx" }
    });
    state = appendMessageManagerEvent(state, {
      kind: "tool_result",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:04.000Z",
      turnCount: 1,
      toolCallId: "tool-1",
      toolName: "read_file",
      output: "done",
      isError: false
    });
    state = appendMessageManagerEvent(state, {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:05.000Z",
      turnCount: 1,
      assistantMessageId: "assistant-1",
      text: "我已经看完并总结好了。",
      snapshot: "我已经看完并总结好了。"
    });
    state = appendMessageManagerEvent(state, {
      kind: "run_complete",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:06.000Z",
      status: "completed",
      stopReason: "end_turn",
      session: createSession([
        userBlock("user-1", "总结一下", "2026-04-27T00:00:01.000Z"),
        assistantBlock(
          "assistant-1",
          "我已经看完并总结好了。",
          "2026-04-27T00:00:05.000Z"
        )
      ])
    });

    const session = createSession([
      userBlock("user-1", "总结一下", "2026-04-27T00:00:01.000Z"),
      assistantBlock(
        "assistant-1",
        "我已经看完并总结好了。",
        "2026-04-27T00:00:05.000Z"
      )
    ]);
    const firstProjection = buildMessageManagerProjection({
      session,
      traceRecords: [],
      debugConversationView: false,
      state
    });

    expect(firstProjection.conversation.newlyCollapsedFlowKeys).toHaveLength(1);
    expect(compactKinds(firstProjection)).toEqual([
      "user",
      "compact-collapsed-flow",
      "assistant_text",
      "run_complete"
    ]);

    state = registerMessageManagerCollapsedFlows(
      state,
      firstProjection.conversation.newlyCollapsedFlowKeys
    );

    const secondProjection = buildMessageManagerProjection({
      session,
      traceRecords: [],
      debugConversationView: false,
      state
    });

    expect(secondProjection.conversation.hiddenAssistantItemKeys.size).toBe(1);
    expect(compactKinds(secondProjection)).toEqual([
      "user",
      "compact-collapsed-flow",
      "run_complete"
    ]);
  });
});
