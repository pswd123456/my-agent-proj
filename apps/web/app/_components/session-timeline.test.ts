import { describe, expect, test } from "bun:test";

import type { RunStreamEvent, SessionSnapshot } from "@ai-app-template/sdk";

import {
  buildTimelineItems,
  getTimelineEventRenderKey
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
});
