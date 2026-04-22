import { describe, expect, test } from "bun:test";

import type { RunStreamEvent, SessionSnapshot } from "@ai-app-template/sdk";

import { buildTimelineItems } from "./ui1-timeline";

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
      pendingToolCallIds: []
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
});
