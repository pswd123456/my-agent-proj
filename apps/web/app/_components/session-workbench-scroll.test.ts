import { describe, expect, test } from "bun:test";

import type { RunStreamEvent } from "@ai-app-template/sdk";

import {
  buildConversationScrollSnapshot,
  getConversationScrollIntent,
  getConversationResizeAutoFollowIntent,
  updateConversationAutoFollowState
} from "./session-workbench-scroll";
import type { TimelineItem } from "./session-timeline";

const turnStartEvent: Extract<RunStreamEvent, { kind: "turn_start" }> = {
  kind: "turn_start",
  sessionId: "session-1",
  createdAt: "2026-04-24T10:00:00.000Z",
  turnCount: 2,
  session: {
    sessionId: "session-1",
    workingDirectory: "/tmp/workspace",
    model: "gpt-5.4",
    sessionState: {
      loopState: "running",
      turnCount: 2,
      lastError: null,
      pendingToolCallIds: []
    }
  }
};

describe("conversation scroll helpers", () => {
  test("captures the latest turn start and latest timeline item", () => {
    const timelineItems: TimelineItem[] = [
      {
        type: "message",
        key: "message-user-1",
        createdAt: "2026-04-24T09:59:58.000Z",
        block: {
          id: "user-1",
          kind: "user",
          content: "安排一下",
          createdAt: "2026-04-24T09:59:58.000Z"
        }
      },
      {
        type: "event",
        key: "event-turn-start-2",
        createdAt: turnStartEvent.createdAt,
        event: turnStartEvent
      },
      {
        type: "event",
        key: "event-tool-call-2",
        createdAt: "2026-04-24T10:00:01.000Z",
        event: {
          kind: "tool_call",
          sessionId: "session-1",
          createdAt: "2026-04-24T10:00:01.000Z",
          turnCount: 2,
          toolCallId: "call-2",
          toolName: "list_routines",
          input: {}
        }
      }
    ];

    expect(buildConversationScrollSnapshot(timelineItems)).toEqual({
      latestItemKey: "event-tool-call-2",
      latestTurnAnchorKey: "event-turn-start-2",
      latestTurnStartKey: "event-turn-start-2"
    });
  });

  test("treats a pending user message as the next turn anchor before trace events arrive", () => {
    const snapshot = buildConversationScrollSnapshot([
      {
        type: "pending-user",
        key: "pending-user-2",
        createdAt: "2026-04-24T10:05:00.000Z",
        text: "帮我重新排一下"
      }
    ]);

    expect(snapshot).toEqual({
      latestItemKey: "pending-user-2",
      latestTurnAnchorKey: "pending-user-2",
      latestTurnStartKey: null
    });
  });

  test("aligns the newest turn to the top when a fresh turn arrives", () => {
    const intent = getConversationScrollIntent({
      previous: {
        latestItemKey: "event-turn-end-1",
        latestTurnAnchorKey: "event-turn-start-1",
        latestTurnStartKey: "event-turn-start-1"
      },
      next: {
        latestItemKey: "message-user-2",
        latestTurnAnchorKey: "event-turn-start-2",
        latestTurnStartKey: "event-turn-start-2"
      },
      followLatest: true
    });

    expect(intent).toBe("align-latest-turn");
  });

  test("follows the latest item while the current turn keeps streaming", () => {
    const intent = getConversationScrollIntent({
      previous: {
        latestItemKey: "event-thinking-2",
        latestTurnAnchorKey: "event-turn-start-2",
        latestTurnStartKey: "event-turn-start-2"
      },
      next: {
        latestItemKey: "event-assistant-2",
        latestTurnAnchorKey: "event-turn-start-2",
        latestTurnStartKey: "event-turn-start-2"
      },
      followLatest: true
    });

    expect(intent).toBe("follow-latest-item");
  });

  test("stops auto-follow when the user scrolls upward away from the live turn", () => {
    expect(
      updateConversationAutoFollowState({
        current: true,
        previousScrollTop: 520,
        currentScrollTop: 480,
        maxScrollTop: 900
      })
    ).toBe(false);
  });

  test("re-enables auto-follow when the user returns near the bottom", () => {
    expect(
      updateConversationAutoFollowState({
        current: false,
        previousScrollTop: 480,
        currentScrollTop: 870,
        maxScrollTop: 900
      })
    ).toBe(true);
  });

  test("skips the first resize follow right after layout scroll already handled a new item", () => {
    expect(
      getConversationResizeAutoFollowIntent({
        followLatest: true,
        latestItemKey: "event-assistant-2",
        skipNextResizeAutoFollow: true
      })
    ).toBe("skip-once");
  });

  test("keeps resize-based follow for later streaming growth of the same item", () => {
    expect(
      getConversationResizeAutoFollowIntent({
        followLatest: true,
        latestItemKey: "event-assistant-2",
        skipNextResizeAutoFollow: false
      })
    ).toBe("follow-latest-item");
  });
});
