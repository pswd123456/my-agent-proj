import { describe, expect, test } from "bun:test";

import { createMemoryRoutineRepository } from "@ai-app-template/db";

import { createAgentRuntime } from "../src/runtime.js";
import { createMemorySessionManager } from "../src/session/index.js";
import type { AnthropicMessageRequest } from "../src/model.js";
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
      toolRegistry: new ToolRegistry()
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "compaction-user",
      contextWindow: 3_000
    });

    await runtime.recoverSession({
      ...session,
      messages: buildLongHistory()
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
      result.session.sessionState.historyCompactionsSinceFullCompaction
    ).toBe(0);
    expect(result.session.messages.length).toBeLessThanOrEqual(8);
    expect(
      result.session.messages.some((block) => block.kind === "tool result")
    ).toBe(false);
    expect(
      result.session.messages.some(
        (block) => block.kind === "assistant thinking"
      )
    ).toBe(false);

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
