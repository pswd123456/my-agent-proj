import { describe, expect, test } from "bun:test";

import type { RunStreamEvent, SessionSnapshot } from "@ai-app-template/sdk";

import { buildConversationViewItems } from "./session-conversation-view";
import type { TimelineItem } from "./session-timeline";

function userBlock(
  id: string,
  content: string,
  createdAt: string
): Extract<SessionSnapshot["messages"][number], { kind: "user" }> {
  return { id, kind: "user", content, createdAt };
}

function assistantEvent(
  createdAt: string
): Extract<RunStreamEvent, { kind: "assistant_text" }> {
  return {
    kind: "assistant_text",
    sessionId: "session-1",
    createdAt,
    turnCount: 1,
    assistantMessageId: "assistant-1",
    text: "已经整理好了。",
    snapshot: "已经整理好了。"
  };
}

function runCompleteEvent(
  createdAt: string
): Extract<RunStreamEvent, { kind: "run_complete" }> {
  return {
    kind: "run_complete",
    sessionId: "session-1",
    createdAt,
    turnCount: 1,
    status: "completed",
    session: null
  };
}

function toMessageItem(
  block: SessionSnapshot["messages"][number]
): TimelineItem {
  return {
    type: "message",
    key: `message-${block.id}`,
    createdAt: block.createdAt,
    block
  };
}

function toEventItem(event: RunStreamEvent): TimelineItem {
  return {
    type: "event",
    key: `event-${event.kind}-${event.createdAt}`,
    createdAt: event.createdAt,
    event
  };
}

describe("session-conversation-view", () => {
  test("hides run_complete rows from compact conversation output", () => {
    const items = buildConversationViewItems({
      mode: "compact",
      timelineItems: [
        toMessageItem(
          userBlock("user-1", "帮我看一下", "2026-04-27T00:00:01.000Z")
        ),
        toEventItem(assistantEvent("2026-04-27T00:00:02.000Z")),
        toEventItem(runCompleteEvent("2026-04-27T00:00:03.000Z"))
      ]
    });

    expect(
      items.some(
        (item) =>
          item.type === "timeline" &&
          item.item.type === "event" &&
          item.item.event.kind === "run_complete"
      )
    ).toBeFalse();
  });

  test("keeps run_complete rows in debug conversation output", () => {
    const items = buildConversationViewItems({
      mode: "debug",
      timelineItems: [toEventItem(runCompleteEvent("2026-04-27T00:00:03.000Z"))]
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "timeline",
      item: {
        type: "event",
        event: {
          kind: "run_complete"
        }
      }
    });
  });
});
