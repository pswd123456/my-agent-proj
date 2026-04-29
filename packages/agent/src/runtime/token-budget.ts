import { getEncoding, type Tiktoken } from "js-tiktoken";

import type { AnthropicToolChoice } from "../model.js";
import { buildPromptRequestMessages, type PromptEnvelope } from "../prompt.js";

let encoder: Tiktoken | null = null;

function getTokenEncoder(): Tiktoken {
  if (!encoder) {
    encoder = getEncoding("o200k_base");
  }

  return encoder;
}

export function estimateTextTokens(text: string): number {
  return getTokenEncoder().encode(text).length;
}

export function estimatePromptTokens(
  promptEnvelope: PromptEnvelope,
  toolChoice: AnthropicToolChoice | undefined
): number {
  const payload = JSON.stringify({
    system: promptEnvelope.system,
    messages: buildPromptRequestMessages(promptEnvelope),
    tools: promptEnvelope.tools,
    ...(toolChoice ? { toolChoice } : {})
  });

  return estimateTextTokens(payload);
}
