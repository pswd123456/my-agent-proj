import { randomUUID } from "node:crypto";

import type { AnthropicContentBlock } from "../model.js";
import type { ConversationBlock, JsonValue, SessionSnapshot } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function buildUserBlockContent(message: string): ConversationBlock {
  return {
    id: randomUUID(),
    kind: "user",
    content: message,
    createdAt: new Date().toISOString()
  };
}

export function buildAssistantBlockContent(
  message: string,
  id: string = randomUUID()
): ConversationBlock {
  return {
    id,
    kind: "assistant",
    content: message,
    createdAt: new Date().toISOString()
  };
}

export function buildToolCallBlock(input: {
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

export function buildToolResultBlock(input: {
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

export function extractToolCalls(blocks: AnthropicContentBlock[]): Array<{
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

export function extractThinkingBlocks(blocks: AnthropicContentBlock[]): Array<{
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

export function buildFallbackAnswer(
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

export function renderPendingConfirmationAnswer(
  pendingConfirmation: NonNullable<
    SessionSnapshot["context"]["pendingConfirmationPayload"]
  >
): string {
  const lines = [pendingConfirmation.summaryText];

  if (pendingConfirmation.conflictItems?.length) {
    lines.push(
      ...pendingConfirmation.conflictItems.map(
        (item) => `- 当前冲突项：${item.previewText}`
      )
    );
  }

  lines.push(
    ...pendingConfirmation.proposedItems.map(
      (item, index) => `- 方案 ${index + 1}：${item.previewText}`
    )
  );

  if (pendingConfirmation.contextNote) {
    lines.push(`- 说明：${pendingConfirmation.contextNote}`);
  }

  lines.push("回复“确认”即可执行这些调整，或者直接回复新的时间。");
  return lines.join("\n");
}

export function renderPendingPermissionAnswer(
  pendingPermissionRequest: NonNullable<
    SessionSnapshot["context"]["pendingPermissionRequest"]
  >
): string {
  const lines = [pendingPermissionRequest.summaryText];

  if (pendingPermissionRequest.contextNote) {
    lines.push(`- 说明：${pendingPermissionRequest.contextNote}`);
  }

  lines.push("回复“确认”即可继续执行，回复“取消”即可拒绝这次操作。");
  return lines.join("\n");
}

export function normalizeConfirmationReply(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}

export function isAffirmativeConfirmationReply(message: string): boolean {
  const normalized = normalizeConfirmationReply(message).toLowerCase();
  return [
    "y",
    "yes",
    "ok",
    "okay",
    "sure",
    "confirm",
    "confirmed",
    "go ahead",
    "好",
    "好的",
    "行",
    "可以",
    "确认",
    "同意",
    "是",
    "继续",
    "按这个来",
    "就这样",
    "没问题"
  ].includes(normalized);
}

export function isNegativeConfirmationReply(message: string): boolean {
  const normalized = normalizeConfirmationReply(message).toLowerCase();
  return [
    "n",
    "no",
    "cancel",
    "stop",
    "不要",
    "不用",
    "取消",
    "不行",
    "不同意",
    "否",
    "算了",
    "先别",
    "不确认"
  ].includes(normalized);
}
