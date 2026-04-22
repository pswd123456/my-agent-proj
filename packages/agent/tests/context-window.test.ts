import { describe, expect, test } from "bun:test";

import { createMemoryRoutineRepository } from "@ai-app-template/db";

import { createAgentRuntime } from "../src/runtime.js";
import { createMemorySessionManager } from "../src/session/index.js";
import { ToolRegistry } from "../src/tools/registry.js";

describe("context window preflight", () => {
  test("fails before the model call when the estimated prompt exceeds the session context window", async () => {
    const sessionManager = createMemorySessionManager();
    const routineRepository = createMemoryRoutineRepository();
    let modelCallCount = 0;

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create() {
            modelCallCount += 1;
            return {
              content: [{ type: "text", text: "should not run" }]
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

    expect(modelCallCount).toBe(0);
    expect(result.status).toBe("failed");
    expect(result.stopReason).toBe("context_window_exceeded");
    expect(result.session.sessionState.loopState).toBe("failed");
    expect(result.session.context.status).toBe("failed");
    expect(result.session.sessionState.lastError).toContain("context window");
  });
});
