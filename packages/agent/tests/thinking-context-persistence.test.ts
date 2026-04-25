import { describe, expect, test } from "bun:test";

import { createMemoryRoutineRepository } from "@ai-app-template/db";

import type { AnthropicMessageRequest } from "../src/model.js";
import { createAgentRuntime } from "../src/runtime.js";
import { createMemorySessionManager } from "../src/session/index.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { RuntimeTool } from "../src/tools/runtime-tool.js";

function createEchoTool(): RuntimeTool {
  return {
    name: "echo_tool",
    description: "Returns the provided value.",
    family: "workspace-file",
    isReadOnly: true,
    hasExternalSideEffect: false,
    permissionProfile: "allow",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string" }
      },
      required: ["value"],
      additionalProperties: false
    },
    validate(input) {
      return {
        ok: true,
        value: {
          value: typeof input.value === "string" ? input.value : ""
        }
      };
    },
    async execute(input) {
      return {
        state: "success",
        content: String(input.value ?? ""),
        displayText: String(input.value ?? ""),
        result: {
          ok: true,
          code: "OK",
          message: "Echoed value."
        }
      };
    }
  };
}

describe("thinking context persistence", () => {
  test("persists signed thinking for native tool-use turns and replays it in the next prompt", async () => {
    const requests: AnthropicMessageRequest[] = [];
    const sessionManager = createMemorySessionManager();
    const routineRepository = createMemoryRoutineRepository();
    let callCount = 0;

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create(request) {
            requests.push(structuredClone(request));
            callCount += 1;

            if (callCount === 1) {
              return {
                content: [
                  {
                    type: "thinking",
                    thinking: "I should call echo_tool before answering.",
                    signature: "tool-turn-signature"
                  },
                  {
                    type: "tool_use",
                    id: "call-echo",
                    name: "echo_tool",
                    input: { value: "tool output" }
                  }
                ],
                stop_reason: "tool_use"
              };
            }

            return {
              content: [
                {
                  type: "thinking",
                  thinking: "Now I can answer.",
                  signature: "final-turn-signature"
                },
                {
                  type: "text",
                  text: "done"
                }
              ],
              stop_reason: "end_turn"
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      toolRegistry: new ToolRegistry().register(createEchoTool()),
      maxTurns: 3,
      maxTokens: 128
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "thinking-context-test"
    });

    const result = await runtime.run({
      sessionId: session.sessionId,
      message: "Use the tool."
    });

    expect(result.status).toBe("completed");
    expect(result.finalAnswer).toBe("done");
    expect(requests).toHaveLength(2);

    const replayedAssistant = requests[1]?.messages.find((message) =>
      message.content.some((block) => block.type === "thinking")
    );
    expect(replayedAssistant?.role).toBe("assistant");
    expect(replayedAssistant?.content).toEqual([
      {
        type: "thinking",
        thinking: "I should call echo_tool before answering.",
        signature: "tool-turn-signature"
      },
      {
        type: "tool_use",
        id: "call-echo",
        name: "echo_tool",
        input: { value: "tool output" }
      }
    ]);

    const thinkingBlocks = result.session.messages.filter(
      (
        block
      ): block is Extract<
        (typeof result.session.messages)[number],
        { kind: "assistant thinking" }
      > => block.kind === "assistant thinking"
    );
    expect(thinkingBlocks.map((block) => block.signature)).toEqual([
      "tool-turn-signature"
    ]);
    expect(
      result.session.messages.some(
        (block) =>
          block.kind === "assistant thinking" &&
          block.signature === "final-turn-signature"
      )
    ).toBe(false);
  });

  test("does not persist thinking from text tool-call fallback turns", async () => {
    const sessionManager = createMemorySessionManager();
    const routineRepository = createMemoryRoutineRepository();
    let callCount = 0;

    const runtime = createAgentRuntime({
      client: {
        messages: {
          async create() {
            callCount += 1;

            if (callCount === 1) {
              return {
                content: [
                  {
                    type: "thinking",
                    thinking:
                      "Fallback tool markup should not become protocol thinking.",
                    signature: "fallback-signature"
                  },
                  {
                    type: "text",
                    text: 'I will call the tool.\n\n[TOOL_CALL]\n{tool => "echo_tool", args => {\n  --value "tool output"\n}}\n[/TOOL_CALL]'
                  }
                ],
                stop_reason: "end_turn"
              };
            }

            return {
              content: [
                {
                  type: "text",
                  text: "done"
                }
              ],
              stop_reason: "end_turn"
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      toolRegistry: new ToolRegistry().register(createEchoTool()),
      maxTurns: 3,
      maxTokens: 128
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "thinking-fallback-test"
    });

    const result = await runtime.run({
      sessionId: session.sessionId,
      message: "Use fallback markup."
    });

    expect(result.status).toBe("completed");
    expect(
      result.session.messages.some(
        (block) => block.kind === "assistant thinking"
      )
    ).toBe(false);
  });
});
