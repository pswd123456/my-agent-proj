import type {
  AnthropicCompatibleClient,
  AnthropicContentBlock,
  AnthropicMessage
} from "./model.js";
import { createPromptBuilder, type PromptBuilder } from "./prompt.js";
import type {
  ConversationBlock,
  JsonValue,
  RunSessionInput,
  RunSessionResult
} from "./types.js";
import type { SessionManager } from "./session.js";
import type { ToolExecutionContext } from "./tools/runtime-tool.js";
import type { ToolRegistry } from "./tools/registry.js";
import { randomUUID } from "node:crypto";

export interface AgentRuntimeOptions {
  client: AnthropicCompatibleClient;
  model: string;
  sessionManager: SessionManager;
  toolRegistry: ToolRegistry;
  promptBuilder?: PromptBuilder;
  maxTurns?: number;
  maxTokens?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractText(blocks: AnthropicContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<AnthropicContentBlock, { type: "text" }> =>
      block.type === "text"
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
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

function toAnthropicMessages(blocks: ConversationBlock[]): AnthropicMessage[] {
  return blocks.map((block) => {
    if (block.kind === "user") {
      return {
        role: "user",
        content: [{ type: "text", text: block.content }]
      };
    }

    if (block.kind === "assistant") {
      return {
        role: "assistant",
        content: [{ type: "text", text: block.content }]
      };
    }

    if (block.kind === "tool call") {
      return {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: block.toolCallId,
            name: block.toolName,
            input: block.input
          }
        ]
      };
    }

    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: block.toolCallId,
          content: block.output,
          is_error: block.isError
        }
      ]
    };
  });
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
      session = await this.options.sessionManager.saveSession(session);
      const promptEnvelope = this.promptBuilder.build(session, this.options.toolRegistry);
      session = await this.options.sessionManager.setPromptCacheKey(
        session.sessionId,
        promptEnvelope.cacheKey
      );

      const response = await this.options.client.messages.create({
        model: session.model,
        max_tokens: this.options.maxTokens ?? 512,
        system: promptEnvelope.system,
        messages: [...promptEnvelope.prefixMessages, ...toAnthropicMessages(session.messages)],
        tools: promptEnvelope.tools
      });

      const usageTokens = response.usage?.input_tokens ?? 0;
      if (usageTokens > 0) {
        session = await this.options.sessionManager.addInputTokens(
          session.sessionId,
          usageTokens
        );
      }

      const responseBlocks = response.content ?? [];
      const text = extractText(responseBlocks);
      const toolCalls = extractToolCalls(responseBlocks);
      stopReason = response.stop_reason ?? null;

      if (text) {
        session = await this.options.sessionManager.appendBlock(
          session.sessionId,
          buildAssistantBlockContent(text)
        );
      }

      if (toolCalls.length > 0) {
        session = await this.options.sessionManager.setLoopState(
          session.sessionId,
          "waiting for tool result"
        );
        session = await this.options.sessionManager.setLastError(
          session.sessionId,
          null
        );

        for (const toolCall of toolCalls) {
          toolCallCount += 1;
          session = await this.options.sessionManager.appendBlock(
            session.sessionId,
            buildToolCallBlock({
              id: toolCall.id,
              name: toolCall.name,
              toolInput: toolCall.input
            })
          );
          session = await this.options.sessionManager.saveSession(session);

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
        }

        continue;
      }

      if (text) {
        finalAnswer = text;
        session = await this.options.sessionManager.setLoopState(
          session.sessionId,
          "completed"
        );
        session = await this.options.sessionManager.setLastError(
          session.sessionId,
          null
        );
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
      return {
        session,
        finalAnswer: null,
        status: "failed",
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
      "Maximum turns reached."
    );

    return {
      session,
      finalAnswer,
      status: "failed",
      stopReason,
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
