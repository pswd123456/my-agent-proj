import { describe, expect, test } from "bun:test";

import type { RunStreamEvent, SessionSnapshot } from "@ai-app-template/sdk";

import {
  buildConversationViewItems,
  getCompactCollapsedFlowAnchors,
  getCompactCollapsedFlowScrollTargetKey
} from "./session-conversation-view";
import {
  buildTimelineItems,
  getTimelineEventKey,
  getTimelineEventRenderKey,
  type TimelineItem
} from "./session-timeline";

const firstUser: Extract<
  SessionSnapshot["messages"][number],
  { kind: "user" }
> = {
  id: "user-1",
  kind: "user",
  content: "下午两点",
  createdAt: "2026-04-21T18:46:03.349Z"
};

const priorToolCall: Extract<
  SessionSnapshot["messages"][number],
  { kind: "tool call" }
> = {
  id: "tool-call-previous",
  kind: "tool call",
  toolCallId: "call-previous",
  toolName: "edit_routine",
  input: {
    routine_id: "routine-1",
    start_time: "19:00"
  },
  state: "pending",
  createdAt: "2026-04-21T02:46:21.783Z"
};

const turnStart: Extract<RunStreamEvent, { kind: "turn_start" }> = {
  kind: "turn_start",
  sessionId: "session-1",
  createdAt: "2026-04-21T18:46:03.364Z",
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
};

const thinkingEvent: Extract<RunStreamEvent, { kind: "thinking" }> = {
  kind: "thinking",
  sessionId: "session-1",
  createdAt: "2026-04-21T18:46:21.692Z",
  turnCount: 1,
  thinkingMessageId: "thinking-1",
  text: "需要先检查现有日程。",
  signature: "sig-1"
};

const currentToolCall: Extract<RunStreamEvent, { kind: "tool_call" }> = {
  kind: "tool_call",
  sessionId: "session-1",
  createdAt: "2026-04-21T18:46:21.720Z",
  turnCount: 1,
  toolCallId: "call-current",
  toolName: "delete_routine",
  input: {
    routine_id: "routine-2"
  }
};

const currentToolResult: Extract<RunStreamEvent, { kind: "tool_result" }> = {
  kind: "tool_result",
  sessionId: "session-1",
  createdAt: "2026-04-21T18:46:21.735Z",
  turnCount: 1,
  toolCallId: "call-current",
  toolName: "delete_routine",
  output: "ok",
  isError: false
};

const fileChangeDetails = {
  kind: "workspace_file_changes" as const,
  files: [
    {
      path: "apps/web/app/page.tsx",
      action: "modify" as const,
      addedLineCount: 4,
      removedLineCount: 2,
      diff: [
        "--- apps/web/app/page.tsx",
        "+++ apps/web/app/page.tsx",
        "@@ -10,2 +10,4 @@",
        "-old line",
        "+new line"
      ].join("\n")
    }
  ]
};

const turnEnd: Extract<RunStreamEvent, { kind: "turn_end" }> = {
  kind: "turn_end",
  sessionId: "session-1",
  createdAt: "2026-04-21T18:46:21.740Z",
  turnCount: 1,
  loopState: "completed"
};

function eventItem(
  event: RunStreamEvent
): Extract<TimelineItem, { type: "event" }> {
  return {
    type: "event",
    key: `event-${getTimelineEventKey(event)}`,
    createdAt: event.createdAt,
    event
  };
}

function messageItem(
  block: SessionSnapshot["messages"][number]
): Extract<TimelineItem, { type: "message" }> {
  return {
    type: "message",
    key: `message-${block.id}`,
    createdAt: block.createdAt,
    block
  };
}

const permissionRequestEvent: Extract<
  RunStreamEvent,
  { kind: "permission_request" }
> = {
  kind: "permission_request",
  sessionId: "session-1",
  createdAt: "2026-04-21T18:46:21.730Z",
  turnCount: 1,
  toolCallId: "call-current",
  toolName: "delete_routine",
  request: {
    toolCallId: "call-current",
    toolName: "delete_routine",
    toolInput: {
      routine_id: "routine-2"
    },
    family: "workspace-file",
    permissionProfile: "destructive-only",
    summaryText: "需要确认后才能删除。",
    createdAt: "2026-04-21T18:46:21.730Z"
  }
};

const permissionApprovedEvent: Extract<
  RunStreamEvent,
  { kind: "permission_approved" }
> = {
  kind: "permission_approved",
  sessionId: "session-1",
  createdAt: "2026-04-21T18:46:21.734Z",
  turnCount: 1,
  toolCallId: "call-current",
  toolName: "delete_routine",
  request: permissionRequestEvent.request
};

const permissionRejectedEvent: Extract<
  RunStreamEvent,
  { kind: "permission_rejected" }
> = {
  kind: "permission_rejected",
  sessionId: "session-1",
  createdAt: "2026-04-21T18:46:21.734Z",
  turnCount: 1,
  toolCallId: "call-current",
  toolName: "delete_routine",
  request: permissionRequestEvent.request
};

const interruptRequestedEvent: Extract<
  RunStreamEvent,
  { kind: "interrupt_requested" }
> = {
  kind: "interrupt_requested",
  sessionId: "session-1",
  createdAt: "2026-04-21T18:46:21.736Z",
  turnCount: 1
};

const interruptedEvent: Extract<RunStreamEvent, { kind: "interrupted" }> = {
  kind: "interrupted",
  sessionId: "session-1",
  createdAt: "2026-04-21T18:46:21.737Z",
  turnCount: 1,
  stopReason: "interrupted_by_user"
};

const interruptedRunCompleteEvent: Extract<
  RunStreamEvent,
  { kind: "run_complete" }
> = {
  kind: "run_complete",
  sessionId: "session-1",
  createdAt: "2026-04-21T18:46:21.738Z",
  status: "interrupted",
  stopReason: "interrupted_by_user",
  session: {
    sessionId: "session-1",
    workingDirectory: "/tmp/workspace",
    model: "MiniMax-M2.7",
    sessionState: {
      loopState: "interrupted",
      turnCount: 1,
      lastError: null,
      pendingToolCallIds: [],
      interruptRequested: false
    }
  }
};

const skillsLoadedEvent: Extract<RunStreamEvent, { kind: "skills_loaded" }> = {
  kind: "skills_loaded",
  sessionId: "session-1",
  createdAt: "2026-04-21T18:46:21.739Z",
  turnCount: 1,
  skills: [],
  diagnostics: []
};

describe("buildTimelineItems", () => {
  test("keeps turn boundaries and the current turn's thinking ahead of tool calls", () => {
    const items = buildTimelineItems({
      messages: [priorToolCall, firstUser],
      historyEvents: [turnStart, thinkingEvent, currentToolCall],
      streamEvents: []
    });

    expect(
      items.map((item) => {
        if (item.type === "event") {
          return item.event.kind;
        }

        if (item.type === "pending-user") {
          return "pending-user";
        }

        return item.block.kind;
      })
    ).toEqual(["tool call", "turn_start", "user", "thinking", "tool_call"]);
  });

  test("uses trace events instead of duplicating persisted assistant and tool blocks", () => {
    const assistantBlock: Extract<
      SessionSnapshot["messages"][number],
      { kind: "assistant" }
    > = {
      id: "assistant-1",
      kind: "assistant",
      content: "我来帮你安排。",
      createdAt: "2026-04-21T18:46:21.705Z"
    };

    const toolResultBlock: Extract<
      SessionSnapshot["messages"][number],
      { kind: "tool result" }
    > = {
      id: "tool-result-1",
      kind: "tool result",
      toolCallId: "call-current",
      toolName: "delete_routine",
      output: "ok",
      isError: false,
      state: "success",
      createdAt: "2026-04-21T18:46:21.735Z"
    };

    const assistantEvent: Extract<RunStreamEvent, { kind: "assistant_text" }> =
      {
        kind: "assistant_text",
        sessionId: "session-1",
        createdAt: "2026-04-21T18:46:21.705Z",
        turnCount: 1,
        assistantMessageId: "assistant-1",
        text: "我来帮你安排。"
      };

    const toolResultEvent: Extract<RunStreamEvent, { kind: "tool_result" }> = {
      kind: "tool_result",
      sessionId: "session-1",
      createdAt: "2026-04-21T18:46:21.735Z",
      turnCount: 1,
      toolCallId: "call-current",
      toolName: "delete_routine",
      output: "ok",
      displayText: "[delete_routine] success",
      isError: false
    };

    const items = buildTimelineItems({
      messages: [firstUser, assistantBlock, toolResultBlock],
      historyEvents: [turnStart, assistantEvent, toolResultEvent],
      streamEvents: []
    });

    expect(items.filter((item) => item.type === "message")).toHaveLength(1);
    expect(
      items
        .filter((item) => item.type === "event")
        .map((item) => item.event.kind)
    ).toEqual(["turn_start", "tool_result", "assistant_text"]);
  });

  test("uses thinking trace events instead of duplicating persisted thinking blocks", () => {
    const thinkingBlock: Extract<
      SessionSnapshot["messages"][number],
      { kind: "assistant thinking" }
    > = {
      id: "thinking-block-1",
      kind: "assistant thinking",
      content: thinkingEvent.text,
      signature: thinkingEvent.signature,
      createdAt: thinkingEvent.createdAt
    };

    const items = buildTimelineItems({
      messages: [firstUser, thinkingBlock],
      historyEvents: [turnStart, thinkingEvent],
      streamEvents: []
    });

    expect(items.filter((item) => item.type === "message")).toHaveLength(1);
    expect(
      items
        .filter((item) => item.type === "event")
        .map((item) => item.event.kind)
    ).toEqual(["turn_start", "thinking"]);
  });

  test("places permission requests between tool calls and tool results", () => {
    const toolResultEvent: Extract<RunStreamEvent, { kind: "tool_result" }> = {
      kind: "tool_result",
      sessionId: "session-1",
      createdAt: "2026-04-21T18:46:21.735Z",
      turnCount: 1,
      toolCallId: "call-current",
      toolName: "delete_routine",
      output: "pending approval",
      isError: false
    };

    const items = buildTimelineItems({
      messages: [firstUser],
      historyEvents: [
        turnStart,
        thinkingEvent,
        currentToolCall,
        permissionRequestEvent,
        toolResultEvent
      ],
      streamEvents: []
    });

    expect(
      items
        .filter((item) => item.type === "event")
        .map((item) => item.event.kind)
    ).toEqual([
      "turn_start",
      "thinking",
      "tool_call",
      "permission_request",
      "tool_result"
    ]);
  });

  test("collapses request plus approved into a single approved permission event", () => {
    const items = buildTimelineItems({
      messages: [firstUser],
      historyEvents: [
        turnStart,
        thinkingEvent,
        currentToolCall,
        permissionRequestEvent,
        permissionApprovedEvent
      ],
      streamEvents: []
    });

    expect(
      items
        .filter((item) => item.type === "event")
        .map((item) => item.event.kind)
    ).toEqual(["turn_start", "thinking", "tool_call", "permission_approved"]);
  });

  test("collapses request plus rejected into a single rejected permission event", () => {
    const items = buildTimelineItems({
      messages: [firstUser],
      historyEvents: [
        turnStart,
        thinkingEvent,
        currentToolCall,
        permissionRequestEvent,
        permissionRejectedEvent
      ],
      streamEvents: []
    });

    expect(
      items
        .filter((item) => item.type === "event")
        .map((item) => item.event.kind)
    ).toEqual(["turn_start", "thinking", "tool_call", "permission_rejected"]);
  });

  test("does not render interrupt request events in the conversation timeline", () => {
    const items = buildTimelineItems({
      messages: [firstUser],
      historyEvents: [
        turnStart,
        interruptRequestedEvent,
        interruptedEvent,
        interruptedRunCompleteEvent
      ],
      streamEvents: []
    });

    expect(
      items
        .filter((item) => item.type === "event")
        .map((item) => item.event.kind)
    ).toEqual(["turn_start", "run_complete"]);
  });

  test("does not render skills loaded events in the conversation timeline", () => {
    const items = buildTimelineItems({
      messages: [firstUser],
      historyEvents: [turnStart, skillsLoadedEvent, thinkingEvent],
      streamEvents: []
    });

    expect(
      items
        .filter((item) => item.type === "event")
        .map((item) => item.event.kind)
    ).toEqual(["turn_start", "thinking"]);
  });

  test("collapses streamed assistant snapshots by assistant message id", () => {
    const partialAssistantEvent: Extract<
      RunStreamEvent,
      { kind: "assistant_text" }
    > = {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-21T18:46:21.705Z",
      turnCount: 1,
      assistantMessageId: "assistant-stream-1",
      text: "我来"
    };

    const finalAssistantEvent: Extract<
      RunStreamEvent,
      { kind: "assistant_text" }
    > = {
      ...partialAssistantEvent,
      createdAt: "2026-04-21T18:46:21.715Z",
      text: "我来帮你安排。"
    };

    const items = buildTimelineItems({
      messages: [firstUser],
      historyEvents: [turnStart, partialAssistantEvent, finalAssistantEvent],
      streamEvents: []
    });

    const assistantEvents = items.filter(
      (item): item is Extract<(typeof items)[number], { type: "event" }> =>
        item.type === "event" && item.event.kind === "assistant_text"
    );

    expect(assistantEvents).toHaveLength(1);
    expect(assistantEvents[0]?.event.text).toBe("我来帮你安排。");
  });

  test("filters empty assistant text snapshots that only reserve timeline space", () => {
    const emptyAssistantEvent: Extract<
      RunStreamEvent,
      { kind: "assistant_text" }
    > = {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-24T08:35:24.150Z",
      turnCount: 1,
      assistantMessageId: "assistant-empty-1",
      text: ""
    };

    const items = buildTimelineItems({
      messages: [firstUser],
      historyEvents: [
        turnStart,
        thinkingEvent,
        emptyAssistantEvent,
        currentToolCall
      ],
      streamEvents: []
    });

    expect(
      items
        .filter((item) => item.type === "event")
        .map((item) => item.event.kind)
    ).toEqual(["turn_start", "thinking", "tool_call"]);
  });

  test("keeps thinking above the final assistant answer even when the trace arrives later", () => {
    const streamedAssistantEvent: Extract<
      RunStreamEvent,
      { kind: "assistant_text" }
    > = {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-21T18:46:21.700Z",
      turnCount: 1,
      assistantMessageId: "assistant-final-1",
      text: "已经安排好了。"
    };

    const delayedThinkingEvent: Extract<RunStreamEvent, { kind: "thinking" }> =
      {
        kind: "thinking",
        sessionId: "session-1",
        createdAt: "2026-04-21T18:46:21.710Z",
        turnCount: 1,
        text: "先确认时间冲突，再输出最终结果。",
        signature: "sig-final"
      };

    const items = buildTimelineItems({
      messages: [firstUser],
      historyEvents: [turnStart, streamedAssistantEvent, delayedThinkingEvent],
      streamEvents: []
    });

    expect(
      items
        .filter((item) => item.type === "event")
        .map((item) => item.event.kind)
    ).toEqual(["turn_start", "thinking", "assistant_text"]);
  });

  test("keeps later runs separate when the provider reuses turnCount values", () => {
    const secondUser: Extract<
      SessionSnapshot["messages"][number],
      { kind: "user" }
    > = {
      id: "user-2",
      kind: "user",
      content: "再看一下下一轮",
      createdAt: "2026-04-21T18:47:03.349Z"
    };
    const firstAssistantEvent: Extract<
      RunStreamEvent,
      { kind: "assistant_text" }
    > = {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-21T18:46:21.800Z",
      turnCount: 1,
      assistantMessageId: "assistant-final-1",
      text: "第一轮已经处理好了。"
    };
    const secondTurnStart: Extract<RunStreamEvent, { kind: "turn_start" }> = {
      ...turnStart,
      createdAt: "2026-04-21T18:47:03.364Z",
      turnCount: 1
    };
    const secondThinkingEvent: Extract<RunStreamEvent, { kind: "thinking" }> = {
      ...thinkingEvent,
      createdAt: "2026-04-21T18:47:21.692Z",
      turnCount: 1,
      thinkingMessageId: "thinking-2",
      signature: "sig-2",
      text: "第二轮先检查新的上下文。"
    };
    const secondAssistantEvent: Extract<
      RunStreamEvent,
      { kind: "assistant_text" }
    > = {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-21T18:47:21.800Z",
      turnCount: 1,
      assistantMessageId: "assistant-final-2",
      text: "第二轮也处理好了。"
    };

    const items = buildTimelineItems({
      messages: [firstUser, secondUser],
      historyEvents: [
        turnStart,
        thinkingEvent,
        firstAssistantEvent,
        secondTurnStart,
        secondThinkingEvent,
        secondAssistantEvent
      ],
      streamEvents: []
    });

    expect(
      items.map((item) => {
        if (item.type === "event") {
          return item.event.kind;
        }

        if (item.type === "pending-user") {
          return "pending-user";
        }

        return item.block.kind;
      })
    ).toEqual([
      "turn_start",
      "user",
      "thinking",
      "assistant_text",
      "turn_start",
      "user",
      "thinking",
      "assistant_text"
    ]);
  });

  test("renders provider-emitted historical tool text as assistant text instead of tool call", () => {
    const historicalAssistantEvent: Extract<
      RunStreamEvent,
      { kind: "assistant_text" }
    > = {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-24T08:35:24.179Z",
      turnCount: 4,
      assistantMessageId: "assistant-historical-1",
      text: '[Historical tool call] list_directory {"path":"../apps/worker/src"}'
    };

    const items = buildTimelineItems({
      messages: [firstUser],
      historyEvents: [turnStart, historicalAssistantEvent],
      streamEvents: []
    });

    const events = items.filter(
      (item): item is Extract<(typeof items)[number], { type: "event" }> =>
        item.type === "event"
    );

    expect(events.map((item) => item.event.kind)).toEqual([
      "turn_start",
      "assistant_text"
    ]);
    expect(events[1]?.event.kind).toBe("assistant_text");
    if (events[1]?.event.kind === "assistant_text") {
      expect(events[1].event.text).toContain("[Historical tool call]");
    }
  });

  test("assistant text keys stay unique across streamed snapshots", () => {
    const partialAssistantEvent: Extract<
      RunStreamEvent,
      { kind: "assistant_text" }
    > = {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-24T08:35:24.100Z",
      turnCount: 1,
      assistantMessageId: "assistant-stream-dup-1",
      text: "先看"
    };

    const finalAssistantEvent: Extract<
      RunStreamEvent,
      { kind: "assistant_text" }
    > = {
      ...partialAssistantEvent,
      createdAt: "2026-04-24T08:35:24.200Z",
      text: "先看看这个问题。"
    };

    expect(getTimelineEventRenderKey(partialAssistantEvent)).not.toBe(
      getTimelineEventRenderKey(finalAssistantEvent)
    );
  });

  test("collapses streamed thinking snapshots by thinking message id", () => {
    const partialThinkingEvent: Extract<RunStreamEvent, { kind: "thinking" }> = {
      kind: "thinking",
      sessionId: "session-1",
      createdAt: "2026-04-24T08:35:24.100Z",
      turnCount: 1,
      thinkingMessageId: "thinking-stream-1",
      text: "先看",
      signature: ""
    };

    const finalThinkingEvent: Extract<RunStreamEvent, { kind: "thinking" }> = {
      ...partialThinkingEvent,
      createdAt: "2026-04-24T08:35:24.200Z",
      text: "先看看这个问题。",
      signature: "sig-thinking-stream-1"
    };

    const items = buildTimelineItems({
      messages: [firstUser],
      historyEvents: [turnStart, partialThinkingEvent, finalThinkingEvent],
      streamEvents: []
    });

    const thinkingEvents = items.filter(
      (item): item is Extract<(typeof items)[number], { type: "event" }> =>
        item.type === "event" && item.event.kind === "thinking"
    );

    expect(thinkingEvents).toHaveLength(1);
    expect(thinkingEvents[0]?.event.text).toBe("先看看这个问题。");
    if (thinkingEvents[0]?.event.kind === "thinking") {
      expect(thinkingEvents[0].event.signature).toBe("sig-thinking-stream-1");
    }
  });

  test("thinking render keys stay unique across streamed snapshots", () => {
    const partialThinkingEvent: Extract<RunStreamEvent, { kind: "thinking" }> = {
      kind: "thinking",
      sessionId: "session-1",
      createdAt: "2026-04-24T08:35:24.100Z",
      turnCount: 1,
      thinkingMessageId: "thinking-stream-dup-1",
      text: "先看",
      signature: ""
    };

    const finalThinkingEvent: Extract<RunStreamEvent, { kind: "thinking" }> = {
      ...partialThinkingEvent,
      createdAt: "2026-04-24T08:35:24.200Z",
      text: "先看看这个问题。",
      signature: "sig-thinking-stream-dup-1"
    };

    expect(getTimelineEventRenderKey(partialThinkingEvent)).not.toBe(
      getTimelineEventRenderKey(finalThinkingEvent)
    );
  });
});

describe("buildConversationViewItems compact mode", () => {
  test("collapses a tool call and result into one updated tool item", () => {
    const runningView = buildConversationViewItems({
      timelineItems: [
        messageItem(firstUser),
        eventItem(turnStart),
        eventItem(currentToolCall)
      ],
      mode: "compact"
    });
    const doneView = buildConversationViewItems({
      timelineItems: [
        messageItem(firstUser),
        eventItem(turnStart),
        eventItem(currentToolCall),
        eventItem(currentToolResult)
      ],
      mode: "compact"
    });

    expect(runningView.map((item) => item.type)).toEqual([
      "timeline",
      "compact-tool"
    ]);
    expect(doneView.map((item) => item.type)).toEqual([
      "timeline",
      "compact-tool"
    ]);
    expect(runningView[1]?.type).toBe("compact-tool");
    expect(doneView[1]?.type).toBe("compact-tool");
    if (runningView[1]?.type === "compact-tool") {
      expect(runningView[1].title).toContain("正在编辑");
    }
    if (doneView[1]?.type === "compact-tool") {
      expect(doneView[1].title).toContain("已编辑");
      expect(doneView[1].originalItems).toHaveLength(2);
    }
  });

  test("keeps structured file changes on compact tool items from live events", () => {
    const editCall: Extract<RunStreamEvent, { kind: "tool_call" }> = {
      ...currentToolCall,
      toolCallId: "call-edit-file",
      toolName: "edit_file",
      input: { path: "apps/web/app/page.tsx", startLine: 10, endLine: 11 }
    };
    const editResult: Extract<RunStreamEvent, { kind: "tool_result" }> = {
      ...currentToolResult,
      toolCallId: "call-edit-file",
      toolName: "edit_file",
      details: fileChangeDetails
    };

    const view = buildConversationViewItems({
      timelineItems: [messageItem(firstUser), eventItem(editCall), eventItem(editResult)],
      mode: "compact"
    });

    expect(view[1]?.type).toBe("compact-tool");
    if (view[1]?.type === "compact-tool") {
      expect(view[1].fileChanges).toEqual(fileChangeDetails.files);
      expect(view[1].title).toBe("已编辑 apps/web/app/page.tsx");
    }
  });

  test("keeps structured file changes on compact tool items from history messages", () => {
    const toolCallMessage: Extract<
      SessionSnapshot["messages"][number],
      { kind: "tool call" }
    > = {
      id: "tool-call-message-1",
      kind: "tool call",
      toolCallId: "call-edit-history",
      toolName: "edit_file",
      input: { path: "apps/web/app/page.tsx", startLine: 10, endLine: 11 },
      state: "pending",
      createdAt: "2026-04-21T18:46:21.700Z"
    };
    const toolResultMessage: Extract<
      SessionSnapshot["messages"][number],
      { kind: "tool result" }
    > = {
      id: "tool-result-message-1",
      kind: "tool result",
      toolCallId: "call-edit-history",
      toolName: "edit_file",
      output: '{"ok":true}',
      isError: false,
      state: "success",
      details: fileChangeDetails,
      createdAt: "2026-04-21T18:46:21.710Z"
    };

    const view = buildConversationViewItems({
      timelineItems: [
        messageItem(firstUser),
        messageItem(toolCallMessage),
        messageItem(toolResultMessage)
      ],
      mode: "compact"
    });

    expect(view[1]?.type).toBe("compact-tool");
    if (view[1]?.type === "compact-tool") {
      expect(view[1].fileChanges).toEqual(fileChangeDetails.files);
      expect(view[1].originalItems).toHaveLength(2);
    }
  });

  test("keeps list_directory as viewed and other generic tools as called", () => {
    const listDirectoryCall: Extract<RunStreamEvent, { kind: "tool_call" }> = {
      ...currentToolCall,
      createdAt: "2026-04-21T18:46:21.710Z",
      toolCallId: "call-list-directory",
      toolName: "list_directory",
      input: { path: "apps/web/app" }
    };
    const listDirectoryResult: Extract<RunStreamEvent, { kind: "tool_result" }> =
      {
        ...currentToolResult,
        createdAt: "2026-04-21T18:46:21.711Z",
        toolCallId: "call-list-directory",
        toolName: "list_directory"
      };
    const httpCall: Extract<RunStreamEvent, { kind: "tool_call" }> = {
      ...currentToolCall,
      createdAt: "2026-04-21T18:46:21.712Z",
      toolCallId: "call-http",
      toolName: "make_http_request",
      input: { url: "https://example.com" }
    };
    const httpResult: Extract<RunStreamEvent, { kind: "tool_result" }> = {
      ...currentToolResult,
      createdAt: "2026-04-21T18:46:21.713Z",
      toolCallId: "call-http",
      toolName: "make_http_request"
    };

    const view = buildConversationViewItems({
      timelineItems: [
        messageItem(firstUser),
        eventItem(listDirectoryCall),
        eventItem(listDirectoryResult),
        eventItem(httpCall),
        eventItem(httpResult)
      ],
      mode: "compact"
    });

    expect(view.map((item) => item.type)).toEqual([
      "timeline",
      "compact-tool",
      "compact-tool"
    ]);
    expect(view[1]?.type).toBe("compact-tool");
    expect(view[2]?.type).toBe("compact-tool");
    if (view[1]?.type === "compact-tool") {
      expect(view[1].title).toContain("已查看");
    }
    if (view[2]?.type === "compact-tool") {
      expect(view[2].title).toContain("已调用");
    }
  });

  test("merges adjacent successful read and search tools into one file batch", () => {
    const readCall: Extract<RunStreamEvent, { kind: "tool_call" }> = {
      ...currentToolCall,
      createdAt: "2026-04-21T18:46:21.710Z",
      toolCallId: "call-read",
      toolName: "read_file",
      input: { path: "apps/web/app/page.tsx" }
    };
    const readResult: Extract<RunStreamEvent, { kind: "tool_result" }> = {
      ...currentToolResult,
      createdAt: "2026-04-21T18:46:21.711Z",
      toolCallId: "call-read",
      toolName: "read_file"
    };
    const searchCall: Extract<RunStreamEvent, { kind: "tool_call" }> = {
      ...currentToolCall,
      createdAt: "2026-04-21T18:46:21.712Z",
      toolCallId: "call-search",
      toolName: "search_text",
      input: { query: "debugConversationView", path: "apps/web" }
    };
    const searchResult: Extract<RunStreamEvent, { kind: "tool_result" }> = {
      ...currentToolResult,
      createdAt: "2026-04-21T18:46:21.713Z",
      toolCallId: "call-search",
      toolName: "search_text"
    };

    const view = buildConversationViewItems({
      timelineItems: [
        messageItem(firstUser),
        eventItem(readCall),
        eventItem(readResult),
        eventItem(searchCall),
        eventItem(searchResult)
      ],
      mode: "compact"
    });

    expect(view.map((item) => item.type)).toEqual([
      "timeline",
      "compact-file-batch"
    ]);
    if (view[1]?.type === "compact-file-batch") {
      expect(view[1].title).toBe("已搜索和阅读 2 个文件");
      expect(view[1].targets).toEqual([
        "apps/web/app/page.tsx",
        "debugConversationView @ apps/web"
      ]);
    }
  });

  test("does not merge read and search tools across assistant text", () => {
    const readCall: Extract<RunStreamEvent, { kind: "tool_call" }> = {
      ...currentToolCall,
      createdAt: "2026-04-21T18:46:21.710Z",
      toolCallId: "call-read",
      toolName: "read_file",
      input: { path: "README.md" }
    };
    const readResult: Extract<RunStreamEvent, { kind: "tool_result" }> = {
      ...currentToolResult,
      createdAt: "2026-04-21T18:46:21.711Z",
      toolCallId: "call-read",
      toolName: "read_file"
    };
    const assistantEvent: Extract<RunStreamEvent, { kind: "assistant_text" }> =
      {
        kind: "assistant_text",
        sessionId: "session-1",
        createdAt: "2026-04-21T18:46:21.712Z",
        turnCount: 1,
        assistantMessageId: "assistant-between",
        text: "先看这里。"
      };
    const searchCall: Extract<RunStreamEvent, { kind: "tool_call" }> = {
      ...currentToolCall,
      createdAt: "2026-04-21T18:46:21.713Z",
      toolCallId: "call-search",
      toolName: "search_text",
      input: { query: "SessionWorkbench" }
    };
    const searchResult: Extract<RunStreamEvent, { kind: "tool_result" }> = {
      ...currentToolResult,
      createdAt: "2026-04-21T18:46:21.714Z",
      toolCallId: "call-search",
      toolName: "search_text"
    };

    const view = buildConversationViewItems({
      timelineItems: [
        messageItem(firstUser),
        eventItem(readCall),
        eventItem(readResult),
        eventItem(assistantEvent),
        eventItem(searchCall),
        eventItem(searchResult)
      ],
      mode: "compact"
    });

    expect(view.map((item) => item.type)).toEqual([
      "timeline",
      "compact-tool",
      "timeline",
      "compact-tool"
    ]);
  });

  test("filters turn boundary events from compact mode", () => {
    const view = buildConversationViewItems({
      timelineItems: [
        messageItem(firstUser),
        eventItem(turnStart),
        eventItem(currentToolCall),
        eventItem(turnEnd)
      ],
      mode: "compact"
    });

    expect(
      view.some(
        (item) =>
          item.type === "timeline" &&
          item.item.type === "event" &&
          (item.item.event.kind === "turn_start" ||
            item.item.event.kind === "turn_end")
      )
    ).toBe(false);
  });

  test("does not fold while the assistant output is still streaming without terminal events", () => {
    const streamingAssistantEvent: Extract<
      RunStreamEvent,
      { kind: "assistant_text" }
    > = {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-21T18:46:21.800Z",
      turnCount: 1,
      assistantMessageId: "assistant-streaming",
      text: "正在整理结果..."
    };

    const view = buildConversationViewItems({
      timelineItems: [
        messageItem(firstUser),
        eventItem(turnStart),
        eventItem(thinkingEvent),
        eventItem(currentToolCall),
        eventItem(currentToolResult),
        eventItem(streamingAssistantEvent)
      ],
      mode: "compact",
      streamEventKeys: new Set([
        getTimelineEventKey(streamingAssistantEvent)
      ])
    });

    expect(view.map((item) => item.type)).toEqual([
      "timeline",
      "timeline",
      "compact-tool",
      "timeline"
    ]);
    expect(
      view.some((item) => item.type === "compact-collapsed-flow")
    ).toBeFalse();
  });

  test("folds settled assistant history even when no run_complete event is present", () => {
    const settledAssistantEvent: Extract<
      RunStreamEvent,
      { kind: "assistant_text" }
    > = {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-21T18:46:21.800Z",
      turnCount: 1,
      assistantMessageId: "assistant-settled",
      text: "已经处理好了。"
    };

    const view = buildConversationViewItems({
      timelineItems: [
        messageItem(firstUser),
        eventItem(turnStart),
        eventItem(thinkingEvent),
        eventItem(currentToolCall),
        eventItem(currentToolResult),
        eventItem(settledAssistantEvent)
      ],
      mode: "compact"
    });

    expect(view.map((item) => item.type)).toEqual([
      "timeline",
      "compact-collapsed-flow",
      "timeline"
    ]);
  });

  test("does not fold when the first assistant text arrives before any tool execution", () => {
    const interimAssistantEvent: Extract<
      RunStreamEvent,
      { kind: "assistant_text" }
    > = {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-21T18:46:21.780Z",
      turnCount: 1,
      assistantMessageId: "assistant-interim",
      text: "我先看一下。"
    };

    const view = buildConversationViewItems({
      timelineItems: [
        messageItem(firstUser),
        eventItem(turnStart),
        eventItem(thinkingEvent),
        eventItem(interimAssistantEvent)
      ],
      mode: "compact"
    });

    expect(view.map((item) => item.type)).toEqual([
      "timeline",
      "timeline",
      "timeline"
    ]);
    expect(
      view.some((item) => item.type === "compact-collapsed-flow")
    ).toBeFalse();
  });

  test("folds the final answer's preceding execution flow", () => {
    const finalAssistantEvent: Extract<
      RunStreamEvent,
      { kind: "assistant_text" }
    > = {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-21T18:46:21.800Z",
      turnCount: 1,
      assistantMessageId: "assistant-final",
      text: "已经处理好了。"
    };
    const completedRunEvent: Extract<RunStreamEvent, { kind: "run_complete" }> =
      {
        ...interruptedRunCompleteEvent,
        createdAt: "2026-04-21T18:46:21.810Z",
        status: "completed",
        stopReason: "end_turn"
      };

    const view = buildConversationViewItems({
      timelineItems: [
        messageItem(firstUser),
        eventItem(turnStart),
        eventItem(thinkingEvent),
        eventItem(currentToolCall),
        eventItem(currentToolResult),
        eventItem(finalAssistantEvent),
        eventItem(completedRunEvent)
      ],
      mode: "compact"
    });

    expect(view.map((item) => item.type)).toEqual([
      "timeline",
      "compact-collapsed-flow",
      "timeline",
      "timeline"
    ]);
    if (view[1]?.type === "compact-collapsed-flow") {
      expect(view[1].hiddenCount).toBe(2);
      expect(view[1].originalItems.map((item) => item.type)).toEqual([
        "timeline",
        "compact-tool"
      ]);
    }
  });

  test("keeps earlier collapsed turns folded when a later turn also collapses", () => {
    const secondUser: Extract<
      SessionSnapshot["messages"][number],
      { kind: "user" }
    > = {
      id: "user-2",
      kind: "user",
      content: "再看一下明天",
      createdAt: "2026-04-21T18:47:03.349Z"
    };
    const secondTurnStart: Extract<RunStreamEvent, { kind: "turn_start" }> = {
      ...turnStart,
      createdAt: "2026-04-21T18:47:03.364Z",
      turnCount: 2
    };
    const secondThinkingEvent: Extract<RunStreamEvent, { kind: "thinking" }> = {
      ...thinkingEvent,
      createdAt: "2026-04-21T18:47:21.692Z",
      turnCount: 2,
      thinkingMessageId: "thinking-2",
      signature: "sig-2",
      text: "再检查一下后续日程。"
    };
    const secondToolCall: Extract<RunStreamEvent, { kind: "tool_call" }> = {
      ...currentToolCall,
      createdAt: "2026-04-21T18:47:21.720Z",
      turnCount: 2,
      toolCallId: "call-current-2"
    };
    const secondToolResult: Extract<RunStreamEvent, { kind: "tool_result" }> = {
      ...currentToolResult,
      createdAt: "2026-04-21T18:47:21.735Z",
      turnCount: 2,
      toolCallId: "call-current-2"
    };
    const firstFinalAssistantEvent: Extract<
      RunStreamEvent,
      { kind: "assistant_text" }
    > = {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-21T18:46:21.800Z",
      turnCount: 1,
      assistantMessageId: "assistant-final-1",
      text: "第一轮已经处理好了。"
    };
    const secondFinalAssistantEvent: Extract<
      RunStreamEvent,
      { kind: "assistant_text" }
    > = {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-21T18:47:21.800Z",
      turnCount: 2,
      assistantMessageId: "assistant-final-2",
      text: "第二轮也处理好了。"
    };
    const firstCompletedRunEvent: Extract<
      RunStreamEvent,
      { kind: "run_complete" }
    > = {
      ...interruptedRunCompleteEvent,
      createdAt: "2026-04-21T18:46:21.810Z",
      status: "completed",
      stopReason: "end_turn"
    };
    const secondCompletedRunEvent: Extract<
      RunStreamEvent,
      { kind: "run_complete" }
    > = {
      ...interruptedRunCompleteEvent,
      createdAt: "2026-04-21T18:47:21.810Z",
      status: "completed",
      stopReason: "end_turn"
    };

    const view = buildConversationViewItems({
      timelineItems: [
        messageItem(firstUser),
        eventItem(turnStart),
        eventItem(thinkingEvent),
        eventItem(currentToolCall),
        eventItem(currentToolResult),
        eventItem(firstFinalAssistantEvent),
        eventItem(firstCompletedRunEvent),
        messageItem(secondUser),
        eventItem(secondTurnStart),
        eventItem(secondThinkingEvent),
        eventItem(secondToolCall),
        eventItem(secondToolResult),
        eventItem(secondFinalAssistantEvent),
        eventItem(secondCompletedRunEvent)
      ],
      mode: "compact"
    });

    expect(view.map((item) => item.type)).toEqual([
      "timeline",
      "compact-collapsed-flow",
      "timeline",
      "timeline",
      "timeline",
      "compact-collapsed-flow",
      "timeline",
      "timeline"
    ]);

    const collapsedItems = view.filter(
      (item): item is Extract<typeof item, { type: "compact-collapsed-flow" }> =>
        item.type === "compact-collapsed-flow"
    );
    expect(collapsedItems).toHaveLength(2);
    expect(collapsedItems.map((item) => item.hiddenCount)).toEqual([2, 2]);
    expect(collapsedItems.map((item) => item.key)).toEqual([
      "compact-collapsed-flow-event-assistant_text-assistant-final-1",
      "compact-collapsed-flow-event-assistant_text-assistant-final-2"
    ]);
  });

  test("still collapses each run separately when later runs reuse turnCount", () => {
    const secondUser: Extract<
      SessionSnapshot["messages"][number],
      { kind: "user" }
    > = {
      id: "user-2",
      kind: "user",
      content: "再看一下明天",
      createdAt: "2026-04-21T18:47:03.349Z"
    };
    const secondTurnStart: Extract<RunStreamEvent, { kind: "turn_start" }> = {
      ...turnStart,
      createdAt: "2026-04-21T18:47:03.364Z",
      turnCount: 1
    };
    const secondThinkingEvent: Extract<RunStreamEvent, { kind: "thinking" }> = {
      ...thinkingEvent,
      createdAt: "2026-04-21T18:47:21.692Z",
      turnCount: 1,
      thinkingMessageId: "thinking-2",
      signature: "sig-2",
      text: "再检查一下后续日程。"
    };
    const secondToolCall: Extract<RunStreamEvent, { kind: "tool_call" }> = {
      ...currentToolCall,
      createdAt: "2026-04-21T18:47:21.720Z",
      turnCount: 1,
      toolCallId: "call-current-2"
    };
    const secondToolResult: Extract<RunStreamEvent, { kind: "tool_result" }> = {
      ...currentToolResult,
      createdAt: "2026-04-21T18:47:21.735Z",
      turnCount: 1,
      toolCallId: "call-current-2"
    };
    const firstFinalAssistantEvent: Extract<
      RunStreamEvent,
      { kind: "assistant_text" }
    > = {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-21T18:46:21.800Z",
      turnCount: 1,
      assistantMessageId: "assistant-final-1",
      text: "第一轮已经处理好了。"
    };
    const secondFinalAssistantEvent: Extract<
      RunStreamEvent,
      { kind: "assistant_text" }
    > = {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-21T18:47:21.800Z",
      turnCount: 1,
      assistantMessageId: "assistant-final-2",
      text: "第二轮也处理好了。"
    };
    const firstCompletedRunEvent: Extract<
      RunStreamEvent,
      { kind: "run_complete" }
    > = {
      ...interruptedRunCompleteEvent,
      createdAt: "2026-04-21T18:46:21.810Z",
      status: "completed",
      stopReason: "end_turn"
    };
    const secondCompletedRunEvent: Extract<
      RunStreamEvent,
      { kind: "run_complete" }
    > = {
      ...interruptedRunCompleteEvent,
      createdAt: "2026-04-21T18:47:21.810Z",
      status: "completed",
      stopReason: "end_turn"
    };

    const timelineItems = buildTimelineItems({
      messages: [firstUser, secondUser],
      historyEvents: [
        turnStart,
        thinkingEvent,
        currentToolCall,
        currentToolResult,
        firstFinalAssistantEvent,
        firstCompletedRunEvent,
        secondTurnStart,
        secondThinkingEvent,
        secondToolCall,
        secondToolResult,
        secondFinalAssistantEvent,
        secondCompletedRunEvent
      ],
      streamEvents: []
    });

    const view = buildConversationViewItems({
      timelineItems,
      mode: "compact"
    });

    expect(view.map((item) => item.type)).toEqual([
      "timeline",
      "compact-collapsed-flow",
      "timeline",
      "timeline",
      "timeline",
      "compact-collapsed-flow",
      "timeline",
      "timeline"
    ]);
  });

  test("keeps earlier persisted assistant turns folded when a later streamed turn also collapses", () => {
    const firstAssistantBlock: Extract<
      SessionSnapshot["messages"][number],
      { kind: "assistant" }
    > = {
      id: "assistant-block-1",
      kind: "assistant",
      content: "第一轮已经处理好了。",
      createdAt: "2026-04-21T18:46:21.800Z"
    };
    const secondUser: Extract<
      SessionSnapshot["messages"][number],
      { kind: "user" }
    > = {
      id: "user-2",
      kind: "user",
      content: "再看一下明天",
      createdAt: "2026-04-21T18:47:03.349Z"
    };
    const secondTurnStart: Extract<RunStreamEvent, { kind: "turn_start" }> = {
      ...turnStart,
      createdAt: "2026-04-21T18:47:03.364Z",
      turnCount: 2
    };
    const secondThinkingEvent: Extract<RunStreamEvent, { kind: "thinking" }> = {
      ...thinkingEvent,
      createdAt: "2026-04-21T18:47:21.692Z",
      turnCount: 2,
      thinkingMessageId: "thinking-2",
      signature: "sig-2",
      text: "再检查一下后续日程。"
    };
    const secondToolCall: Extract<RunStreamEvent, { kind: "tool_call" }> = {
      ...currentToolCall,
      createdAt: "2026-04-21T18:47:21.720Z",
      turnCount: 2,
      toolCallId: "call-current-2"
    };
    const secondToolResult: Extract<RunStreamEvent, { kind: "tool_result" }> = {
      ...currentToolResult,
      createdAt: "2026-04-21T18:47:21.735Z",
      turnCount: 2,
      toolCallId: "call-current-2"
    };
    const secondFinalAssistantEvent: Extract<
      RunStreamEvent,
      { kind: "assistant_text" }
    > = {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-21T18:47:21.800Z",
      turnCount: 2,
      assistantMessageId: "assistant-final-2",
      text: "第二轮也处理好了。"
    };
    const firstCompletedRunEvent: Extract<
      RunStreamEvent,
      { kind: "run_complete" }
    > = {
      ...interruptedRunCompleteEvent,
      createdAt: "2026-04-21T18:46:21.810Z",
      status: "completed",
      stopReason: "end_turn"
    };
    const secondCompletedRunEvent: Extract<
      RunStreamEvent,
      { kind: "run_complete" }
    > = {
      ...interruptedRunCompleteEvent,
      createdAt: "2026-04-21T18:47:21.810Z",
      status: "completed",
      stopReason: "end_turn"
    };

    const view = buildConversationViewItems({
      timelineItems: [
        messageItem(firstUser),
        eventItem(turnStart),
        eventItem(thinkingEvent),
        eventItem(currentToolCall),
        eventItem(currentToolResult),
        messageItem(firstAssistantBlock),
        eventItem(firstCompletedRunEvent),
        messageItem(secondUser),
        eventItem(secondTurnStart),
        eventItem(secondThinkingEvent),
        eventItem(secondToolCall),
        eventItem(secondToolResult),
        eventItem(secondFinalAssistantEvent),
        eventItem(secondCompletedRunEvent)
      ],
      mode: "compact"
    });

    expect(view.map((item) => item.type)).toEqual([
      "timeline",
      "compact-collapsed-flow",
      "timeline",
      "timeline",
      "timeline",
      "compact-collapsed-flow",
      "timeline",
      "timeline"
    ]);

    const collapsedItems = view.filter(
      (item): item is Extract<typeof item, { type: "compact-collapsed-flow" }> =>
        item.type === "compact-collapsed-flow"
    );
    expect(collapsedItems).toHaveLength(2);
    expect(collapsedItems.map((item) => item.hiddenCount)).toEqual([2, 2]);
    expect(collapsedItems[0]?.key).toBe(
      "compact-collapsed-flow-message-assistant-block-1"
    );
    expect(collapsedItems[1]?.key).toBe(
      "compact-collapsed-flow-event-assistant_text-assistant-final-2"
    );
  });

  test("anchors collapsed flow scrolling to the turn's user message while keeping the final assistant key", () => {
    const finalAssistantEvent: Extract<
      RunStreamEvent,
      { kind: "assistant_text" }
    > = {
      kind: "assistant_text",
      sessionId: "session-1",
      createdAt: "2026-04-21T18:46:21.800Z",
      turnCount: 1,
      assistantMessageId: "assistant-final",
      text: "已经处理好了。"
    };
    const completedRunEvent: Extract<RunStreamEvent, { kind: "run_complete" }> =
      {
        ...interruptedRunCompleteEvent,
        createdAt: "2026-04-21T18:46:21.810Z",
        status: "completed",
        stopReason: "end_turn"
      };

    const view = buildConversationViewItems({
      timelineItems: [
        messageItem(firstUser),
        eventItem(turnStart),
        eventItem(thinkingEvent),
        eventItem(currentToolCall),
        eventItem(currentToolResult),
        eventItem(finalAssistantEvent),
        eventItem(completedRunEvent)
      ],
      mode: "compact"
    });

    expect(
      getCompactCollapsedFlowScrollTargetKey({
        items: view,
        collapsedFlowKey:
          "compact-collapsed-flow-event-assistant_text-assistant-final"
      })
    ).toBe("message-user-1");
    expect(
      getCompactCollapsedFlowAnchors({
        items: view,
        collapsedFlowKey:
          "compact-collapsed-flow-event-assistant_text-assistant-final"
      }).assistantItemKey
    ).toBe("event-assistant_text-assistant-final");
  });
});
