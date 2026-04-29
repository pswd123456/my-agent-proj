import { describe, expect, test } from "bun:test";

import { createMemoryRoutineRepository } from "@ai-app-template/db";

import type { AnthropicMessageRequest } from "../src/model.js";
import { DEFAULT_DEEPSEEK_MODEL } from "../src/models/service.js";
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

function createApprovalEchoTool(): RuntimeTool {
  return {
    name: "approval_echo_tool",
    description: "Returns the provided value after approval.",
    family: "workspace-file",
    isReadOnly: false,
    hasExternalSideEffect: false,
    permissionProfile: "always-ask-user",
    sandboxProfile: "none",
    inputSchema: {
      type: "object",
      properties: {
        value: { type: "string" }
      },
      required: ["value"],
      additionalProperties: false
    },
    async getPermissionRequest() {
      return {
        summaryText: "需要确认后才能继续执行第一个工具。"
      };
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
          message: "Echoed value after approval."
        }
      };
    }
  };
}

function messageText(message: AnthropicMessageRequest["messages"][number]) {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
}

describe("thinking context persistence", () => {
  test("sends runtime context before conversation history so tool results stay last", async () => {
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
                    type: "tool_use",
                    id: "call-echo-order",
                    name: "echo_tool",
                    input: { value: "tool output should be last" }
                  }
                ],
                stop_reason: "tool_use"
              };
            }

            return {
              content: [{ type: "text", text: "done" }],
              stop_reason: "end_turn"
            };
          }
        }
      },
      model: "MiniMax-M2.7",
      sessionManager,
      routineRepository,
      toolRegistry: new ToolRegistry().register(createEchoTool()),
      maxTurns: 2,
      maxTokens: 128
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "message-order-test"
    });

    const result = await runtime.run({
      sessionId: session.sessionId,
      message: "Use echo."
    });

    expect(result.status).toBe("completed");
    expect(requests).toHaveLength(2);

    const secondMessages = requests[1]?.messages ?? [];
    const runtimeContextIndex = secondMessages.findIndex((message) =>
      messageText(message).includes("Runtime context for this run:")
    );
    const userRequestIndex = secondMessages.findIndex((message) =>
      messageText(message).includes("Use echo.")
    );

    expect(runtimeContextIndex).toBeGreaterThanOrEqual(0);
    expect(userRequestIndex).toBeGreaterThan(runtimeContextIndex);
    expect(secondMessages.at(-1)?.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "call-echo-order",
        content: "tool output should be last",
        is_error: false
      }
    ]);
  });

  test("persists signed thinking blocks and replays them in the next prompt", async () => {
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

    const thirdRun = await runtime.run({
      sessionId: session.sessionId,
      message: "继续。"
    });

    expect(thirdRun.status).toBe("completed");
    expect(thirdRun.finalAnswer).toBe("done");
    expect(requests).toHaveLength(3);
    expect(
      requests[2]?.messages.find((message) =>
        message.content.some((block) => block.type === "thinking")
      )
    ).toEqual({
      role: "assistant",
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
      ]
    });
    expect(
      requests[2]?.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content.some(
            (block) =>
              block.type === "thinking" &&
              block.signature === "final-turn-signature"
          )
      )
    ).toBe(true);

    const thinkingBlocks = result.session.messages.filter(
      (
        block
      ): block is Extract<
        (typeof result.session.messages)[number],
        { kind: "assistant thinking" }
      > => block.kind === "assistant thinking"
    );
    expect(thinkingBlocks.map((block) => block.signature)).toEqual([
      "tool-turn-signature",
      "final-turn-signature"
    ]);
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

  test("replays historical thinking blocks when the selected model supports thinking input", async () => {
    const requests: AnthropicMessageRequest[] = [];
    const sessionManager = createMemorySessionManager();
    const routineRepository = createMemoryRoutineRepository();
    const client = {
      messages: {
        async create(request: AnthropicMessageRequest) {
          requests.push(structuredClone(request));
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
    };

    const runtime = createAgentRuntime({
      modelService: {
        listModels() {
          return [];
        },
        getDefaultModel() {
          return DEFAULT_DEEPSEEK_MODEL;
        },
        isModelSupported(model) {
          return model === DEFAULT_DEEPSEEK_MODEL;
        },
        isModelAvailable(model) {
          return model === DEFAULT_DEEPSEEK_MODEL;
        },
        supportsThinking() {
          return true;
        },
        assertModelAvailable() {
          return DEFAULT_DEEPSEEK_MODEL;
        },
        getClient() {
          return client;
        }
      },
      sessionManager,
      routineRepository,
      toolRegistry: new ToolRegistry(),
      maxTurns: 2,
      maxTokens: 128
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "deepseek-thinking-filter-test",
      model: DEFAULT_DEEPSEEK_MODEL
    });

    await sessionManager.appendBlock(session.sessionId, {
      id: "assistant-thinking-1",
      kind: "assistant thinking",
      content: "old hidden reasoning",
      signature: "old-signature",
      createdAt: new Date().toISOString()
    });

    await runtime.run({
      sessionId: session.sessionId,
      message: "Continue."
    });

    expect(requests).toHaveLength(1);
    expect(
      requests[0]?.messages.some((message) =>
        message.content.some((block) => block.type === "thinking")
      )
    ).toBe(true);
  });

  test("replays multi-tool thinking turns as one assistant message with grouped tool results", async () => {
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
                    thinking: "I should gather several files before planning.",
                    signature: "multi-tool-signature"
                  },
                  {
                    type: "text",
                    text: "Let me inspect a few places first."
                  },
                  {
                    type: "tool_use",
                    id: "call-1",
                    name: "echo_tool",
                    input: { value: "one" }
                  },
                  {
                    type: "tool_use",
                    id: "call-2",
                    name: "echo_tool",
                    input: { value: "two" }
                  },
                  {
                    type: "tool_use",
                    id: "call-3",
                    name: "echo_tool",
                    input: { value: "three" }
                  }
                ],
                stop_reason: "tool_use"
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
      userId: "multi-tool-thinking-group-test"
    });

    const result = await runtime.run({
      sessionId: session.sessionId,
      message: "Use several tools."
    });

    expect(result.status).toBe("completed");
    expect(requests).toHaveLength(2);
    const replayedAssistant = requests[1]?.messages.find(
      (message) =>
        message.role === "assistant" &&
        message.content.some((block) => block.type === "thinking")
    );
    expect(replayedAssistant).toEqual({
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "I should gather several files before planning.",
          signature: "multi-tool-signature"
        },
        {
          type: "text",
          text: "Let me inspect a few places first."
        },
        {
          type: "tool_use",
          id: "call-1",
          name: "echo_tool",
          input: { value: "one" }
        },
        {
          type: "tool_use",
          id: "call-2",
          name: "echo_tool",
          input: { value: "two" }
        },
        {
          type: "tool_use",
          id: "call-3",
          name: "echo_tool",
          input: { value: "three" }
        }
      ]
    });
    const groupedToolResults = requests[1]?.messages.find(
      (message) =>
        message.role === "user" &&
        message.content.length === 3 &&
        message.content.every((block) => block.type === "tool_result")
    );
    expect(groupedToolResults).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "call-1",
          content: "one",
          is_error: false
        },
        {
          type: "tool_result",
          tool_use_id: "call-2",
          content: "two",
          is_error: false
        },
        {
          type: "tool_result",
          tool_use_id: "call-3",
          content: "three",
          is_error: false
        }
      ]
    });
  });

  test("preserves the full tool-use turn after permission approval before returning to the model", async () => {
    const requests: AnthropicMessageRequest[] = [];
    const sessionManager = createMemorySessionManager();
    const routineRepository = createMemoryRoutineRepository();
    let callCount = 0;

    const runtime = createAgentRuntime({
      modelService: {
        listModels() {
          return [];
        },
        getDefaultModel() {
          return DEFAULT_DEEPSEEK_MODEL;
        },
        isModelSupported(model) {
          return model === DEFAULT_DEEPSEEK_MODEL;
        },
        isModelAvailable(model) {
          return model === DEFAULT_DEEPSEEK_MODEL;
        },
        supportsThinking() {
          return true;
        },
        assertModelAvailable() {
          return DEFAULT_DEEPSEEK_MODEL;
        },
        getClient() {
          return {
            messages: {
              async create(request: AnthropicMessageRequest) {
                requests.push(structuredClone(request));
                callCount += 1;

                if (callCount === 1) {
                  return {
                    content: [
                      {
                        type: "thinking",
                        thinking:
                          "I should run the approval gate first, then finish the other tools.",
                        signature: "approval-multi-tool-signature"
                      },
                      {
                        type: "tool_use",
                        id: "call-approval",
                        name: "approval_echo_tool",
                        input: { value: "approved" }
                      },
                      {
                        type: "tool_use",
                        id: "call-echo-1",
                        name: "echo_tool",
                        input: { value: "one" }
                      },
                      {
                        type: "tool_use",
                        id: "call-echo-2",
                        name: "echo_tool",
                        input: { value: "two" }
                      }
                    ],
                    stop_reason: "tool_use"
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
          };
        }
      },
      sessionManager,
      routineRepository,
      toolRegistry: new ToolRegistry()
        .register(createApprovalEchoTool())
        .register(createEchoTool()),
      maxTurns: 3,
      maxTokens: 128
    });

    const session = await runtime.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "approval-multi-tool-test",
      model: DEFAULT_DEEPSEEK_MODEL
    });

    const firstRun = await runtime.run({
      sessionId: session.sessionId,
      message: "Run the tools."
    });

    expect(firstRun.status).toBe("waiting for input");
    expect(firstRun.session.sessionState.pendingToolCallIds).toEqual([
      "call-approval",
      "call-echo-1",
      "call-echo-2"
    ]);
    expect(
      firstRun.session.messages.filter((block) => block.kind === "tool call")
        .length
    ).toBe(3);

    const secondRun = await runtime.run({
      sessionId: session.sessionId,
      message: "确认",
      permissionReply: true
    });

    expect(secondRun.status).toBe("completed");
    expect(secondRun.finalAnswer).toBe("done");
    expect(requests).toHaveLength(2);
    expect(
      requests[1]?.messages.find(
        (message) =>
          message.role === "assistant" &&
          message.content.some((block) => block.type === "thinking")
      )
    ).toEqual({
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking:
            "I should run the approval gate first, then finish the other tools.",
          signature: "approval-multi-tool-signature"
        },
        {
          type: "tool_use",
          id: "call-approval",
          name: "approval_echo_tool",
          input: { value: "approved" }
        },
        {
          type: "tool_use",
          id: "call-echo-1",
          name: "echo_tool",
          input: { value: "one" }
        },
        {
          type: "tool_use",
          id: "call-echo-2",
          name: "echo_tool",
          input: { value: "two" }
        }
      ]
    });
    expect(
      requests[1]?.messages.find(
        (message) =>
          message.role === "user" &&
          message.content.length === 3 &&
          message.content.every((block) => block.type === "tool_result")
      )
    ).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "call-approval",
          content: "approved",
          is_error: false
        },
        {
          type: "tool_result",
          tool_use_id: "call-echo-1",
          content: "one",
          is_error: false
        },
        {
          type: "tool_result",
          tool_use_id: "call-echo-2",
          content: "two",
          is_error: false
        }
      ]
    });
  });
});
