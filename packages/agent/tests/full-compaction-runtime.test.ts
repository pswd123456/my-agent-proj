import { describe, expect, test } from "bun:test";

import { createMemoryRoutineRepository } from "@ai-app-template/db";

import { createAgentRuntime } from "../src/runtime.js";
import { fullCompactionTestUtils } from "../src/runtime/compaction.js";
import { createMemorySessionManager } from "../src/session/index.js";
import type { AnthropicMessageRequest } from "../src/model.js";
import { getUserContextHookConfigHash } from "../src/subagent-hooks.js";
import type { TraceEvent, TraceManager, TraceRecord } from "../src/trace.js";
import { ToolRegistry } from "../src/tools/registry.js";

class MemoryTraceManager implements TraceManager {
  readonly events: TraceEvent[] = [];

  async appendEvent(_sessionId: string, event: TraceEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }

  async readEvents(_sessionId: string): Promise<TraceRecord[]> {
    return [];
  }

  async deleteEvents(_sessionId: string): Promise<void> {
    this.events.length = 0;
  }
}

function buildLongHistory() {
  const blocks = [];

  for (let index = 0; index < 12; index += 1) {
    blocks.push(
      {
        id: `user-${index}`,
        kind: "user" as const,
        content: `User request ${index}: ${"A".repeat(220)}`,
        createdAt: `2026-04-26T00:00:${String(index).padStart(2, "0")}.000Z`
      },
      {
        id: `assistant-${index}`,
        kind: "assistant" as const,
        content: `Assistant step ${index}: ${"B".repeat(240)}`,
        createdAt: `2026-04-26T00:01:${String(index).padStart(2, "0")}.000Z`
      },
      {
        id: `tool-call-${index}`,
        kind: "tool call" as const,
        toolCallId: `call-${index}`,
        toolName: "read_file",
        input: {
          path: `src/file-${index}.ts`,
          hint: "C".repeat(180)
        },
        state: "success" as const,
        createdAt: `2026-04-26T00:02:${String(index).padStart(2, "0")}.000Z`
      },
      {
        id: `tool-result-${index}`,
        kind: "tool result" as const,
        toolCallId: `call-${index}`,
        toolName: "read_file",
        output: `SECRET_TOOL_RESULT_BODY_${index}_${"D".repeat(1_200)}`,
        isError: false,
        state: "success" as const,
        createdAt: `2026-04-26T00:03:${String(index).padStart(2, "0")}.000Z`
      }
    );
  }

  return blocks;
}

describe("full compaction runtime", () => {
  test("retains tool result blocks together with their paired tool calls", () => {
    const blocks = [
      {
        id: "user-0",
        kind: "user" as const,
        content: "Earlier context",
        createdAt: "2026-04-26T00:00:00.000Z"
      },
      {
        id: "assistant-0",
        kind: "assistant" as const,
        content: "Earlier reply",
        createdAt: "2026-04-26T00:00:01.000Z"
      },
      {
        id: "assistant-tail-0",
        kind: "assistant" as const,
        content: "Tail text before the tool use",
        responseGroupId: "group-1",
        createdAt: "2026-04-26T00:00:02.000Z"
      },
      {
        id: "tool-call-0",
        kind: "tool call" as const,
        toolCallId: "call-0",
        toolName: "read_file",
        input: { path: "src/a.ts" },
        state: "success" as const,
        responseGroupId: "group-1",
        createdAt: "2026-04-26T00:00:03.000Z"
      },
      {
        id: "tool-result-0",
        kind: "tool result" as const,
        toolCallId: "call-0",
        toolName: "read_file",
        output: "result-a",
        isError: false,
        state: "success" as const,
        responseGroupId: "group-1",
        createdAt: "2026-04-26T00:00:04.000Z"
      },
      {
        id: "assistant-tail-1",
        kind: "assistant" as const,
        content: "Post-tool follow-up",
        createdAt: "2026-04-26T00:00:05.000Z"
      }
    ];

    const { retainedTail } =
      fullCompactionTestUtils.splitFullCompactionBlocks(blocks);

    expect(retainedTail.some((block) => block.kind === "tool call")).toBe(true);
    expect(retainedTail.some((block) => block.kind === "tool result")).toBe(
      true
    );
    expect(
      retainedTail.find((block) => block.kind === "tool call")?.toolCallId
    ).toBe(
      retainedTail.find((block) => block.kind === "tool result")?.toolCallId
    );
  });

  test("runs history compaction once, then full compaction, and keeps only the retained tail", async () => {
    const sessionManager = createMemorySessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const traceManager = new MemoryTraceManager();
    const requests: AnthropicMessageRequest[] = [];

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create(request) {
            requests.push(structuredClone(request));
            if (request.system.includes("summarizing agent session history")) {
              return {
                content: [
                  {
                    type: "text",
                    text: [
                      "## Goal",
                      "Continue the runtime compaction rollout.",
                      "",
                      "## Constraints",
                      "- Keep the compact summary small.",
                      "",
                      "## Verified Facts",
                      "- History compaction already happened once.",
                      "",
                      "## Decisions",
                      "- Use full compaction as the continuation boundary.",
                      "",
                      "## Current Frontier",
                      "- Validate the reduced tail and keep moving.",
                      "",
                      "## Next Checkpoint",
                      "- Resume from the retained tail."
                    ].join("\n")
                  }
                ],
                stop_reason: "end_turn",
                usage: {
                  input_tokens: 100,
                  output_tokens: 80,
                  cache_creation_input_tokens: 0,
                  cache_read_input_tokens: 0
                }
              };
            }

            return {
              content: [{ type: "text", text: "继续处理。" }],
              stop_reason: "end_turn",
              usage: {
                input_tokens: 120,
                output_tokens: 8,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0
              }
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      traceManager,
      routineRepository,
      toolRegistry: new ToolRegistry(),
      userContextHooks: [
        {
          id: "hook-session",
          event: "session_started",
          behavior: "subagent",
          waitMode: "blocking",
          title: "Session hook",
          content: "session hook config",
          enabled: true
        },
        {
          id: "hook-run",
          event: "run_started",
          behavior: "subagent",
          waitMode: "unblocking",
          title: "Run hook",
          content: "run hook config",
          enabled: true
        }
      ]
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "compaction-user",
      contextWindow: 4_000
    });
    const sessionHookConfigHash = getUserContextHookConfigHash({
      event: "session_started",
      behavior: "subagent",
      waitMode: "blocking",
      title: "Session hook",
      content: "session hook config"
    });
    const runHookConfigHash = getUserContextHookConfigHash({
      event: "run_started",
      behavior: "subagent",
      waitMode: "unblocking",
      title: "Run hook",
      content: "run hook config"
    });

    await runtime.recoverSession({
      ...session,
      messages: buildLongHistory(),
      context: {
        ...session.context,
        hookContextEntries: [
          {
            hookId: "hook-session",
            hookEvent: "session_started",
            waitMode: "blocking",
            taskId: "task-session",
            title: "Session hook",
            configHash: sessionHookConfigHash,
            content: "这是 session_started hook 的结果。",
            createdAt: "2026-04-26T00:00:00.000Z"
          },
          {
            hookId: "hook-run",
            hookEvent: "run_started",
            waitMode: "unblocking",
            taskId: "task-run-1",
            title: "Run hook",
            configHash: runHookConfigHash,
            content: "这是第一条 run_started hook 结果。",
            createdAt: "2026-04-26T00:10:00.000Z"
          },
          {
            hookId: "hook-run",
            hookEvent: "run_started",
            waitMode: "unblocking",
            taskId: "task-run-2",
            title: "Run hook",
            configHash: runHookConfigHash,
            content: "这是第二条 run_started hook 结果。",
            createdAt: "2026-04-26T00:11:00.000Z"
          }
        ]
      }
    });

    const result = await runtime.run({
      sessionId: session.sessionId,
      message: "继续"
    });

    expect(result.status).toBe("completed");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.system).toContain(
      "summarizing agent session history for continuation after full compaction"
    );
    expect(JSON.stringify(requests[0]?.messages ?? [])).not.toContain(
      "SECRET_TOOL_RESULT_BODY"
    );
    expect(
      result.session.context.fullCompactionState?.summaryMarkdown
    ).toContain("## Goal");
    expect(
      result.session.context.fullCompactionState?.summaryMarkdown
    ).toContain("## Compacted Hook Context");
    expect(
      result.session.context.fullCompactionState?.summaryMarkdown
    ).toContain("这是第一条 run_started hook 结果。");
    expect(
      result.session.context.fullCompactionState?.summaryMarkdown
    ).toContain("这是第二条 run_started hook 结果。");
    expect(
      result.session.sessionState.historyCompactionsSinceFullCompaction
    ).toBe(0);
    expect(
      result.session.messages.some((block) => block.kind === "tool result")
    ).toBe(true);
    expect(
      result.session.messages.some(
        (block) => block.kind === "assistant thinking"
      )
    ).toBe(false);
    expect(result.session.context.hookContextEntries).toEqual([
      {
        hookId: "hook-session",
        hookEvent: "session_started",
        waitMode: "blocking",
        taskId: "task-session",
        title: "Session hook",
        configHash: sessionHookConfigHash,
        content: "这是 session_started hook 的结果。",
        createdAt: "2026-04-26T00:00:00.000Z"
      }
    ]);

    const retainedToolCallIds = result.session.messages
      .filter(
        (
          block
        ): block is Extract<
          (typeof result.session.messages)[number],
          { kind: "tool call" }
        > => block.kind === "tool call"
      )
      .map((block) => block.toolCallId);
    const retainedToolResultIds = new Set(
      result.session.messages
        .filter(
          (
            block
          ): block is Extract<
            (typeof result.session.messages)[number],
            { kind: "tool result" }
          > => block.kind === "tool result"
        )
        .map((block) => block.toolCallId)
    );
    expect(retainedToolCallIds.length).toBeGreaterThan(0);
    for (const toolCallId of retainedToolCallIds) {
      expect(retainedToolResultIds.has(toolCallId)).toBe(true);
    }

    const promptMessages = requests[1]?.messages ?? [];
    const promptToolUseCount = promptMessages.reduce(
      (total, message) =>
        total +
        message.content.filter((block) => block.type === "tool_use").length,
      0
    );
    const promptToolResultCount = promptMessages.reduce(
      (total, message) =>
        total +
        message.content.filter((block) => block.type === "tool_result").length,
      0
    );
    expect(promptToolUseCount).toBeGreaterThan(0);
    expect(promptToolUseCount).toBe(promptToolResultCount);

    const historyEvent = traceManager.events.find(
      (event): event is Extract<TraceEvent, { kind: "history_compaction" }> =>
        event.kind === "history_compaction"
    );
    const fullEvent = traceManager.events.find(
      (event): event is Extract<TraceEvent, { kind: "full_compaction" }> =>
        event.kind === "full_compaction"
    );

    expect(historyEvent).toBeDefined();
    expect(fullEvent).toBeDefined();
    expect(fullEvent?.summaryMarkdown).toContain(
      "Continue the runtime compaction rollout."
    );
  });
});
