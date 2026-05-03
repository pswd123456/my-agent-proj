import { randomUUID } from "node:crypto";

import type {
  AnthropicCompatibleClient,
  AnthropicMessage,
  AnthropicMessageRequest,
  AnthropicToolChoice
} from "../model.js";
import {
  HISTORY_COMPACTION_TAIL_MESSAGES,
  HISTORY_COMPACTION_TRIGGER_RATIO,
  compactHistoryBlocks,
  countHistoryCompactionTailBlocks,
  type PromptBuilder,
  type PromptEnvelope,
  type PromptRuntimeContext
} from "../prompt.js";
import type { SessionManager } from "../session.js";
import type { SkillDescriptor } from "../skills/index.js";
import type { TraceManager } from "../trace.js";
import type { ConversationBlock, SessionSnapshot } from "../types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { RunEventSink } from "../events.js";
import { emitTraceEvent } from "./run-events.js";
import { estimatePromptTokens } from "./token-budget.js";

const FULL_COMPACTION_PROMPT_VERSION = "full-compaction-v1";
const FULL_COMPACTION_RETAINED_TAIL_BLOCKS = 6;
const FULL_COMPACTION_MAX_TOKENS = 1_200;
const FULL_COMPACTION_BLOCK_TEXT_LIMIT = 800;
const FULL_COMPACTION_TOOL_INPUT_LIMIT = 600;
const REQUIRED_SUMMARY_HEADINGS = [
  "## Goal",
  "## Constraints",
  "## Verified Facts",
  "## Decisions",
  "## Current Frontier",
  "## Next Checkpoint"
] as const;

export interface CompactionPreparationResult {
  session: SessionSnapshot;
  promptEnvelope: PromptEnvelope;
  estimatedInputTokens: number;
}

function truncateText(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) {
    return text;
  }

  return `${text.slice(0, maxCharacters)}\n...[truncated ${text.length - maxCharacters} chars]`;
}

function stringifyToolInput(input: Record<string, unknown>): string {
  const serialized = JSON.stringify(input);
  return typeof serialized === "string" ? serialized : String(input);
}

function getBlockResponseGroupId(block: ConversationBlock): string | undefined {
  return "responseGroupId" in block && typeof block.responseGroupId === "string"
    ? block.responseGroupId
    : undefined;
}

function buildFullCompactionSourceLine(
  block: ConversationBlock
): string | null {
  if (block.kind === "user") {
    return `user: ${truncateText(block.content, FULL_COMPACTION_BLOCK_TEXT_LIMIT)}`;
  }

  if (block.kind === "assistant") {
    return `assistant: ${truncateText(block.content, FULL_COMPACTION_BLOCK_TEXT_LIMIT)}`;
  }

  if (block.kind === "tool call") {
    return `tool call: ${block.toolName} ${truncateText(
      stringifyToolInput(block.input),
      FULL_COMPACTION_TOOL_INPUT_LIMIT
    )}`;
  }

  return null;
}

function splitFullCompactionBlocks(blocks: ConversationBlock[]): {
  sourceBlocks: ConversationBlock[];
  retainedTail: ConversationBlock[];
} {
  const retainedRanges: Array<{ start: number; end: number }> = [];

  for (
    let index = blocks.length - 1;
    index >= 0 && retainedRanges.length < FULL_COMPACTION_RETAINED_TAIL_BLOCKS;
    index -= 1
  ) {
    const block = blocks[index];
    if (!block) {
      continue;
    }

    const responseGroupId = getBlockResponseGroupId(block);
    if (responseGroupId) {
      let start = index;
      while (
        start - 1 >= 0 &&
        getBlockResponseGroupId(blocks[start - 1] as ConversationBlock) ===
          responseGroupId
      ) {
        start -= 1;
      }

      let end = index;
      while (
        end + 1 < blocks.length &&
        getBlockResponseGroupId(blocks[end + 1] as ConversationBlock) ===
          responseGroupId
      ) {
        end += 1;
      }

      retainedRanges.push({ start, end });
      index = start;
      continue;
    }

    if (block.kind === "tool result") {
      const previous = blocks[index - 1];
      if (
        previous &&
        previous.kind === "tool call" &&
        previous.toolCallId === block.toolCallId &&
        getBlockResponseGroupId(previous) === undefined
      ) {
        retainedRanges.push({ start: index - 1, end: index });
        index -= 1;
        continue;
      }
    }

    if (block.kind === "tool call") {
      const next = blocks[index + 1];
      if (
        next &&
        next.kind === "tool result" &&
        next.toolCallId === block.toolCallId &&
        getBlockResponseGroupId(next) === undefined
      ) {
        retainedRanges.push({ start: index, end: index + 1 });
        continue;
      }
    }

    retainedRanges.push({ start: index, end: index });
  }

  retainedRanges.reverse();
  const retainedTail = retainedRanges.flatMap((range) =>
    blocks.slice(range.start, range.end + 1)
  );
  const retainedIds = new Set(retainedTail.map((block) => block.id));
  const sourceBlocks = blocks.filter((block) => !retainedIds.has(block.id));
  return { sourceBlocks, retainedTail };
}

function buildFullCompactionRequest(input: {
  model: string;
  sourceLines: string[];
  maxTokens?: number;
}): AnthropicMessageRequest {
  const system = [
    "You are summarizing agent session history for continuation after full compaction.",
    "Produce concise Markdown with exactly these section headings:",
    ...REQUIRED_SUMMARY_HEADINGS,
    "Do not include any other headings.",
    "Base the summary only on the provided history extract.",
    "Do not mention task brief, plan mode, or hidden implementation notes unless the history explicitly requires it.",
    "Do not quote tool result bodies because they are intentionally omitted from the source extract.",
    "Focus on durable continuation state: goal, constraints, verified facts, decisions, current frontier, and the next checkpoint."
  ].join("\n");
  const sourceText =
    input.sourceLines.length > 0
      ? input.sourceLines.join("\n")
      : "No older eligible history blocks were available before the retained tail.";

  const messages: AnthropicMessage[] = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "Summarize this older session history into the required continuation template.",
            "",
            "History extract:",
            sourceText
          ].join("\n")
        }
      ]
    }
  ];

  return {
    model: input.model,
    system,
    messages,
    tools: [],
    max_tokens: Math.min(
      input.maxTokens ?? FULL_COMPACTION_MAX_TOKENS,
      FULL_COMPACTION_MAX_TOKENS
    )
  };
}

function normalizeFullCompactionSummary(text: string): string {
  const trimmed = text.trim();
  const hasAllHeadings = REQUIRED_SUMMARY_HEADINGS.every((heading) =>
    trimmed.includes(heading)
  );

  if (hasAllHeadings) {
    return trimmed;
  }

  return [
    "## Goal",
    "Continue the active task from compacted session history.",
    "",
    "## Constraints",
    "- Preserve the latest retained tail and runtime state.",
    "",
    "## Verified Facts",
    "- The earlier history has been compacted into this continuation summary.",
    "",
    "## Decisions",
    "- Full compaction replaced older raw history with a continuation summary.",
    "",
    "## Current Frontier",
    trimmed.length > 0 ? trimmed : "No additional summary text was produced.",
    "",
    "## Next Checkpoint",
    "- Re-read the retained tail and continue from the current frontier."
  ].join("\n");
}

function appendHookContextCompactionSummary(input: {
  summaryMarkdown: string;
  runtimeContext: PromptRuntimeContext;
}): string {
  const compactedEntries =
    input.runtimeContext.hookContextEntries?.filter(
      (entry) => entry.hookEvent !== "session_started"
    ) ?? [];
  if (compactedEntries.length === 0) {
    return input.summaryMarkdown;
  }

  return [
    input.summaryMarkdown,
    "",
    "## Compacted Hook Context",
    ...compactedEntries.map((entry, index) =>
      [`${index + 1}. ${entry.title || entry.hookId}`, entry.content].join("\n")
    )
  ].join("\n");
}

function getEstimatedInputTokens(
  promptEnvelope: PromptEnvelope,
  toolChoice: AnthropicToolChoice | undefined
): number {
  return estimatePromptTokens(promptEnvelope, toolChoice);
}

export async function preparePromptWithCompaction(input: {
  client: AnthropicCompatibleClient;
  sessionManager: SessionManager;
  promptBuilder: PromptBuilder;
  toolRegistry: ToolRegistry;
  traceManager: TraceManager | undefined;
  eventSink: RunEventSink | undefined;
  session: SessionSnapshot;
  turnCount: number;
  toolChoice: AnthropicToolChoice | undefined;
  runtimeContext: PromptRuntimeContext;
  skills: SkillDescriptor[];
  maxTokens?: number;
}): Promise<CompactionPreparationResult> {
  const threshold = Math.floor(
    input.session.contextWindow * HISTORY_COMPACTION_TRIGGER_RATIO
  );
  let session = input.session;
  let promptEnvelope = input.promptBuilder.build(
    session,
    input.toolRegistry,
    input.runtimeContext,
    input.skills
  );
  let estimatedInputTokens = getEstimatedInputTokens(
    promptEnvelope,
    input.toolChoice
  );

  if (estimatedInputTokens <= threshold) {
    return { session, promptEnvelope, estimatedInputTokens };
  }

  if (session.sessionState.historyCompactionsSinceFullCompaction === 0) {
    const historyCompactedMessages = compactHistoryBlocks(session.messages);
    const historyCompactedSession = {
      ...session,
      messages: historyCompactedMessages,
      sessionState: {
        ...session.sessionState,
        historyCompactionsSinceFullCompaction: 1
      }
    };
    session = await input.sessionManager.saveSession(historyCompactedSession);
    promptEnvelope = input.promptBuilder.build(
      session,
      input.toolRegistry,
      input.runtimeContext,
      input.skills
    );
    const estimatedAfterHistoryCompaction = getEstimatedInputTokens(
      promptEnvelope,
      input.toolChoice
    );
    await emitTraceEvent({
      traceManager: input.traceManager,
      eventSink: input.eventSink,
      sessionId: session.sessionId,
      event: {
        kind: "history_compaction",
        turnCount: input.turnCount,
        thresholdTokens: threshold,
        estimatedInputTokensBefore: estimatedInputTokens,
        estimatedInputTokensAfter: estimatedAfterHistoryCompaction,
        sourceBlockCount: input.session.messages.length,
        retainedTailCount: countHistoryCompactionTailBlocks(
          input.session.messages
        )
      }
    });
    estimatedInputTokens = estimatedAfterHistoryCompaction;
    if (estimatedInputTokens <= threshold) {
      return { session, promptEnvelope, estimatedInputTokens };
    }
  }

  const { sourceBlocks, retainedTail } = splitFullCompactionBlocks(
    session.messages
  );
  const sourceLines = sourceBlocks
    .map(buildFullCompactionSourceLine)
    .filter((line): line is string => Boolean(line));
  const compactionRequest = buildFullCompactionRequest({
    model: session.model,
    sourceLines,
    ...(typeof input.maxTokens === "number"
      ? { maxTokens: input.maxTokens }
      : {})
  });
  const compactionResponse =
    await input.client.messages.create(compactionRequest);
  const compactionText = compactionResponse.content
    .filter(
      (
        block
      ): block is Extract<
        (typeof compactionResponse.content)[number],
        { type: "text" }
      > => block.type === "text"
    )
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");
  const summaryMarkdown = appendHookContextCompactionSummary({
    summaryMarkdown: normalizeFullCompactionSummary(compactionText),
    runtimeContext: input.runtimeContext
  });

  const fullCompactedSession: SessionSnapshot = {
    ...session,
    messages: retainedTail.map((block) => structuredClone(block)),
    context: {
      ...session.context,
      hookContextEntries: session.context.hookContextEntries.filter(
        (entry) => entry.hookEvent === "session_started"
      ),
      fullCompactionState: {
        summaryMarkdown,
        compactedAt: new Date().toISOString(),
        promptVersion: FULL_COMPACTION_PROMPT_VERSION,
        sourceBlockCount: sourceBlocks.length,
        retainedTailCount: retainedTail.length
      }
    },
    sessionState: {
      ...session.sessionState,
      historyCompactionsSinceFullCompaction: 0
    }
  };
  session = await input.sessionManager.saveSession(fullCompactedSession);
  promptEnvelope = input.promptBuilder.build(
    session,
    input.toolRegistry,
    input.runtimeContext,
    input.skills
  );
  const estimatedAfterFullCompaction = getEstimatedInputTokens(
    promptEnvelope,
    input.toolChoice
  );
  await emitTraceEvent({
    traceManager: input.traceManager,
    eventSink: input.eventSink,
    sessionId: session.sessionId,
    event: {
      kind: "full_compaction",
      turnCount: input.turnCount,
      thresholdTokens: threshold,
      estimatedInputTokensBefore: estimatedInputTokens,
      estimatedInputTokensAfter: estimatedAfterFullCompaction,
      sourceBlockCount: sourceBlocks.length,
      retainedTailCount: retainedTail.length,
      promptVersion: FULL_COMPACTION_PROMPT_VERSION,
      summaryMarkdown
    }
  });

  return {
    session,
    promptEnvelope,
    estimatedInputTokens: estimatedAfterFullCompaction
  };
}

export const fullCompactionTestUtils = {
  buildFullCompactionSourceLine,
  splitFullCompactionBlocks,
  normalizeFullCompactionSummary,
  FULL_COMPACTION_RETAINED_TAIL_BLOCKS,
  FULL_COMPACTION_PROMPT_VERSION
};
