import { describe, expect, test } from "bun:test";

import {
  buildForkReplayRequestMessages,
  cloneForkSessionSnapshot,
  createSnapshot
} from "../src/session/index.js";
import type { SessionForkCheckpoint } from "../src/types.js";

describe("session fork helpers", () => {
  function createCheckpoint(): SessionForkCheckpoint {
    const snapshot = createSnapshot({
      sessionId: "source-session",
      workingDirectory: "/tmp/workspace",
      model: "MiniMax-M2.7",
      planModeEnabled: true,
      taskBriefPath: "/tmp/workspace/.agent/plans/source-session/plan.md"
    });
    snapshot.messages = [
      {
        id: "user-1",
        kind: "user",
        content: "原始问题",
        createdAt: "2026-05-01T00:00:00.000Z"
      },
      {
        id: "assistant-1",
        kind: "assistant",
        content: "先读取文件。",
        createdAt: "2026-05-01T00:00:01.000Z",
        responseGroupId: "group-1"
      },
      {
        id: "tool-call-1",
        kind: "tool call",
        toolCallId: "tool-call-1",
        toolName: "read_file",
        input: { path: "apps/api/src/app.ts" },
        state: "success",
        createdAt: "2026-05-01T00:00:02.000Z",
        responseGroupId: "group-1"
      },
      {
        id: "tool-result-1",
        kind: "tool result",
        toolCallId: "tool-call-1",
        toolName: "read_file",
        output: "file body",
        isError: false,
        state: "success",
        createdAt: "2026-05-01T00:00:03.000Z",
        responseGroupId: "group-1"
      }
    ];
    snapshot.context.activeBackgroundTaskCount = 2;
    snapshot.context.pendingBackgroundNotifications = [
      {
        id: "notif-1",
        kind: "task_completed",
        title: "done",
        content: "done",
        taskId: "task-1",
        taskKind: "subagent",
        createdAt: "2026-05-01T00:00:04.000Z",
        requiresMainAgentReply: false,
        expectedParentReply: "none",
        result: null
      }
    ];
    snapshot.context.pendingPermissionRequest = {
      toolCallId: "tool-call-2",
      toolName: "run_shell_command",
      toolInput: { command: "pwd" },
      reason: "needs approval",
      allowWorkspaceEscape: false
    };
    snapshot.sessionState.pendingToolCallIds = ["tool-call-2"];
    snapshot.sessionState.interruptRequested = true;

    return {
      id: "checkpoint-1",
      sessionId: snapshot.sessionId,
      assistantMessageId: "assistant-1",
      turnCount: 3,
      baseMessageCount: 1,
      responseGroupId: "group-1",
      snapshot,
      promptSeed: {
        system: "system",
        requestMessages: [
          {
            role: "user",
            content: [{ type: "text", text: "原始问题" }]
          }
        ],
        runtimeContextMessages: [
          {
            role: "user",
            content: [{ type: "text", text: "runtime context" }]
          }
        ],
        tools: [
          {
            name: "read_file",
            description: "Read a file",
            input_schema: { type: "object" }
          }
        ],
        toolChoice: { type: "auto" }
      },
      createdAt: "2026-05-01T00:00:05.000Z",
      updatedAt: "2026-05-01T00:00:05.000Z"
    };
  }

  test("builds replay request messages from prompt seed plus checkpoint tail", () => {
    const checkpoint = createCheckpoint();

    const requestMessages = buildForkReplayRequestMessages({
      session: checkpoint.snapshot,
      checkpoint
    });

    expect(requestMessages).toHaveLength(3);
    expect(requestMessages[0]?.role).toBe("user");
    expect(requestMessages[1]?.role).toBe("assistant");
    expect(requestMessages[2]?.role).toBe("user");
  });

  test("clones a fork snapshot with a new parent relation and cleared live state", () => {
    const checkpoint = createCheckpoint();

    const forkSnapshot = cloneForkSessionSnapshot({
      checkpoint,
      sessionId: "fork-session",
      taskBriefPath: "/tmp/workspace/.agent/plans/fork-session/plan.md"
    });

    expect(forkSnapshot.sessionId).toBe("fork-session");
    expect(forkSnapshot.parentSessionId).toBe("source-session");
    expect(forkSnapshot.parentRelationKind).toBe("fork");
    expect(forkSnapshot.forkReplayCheckpointId).toBe("checkpoint-1");
    expect(forkSnapshot.context.taskBriefPath).toBe(
      "/tmp/workspace/.agent/plans/fork-session/plan.md"
    );
    expect(forkSnapshot.context.activeBackgroundTaskCount).toBe(0);
    expect(forkSnapshot.context.pendingBackgroundNotifications).toEqual([]);
    expect(forkSnapshot.context.pendingPermissionRequest).toBeNull();
    expect(forkSnapshot.sessionState.pendingToolCallIds).toEqual([]);
    expect(forkSnapshot.sessionState.interruptRequested).toBe(false);
    expect(forkSnapshot.messages).toHaveLength(
      checkpoint.snapshot.messages.length
    );
    expect(forkSnapshot.messages.map((message) => message.id)).not.toEqual(
      checkpoint.snapshot.messages.map((message) => message.id)
    );
    expect(
      forkSnapshot.messages.map(({ id: _id, ...message }) => message)
    ).toEqual(
      checkpoint.snapshot.messages.map(({ id: _id, ...message }) => message)
    );
  });
});
