import { describe, expect, test } from "bun:test";

import { createMemoryRoutineRepository } from "@ai-app-template/db";

import { createAgentRuntime, type RunStreamEvent } from "../src/index.js";
import { createMemorySessionManager } from "../src/session/index.js";
import { ToolRegistry } from "../src/tools/registry.js";

describe("runtime streaming assistant text", () => {
  test("emits incremental assistant_text snapshots and persists only the final assistant block", async () => {
    const sessionManager = createMemorySessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create() {
            throw new Error("stream path should be used");
          },
          stream() {
            const events = [
              {
                type: "content_block_start" as const,
                index: 0,
                content_block: {
                  type: "text" as const,
                  text: ""
                }
              },
              {
                type: "content_block_delta" as const,
                index: 0,
                delta: {
                  type: "text_delta" as const,
                  text: "你好"
                }
              },
              {
                type: "content_block_delta" as const,
                index: 0,
                delta: {
                  type: "text_delta" as const,
                  text: "，世界"
                }
              },
              {
                type: "content_block_stop" as const,
                index: 0
              },
              {
                type: "message_delta" as const,
                delta: {
                  stop_reason: "end_turn"
                },
                usage: {
                  input_tokens: 12,
                  output_tokens: 4,
                  cache_creation_input_tokens: 0,
                  cache_read_input_tokens: 0
                }
              },
              {
                type: "message_stop" as const
              }
            ];

            return {
              async finalMessage() {
                return {
                  content: [{ type: "text", text: "你好，世界" }],
                  stop_reason: "end_turn",
                  usage: {
                    input_tokens: 12,
                    output_tokens: 4,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0
                  }
                };
              },
              async *[Symbol.asyncIterator]() {
                for (const event of events) {
                  yield event;
                }
              }
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      toolRegistry: new ToolRegistry()
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "stream-user"
    });

    const streamEvents: RunStreamEvent[] = [];
    const result = await runtime.run({
      sessionId: session.sessionId,
      message: "打个招呼",
      eventSink(event) {
        streamEvents.push(event);
      }
    });

    expect(result.status).toBe("completed");

    const assistantEvents = streamEvents.filter(
      (event): event is Extract<RunStreamEvent, { kind: "assistant_text" }> =>
        event.kind === "assistant_text"
    );

    expect(assistantEvents).toHaveLength(2);
    expect(assistantEvents.map((event) => event.text)).toEqual([
      "你好",
      "你好，世界"
    ]);
    expect(
      new Set(assistantEvents.map((event) => event.assistantMessageId)).size
    ).toBe(1);

    const assistantBlocks = result.session.messages.filter(
      (block): block is Extract<typeof result.session.messages[number], { kind: "assistant" }> =>
        block.kind === "assistant"
    );
    expect(assistantBlocks).toHaveLength(1);
    expect(assistantBlocks[0]?.content).toBe("你好，世界");
    expect(assistantBlocks[0]?.id).toBe(
      assistantEvents[assistantEvents.length - 1]?.assistantMessageId
    );
  });

  test("emits incremental thinking snapshots with a stable thinking message id", async () => {
    const sessionManager = createMemorySessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create() {
            throw new Error("stream path should be used");
          },
          stream() {
            const events = [
              {
                type: "content_block_start" as const,
                index: 0,
                content_block: {
                  type: "thinking" as const,
                  thinking: "",
                  signature: ""
                }
              },
              {
                type: "content_block_delta" as const,
                index: 0,
                delta: {
                  type: "thinking_delta" as const,
                  thinking: "先检查"
                }
              },
              {
                type: "content_block_delta" as const,
                index: 0,
                delta: {
                  type: "thinking_delta" as const,
                  thinking: "一下上下文"
                }
              },
              {
                type: "content_block_delta" as const,
                index: 0,
                delta: {
                  type: "signature_delta" as const,
                  signature: "sig-thinking-1"
                }
              },
              {
                type: "content_block_stop" as const,
                index: 0
              },
              {
                type: "content_block_start" as const,
                index: 1,
                content_block: {
                  type: "text" as const,
                  text: ""
                }
              },
              {
                type: "content_block_delta" as const,
                index: 1,
                delta: {
                  type: "text_delta" as const,
                  text: "已完成。"
                }
              },
              {
                type: "content_block_stop" as const,
                index: 1
              },
              {
                type: "message_delta" as const,
                delta: {
                  stop_reason: "end_turn"
                },
                usage: {
                  input_tokens: 10,
                  output_tokens: 5,
                  cache_creation_input_tokens: 0,
                  cache_read_input_tokens: 0
                }
              },
              {
                type: "message_stop" as const
              }
            ];

            return {
              async finalMessage() {
                return {
                  content: [
                    {
                      type: "thinking",
                      thinking: "先检查一下上下文",
                      signature: "sig-thinking-1"
                    },
                    { type: "text", text: "已完成。" }
                  ],
                  stop_reason: "end_turn",
                  usage: {
                    input_tokens: 10,
                    output_tokens: 5,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0
                  }
                };
              },
              async *[Symbol.asyncIterator]() {
                for (const event of events) {
                  yield event;
                }
              }
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      toolRegistry: new ToolRegistry()
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "stream-thinking-user"
    });

    const streamEvents: RunStreamEvent[] = [];
    const result = await runtime.run({
      sessionId: session.sessionId,
      message: "先想一想再回答",
      eventSink(event) {
        streamEvents.push(event);
      }
    });

    expect(result.status).toBe("completed");

    const thinkingEvents = streamEvents.filter(
      (event): event is Extract<RunStreamEvent, { kind: "thinking" }> =>
        event.kind === "thinking"
    );

    expect(thinkingEvents.map((event) => event.text)).toEqual([
      "先检查",
      "先检查一下上下文",
      "先检查一下上下文"
    ]);
    expect(thinkingEvents[2]?.signature).toBe("sig-thinking-1");
    expect(
      new Set(thinkingEvents.map((event) => event.thinkingMessageId)).size
    ).toBe(1);
    expect(
      result.session.messages.some((block) => block.kind === "assistant thinking")
    ).toBe(false);
  });
});
