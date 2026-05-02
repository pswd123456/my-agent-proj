import { describe, expect, test } from "bun:test";

import type {
  RunStreamEvent,
  SessionSnapshot,
  TraceRecord
} from "@ai-app-template/sdk";

import {
  appendMessageManagerEvent,
  beginMessageManagerRun,
  buildMessageManagerProjection,
  completeMessageManagerAutoCollapse,
  createMessageManagerState,
  finishMessageManagerRun,
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
      firstUserMessage: null,
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
): Extract<
  SessionSnapshot["messages"][number],
  { kind: "assistant thinking" }
> {
  return { id, kind: "assistant thinking", content, signature, createdAt };
}

function compactKinds(
  projection: ReturnType<typeof buildMessageManagerProjection>
) {
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

    if (item.item.type === "pending-hook") {
      return "pending-hook";
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

  test("hides pending user echo once the submitted user message is persisted", () => {
    let state = createMessageManagerState();
    state = beginMessageManagerRun(state, {
      message: {
        createdAt: "2026-04-27T00:00:01.000Z",
        text: "今天要花两个小时开会"
      }
    });
    state = appendMessageManagerEvent(state, {
      kind: "turn_start",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:02.000Z",
      turnCount: 2,
      session: {
        sessionId: "session-1",
        workingDirectory: "/tmp/workspace",
        model: "MiniMax-M2.7",
        sessionState: {
          loopState: "running",
          turnCount: 2,
          lastError: null,
          pendingToolCallIds: [],
          interruptRequested: false
        }
      }
    });

    const projection = buildMessageManagerProjection({
      session: createSession([
        userBlock("user-2", "今天要花两个小时开会", "2026-04-27T00:00:01.500Z")
      ]),
      traceRecords: [],
      debugConversationView: false,
      state
    });

    expect(compactKinds(projection)).toEqual(["user"]);
  });

  test("shows a pending hook phase before the user message when pre-user hooks are active", () => {
    let state = createMessageManagerState();
    state = beginMessageManagerRun(state, {
      message: {
        createdAt: "2026-04-27T00:00:01.000Z",
        text: "先处理这个请求"
      },
      pendingPreUserHooks: {
        runCount: 1,
        hooks: [
          {
            event: "run_started",
            title: "默认上下文"
          }
        ]
      }
    });

    const projection = buildMessageManagerProjection({
      session: createSession([]),
      traceRecords: [],
      debugConversationView: false,
      state
    });

    expect(compactKinds(projection)).toEqual(["pending-hook"]);
  });

  test("keeps a blocking subagent hook hint while its background task is active", () => {
    let state = createMessageManagerState();
    state = beginMessageManagerRun(state, {
      message: {
        createdAt: "2026-04-27T00:00:01.000Z",
        text: "先处理这个请求"
      },
      pendingPreUserHooks: {
        runCount: 0,
        hooks: [
          {
            event: "run_started",
            behavior: "subagent",
            title: "长期记忆"
          }
        ]
      }
    });

    const activeSession = createSession([]);
    activeSession.context.activeBackgroundTaskCount = 1;
    activeSession.context.status = "waiting_for_user_input";
    activeSession.sessionState.loopState = "waiting for input";

    state = appendMessageManagerEvent(state, {
      kind: "run_complete",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:02.000Z",
      finalAnswer: null,
      status: "waiting for input",
      stopReason: "background_task_running",
      toolCallCount: 0,
      toolResultCount: 0,
      toolOutputs: [],
      session: activeSession
    });
    state = finishMessageManagerRun(state);

    const projection = buildMessageManagerProjection({
      session: activeSession,
      traceRecords: [],
      debugConversationView: false,
      state
    });

    expect(compactKinds(projection)).toEqual(["pending-hook"]);
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

  test("surfaces collapsed flow metadata without auto-expanding hydrated history", () => {
    const session = createSession([
      userBlock("user-1", "总结一下", "2026-04-27T00:00:01.000Z"),
      assistantBlock(
        "assistant-1",
        "我已经看完并总结好了。",
        "2026-04-27T00:00:05.000Z"
      )
    ]);
    const traceRecords: TraceRecord[] = [
      {
        sessionId: "session-1",
        createdAt: "2026-04-27T00:00:02.000Z",
        event: {
          kind: "thinking",
          turnCount: 1,
          thinkingMessageId: "thinking-1",
          text: "先检查文件。",
          signature: "sig-1"
        }
      },
      {
        sessionId: "session-1",
        createdAt: "2026-04-27T00:00:03.000Z",
        event: {
          kind: "tool_call",
          turnCount: 1,
          toolCallId: "tool-1",
          toolName: "read_file",
          input: { path: "apps/web/app/page.tsx" }
        }
      },
      {
        sessionId: "session-1",
        createdAt: "2026-04-27T00:00:04.000Z",
        event: {
          kind: "tool_result",
          turnCount: 1,
          toolCallId: "tool-1",
          toolName: "read_file",
          output: "done",
          isError: false
        }
      },
      {
        sessionId: "session-1",
        createdAt: "2026-04-27T00:00:05.000Z",
        event: {
          kind: "assistant_text",
          turnCount: 1,
          assistantMessageId: "assistant-1",
          text: "我已经看完并总结好了。",
          snapshot: "我已经看完并总结好了。"
        }
      },
      {
        sessionId: "session-1",
        createdAt: "2026-04-27T00:00:06.000Z",
        event: {
          kind: "run_complete",
          turnCount: 1,
          status: "completed",
          stopReason: "end_turn",
          session
        }
      }
    ];

    const firstProjection = buildMessageManagerProjection({
      session,
      traceRecords,
      debugConversationView: false,
      state: createMessageManagerState()
    });

    const collapsedFlowKey =
      firstProjection.conversation.conversationItems.find(
        (
          item
        ): item is Extract<typeof item, { type: "compact-collapsed-flow" }> =>
          item.type === "compact-collapsed-flow"
      )?.key;

    expect(firstProjection.conversation.newlyCollapsedFlowKeys).toHaveLength(0);
    expect(compactKinds(firstProjection)).toEqual([
      "user",
      "compact-collapsed-flow",
      "assistant_text"
    ]);

    if (!collapsedFlowKey) {
      throw new Error("Expected collapsed flow item");
    }

    const collapsedState = registerMessageManagerCollapsedFlows(
      createMessageManagerState(),
      [collapsedFlowKey]
    );

    const secondProjection = buildMessageManagerProjection({
      session,
      traceRecords,
      debugConversationView: false,
      state: collapsedState
    });

    expect(secondProjection.conversation.hiddenAssistantItemKeys.size).toBe(1);
    expect(compactKinds(secondProjection)).toEqual([
      "user",
      "compact-collapsed-flow"
    ]);
  });

  test("keeps hydrated collapsed flow folded when context hook trace metadata trails the final assistant", () => {
    const session = createSession([
      userBlock("user-1", "总结一下", "2026-04-27T00:00:01.000Z"),
      assistantBlock(
        "assistant-1",
        "我已经看完并总结好了。",
        "2026-04-27T00:00:05.000Z"
      )
    ]);
    const traceRecords: TraceRecord[] = [
      {
        sessionId: "session-1",
        createdAt: "2026-04-27T00:00:02.000Z",
        event: {
          kind: "thinking",
          turnCount: 1,
          thinkingMessageId: "thinking-1",
          text: "先检查文件。",
          signature: "sig-1"
        }
      },
      {
        sessionId: "session-1",
        createdAt: "2026-04-27T00:00:03.000Z",
        event: {
          kind: "tool_call",
          turnCount: 1,
          toolCallId: "tool-1",
          toolName: "read_file",
          input: { path: "apps/web/app/page.tsx" }
        }
      },
      {
        sessionId: "session-1",
        createdAt: "2026-04-27T00:00:04.000Z",
        event: {
          kind: "tool_result",
          turnCount: 1,
          toolCallId: "tool-1",
          toolName: "read_file",
          output: "done",
          isError: false
        }
      },
      {
        sessionId: "session-1",
        createdAt: "2026-04-27T00:00:05.000Z",
        event: {
          kind: "assistant_text",
          turnCount: 1,
          assistantMessageId: "assistant-1",
          text: "我已经看完并总结好了。",
          snapshot: "我已经看完并总结好了。"
        }
      },
      {
        sessionId: "session-1",
        createdAt: "2026-04-27T00:00:05.100Z",
        event: {
          kind: "context_hooks_loaded",
          turnCount: 1,
          userId: "user-1",
          hooks: []
        }
      }
    ];

    const projection = buildMessageManagerProjection({
      session,
      traceRecords,
      debugConversationView: false,
      state: createMessageManagerState()
    });

    expect(compactKinds(projection)).toEqual([
      "user",
      "compact-collapsed-flow",
      "assistant_text"
    ]);
  });

  test("marks a completed live execution flow as newly collapsed for auto-collapse", () => {
    const session = createSession([
      userBlock("user-1", "总结一下", "2026-04-27T00:00:01.500Z"),
      assistantBlock(
        "assistant-live",
        "我已经看完并总结好了。",
        "2026-04-27T00:00:05.000Z"
      )
    ]);
    let state = beginMessageManagerRun(createMessageManagerState(), {
      message: {
        createdAt: "2026-04-27T00:00:01.000Z",
        text: "总结一下"
      }
    });

    state = appendMessageManagerEvent(state, {
      kind: "turn_start",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:01.100Z",
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
      kind: "tool_call",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:02.000Z",
      turnCount: 1,
      toolCallId: "tool-1",
      toolName: "read_file",
      input: { path: "apps/web/app/page.tsx" }
    });
    state = appendMessageManagerEvent(state, {
      kind: "tool_result",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:03.000Z",
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
      assistantMessageId: "assistant-live",
      text: "我已经看完并总结好了。",
      snapshot: "我已经看完并总结好了。"
    });
    state = appendMessageManagerEvent(state, {
      kind: "run_complete",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:06.000Z",
      turnCount: 1,
      status: "completed",
      stopReason: "end_turn",
      session
    });

    const projection = buildMessageManagerProjection({
      session,
      traceRecords: [],
      debugConversationView: false,
      state
    });

    expect(projection.conversation.newlyCollapsedFlowKeys).toEqual([
      "compact-collapsed-flow-assistant-live"
    ]);
    expect(compactKinds(projection)).toEqual([
      "user",
      "compact-collapsed-flow",
      "assistant_text"
    ]);
  });

  test("marks a streaming final assistant after tool execution as newly collapsed", () => {
    const session = createSession([
      userBlock("user-1", "总结一下", "2026-04-27T00:00:01.500Z")
    ]);
    let state = beginMessageManagerRun(createMessageManagerState(), {
      message: {
        createdAt: "2026-04-27T00:00:01.000Z",
        text: "总结一下"
      }
    });

    state = appendMessageManagerEvent(state, {
      kind: "turn_start",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:01.100Z",
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
      kind: "tool_call",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:02.000Z",
      turnCount: 1,
      toolCallId: "tool-1",
      toolName: "read_file",
      input: { path: "apps/web/app/page.tsx" }
    });
    state = appendMessageManagerEvent(state, {
      kind: "tool_result",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:03.000Z",
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
      assistantMessageId: "assistant-live",
      text: "我已经看完并总结好了。",
      snapshot: "我已经看完并总结好了。"
    });

    const projection = buildMessageManagerProjection({
      session,
      traceRecords: [],
      debugConversationView: false,
      state
    });

    expect(projection.conversation.newlyCollapsedFlowKeys).toEqual([
      "compact-collapsed-flow-assistant-live"
    ]);
    expect(compactKinds(projection)).toEqual([
      "user",
      "compact-collapsed-flow",
      "assistant_text"
    ]);
  });

  test("does not replay collapse animation for a settled turn when the next run begins", () => {
    let state = registerMessageManagerCollapsedFlows(
      createMessageManagerState(),
      ["compact-collapsed-flow-assistant-1"]
    );
    state = completeMessageManagerAutoCollapse(
      state,
      "compact-collapsed-flow-assistant-1"
    );

    const nextRunState = beginMessageManagerRun(state, {
      message: {
        createdAt: "2026-04-27T00:00:10.000Z",
        text: "再看一下明天"
      }
    });

    const nextRunProjection = buildMessageManagerProjection({
      session: createSession([
        userBlock("user-1", "先总结一下", "2026-04-27T00:00:01.500Z"),
        assistantBlock(
          "assistant-1",
          "我已经看完了。",
          "2026-04-27T00:00:05.000Z"
        )
      ]),
      traceRecords: [
        {
          sessionId: "session-1",
          createdAt: "2026-04-27T00:00:02.000Z",
          event: {
            kind: "tool_call",
            turnCount: 1,
            toolCallId: "tool-1",
            toolName: "read_file",
            input: { path: "apps/web/app/page.tsx" }
          }
        },
        {
          sessionId: "session-1",
          createdAt: "2026-04-27T00:00:03.000Z",
          event: {
            kind: "tool_result",
            turnCount: 1,
            toolCallId: "tool-1",
            toolName: "read_file",
            output: "done",
            isError: false
          }
        },
        {
          sessionId: "session-1",
          createdAt: "2026-04-27T00:00:05.100Z",
          event: {
            kind: "run_complete",
            turnCount: 1,
            status: "completed",
            stopReason: "end_turn",
            session: createSession([
              userBlock("user-1", "先总结一下", "2026-04-27T00:00:01.500Z"),
              assistantBlock(
                "assistant-1",
                "我已经看完了。",
                "2026-04-27T00:00:05.000Z"
              )
            ])
          }
        }
      ],
      debugConversationView: false,
      state: nextRunState
    });

    expect(nextRunProjection.conversation.newlyCollapsedFlowKeys).toHaveLength(
      0
    );
    expect(compactKinds(nextRunProjection)).toEqual([
      "user",
      "compact-collapsed-flow",
      "assistant",
      "pending-user"
    ]);
  });

  test("does not treat unregistered tool-heavy history as newly collapsed during the next run", () => {
    let state = beginMessageManagerRun(createMessageManagerState(), {
      message: {
        createdAt: "2026-04-27T00:00:10.000Z",
        text: "继续看一下"
      }
    });
    const session = createSession([
      userBlock("user-1", "先读几个文件", "2026-04-27T00:00:01.000Z"),
      assistantBlock(
        "assistant-1",
        "这几个文件我已经看完了。",
        "2026-04-27T00:00:08.000Z"
      )
    ]);
    const traceRecords: TraceRecord[] = [
      {
        sessionId: "session-1",
        createdAt: "2026-04-27T00:00:02.000Z",
        event: {
          kind: "turn_start",
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
        }
      },
      {
        sessionId: "session-1",
        createdAt: "2026-04-27T00:00:03.000Z",
        event: {
          kind: "tool_call",
          turnCount: 1,
          toolCallId: "tool-1",
          toolName: "read_file",
          input: { path: "package.json" }
        }
      },
      {
        sessionId: "session-1",
        createdAt: "2026-04-27T00:00:04.000Z",
        event: {
          kind: "tool_result",
          turnCount: 1,
          toolCallId: "tool-1",
          toolName: "read_file",
          output: "package",
          isError: false
        }
      },
      {
        sessionId: "session-1",
        createdAt: "2026-04-27T00:00:05.000Z",
        event: {
          kind: "tool_call",
          turnCount: 1,
          toolCallId: "tool-2",
          toolName: "read_file",
          input: { path: "AGENTS.md" }
        }
      },
      {
        sessionId: "session-1",
        createdAt: "2026-04-27T00:00:06.000Z",
        event: {
          kind: "tool_result",
          turnCount: 1,
          toolCallId: "tool-2",
          toolName: "read_file",
          output: "agents",
          isError: false
        }
      },
      {
        sessionId: "session-1",
        createdAt: "2026-04-27T00:00:08.000Z",
        event: {
          kind: "assistant_text",
          turnCount: 1,
          assistantMessageId: "assistant-1",
          text: "这几个文件我已经看完了。",
          snapshot: "这几个文件我已经看完了。"
        }
      },
      {
        sessionId: "session-1",
        createdAt: "2026-04-27T00:00:09.000Z",
        event: {
          kind: "run_complete",
          turnCount: 1,
          status: "completed",
          stopReason: "end_turn",
          session
        }
      }
    ];

    let projection = buildMessageManagerProjection({
      session,
      traceRecords,
      debugConversationView: false,
      state
    });

    expect(projection.conversation.newlyCollapsedFlowKeys).toHaveLength(0);
    expect(projection.conversation.hiddenAssistantItemKeys.size).toBe(0);
    expect(compactKinds(projection)).toEqual([
      "user",
      "compact-collapsed-flow",
      "assistant_text",
      "pending-user"
    ]);

    state = appendMessageManagerEvent(state, {
      kind: "turn_start",
      sessionId: "session-1",
      createdAt: "2026-04-27T00:00:11.000Z",
      turnCount: 2,
      session: {
        sessionId: "session-1",
        workingDirectory: "/tmp/workspace",
        model: "MiniMax-M2.7",
        sessionState: {
          loopState: "running",
          turnCount: 2,
          lastError: null,
          pendingToolCallIds: [],
          interruptRequested: false
        }
      }
    });

    projection = buildMessageManagerProjection({
      session,
      traceRecords,
      debugConversationView: false,
      state
    });

    expect(projection.conversation.newlyCollapsedFlowKeys).toHaveLength(0);
    expect(projection.conversation.hiddenAssistantItemKeys.size).toBe(0);
    expect(compactKinds(projection)).toEqual([
      "user",
      "compact-collapsed-flow",
      "assistant_text",
      "pending-user"
    ]);
  });
});
