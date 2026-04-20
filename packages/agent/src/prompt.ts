import { createHash } from "node:crypto";

import type {
  AnthropicMessage,
  AnthropicToolDefinition
} from "./model.js";
import type {
  ConversationBlock,
  JsonValue,
  SessionSnapshot,
  ToolResultConversationBlock,
  UserConversationBlock
} from "./types.js";
import type { ToolRegistry } from "./tools/registry.js";

export interface PromptEnvelope {
  system: string;
  prefixMessages: AnthropicMessage[];
  messages: AnthropicMessage[];
  tools: AnthropicToolDefinition[];
  cacheKey: string;
}

export interface PromptBuilderOptions {
  systemPrompt?: string;
}

const DEFAULT_SYSTEM_PROMPT = [
  "You are a minimal TypeScript agent runtime.",
  "Use the workspace tools when they help you answer accurately.",
  "Keep responses concise and do not invent file contents.",
  "If a tool is useful, call exactly the tool you need and continue from the result."
].join("\n");

function toolSummary(tools: AnthropicToolDefinition[]): string {
  return tools
    .map(
      (tool) =>
        `- ${tool.name}: ${tool.description}\n  schema: ${JSON.stringify(tool.input_schema)}`
    )
    .join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toAnthropicMessage(block: ConversationBlock): AnthropicMessage {
  if (block.kind === "user") {
    return {
      role: "user",
      content: [
        {
          type: "text",
          text: block.content
        }
      ]
    };
  }

  if (block.kind === "assistant") {
    return {
      role: "assistant",
      content: [
        {
          type: "text",
          text: block.content
        }
      ]
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

  const toolResultBlock = block as ToolResultConversationBlock;
  return {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: toolResultBlock.toolCallId,
        content: toolResultBlock.output,
        is_error: toolResultBlock.isError
      }
    ]
  };
}

function createPrefixMessage(
  session: SessionSnapshot,
  tools: AnthropicToolDefinition[]
): AnthropicMessage {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: [
          `Workspace root: ${session.workingDirectory}`,
          "Available tools:",
          toolSummary(tools)
        ].join("\n")
      }
    ]
  };
}

export class PromptBuilder {
  constructor(private readonly systemPrompt = DEFAULT_SYSTEM_PROMPT) {}

  build(session: SessionSnapshot, toolRegistry: ToolRegistry): PromptEnvelope {
    const tools = toolRegistry.toAnthropicTools();
    const prefixMessage = createPrefixMessage(session, tools);
    const messages = session.messages.map(toAnthropicMessage);
    const cacheKey = createHash("sha256")
      .update(this.systemPrompt)
      .update("\n")
      .update(JSON.stringify(prefixMessage))
      .update("\n")
      .update(JSON.stringify(tools))
      .digest("hex");

    return {
      system: this.systemPrompt,
      prefixMessages: [prefixMessage],
      messages,
      tools,
      cacheKey
    };
  }
}

export function createPromptBuilder(options: PromptBuilderOptions = {}): PromptBuilder {
  return new PromptBuilder(options.systemPrompt);
}

export function summarizeConversationBlocks(blocks: ConversationBlock[]): string {
  return blocks
    .map((block) => {
      if (block.kind === "user" || block.kind === "assistant") {
        return `${block.kind}: ${block.content}`;
      }

      if (block.kind === "tool call") {
        return `tool call: ${block.toolName}`;
      }

      return `tool result: ${block.toolName}`;
    })
    .join("\n");
}

export function extractUserMessages(blocks: ConversationBlock[]): UserConversationBlock[] {
  return blocks.filter((block): block is UserConversationBlock => block.kind === "user");
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

export function toToolInputRecord(value: unknown): Record<string, JsonValue> {
  if (!isRecord(value)) {
    return {};
  }

  return value as Record<string, JsonValue>;
}
