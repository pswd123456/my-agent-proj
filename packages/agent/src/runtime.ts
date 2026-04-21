import { randomUUID } from "node:crypto";

import type {
  AnthropicCompatibleClient,
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicToolChoice
} from "./model.js";
import {
  createPromptBuilder,
  toAnthropicMessages,
  type PromptBuilder
} from "./prompt.js";
import type {
  ConversationBlock,
  JsonValue,
  RunSessionInput,
  RunSessionResult,
  SessionSnapshot
} from "./types.js";
import type { SessionManager } from "./session.js";
import type { ToolExecutionContext } from "./tools/runtime-tool.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { TraceManager } from "./trace.js";

export interface AgentRuntimeOptions {
  client: AnthropicCompatibleClient;
  model: string;
  sessionManager: SessionManager;
  toolRegistry: ToolRegistry;
  traceManager?: TraceManager;
  promptBuilder?: PromptBuilder;
  maxTurns?: number;
  maxTokens?: number;
  toolChoice?: AnthropicToolChoice;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildUserBlockContent(message: string): ConversationBlock {
  return {
    id: randomUUID(),
    kind: "user",
    content: message,
    createdAt: new Date().toISOString()
  };
}

function buildAssistantBlockContent(message: string): ConversationBlock {
  return {
    id: randomUUID(),
    kind: "assistant",
    content: message,
    createdAt: new Date().toISOString()
  };
}

function buildToolCallBlock(input: {
  id: string;
  name: string;
  toolInput: Record<string, unknown>;
}): ConversationBlock {
  return {
    id: randomUUID(),
    kind: "tool call",
    toolCallId: input.id,
    toolName: input.name,
    input: input.toolInput as Record<string, JsonValue>,
    state: "pending",
    createdAt: new Date().toISOString()
  };
}

function buildToolResultBlock(input: {
  id: string;
  name: string;
  content: string;
  isError: boolean;
}): ConversationBlock {
  return {
    id: randomUUID(),
    kind: "tool result",
    toolCallId: input.id,
    toolName: input.name,
    output: input.content,
    isError: input.isError,
    state: input.isError ? "failed" : "success",
    createdAt: new Date().toISOString()
  };
}

function extractToolCalls(blocks: AnthropicContentBlock[]): Array<{
  id: string;
  name: string;
  input: Record<string, unknown>;
}> {
  return blocks
    .filter(
      (block): block is Extract<AnthropicContentBlock, { type: "tool_use" }> =>
        block.type === "tool_use"
    )
    .map((block) => ({
      id: block.id,
      name: block.name,
      input: isRecord(block.input) ? block.input : {}
    }));
}

function extractThinkingBlocks(blocks: AnthropicContentBlock[]): Array<{
  text: string;
  signature: string;
}> {
  return blocks
    .filter(
      (
        block
      ): block is Extract<AnthropicContentBlock, { type: "thinking" }> =>
        block.type === "thinking"
    )
    .map((block) => ({
      text: block.thinking,
      signature: block.signature
    }));
}

function summarizeBlock(block: ConversationBlock): string {
  if (block.kind === "user" || block.kind === "assistant") {
    return `${block.kind}: ${block.content}`;
  }

  if (block.kind === "tool call") {
    return `tool call: ${block.toolName}`;
  }

  return `tool result: ${block.toolName}`;
}

function buildFallbackAnswer(
  session: Pick<SessionSnapshot, "messages" | "sessionState">,
  maxTurns: number
): string {
  const recentBlocks = session.messages.slice(-6).map(summarizeBlock);
  const lines = [
    `I reached the turn limit after ${session.sessionState.turnCount}/${maxTurns} turns.`,
    "I stopped here to avoid looping forever, but I can continue from the latest state."
  ];

  if (recentBlocks.length > 0) {
    lines.push(`Recent steps:\n- ${recentBlocks.join("\n- ")}`);
  }

  if (session.sessionState.lastError) {
    lines.push(`Last error: ${session.sessionState.lastError}`);
  }

  if (session.sessionState.pendingToolCallIds.length > 0) {
    lines.push(
      `Pending tool calls: ${session.sessionState.pendingToolCallIds.join(", ")}`
    );
  }

  return lines.join("\n");
}

async function appendTrace(
  traceManager: TraceManager | undefined,
  sessionId: string,
  event: Parameters<TraceManager["appendEvent"]>[1]
): Promise<void> {
  if (!traceManager) {
    return;
  }

  await traceManager.appendEvent(sessionId, event);
}

export class AgentRuntime {
  private readonly promptBuilder: PromptBuilder;

  constructor(private readonly options: AgentRuntimeOptions) {
    this.promptBuilder = options.promptBuilder ?? createPromptBuilder();
  }

  async createSession(
    input: { workingDirectory?: string; model?: string } = {}
  ): ReturnType<SessionManager["createSession"]> {
    const createInput: { workingDirectory?: string; model?: string } = {
      model: input.model ?? this.options.model
    };

    if (typeof input.workingDirectory === "string") {
      createInput.workingDirectory = input.workingDirectory;
    }

    return this.options.sessionManager.createSession(createInput);
  }

  async recoverSession(
    snapshot: Parameters<SessionManager["recover"]>[0]
  ): ReturnType<SessionManager["recover"]> {
    return this.options.sessionManager.recover(snapshot);
  }

  async run(input: RunSessionInput): Promise<RunSessionResult> {
    const maxTurns = input.maxTurns ?? this.options.maxTurns ?? 6;
    let session = await this.options.sessionManager.getSession(input.sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${input.sessionId}`);
    }

    if (input.message) {
      session = await this.options.sessionManager.appendBlock(
        session.sessionId,
        buildUserBlockContent(input.message)
      );
    }

    session = await this.options.sessionManager.setLoopState(
      session.sessionId,
      "running"
    );

    let finalAnswer: string | null = null;
    let stopReason: string | null = null;
    let toolCallCount = 0;
    let toolResultCount = 0;

    for (let turn = 0; turn < maxTurns; turn += 1) {
      const turnCount = turn + 1;
      session = await this.options.sessionManager.saveSession(session);
      session = await this.options.sessionManager.setTurnCount(
        session.sessionId,
        turnCount
      );

      const promptEnvelope = this.promptBuilder.build(
        session,
        this.options.toolRegistry
      );
      session = await this.options.sessionManager.setPromptCacheKey(
        session.sessionId,
        promptEnvelope.cacheKey
      );

      await appendTrace(this.options.traceManager, session.sessionId, {
        kind: "turn_start",
        turnCount,
        session: {
          sessionId: session.sessionId,
          workingDirectory: session.workingDirectory,
          model: session.model,
          sessionState: session.sessionState
        }
      });
      await appendTrace(this.options.traceManager, session.sessionId, {
        kind: "prompt",
        turnCount,
        system: promptEnvelope.system,
        prefixMessages: promptEnvelope.prefixMessages,
        messages: promptEnvelope.messages,
        tools: promptEnvelope.tools,
        toolChoice: this.options.toolChoice ?? null,
        cacheKey: promptEnvelope.cacheKey
      });

      const response = await this.options.client.messages.create({
        model: session.model,
        max_tokens: this.options.maxTokens ?? 512,
        system: promptEnvelope.system,
        messages: [...promptEnvelope.prefixMessages, ...promptEnvelope.messages],
        tools: promptEnvelope.tools,
        ...(this.options.toolChoice
          ? { tool_choice: this.options.toolChoice }
          : {})
      });

      const usageTokens = response.usage?.input_tokens ?? 0;
      const outputTokens = response.usage?.output_tokens ?? 0;
      if (usageTokens > 0) {
        session = await this.options.sessionManager.addInputTokens(
          session.sessionId,
          usageTokens
        );
      }

      const responseBlocks = response.content ?? [];
      stopReason = response.stop_reason ?? null;
      await appendTrace(this.options.traceManager, session.sessionId, {
        kind: "response",
        turnCount,
        stopReason,
        usage: {
          inputTokens: usageTokens,
          outputTokens
        },
        content: structuredClone(responseBlocks) as unknown as JsonValue
      });

      const thinkingBlocks = extractThinkingBlocks(responseBlocks);
      for (const thinkingBlock of thinkingBlocks) {
        await appendTrace(this.options.traceManager, session.sessionId, {
          kind: "thinking",
          turnCount,
          text: thinkingBlock.text,
          signature: thinkingBlock.signature
        });
      }

      const toolCalls = extractToolCalls(responseBlocks);
      const assistantTexts: string[] = [];
      const pendingToolCallIds: string[] = [];

      for (const block of responseBlocks) {
        if (block.type === "text") {
          assistantTexts.push(block.text);
          session = await this.options.sessionManager.appendBlock(
            session.sessionId,
            buildAssistantBlockContent(block.text)
          );
          await appendTrace(this.options.traceManager, session.sessionId, {
            kind: "assistant_text",
            turnCount,
            text: block.text
          });
          continue;
        }

        if (block.type !== "tool_use") {
          continue;
        }

        const toolInput = isRecord(block.input) ? block.input : {};
        pendingToolCallIds.push(block.id);
        toolCallCount += 1;
        session = await this.options.sessionManager.appendBlock(
          session.sessionId,
          buildToolCallBlock({
            id: block.id,
            name: block.name,
            toolInput
          })
        );
        await appendTrace(this.options.traceManager, session.sessionId, {
          kind: "tool_call",
          turnCount,
          toolCallId: block.id,
          toolName: block.name,
          input: toolInput
        });
      }

      if (pendingToolCallIds.length > 0) {
        session = await this.options.sessionManager.setLoopState(
          session.sessionId,
          "waiting for tool result"
        );
        session = await this.options.sessionManager.setPendingToolCallIds(
          session.sessionId,
          pendingToolCallIds
        );
        session = await this.options.sessionManager.setLastError(
          session.sessionId,
          null
        );

        for (const toolCall of toolCalls) {
          const tool = this.options.toolRegistry.get(toolCall.name);
          const context: ToolExecutionContext = {
            sessionId: session.sessionId,
            workingDirectory: session.workingDirectory
          };

          if (!tool) {
            const errorText = `Unknown tool: ${toolCall.name}`;
            session = await this.options.sessionManager.appendBlock(
              session.sessionId,
              buildToolResultBlock({
                id: toolCall.id,
                name: toolCall.name,
                content: errorText,
                isError: true
              })
            );
            session = await this.options.sessionManager.setLastError(
              session.sessionId,
              errorText
            );
            toolResultCount += 1;
            await appendTrace(this.options.traceManager, session.sessionId, {
              kind: "tool_result",
              turnCount,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              output: errorText,
              isError: true
            });
            continue;
          }

          const result = await tool.execute(
            toolCall.input as Record<string, JsonValue>,
            context
          );

          session = await this.options.sessionManager.appendBlock(
            session.sessionId,
            buildToolResultBlock({
              id: toolCall.id,
              name: toolCall.name,
              content: result.content,
              isError: result.state === "failed"
            })
          );
          session = await this.options.sessionManager.setLastError(
            session.sessionId,
            result.state === "failed" ? result.error ?? result.content : null
          );
          toolResultCount += 1;
          await appendTrace(this.options.traceManager, session.sessionId, {
            kind: "tool_result",
            turnCount,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            output: result.content,
            isError: result.state === "failed"
          });
        }

        session = await this.options.sessionManager.setPendingToolCallIds(
          session.sessionId,
          []
        );
        session = await this.options.sessionManager.setLoopState(
          session.sessionId,
          "running"
        );
        await appendTrace(this.options.traceManager, session.sessionId, {
          kind: "turn_end",
          turnCount,
          loopState: "running"
        });
        continue;
      }

      if (assistantTexts.length > 0) {
        finalAnswer = assistantTexts.join("\n").trim();
        session = await this.options.sessionManager.setLoopState(
          session.sessionId,
          "completed"
        );
        session = await this.options.sessionManager.setPendingToolCallIds(
          session.sessionId,
          []
        );
        session = await this.options.sessionManager.setLastError(
          session.sessionId,
          null
        );
        await appendTrace(this.options.traceManager, session.sessionId, {
          kind: "turn_end",
          turnCount,
          loopState: "completed"
        });
        return {
          session,
          finalAnswer,
          status: "completed",
          stopReason,
          toolCallCount,
          toolResultCount
        };
      }

      session = await this.options.sessionManager.setLoopState(
        session.sessionId,
        "failed"
      );
      session = await this.options.sessionManager.setLastError(
        session.sessionId,
        "Model returned no text or tool call."
      );
      await appendTrace(this.options.traceManager, session.sessionId, {
        kind: "turn_end",
        turnCount,
        loopState: "failed"
      });
      return {
        session,
        finalAnswer: null,
        status: "failed",
        stopReason,
        toolCallCount,
        toolResultCount
      };
    }

    finalAnswer = buildFallbackAnswer(session, maxTurns);
    session = await this.options.sessionManager.appendBlock(
      session.sessionId,
      buildAssistantBlockContent(finalAnswer)
    );
    session = await this.options.sessionManager.setLoopState(
      session.sessionId,
      "completed"
    );
    session = await this.options.sessionManager.setPendingToolCallIds(
      session.sessionId,
      []
    );
    session = await this.options.sessionManager.setLastError(session.sessionId, null);
    await appendTrace(this.options.traceManager, session.sessionId, {
      kind: "fallback",
      turnCount: maxTurns,
      reason: "max_turns",
      summary: finalAnswer
    });
    await appendTrace(this.options.traceManager, session.sessionId, {
      kind: "turn_end",
      turnCount: maxTurns,
      loopState: "completed"
    });

    return {
      session,
      finalAnswer,
      status: "completed",
      stopReason: "max_turns",
      toolCallCount,
      toolResultCount
    };
  }
}

export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
  return new AgentRuntime(options);
}

export function toAnthropicMessageBlocks(
  blocks: ConversationBlock[]
): AnthropicMessage[] {
  return toAnthropicMessages(blocks);
}
