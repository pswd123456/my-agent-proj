import { describe, expect, test } from "bun:test";

import type { RunStreamEvent } from "@ai-app-template/sdk";

import { getTimelineEventKey } from "./session-timeline";

import {
  appendStreamEvent,
  beginRun,
  createRunViewState,
  finishRun,
  markAssistantAnimationComplete,
  resetRunView
} from "./run-view-state-manager";

function createAnimatedEvent(kind: "assistant_text" | "thinking"): RunStreamEvent {
  if (kind === "thinking") {
    return {
      kind,
      sessionId: "session-1",
      createdAt: "2026-04-24T00:00:00.000Z",
      turnCount: 1,
      text: "thinking",
      signature: "sig-1"
    } as RunStreamEvent;
  }

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

  test("assistant and thinking events are tracked for animation cleanup", () => {
    const started = beginRun(createRunViewState(), {
      createdAt: "2026-04-24T00:00:00.000Z",
      text: "hi"
    });
    const next = appendStreamEvent(
      appendStreamEvent(started, createAnimatedEvent("assistant_text")),
      createAnimatedEvent("thinking")
    );
    const keys = [...next.recentAssistantEventKeys];

    expect(next.recentAssistantEventKeys).toEqual(
      new Set([
        getTimelineEventKey(createAnimatedEvent("assistant_text")),
        getTimelineEventKey(createAnimatedEvent("thinking"))
      ])
    );

    const afterAssistant = markAssistantAnimationComplete(next, keys[0]!);
    expect(afterAssistant.recentAssistantEventKeys.size).toBe(1);
    expect(
      markAssistantAnimationComplete(afterAssistant, keys[1]!)
        .recentAssistantEventKeys.size
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
