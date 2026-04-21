import { createHash } from "node:crypto";

import type {
  AnthropicMessage,
  AnthropicToolDefinition
} from "./model.js";
import type {
  ConversationBlock,
  JsonValue,
  SessionSnapshot,
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
  "If a tool is useful, you must start the response with one short text sentence that states the plan, then call exactly the tool you need in the same response and continue from the result."
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

function createAnthropicMessage(
  role: "user" | "assistant",
  content: AnthropicMessage["content"]
): AnthropicMessage {
  return {
    role,
    content
  };
}

function createTextContent(text: string): AnthropicMessage["content"][number] {
  return {
    type: "text",
    text
  };
}

function createToolUseContent(
  block: Extract<ConversationBlock, { kind: "tool call" }>
): AnthropicMessage["content"][number] {
  return {
    type: "tool_use",
    id: block.toolCallId,
    name: block.toolName,
    input: block.input
  };
}

function createToolResultContent(
  block: Extract<ConversationBlock, { kind: "tool result" }>
): AnthropicMessage["content"][number] {
  return {
    type: "tool_result",
    tool_use_id: block.toolCallId,
    content: block.output,
    is_error: block.isError
  };
}

export function toAnthropicMessages(blocks: ConversationBlock[]): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [];
  let currentRole: "user" | "assistant" | null = null;
  let currentContent: AnthropicMessage["content"] = [];

  const flush = () => {
    if (currentRole && currentContent.length > 0) {
      messages.push(createAnthropicMessage(currentRole, currentContent));
    }
    currentRole = null;
    currentContent = [];
  };

  const append = (
    role: "user" | "assistant",
    content: AnthropicMessage["content"][number]
  ) => {
    if (currentRole !== role) {
      flush();
      currentRole = role;
    }

    currentContent = [...currentContent, content];
  };

  for (const block of blocks) {
    if (block.kind === "user") {
      flush();
      messages.push(
        createAnthropicMessage("user", [createTextContent(block.content)])
      );
      continue;
    }

    if (block.kind === "assistant") {
      append("assistant", createTextContent(block.content));
      continue;
    }

    if (block.kind === "tool call") {
      append("assistant", createToolUseContent(block));
      continue;
    }

    append("user", createToolResultContent(block));
  }

  flush();
  return messages;
}

export class PromptBuilder {
  constructor(private readonly systemPrompt = DEFAULT_SYSTEM_PROMPT) {}

  build(session: SessionSnapshot, toolRegistry: ToolRegistry): PromptEnvelope {
    const tools = toolRegistry.toAnthropicTools();
    const prefixMessage = createPrefixMessage(session, tools);
    const messages = toAnthropicMessages(session.messages);
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
