import { describe, expect, test } from "bun:test";

import { createMemoryRoutineRepository } from "@ai-app-template/db";

import {
  createAgentRuntime,
  type AnthropicMessageRequest,
  type RunStreamEvent
} from "../src/index.js";
import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";
import { ToolRegistry } from "../src/tools/registry.js";

function requestText(request: AnthropicMessageRequest): string {
  return request.messages
    .flatMap((message) =>
      message.content.flatMap((block) =>
        block.type === "text" ? [block.text] : []
      )
    )
    .join("\n");
}

describe("message user context hooks", () => {
  test("runs session and run start hook messages before the user message, then run end hooks", async () => {
    const requests: AnthropicMessageRequest[] = [];
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
    let callCount = 0;

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create(request) {
            requests.push(structuredClone(request));
            callCount += 1;
            return {
              content: [{ type: "text", text: `reply ${callCount}` }],
              stop_reason: "end_turn" as const
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      toolRegistry: new ToolRegistry(),
      userContextHooks: [
        {
          id: "session-start",
          event: "session_started",
          behavior: "message",
          title: "Session start",
          content: "先执行 session start hook。",
          enabled: true
        },
        {
          id: "run-start",
          event: "run_started",
          behavior: "message",
          title: "Run start",
          content: "再执行 run start hook。",
          enabled: true
        },
        {
          id: "run-end",
          event: "run_end",
          behavior: "message",
          title: "Run end",
          content: "最后执行 run end hook。",
          enabled: true
        }
      ],
      maxTurns: 1
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "hook-message-user"
    });

    const streamEvents: RunStreamEvent[] = [];
    const result = await runtime.run({
      sessionId: session.sessionId,
      message: "这是用户原始消息。",
      eventSink(event) {
        streamEvents.push(event);
      }
    });

    expect(result.status).toBe("completed");
    expect(result.finalAnswer).toBe("reply 4");
    expect(requests).toHaveLength(4);
    expect(requestText(requests[0]!)).toContain("先执行 session start hook。");
    expect(requestText(requests[0]!)).not.toContain("这是用户原始消息。");
    expect(requestText(requests[1]!)).toContain("再执行 run start hook。");
    expect(requestText(requests[1]!)).not.toContain("这是用户原始消息。");
    expect(requestText(requests[2]!)).toContain("这是用户原始消息。");
    expect(requestText(requests[2]!)).not.toContain("最后执行 run end hook。");
    expect(requestText(requests[3]!)).toContain("最后执行 run end hook。");

    expect(
      result.session.messages
        .filter((block) => block.kind === "user")
        .map((block) => block.content)
    ).toEqual([
      "先执行 session start hook。",
      "再执行 run start hook。",
      "这是用户原始消息。",
      "最后执行 run end hook。"
    ]);
    expect(
      streamEvents.filter((event) => event.kind === "run_complete")
    ).toHaveLength(1);
  });
});
