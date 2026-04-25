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
    ).toEqual(["turn_start", "assistant_text", "tool_result"]);
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

  test("folds the preceding execution flow as soon as the final answer starts streaming", () => {
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
      mode: "compact"
    });

    expect(view.map((item) => item.type)).toEqual([
      "timeline",
      "compact-collapsed-flow",
      "timeline"
    ]);
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

    const view = buildConversationViewItems({
      timelineItems: [
        messageItem(firstUser),
        eventItem(turnStart),
        eventItem(thinkingEvent),
        eventItem(currentToolCall),
        eventItem(currentToolResult),
        eventItem(finalAssistantEvent),
        eventItem(turnEnd)
      ],
      mode: "compact"
    });

    expect(view.map((item) => item.type)).toEqual([
      "timeline",
      "compact-collapsed-flow",
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

    const view = buildConversationViewItems({
      timelineItems: [
        messageItem(firstUser),
        eventItem(turnStart),
        eventItem(thinkingEvent),
        eventItem(currentToolCall),
        eventItem(currentToolResult),
        eventItem(finalAssistantEvent),
        eventItem(turnEnd)
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
