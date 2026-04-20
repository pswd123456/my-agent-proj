import Anthropic from "@anthropic-ai/sdk";

import type {
  JsonValue,
  UserConversationBlock
} from "./types.js";

export const DEFAULT_MINIMAX_MODEL = "MiniMax-M2.7";
export const DEFAULT_MINIMAX_BASE_URL = "https://api.minimaxi.com/anthropic";

export interface AnthropicContentTextBlock {
  type: "text";
  text: string;
}

export interface AnthropicContentToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, JsonValue>;
}

export interface AnthropicContentToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type AnthropicContentBlock =
  | AnthropicContentTextBlock
  | AnthropicContentToolUseBlock
  | AnthropicContentToolResultBlock;

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicMessageUsage {
  input_tokens?: number;
  output_tokens?: number;
}

export interface AnthropicMessageResponse {
  content: AnthropicContentBlock[];
  stop_reason?: string | null;
  usage?: AnthropicMessageUsage;
}

export interface AnthropicCompatibleClient {
  messages: {
    create(input: {
      model: string;
      max_tokens: number;
      system: string;
      messages: AnthropicMessage[];
      tools: AnthropicToolDefinition[];
    }): Promise<AnthropicMessageResponse>;
  };
}

export interface MiniMaxRuntimeConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

export interface MiniMaxRuntime {
  client: AnthropicCompatibleClient;
  model: string;
  config: MiniMaxRuntimeConfig;
}

export function resolveMiniMaxRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): MiniMaxRuntimeConfig | null {
  const apiKey =
    env.ANTHROPIC_API_KEY ?? env.MINIMAX_API_KEY ?? env.API_KEY ?? "";

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    baseURL: env.ANTHROPIC_BASE_URL ?? DEFAULT_MINIMAX_BASE_URL,
    model: env.ANTHROPIC_MODEL ?? DEFAULT_MINIMAX_MODEL
  };
}

export function createMiniMaxRuntime(
  env: NodeJS.ProcessEnv = process.env
): MiniMaxRuntime | null {
  const config = resolveMiniMaxRuntimeConfig(env);
  if (!config) {
    return null;
  }

  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseURL
  });

  return {
    client: client as unknown as AnthropicCompatibleClient,
    model: config.model,
    config
  };
}

export function toAnthropicUserBlock(
  message: UserConversationBlock
): AnthropicMessage {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: message.content
      }
    ]
  };
}
