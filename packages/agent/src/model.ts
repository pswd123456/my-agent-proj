import Anthropic from "@anthropic-ai/sdk";

import type {
  JsonValue,
  UserConversationBlock
} from "./types.js";

export const DEFAULT_MINIMAX_MODEL = "MiniMax-M2.7";
export const DEFAULT_MINIMAX_BASE_URL = "https://api.minimaxi.com/anthropic";
export const DEFAULT_MAX_TOKENS = 16384;

export interface AnthropicContentTextBlock {
  type: "text";
  text: string;
  cache_control?: {
    type: "ephemeral";
  };
}

export interface AnthropicContentThinkingBlock {
  type: "thinking";
  thinking: string;
  signature: string;
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
  | AnthropicContentThinkingBlock
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

export type AnthropicToolChoice =
  | { type: "auto" }
  | { type: "any" }
  | { type: "none" }
  | { type: "tool"; name: string };

export interface AnthropicMessageUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface AnthropicMessageResponse {
  content: AnthropicContentBlock[];
  stop_reason?: string | null;
  usage?: AnthropicMessageUsage;
}

export interface AnthropicMessageRequest {
  model: string;
  max_tokens?: number;
  system: string;
  messages: AnthropicMessage[];
  tools: AnthropicToolDefinition[];
  tool_choice?: AnthropicToolChoice;
}

export interface AnthropicTextDelta {
  type: "text_delta";
  text: string;
}

export interface AnthropicThinkingDelta {
  type: "thinking_delta";
  thinking: string;
}

export interface AnthropicSignatureDelta {
  type: "signature_delta";
  signature: string;
}

export interface AnthropicInputJsonDelta {
  type: "input_json_delta";
  partial_json: string;
}

export interface AnthropicCitationsDelta {
  type: "citations_delta";
}

export type AnthropicContentBlockDelta =
  | AnthropicTextDelta
  | AnthropicThinkingDelta
  | AnthropicSignatureDelta
  | AnthropicInputJsonDelta
  | AnthropicCitationsDelta;

export interface AnthropicContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  content_block: AnthropicContentBlock;
}

export interface AnthropicContentBlockDeltaEvent {
  type: "content_block_delta";
  index: number;
  delta: AnthropicContentBlockDelta;
}

export interface AnthropicContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

export interface AnthropicMessageDeltaEvent {
  type: "message_delta";
  delta: {
    stop_reason: string | null;
  };
  usage: AnthropicMessageUsage;
}

export interface AnthropicMessageStartEvent {
  type: "message_start";
  message: AnthropicMessageResponse;
}

export interface AnthropicMessageStopEvent {
  type: "message_stop";
}

export type AnthropicMessageStreamEvent =
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStartEvent
  | AnthropicMessageStopEvent;

export interface AnthropicMessageStream
  extends AsyncIterable<AnthropicMessageStreamEvent> {
  finalMessage(): Promise<AnthropicMessageResponse>;
  abort?(): void;
}

export interface AnthropicTextDeltaSnapshot {
  blockIndex: number;
  delta: string;
  text: string;
}

export interface AnthropicThinkingDeltaSnapshot {
  blockIndex: number;
  delta?: string;
  text: string;
  signature: string;
}

export interface AnthropicCompatibleClient {
  messages: {
    create(input: AnthropicMessageRequest): Promise<AnthropicMessageResponse>;
    stream?(input: AnthropicMessageRequest): AnthropicMessageStream;
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

export function resolveToolChoice(
  env: NodeJS.ProcessEnv = process.env
): AnthropicToolChoice | undefined {
  const raw = env.ANTHROPIC_TOOL_CHOICE ?? env.TOOL_CHOICE;
  if (!raw) {
    return undefined;
  }

  const value = raw.trim();
  if (value === "auto" || value === "any" || value === "none") {
    return { type: value };
  }

  if (value.startsWith("tool:")) {
    const name = value.slice("tool:".length).trim();
    if (name) {
      return { type: "tool", name };
    }
  }

  return undefined;
}

export function resolveMaxTokens(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env.ANTHROPIC_MAX_TOKENS ?? env.MAX_TOKENS;
  if (!raw) {
    return DEFAULT_MAX_TOKENS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_TOKENS;
  }

  return parsed;
}

export function resolveMiniMaxRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): MiniMaxRuntimeConfig | null {
  const apiKey = env.ANTHROPIC_API_KEY ?? env.MINIMAX_API_KEY ?? "";

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

export async function streamAnthropicMessage(input: {
  client: AnthropicCompatibleClient;
  request: AnthropicMessageRequest;
  signal?: AbortSignal;
  onTextDelta?: (
    snapshot: AnthropicTextDeltaSnapshot
  ) => void | Promise<void>;
  onThinkingDelta?: (
    snapshot: AnthropicThinkingDeltaSnapshot
  ) => void | Promise<void>;
}): Promise<AnthropicMessageResponse> {
  if (!input.client.messages.stream) {
    return input.client.messages.create(input.request);
  }

  const stream = input.client.messages.stream(input.request);
  const textSnapshots = new Map<number, string>();
  const thinkingSnapshots = new Map<number, { text: string; signature: string }>();
  const abortStream = () => {
    if (typeof stream.abort === "function") {
      try {
        stream.abort();
      } catch {
        // Ignore abort transport errors and let the caller resolve from final state.
      }
    }
  };
  const onAbort = () => {
    abortStream();
  };

  if (input.signal) {
    if (input.signal.aborted) {
      abortStream();
    } else {
      input.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  try {
    for await (const event of stream) {
      if (event.type !== "content_block_delta") {
        continue;
      }

      if (event.delta.type === "text_delta") {
        const nextText = `${textSnapshots.get(event.index) ?? ""}${event.delta.text}`;
        textSnapshots.set(event.index, nextText);
        await input.onTextDelta?.({
          blockIndex: event.index,
          delta: event.delta.text,
          text: nextText
        });
        continue;
      }

      if (
        event.delta.type !== "thinking_delta" &&
        event.delta.type !== "signature_delta"
      ) {
        continue;
      }

      const currentThinking = thinkingSnapshots.get(event.index) ?? {
        text: "",
        signature: ""
      };
      const nextThinking =
        event.delta.type === "thinking_delta"
          ? {
              text: `${currentThinking.text}${event.delta.thinking}`,
              signature: currentThinking.signature
            }
          : {
              text: currentThinking.text,
              signature: `${currentThinking.signature}${event.delta.signature}`
            };
      thinkingSnapshots.set(event.index, nextThinking);
      await input.onThinkingDelta?.({
        blockIndex: event.index,
        ...(event.delta.type === "thinking_delta"
          ? { delta: event.delta.thinking }
          : {}),
        text: nextThinking.text,
        signature: nextThinking.signature
      });
    }

    return await stream.finalMessage();
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
  }
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
