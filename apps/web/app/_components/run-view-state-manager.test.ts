import { describe, expect, test } from "bun:test";

import type { RunStreamEvent } from "@ai-app-template/sdk";

import {
  appendStreamEvent,
  beginRun,
  createRunViewState,
  finishRun,
  markAssistantAnimationComplete,
  resetRunView
} from "./run-view-state-manager";

function createAssistantEvent(kind: RunStreamEvent["kind"]): RunStreamEvent {
  return {
    kind,
    sessionId: "session-1",
    createdAt: "2026-04-24T00:00:00.000Z",
    turnCount: 1,
    messageId: "message-1",
    text: "hello"
  } as RunStreamEvent;
}

describe("run-view-state-manager", () => {
  test("beginRun resets stream state and stores pending user message", () => {
    const state = beginRun(createRunViewState(), {
      createdAt: "2026-04-24T00:00:00.000Z",
      text: "hi"
    });

    expect(state.pendingUserMessage?.text).toBe("hi");
    expect(state.streamEvents).toHaveLength(0);
  });

  test("assistant events are tracked for animation cleanup", () => {
    const started = beginRun(createRunViewState(), {
      createdAt: "2026-04-24T00:00:00.000Z",
      text: "hi"
    });
    const next = appendStreamEvent(
      started,
      createAssistantEvent("assistant_text")
    );
    const key = [...next.recentAssistantEventKeys][0];

    expect(next.recentAssistantEventKeys.size).toBe(1);
    expect(
      markAssistantAnimationComplete(next, key).recentAssistantEventKeys.size
    ).toBe(0);
  });

  test("finishRun clears pending message and resetRunView clears all transient state", () => {
    const started = beginRun(createRunViewState(), {
      createdAt: "2026-04-24T00:00:00.000Z",
      text: "hi"
    });
    const finished = finishRun(started);

    expect(finished.pendingUserMessage).toBeNull();
    expect(resetRunView()).toEqual({
      streamEvents: [],
      recentAssistantEventKeys: new Set(),
      pendingUserMessage: null
    });
  });
});
