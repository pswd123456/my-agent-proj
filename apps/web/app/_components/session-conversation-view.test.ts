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

function toolCallEvent(input: {
  toolCallId: string;
  toolName: string;
  createdAt: string;
  toolInput?: Record<string, unknown>;
}): Extract<RunStreamEvent, { kind: "tool_call" }> {
  return {
    kind: "tool_call",
    sessionId: "session-1",
    createdAt: input.createdAt,
    turnCount: 1,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    input: input.toolInput ?? {}
  };
}

function toolResultEvent(input: {
  toolCallId: string;
  toolName: string;
  createdAt: string;
  details?: Extract<RunStreamEvent, { kind: "tool_result" }>["details"];
}): Extract<RunStreamEvent, { kind: "tool_result" }> {
  return {
    kind: "tool_result",
    sessionId: "session-1",
    createdAt: input.createdAt,
    turnCount: 1,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    output: '{"ok":true}',
    displayText: "ok",
    isError: false,
    ...(input.details ? { details: input.details } : {})
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

  test("keeps task brief previews visible in compact mode", () => {
    const items = buildConversationViewItems({
      mode: "compact",
      timelineItems: [
        toMessageItem(
          userBlock("user-1", "写一个 task brief", "2026-04-27T00:00:01.000Z")
        ),
        toEventItem(
          toolCallEvent({
            toolCallId: "tool-1",
            toolName: "manage_task_brief",
            createdAt: "2026-04-27T00:00:02.000Z",
            toolInput: {
              action: "replace",
              plan_name: "ship_task_brief",
              content: "# Task Brief\n\n## Goal\nShip it"
            }
          })
        ),
        toEventItem(
          toolResultEvent({
            toolCallId: "tool-1",
            toolName: "manage_task_brief",
            createdAt: "2026-04-27T00:00:03.000Z",
            details: {
              kind: "task_brief",
              path: "/tmp/workspace/.agents/plans/session-1/ship_task_brief.md",
              content: "# Task Brief\n\n## Goal\nShip it",
              operation: "replace"
            }
          })
        ),
        toEventItem(assistantEvent("2026-04-27T00:00:04.000Z")),
        toEventItem(runCompleteEvent("2026-04-27T00:00:05.000Z"))
      ]
    });

    expect(items.map((item) => item.type)).toEqual([
      "timeline",
      "compact-tool",
      "timeline"
    ]);
    expect(items[1]?.type).toBe("compact-tool");
    if (items[1]?.type === "compact-tool") {
      expect(items[1].title).toBe("已更新 task brief");
      expect(items[1].taskBriefPreview).toEqual({
        path: "/tmp/workspace/.agents/plans/session-1/ship_task_brief.md",
        content: "# Task Brief\n\n## Goal\nShip it",
        operation: "replace"
      });
    }
  });

  test("shows shell command as the compact tool target from call input and result details", () => {
    const command = "printf ok";
    const items = buildConversationViewItems({
      mode: "compact",
      timelineItems: [
        toMessageItem(
          userBlock("user-1", "跑一下命令", "2026-04-27T00:00:01.000Z")
        ),
        toEventItem(
          toolCallEvent({
            toolCallId: "tool-1",
            toolName: "run_shell_command",
            createdAt: "2026-04-27T00:00:02.000Z",
            toolInput: {
              action: "start",
              command
            }
          })
        ),
        toEventItem(
          toolResultEvent({
            toolCallId: "tool-1",
            toolName: "run_shell_command",
            createdAt: "2026-04-27T00:00:03.000Z",
            details: {
              kind: "shell_command",
              action: "start",
              command,
              executionMode: "inline"
            }
          })
        )
      ]
    });

    expect(items[1]?.type).toBe("compact-tool");
    if (items[1]?.type === "compact-tool") {
      expect(items[1].target).toBe(command);
      expect(items[1].title).toBe(`已执行 ${command}`);
    }

    const resultOnlyItems = buildConversationViewItems({
      mode: "compact",
      timelineItems: [
        toEventItem(
          toolResultEvent({
            toolCallId: "tool-2",
            toolName: "run_shell_command",
            createdAt: "2026-04-27T00:00:04.000Z",
            details: {
              kind: "shell_command",
              action: "start",
              command,
              executionMode: "inline"
            }
          })
        )
      ]
    });

    expect(resultOnlyItems[0]?.type).toBe("compact-tool");
    if (resultOnlyItems[0]?.type === "compact-tool") {
      expect(resultOnlyItems[0].target).toBe(command);
      expect(resultOnlyItems[0].title).toBe(`已执行 ${command}`);
    }
  });
});
