import { describe, expect, test } from "bun:test";
import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";
import { createMemoryRoutineRepository } from "@ai-app-template/db";

import {
  buildForkReplayRequestMessages,
  cloneForkSessionSnapshot,
  createSnapshot,
  createRewriteRewindSnapshot,
  getCheckpointTriggerUserBlock,
  resolveTaskBriefPathForFork
} from "../src/session/index.js";
import type { SessionForkCheckpoint } from "../src/types.js";
import { createAgentRuntime } from "../src/index.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { RuntimeTool } from "../src/tools/runtime-tool.js";

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

  test("maps a named task brief onto the fork session path with the same file name", () => {
    expect(
      resolveTaskBriefPathForFork({
        workingDirectory: "/tmp/workspace",
        sourceSessionId: "source-session",
        sourceTaskBriefPath: "/tmp/workspace/.agent/plans/source-session/plan.md",
        targetSessionId: "fork-session",
        planModeEnabled: true
      })
    ).toBe("/tmp/workspace/.agent/plans/fork-session/plan.md");
  });

  test("resolves the checkpoint trigger block even when a hook message trails the turn", () => {
    const snapshot = createSnapshot({
      sessionId: "rewrite-source",
      workingDirectory: "/tmp/workspace",
      model: "MiniMax-M2.7",
      firstUserMessage: "第一轮问题",
      lastUserMessage: "第二轮问题"
    });
    snapshot.messages = [
      {
        id: "user-1",
        kind: "user",
        content: "第一轮问题",
        source: "user",
        createdAt: "2026-05-01T00:00:00.000Z"
      },
      {
        id: "assistant-1",
        kind: "assistant",
        content: "第一轮回答",
        createdAt: "2026-05-01T00:00:01.000Z"
      },
      {
        id: "user-2",
        kind: "user",
        content: "第二轮问题",
        source: "user",
        createdAt: "2026-05-01T00:00:02.000Z"
      },
      {
        id: "assistant-2",
        kind: "assistant",
        content: "第二轮回答",
        createdAt: "2026-05-01T00:00:03.000Z"
      },
      {
        id: "hook-1",
        kind: "user",
        content: "本轮已收尾",
        source: "hook_message",
        hookEvent: "run_end",
        hookTitle: "收尾 hook",
        createdAt: "2026-05-01T00:00:04.000Z"
      }
    ];

    const checkpoint: SessionForkCheckpoint = {
      id: "checkpoint-rewrite",
      sessionId: snapshot.sessionId,
      assistantMessageId: "assistant-2",
      turnCount: 2,
      baseMessageCount: 3,
      responseGroupId: null,
      snapshot,
      promptSeed: {
        system: "system",
        requestMessages: [],
        runtimeContextMessages: [],
        tools: [],
        toolChoice: null
      },
      createdAt: "2026-05-01T00:00:05.000Z",
      updatedAt: "2026-05-01T00:00:05.000Z"
    };

    expect(
      getCheckpointTriggerUserBlock({ session: snapshot, checkpoint })
    ).toMatchObject({
      id: "user-2",
      content: "第二轮问题",
      source: "user"
    });
  });

  test("falls back to the nearest preceding user block when legacy baseMessageCount points into tool results", () => {
    const snapshot = createSnapshot({
      sessionId: "legacy-rewrite-source",
      workingDirectory: "/tmp/workspace",
      model: "MiniMax-M2.7"
    });
    snapshot.messages = [
      {
        id: "user-1",
        kind: "user",
        content: "#git_grouped_commit",
        source: "user",
        createdAt: "2026-05-01T00:00:00.000Z"
      },
      {
        id: "assistant-1",
        kind: "assistant",
        content: "先加载 skill。",
        createdAt: "2026-05-01T00:00:01.000Z"
      },
      {
        id: "tool-call-1",
        kind: "tool call",
        toolCallId: "call-1",
        toolName: "load_skill",
        input: {},
        state: "success",
        createdAt: "2026-05-01T00:00:02.000Z"
      },
      {
        id: "tool-result-1",
        kind: "tool result",
        toolCallId: "call-1",
        toolName: "load_skill",
        output: "ok",
        isError: false,
        state: "success",
        createdAt: "2026-05-01T00:00:03.000Z"
      },
      {
        id: "assistant-2",
        kind: "assistant",
        content: "最终总结",
        createdAt: "2026-05-01T00:00:04.000Z"
      }
    ];

    const checkpoint: SessionForkCheckpoint = {
      id: "legacy-checkpoint",
      sessionId: snapshot.sessionId,
      assistantMessageId: "assistant-2",
      turnCount: 4,
      baseMessageCount: 4,
      responseGroupId: null,
      snapshot,
      promptSeed: {
        system: "system",
        requestMessages: [],
        runtimeContextMessages: [],
        tools: [],
        toolChoice: null
      },
      createdAt: "2026-05-01T00:00:05.000Z",
      updatedAt: "2026-05-01T00:00:05.000Z"
    };

    expect(
      getCheckpointTriggerUserBlock({ session: snapshot, checkpoint })
    ).toMatchObject({
      id: "user-1",
      content: "#git_grouped_commit",
      source: "user"
    });
  });

  test("rewinds a rewrite snapshot to the start of the trigger turn and recomputes user bounds", () => {
    const snapshot = createSnapshot({
      sessionId: "rewrite-source",
      workingDirectory: "/tmp/workspace",
      model: "MiniMax-M2.7",
      firstUserMessage: "第一轮问题",
      lastUserMessage: "第二轮问题"
    });
    snapshot.messages = [
      {
        id: "user-1",
        kind: "user",
        content: "第一轮问题",
        source: "user",
        createdAt: "2026-05-01T00:00:00.000Z"
      },
      {
        id: "assistant-1",
        kind: "assistant",
        content: "第一轮回答",
        createdAt: "2026-05-01T00:00:01.000Z"
      },
      {
        id: "user-2",
        kind: "user",
        content: "第二轮问题",
        source: "user",
        createdAt: "2026-05-01T00:00:02.000Z"
      },
      {
        id: "assistant-2",
        kind: "assistant",
        content: "第二轮回答",
        createdAt: "2026-05-01T00:00:03.000Z"
      },
      {
        id: "hook-1",
        kind: "user",
        content: "本轮已收尾",
        source: "hook_message",
        hookEvent: "run_end",
        hookTitle: "收尾 hook",
        createdAt: "2026-05-01T00:00:04.000Z"
      }
    ];
    snapshot.context.status = "completed";
    snapshot.context.pendingPermissionRequest = {
      toolCallId: "tool-call-2",
      toolName: "run_shell_command",
      toolInput: { command: "pwd" },
      reason: "needs approval",
      allowWorkspaceEscape: false
    };
    snapshot.context.pendingConflictSummary = "stale";
    snapshot.sessionState.loopState = "completed";
    snapshot.sessionState.turnCount = 2;
    snapshot.sessionState.pendingToolCallIds = ["tool-call-2"];
    snapshot.sessionState.interruptRequested = true;
    snapshot.inputTokensCount = 999;
    snapshot.promptCacheKey = "old-cache";

    const checkpoint: SessionForkCheckpoint = {
      id: "checkpoint-rewrite",
      sessionId: snapshot.sessionId,
      assistantMessageId: "assistant-2",
      turnCount: 2,
      baseMessageCount: 3,
      responseGroupId: null,
      snapshot,
      promptSeed: {
        system: "system",
        requestMessages: [],
        runtimeContextMessages: [],
        tools: [],
        toolChoice: null
      },
      createdAt: "2026-05-01T00:00:05.000Z",
      updatedAt: "2026-05-01T00:00:05.000Z"
    };

    const rewind = createRewriteRewindSnapshot({
      session: snapshot,
      checkpoint
    });

    expect(rewind.messages.map((block) => block.id)).toEqual([
      "user-1",
      "assistant-1"
    ]);
    expect(rewind.context.firstUserMessage).toBe("第一轮问题");
    expect(rewind.context.lastUserMessage).toBe("第一轮问题");
    expect(rewind.context.pendingPermissionRequest).toBeNull();
    expect(rewind.context.pendingConfirmationPayload).toBeNull();
    expect(rewind.context.pendingUserQuestionPayload).toBeNull();
    expect(rewind.context.pendingConflictSummary).toBeNull();
    expect(rewind.sessionState.loopState).toBe("waiting for input");
    expect(rewind.sessionState.turnCount).toBe(1);
    expect(rewind.sessionState.pendingToolCallIds).toEqual([]);
    expect(rewind.sessionState.interruptRequested).toBe(false);
    expect(rewind.inputTokensCount).toBe(0);
    expect(rewind.promptCacheKey).toBe("");
  });

  test("anchors checkpoint baseMessageCount to the originating user message across multi-step tool turns", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
    let responseIndex = 0;

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create() {
            responseIndex += 1;
            if (responseIndex === 1) {
              return {
                content: [
                  {
                    type: "tool_use" as const,
                    id: "tool-call-1",
                    name: "echo_tool",
                    input: {}
                  }
                ],
                stop_reason: "tool_use",
                usage: {
                  input_tokens: 10,
                  output_tokens: 5,
                  cache_creation_input_tokens: 0,
                  cache_read_input_tokens: 0
                }
              };
            }

            return {
              content: [{ type: "text" as const, text: "最终结果" }],
              stop_reason: "end_turn",
              usage: {
                input_tokens: 6,
                output_tokens: 3,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0
              }
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      toolRegistry: new ToolRegistry().register({
        name: "echo_tool",
        description: "Return ok.",
        family: "workspace-file",
        isReadOnly: true,
        hasExternalSideEffect: false,
        permissionProfile: "allow",
        sandboxProfile: "none",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        },
        validate() {
          return { ok: true, value: {} };
        },
        async execute() {
          return {
            state: "success",
            content: "ok",
            displayText: "ok",
            result: {
              ok: true,
              code: "OK",
              message: "ok"
            }
          };
        }
      } satisfies RuntimeTool)
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "runtime-fork-user"
    });
    const result = await runtime.run({
      sessionId: session.sessionId,
      message: "原始问题"
    });

    expect(result.status).toBe("completed");

    const checkpoints = await sessionManager.listForkCheckpoints(session.sessionId);
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]?.baseMessageCount).toBe(1);
    expect(
      getCheckpointTriggerUserBlock({
        session: result.session,
        checkpoint: checkpoints[0]!
      })
    ).toMatchObject({
      content: "原始问题",
      source: "user"
    });
  });
});
