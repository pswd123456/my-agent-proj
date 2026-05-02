import { afterAll, describe, expect, test } from "bun:test";
import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createMemoryRoutineRepository } from "@ai-app-template/db";

import {
  createAgentRuntime,
  createWorkspaceToolRegistry,
  type AnthropicRequestOptions,
  type RunStreamEvent
} from "../src/index.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const cleanupPaths = new Set<string>();

afterAll(async () => {
  await Promise.all(
    [...cleanupPaths].map((target) =>
      rm(target, { recursive: true, force: true })
    )
  );
});

describe("runtime interrupt handling", () => {
  test("persists partial streamed assistant text when the user interrupts mid-stream", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
    let aborted = false;

    const runtime = createAgentRuntime({
      client: {
        messages: {
          stream() {
            return {
              abort() {
                aborted = true;
              },
              async finalMessage() {
                return {
                  content: [{ type: "text", text: "你好" }],
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
                yield {
                  type: "content_block_start" as const,
                  index: 0,
                  content_block: {
                    type: "text" as const,
                    text: ""
                  }
                };
                yield {
                  type: "content_block_delta" as const,
                  index: 0,
                  delta: {
                    type: "text_delta" as const,
                    text: "你好"
                  }
                };
                await sleep(400);
                if (aborted) {
                  return;
                }
                yield {
                  type: "content_block_delta" as const,
                  index: 0,
                  delta: {
                    type: "text_delta" as const,
                    text: "，世界"
                  }
                };
                yield {
                  type: "content_block_stop" as const,
                  index: 0
                };
                yield {
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
                };
                yield {
                  type: "message_stop" as const
                };
              }
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      toolRegistry: createWorkspaceToolRegistry({
        workingDirectory: process.cwd()
      })
    });

    const session = await runtime.createSession({
      workingDirectory: process.cwd(),
      userId: "interrupt-user"
    });

    const streamEvents: RunStreamEvent[] = [];
    const result = await runtime.run({
      sessionId: session.sessionId,
      message: "打个招呼，然后我会中断你",
      eventSink(event) {
        streamEvents.push(event);
        if (event.kind === "assistant_text") {
          void sessionManager.requestInterrupt(session.sessionId);
        }
      }
    });

    expect(aborted).toBe(true);
    expect(result.status).toBe("interrupted");
    expect(result.stopReason).toBe("interrupted_by_user");
    expect(result.finalAnswer).toBe("你好");
    expect(result.session.context.status).toBe("waiting_for_user_input");
    expect(result.session.sessionState.loopState).toBe("interrupted");
    expect(result.session.sessionState.interruptRequested).toBe(false);
    expect(
      result.session.messages.filter((block) => block.kind === "assistant")
    ).toHaveLength(1);
    expect(
      result.session.messages.find((block) => block.kind === "assistant")
    ).toMatchObject({
      kind: "assistant",
      content: "你好"
    });
    expect(
      streamEvents.some((event) => event.kind === "interrupt_requested")
    ).toBe(true);
    expect(streamEvents.some((event) => event.kind === "interrupted")).toBe(
      true
    );
  });

  test("interrupts a model stream before the first model event arrives", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
    let sessionId = "";
    let requestSignal: AbortSignal | null = null;
    let streamAbortCalled = false;

    const runtime = createAgentRuntime({
      client: {
        messages: {
          stream(_request, options?: AnthropicRequestOptions) {
            requestSignal = options?.signal ?? null;
            void sessionManager.requestInterrupt(sessionId);
            return {
              abort() {
                streamAbortCalled = true;
              },
              async finalMessage() {
                return {
                  content: [],
                  stop_reason: "end_turn",
                  usage: {
                    input_tokens: 12,
                    output_tokens: 0,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0
                  }
                };
              },
              async *[Symbol.asyncIterator]() {
                const signal = requestSignal;
                if (!signal) {
                  throw new Error("missing abort signal");
                }
                if (!signal.aborted) {
                  await new Promise<void>((resolve) => {
                    signal.addEventListener("abort", () => resolve(), {
                      once: true
                    });
                  });
                }
              }
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      toolRegistry: createWorkspaceToolRegistry({
        workingDirectory: process.cwd()
      })
    });

    const session = await runtime.createSession({
      workingDirectory: process.cwd(),
      userId: "interrupt-user"
    });
    sessionId = session.sessionId;

    const result = await runtime.run({
      sessionId: session.sessionId,
      message: "这次模型服务器还没吐首包就中断"
    });

    expect(requestSignal).not.toBeNull();
    expect(requestSignal?.aborted).toBe(true);
    expect(streamAbortCalled).toBe(true);
    expect(result.status).toBe("interrupted");
    expect(result.stopReason).toBe("interrupted_by_user");
    expect(result.session.sessionState.interruptRequested).toBe(false);
  });

  test("marks a long-running tool call as interrupted and clears pending tool ids", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(tmpdir(), "agent-interrupt-runtime-")
    );
    cleanupPaths.add(workspaceRoot);

    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const server = Bun.serve({
      port: 0,
      async fetch() {
        await sleep(5_000);
        return new Response("late response");
      }
    });

    try {
      const runtime = createAgentRuntime({
        client: {
          messages: {
            async create() {
              return {
                content: [
                  {
                    type: "tool_use" as const,
                    id: "http-call-1",
                    name: "make_http_request",
                    input: {
                      url: `http://127.0.0.1:${server.port}/slow`
                    }
                  }
                ],
                stop_reason: "tool_use",
                usage: {
                  input_tokens: 8,
                  output_tokens: 2,
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
        toolRegistry: createWorkspaceToolRegistry({
          workingDirectory: workspaceRoot
        })
      });

      const session = await runtime.createSession({
        workingDirectory: workspaceRoot,
        userId: "interrupt-user",
        toolAllowList: ["make_http_request"]
      });

      const result = await runtime.run({
        sessionId: session.sessionId,
        message: "去请求一个很慢的地址",
        eventSink(event) {
          if (event.kind === "tool_call") {
            void sessionManager.requestInterrupt(session.sessionId);
          }
        }
      });

      expect(result.status).toBe("interrupted");
      expect(result.stopReason).toBe("interrupted_by_user");
      expect(result.toolOutputs).toHaveLength(1);
      expect(result.toolOutputs[0]?.displayText).toContain("interrupted");
      expect(result.toolOutputs[0]?.isError).toBe(true);
      expect(result.session.sessionState.pendingToolCallIds).toHaveLength(0);
      expect(result.session.context.status).toBe("waiting_for_user_input");
    } finally {
      server.stop(true);
    }
  });
});
