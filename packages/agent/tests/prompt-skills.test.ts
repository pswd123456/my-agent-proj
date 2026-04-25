import { describe, expect, test } from "bun:test";

import { createCreateRoutineTool } from "../src/tools/create-routine.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createPromptBuilder, toAnthropicMessages } from "../src/prompt.js";
import type { ConversationBlock, SessionSnapshot } from "../src/types.js";

function createSessionSnapshot(): SessionSnapshot {
  return {
    sessionId: "session-1",
    workingDirectory: "/tmp/workspace",
    model: "MiniMax-M2.7",
    contextWindow: 200_000,
    maxTurns: 50,
    context: {
      userId: "test-user",
      status: "completed",
      yoloMode: false,
      shellAllowPatterns: [],
      shellDenyPatterns: [],
      toolAllowList: [],
      toolAskList: [],
      toolDenyList: [],
      pendingPermissionRequest: null,
      pendingConfirmationPayload: null,
      pendingConflictSummary: null,
      currentDateContext: "2026-04-22",
      lastUserMessage: null
    },
    messages: [],
    sessionState: {
      loopState: "waiting for input",
      turnCount: 0,
      lastError: null,
      pendingToolCallIds: [],
      interruptRequested: false
    },
    inputTokensCount: 0,
    promptCacheKey: "",
    updatedAt: new Date().toISOString()
  };
}

describe("PromptBuilder skill context", () => {
  test("serializes assistant thinking before the matching tool call", () => {
    const messages = toAnthropicMessages([
      {
        id: "user-1",
        kind: "user",
        content: "Read the file.",
        createdAt: "2026-04-25T00:00:00.000Z"
      },
      {
        id: "thinking-1",
        kind: "assistant thinking",
        content: "I need to inspect the requested file before answering.",
        signature: "thinking-signature-1",
        createdAt: "2026-04-25T00:00:01.000Z"
      },
      {
        id: "tool-call-1",
        kind: "tool call",
        toolCallId: "call-1",
        toolName: "read_file",
        input: { path: "README.md" },
        state: "pending",
        createdAt: "2026-04-25T00:00:02.000Z"
      },
      {
        id: "tool-result-1",
        kind: "tool result",
        toolCallId: "call-1",
        toolName: "read_file",
        output: "Hello",
        isError: false,
        state: "success",
        createdAt: "2026-04-25T00:00:03.000Z"
      }
    ]);

    expect(messages).toHaveLength(3);
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.content).toEqual([
      {
        type: "thinking",
        thinking: "I need to inspect the requested file before answering.",
        signature: "thinking-signature-1"
      },
      {
        type: "tool_use",
        id: "call-1",
        name: "read_file",
        input: { path: "README.md" }
      }
    ]);
    expect(messages[2]?.content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "call-1"
    });
  });

  test("injects a skill list into runtime context messages", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    const toolRegistry = new ToolRegistry();

    const promptEnvelope = promptBuilder.build(
      session,
      toolRegistry,
      {
        currentDateTimeContext: "2026-04-22 10:00",
        currentTimeZone: "Asia/Shanghai"
      },
      [
        {
          name: "repo_reader",
          description: "Read repository structure before implementation.",
          relativePath: ".agent/skills/repo-reader/SKILL.md"
        }
      ]
    );

    expect(promptEnvelope.system).toContain(
      "Actively utilize the skills listed in the runtime context"
    );
    expect(promptEnvelope.system).toContain(
      "Only rely on skills explicitly listed in the current runtime context"
    );
    expect(promptEnvelope.runtimeContextMessages).toHaveLength(2);
    expect(JSON.stringify(promptEnvelope.runtimeContextMessages[1])).toContain(
      "Runtime skills for this workspace:"
    );
    expect(JSON.stringify(promptEnvelope.runtimeContextMessages[1])).toContain(
      "repo_reader"
    );
    expect(
      JSON.stringify(promptEnvelope.runtimeContextMessages[1])
    ).not.toContain(".agent/skills/repo-reader/SKILL.md");
  });

  test("renders none when no skills are available", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    const promptEnvelope = promptBuilder.build(session, new ToolRegistry());

    expect(promptEnvelope.system).toContain(
      "You are a personal assistant."
    );
    expect(promptEnvelope.system).not.toMatch(
      /scheduling agent.*routine manager/i
    );
    expect(promptEnvelope.runtimeContextMessages).toHaveLength(2);
    expect(JSON.stringify(promptEnvelope.runtimeContextMessages[1])).toContain(
      "Runtime skills for this workspace:"
    );
    expect(JSON.stringify(promptEnvelope.runtimeContextMessages[1])).toContain(
      "none"
    );
  });

  test("adds routine guidance only when routine tools are mounted", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    const toolRegistry = new ToolRegistry().register(createCreateRoutineTool());

    const promptEnvelope = promptBuilder.build(session, toolRegistry);

    expect(JSON.stringify(promptEnvelope.prefixMessages[0])).toContain(
      "Mounted tools: create_routine"
    );
    expect(JSON.stringify(promptEnvelope.prefixMessages[0])).toContain(
      "Enabled capability packs: workspace, schedule"
    );
  });

  test("keeps the recent tool chain when compacting a single-user long run", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    const blocks: ConversationBlock[] = [
      {
        id: "user-1",
        kind: "user",
        content: "检查 ../ 下的项目文件，告诉我项目中的agent loop是怎么实现的",
        createdAt: "2026-04-24T00:00:00.000Z"
      }
    ];

    for (let index = 0; index < 12; index += 1) {
      blocks.push(
        {
          id: `assistant-${index}`,
          kind: "assistant",
          content: `继续查看第 ${index} 个候选路径`,
          createdAt: "2026-04-24T00:00:00.000Z"
        },
        {
          id: `tool-call-${index}`,
          kind: "tool call",
          toolCallId: `call-${index}`,
          toolName: index === 11 ? "list_directory" : "read_file",
          input:
            index === 11
              ? { path: "../packages/agent/src" }
              : { path: `../missing-${index}.ts` },
          createdAt: "2026-04-24T00:00:00.000Z"
        },
        {
          id: `tool-result-${index}`,
          kind: "tool result",
          toolCallId: `call-${index}`,
          toolName: index === 11 ? "list_directory" : "read_file",
          output:
            index === 11
              ? JSON.stringify({
                  ok: true,
                  data: {
                    path: "../packages/agent/src",
                    entries: [
                      { name: "runtime.ts", kind: "file" },
                      { name: "runtime", kind: "directory" },
                      { name: "tools", kind: "directory" }
                    ]
                  }
                })
              : JSON.stringify({
                  ok: false,
                  message: `ENOENT: ../missing-${index}.ts`
                }),
          isError: index !== 11,
          createdAt: "2026-04-24T00:00:00.000Z"
        }
      );
    }

    session.messages = blocks;

    const promptEnvelope = promptBuilder.build(session, new ToolRegistry());
    const serializedMessages = JSON.stringify(promptEnvelope.messages);

    expect(serializedMessages).not.toContain("[History compacted:");
    expect(serializedMessages).toContain("../missing-0.ts");
    expect(serializedMessages).toContain("ENOENT: ../missing-0.ts");
    expect(serializedMessages).not.toContain("[Historical tool call]");
    expect(serializedMessages).not.toContain("[Historical tool result]");
  });

  test("drops standalone historical tool blocks from anthropic messages", () => {
    const session = createSessionSnapshot();
    session.messages = [
      {
        id: "user-1",
        kind: "user",
        content: "检查 agent loop",
        createdAt: "2026-04-24T00:00:00.000Z"
      },
      {
        id: "tool-call-1",
        kind: "tool call",
        toolCallId: "call-1",
        toolName: "read_file",
        input: { path: "../packages/agent/src/runtime/run-loop.ts" },
        createdAt: "2026-04-24T00:00:01.000Z"
      },
      {
        id: "tool-result-1",
        kind: "tool result",
        toolCallId: "call-1",
        toolName: "read_file",
        output: "export async function runSessionLoop() {}",
        isError: false,
        createdAt: "2026-04-24T00:00:02.000Z"
      }
    ];

    const promptEnvelope = createPromptBuilder().build(
      session,
      new ToolRegistry()
    );

    expect(JSON.stringify(promptEnvelope.messages)).not.toContain(
      "[Historical tool call]"
    );
    expect(JSON.stringify(promptEnvelope.messages)).not.toContain(
      "[Historical tool result]"
    );
  });

  test("does not serialize compacted historical tool calls as assistant text", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();

    session.messages = [
      {
        id: "user-1",
        kind: "user",
        content: "先看下项目结构",
        createdAt: "2026-04-24T00:00:00.000Z"
      },
      {
        id: "tool-call-1",
        kind: "tool call",
        toolCallId: "call-1",
        toolName: "list_directory",
        input: { path: ".." },
        state: "completed",
        createdAt: "2026-04-24T00:00:01.000Z"
      },
      {
        id: "tool-result-1",
        kind: "tool result",
        toolCallId: "call-1",
        toolName: "list_directory",
        output: JSON.stringify({ ok: true }),
        isError: false,
        state: "success",
        createdAt: "2026-04-24T00:00:02.000Z"
      },
      {
        id: "assistant-1",
        kind: "assistant",
        content: "我继续往下看。",
        createdAt: "2026-04-24T00:00:03.000Z"
      }
    ];

    const promptEnvelope = promptBuilder.build(session, new ToolRegistry());
    const serializedMessages = JSON.stringify(promptEnvelope.messages);

    expect(serializedMessages).not.toContain("[Historical tool call]");
    expect(serializedMessages).not.toContain("[Historical tool result]");
    expect(serializedMessages).toContain("我继续往下看。");
  });

  test("omits compacted thinking text and signatures from the summary while preserving tail thinking", () => {
    const promptBuilder = createPromptBuilder();
    const session = createSessionSnapshot();
    const blocks: ConversationBlock[] = [
      {
        id: "user-1",
        kind: "user",
        content: "Run a long investigation.",
        createdAt: "2026-04-25T00:00:00.000Z"
      },
      {
        id: "old-thinking",
        kind: "assistant thinking",
        content: "old private reasoning that should not be summarized verbatim",
        signature: "old-signature-should-not-leak",
        createdAt: "2026-04-25T00:00:01.000Z"
      }
    ];

    for (let index = 0; index < 18; index += 1) {
      blocks.push({
        id: `assistant-${index}`,
        kind: "assistant",
        content: `step ${index} ${"x".repeat(80)}`,
        createdAt: "2026-04-25T00:00:02.000Z"
      });
    }

    blocks.push(
      {
        id: "tail-thinking",
        kind: "assistant thinking",
        content: "tail reasoning must remain protocol-visible",
        signature: "tail-signature-must-remain",
        createdAt: "2026-04-25T00:00:03.000Z"
      },
      {
        id: "tail-tool-call",
        kind: "tool call",
        toolCallId: "call-tail",
        toolName: "read_file",
        input: { path: "src/index.ts" },
        state: "pending",
        createdAt: "2026-04-25T00:00:04.000Z"
      }
    );

    session.contextWindow = 1_000;
    session.messages = blocks;

    const promptEnvelope = promptBuilder.build(session, new ToolRegistry());
    const serializedMessages = JSON.stringify(promptEnvelope.messages);

    expect(serializedMessages).toContain("[History compacted:");
    expect(serializedMessages).toContain(
      "assistant thinking: preserved reasoning for a prior tool-use turn; signature omitted from compact summary"
    );
    expect(serializedMessages).not.toContain(
      "old private reasoning that should not be summarized verbatim"
    );
    expect(serializedMessages).not.toContain("old-signature-should-not-leak");
    expect(serializedMessages).toContain(
      "tail reasoning must remain protocol-visible"
    );
    expect(serializedMessages).toContain("tail-signature-must-remain");
  });
});
