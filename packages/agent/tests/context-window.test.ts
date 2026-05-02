import { describe, expect, test } from "bun:test";

import { createMemoryRoutineRepository } from "@ai-app-template/db";

import { createAgentRuntime } from "../src/runtime.js";
import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";
import { ToolRegistry } from "../src/tools/registry.js";

describe("context window preflight", () => {
  test("fails before the main assistant turn when compaction still cannot fit the prompt into the context window", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const requests: Array<{ system: string; messageCount: number }> = [];

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create(request) {
            requests.push({
              system: request.system,
              messageCount: request.messages.length
            });
            return {
              content: [
                {
                  type: "text",
                  text: [
                    "## Goal",
                    "Keep the session resumable.",
                    "",
                    "## Constraints",
                    "- The prompt is still too large.",
                    "",
                    "## Verified Facts",
                    "- Full compaction was attempted.",
                    "",
                    "## Decisions",
                    "- Fail before the main turn if the prompt still exceeds the window.",
                    "",
                    "## Current Frontier",
                    "- No assistant turn should run.",
                    "",
                    "## Next Checkpoint",
                    "- Ask for a larger context window or reduce prompt size."
                  ].join("\n")
                }
              ]
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
      userId: "budget-user",
      contextWindow: 1
    });

    const result = await runtime.run({
      sessionId: session.sessionId,
      message: "请先读取当前上下文。"
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.system).toContain(
      "summarizing agent session history for continuation after full compaction"
    );
    expect(result.status).toBe("failed");
    expect(result.stopReason).toBe("context_window_exceeded");
    expect(result.session.sessionState.loopState).toBe("failed");
    expect(result.session.context.status).toBe("failed");
    expect(result.session.sessionState.lastError).toContain("context window");
  });
});
