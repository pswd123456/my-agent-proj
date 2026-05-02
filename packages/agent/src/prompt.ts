import { createHash } from "node:crypto";

import type {
  AnthropicMessage,
  AnthropicToolChoice,
  AnthropicToolDefinition
} from "./model.js";
import type {
  ConversationBlock,
  JsonValue,
  SessionSnapshot,
  UserConversationBlock
} from "./types.js";
import type { SkillDescriptor } from "./skills/index.js";
import type { RuntimeTool } from "./tools/runtime-tool.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { WorkspaceInstructionsDescriptor } from "./workspace-instructions/index.js";
import type { ResolvedUserContextHookSection } from "./context-hooks.js";
import type { HookContextEntry } from "@ai-app-template/domain";
import {
  PLANNING_STATE_TOOL_NAMES,
  normalizeCapabilityPacks
} from "@ai-app-template/domain";
import {
  describeTaskBriefBinding,
  type TaskBriefBindingInfo
} from "./session/task-brief.js";

export interface PromptEnvelope {
  system: string;
  prefixMessages: AnthropicMessage[];
  messages: AnthropicMessage[];
  runtimeContextMessages: AnthropicMessage[];
  dynamicPromptMessages: string[];
  tools: AnthropicToolDefinition[];
  cacheKey: string;
}

export interface PromptCompositionLargestToolResult {
  toolUseId: string;
  toolName: string;
  chars: number;
  isError: boolean;
  preview: string;
}

export interface PromptCompositionStats {
  totalChars: number;
  systemChars: number;
  prefixChars: number;
  conversationChars: number;
  runtimeContextChars: number;
  dynamicPromptChars: number;
  toolDefinitionChars: number;
  conversationBreakdown: {
    textChars: number;
    thinkingChars: number;
    toolUseInputChars: number;
    toolResultChars: number;
    toolResultCount: number;
    thinkingBlockCount: number;
  };
  largestToolResults: PromptCompositionLargestToolResult[];
}

export interface PromptBuilderOptions {
  systemPrompt?: string;
  toolChoice?: AnthropicToolChoice;
}

export interface PromptRuntimeContext {
  currentTurnCount?: number;
  maxTurns?: number;
  userCustomPrompt?: string;
  contextHooks?: ResolvedUserContextHookSection[];
  hookContextEntries?: HookContextEntry[];
  workspaceInstructions?: WorkspaceInstructionsDescriptor | null;
}

const DEFAULT_SYSTEM_PROMPT = [
  "## Role and Operating Mode",
  "You are a personal assistant.",
  "Use the available tools directly.",
  "Adapt to the tools that are actually available in this run instead of assuming a fixed product workflow.",
  "Prefer inspecting the current workspace or persisted state before taking actions that depend on existing context.",
  "When a capability is not exposed in the current tool list, say so briefly instead of inventing hidden tools.",
  "When a tool returns INVALID_TOOL_INPUT or other validation errors, correct the tool call instead of repeating the same mistake.",
  "",
  "## Workspace Instructions",
  "Follow workspace instructions listed in the runtime context when they are present.",
  "",
  "## Action Updates",
  "Before taking an action, you MUST briefly state your immediate intent in one short sentence so the user can follow what you are about to do.",
  "Keep pre-action intent text concrete and short; do not restate the whole task or write long plans unless the user asks for them.",
  "",
  "## Pending User State",
  "When the session contains a pending confirmation payload and the user answers yes/no or revises the time, treat it as a response to that pending confirmation.",
  "",
  "## Skills and Planning State",
  "Actively utilize the skills listed in the runtime context when they are relevant to the user's request and can improve efficiency or reliability.",
  "When search_skill and load_skill are available, use search_skill to find the most relevant workspace skill and load_skill to inspect its exact instructions before following a detailed skill workflow.",
  "Only rely on skills explicitly listed in the current runtime context. Do not invent or assume unavailable skills.",
  "When the user message contains an explicit file reference like @relative/path, treat it as a concrete workspace path. If the path is already precise, do not call find_files just to rediscover the same target.",
  "When the user message contains an explicit skill reference like #skill_name, treat it as a concrete workspace skill name. If load_skill is available, you may load that exact skill directly.",
  "When a structured todo list is available, use it to stay aligned with the current task and keep item status updated as you make progress.",
  "",
  "## Repository and Document Retrieval",
  "For repository or document inspection, follow this retrieval protocol unless the user explicitly asks for a full-file read: (1) use search_text or find_files to narrow the target, (2) read only a narrow window with read_file, (3) expand with the next adjacent window only if needed.",
  "Do not begin context gathering with broad read_file, git_status, or directory-wide exploration when search_text or find_files can narrow the target faster.",
  "When both search_text and read_file are available, you MUST use search_text first before read_file unless you already have an exact file path and exact line range from the current turn.",
  "When reading a file with unknown size, or when you only need part of it, you MUST use read_file with offset and limit or startLine/endLine instead of requesting the whole file at once.",
  "After search_text identifies a likely target, you MUST read a narrow window around the relevant section instead of reading the whole file.",
  "If the first read_file window is not enough, continue with the next adjacent window instead of rereading from the beginning or jumping to a full-file read.",
  "Only read an entire file when the tool results already show it is small enough and the whole file is genuinely required for the task.",
  "If read_file reports that a file is unchanged since the last read, reuse the earlier content already in context instead of rereading it.",
  "",
  "## File Mutation Tools",
  "Use write_file only for new files or full-file replacement, use apply_patch for line-level edits, and use delete_file for deleting one or more files. Use delete_path only when the target may be a directory or generic path.",
  "Read before edit: before mutating or deleting an existing file, call read_file for that exact path in the current session unless this same session already successfully changed that file with write_file, apply_patch, or delete_file.",
  "Content from search_skill, load_skill, search_text, git_diff, or earlier conversation is useful context, but it does not satisfy the write precondition for existing files.",
  "Before using write_file, apply_patch, or delete_file on an existing file, you MUST have a current session file state for that file: either read it with read_file, or rely on a successful write_file/apply_patch/delete_file from this same session. If the write tool reports the file changed since the last session file state, read it again before retrying.",
  "",
  "## Final Response",
  "Keep the final text concise and rely on stable tool results for detail."
].join("\n");

const EPHEMERAL_CACHE_CONTROL = {
  type: "ephemeral"
} as const;

const PLAN_MODE_DISABLED_TOOL_NAMES = new Set<string>(
  PLANNING_STATE_TOOL_NAMES
);

export const HISTORY_COMPACTION_TRIGGER_RATIO = 0.95;
export const HISTORY_COMPACTION_TAIL_MESSAGES = 18;
const COMPACTED_TEXT_LIMIT = 1_200;
const LARGEST_TOOL_RESULTS_LIMIT = 5;
const TOOL_RESULT_PREVIEW_LIMIT = 160;

function toolSummary(tools: AnthropicToolDefinition[]): string {
  return tools.map((tool) => tool.name).join(", ");
}

function shouldExposeToolInPrompt(
  session: SessionSnapshot,
  tool: RuntimeTool
): boolean {
  if (
    session.context.planModeEnabled &&
    tool.family === "workspace-file" &&
    tool.isReadOnly === false
  ) {
    return false;
  }

  if (
    session.context.planModeEnabled &&
    PLAN_MODE_DISABLED_TOOL_NAMES.has(tool.name)
  ) {
    return false;
  }

  return true;
}

function listPromptTools(
  session: SessionSnapshot,
  toolRegistry: ToolRegistry
): AnthropicToolDefinition[] {
  return toolRegistry
    .list()
    .filter((tool) => shouldExposeToolInPrompt(session, tool))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createPrefixMessage(
  session: SessionSnapshot,
  tools: AnthropicToolDefinition[]
): AnthropicMessage {
  const enabledCapabilityPacks = normalizeCapabilityPacks(
    session.context.enabledCapabilityPacks
  );
  return {
    role: "user",
    content: [
      {
        type: "text",
        cache_control: EPHEMERAL_CACHE_CONTROL,
        text: [
          `Workspace root: ${session.workingDirectory}`,
          `Enabled capability packs: ${enabledCapabilityPacks.join(", ") || "none"}`,
          `Mounted tools: ${toolSummary(tools) || "none"}`
        ].join("\n")
      }
    ]
  };
}

function truncateText(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) {
    return text;
  }

  return `${text.slice(0, maxCharacters)}\n...[truncated ${text.length - maxCharacters} chars]`;
}

function summarizeCompactedBlock(block: ConversationBlock): string {
  if (block.kind === "user") {
    return `user: ${block.content}`;
  }

  if (block.kind === "assistant") {
    return `assistant: ${block.content}`;
  }

  if (block.kind === "tool call") {
    return `tool call: ${block.toolName} ${truncateText(JSON.stringify(block.input), 320)}`;
  }

  if (block.kind === "assistant thinking") {
    return "assistant thinking: preserved verbatim outside compact summary";
  }

  return `tool result: ${block.toolName} ${block.isError ? "failed" : "succeeded"}; output omitted from compact summary (${block.output.length} chars)`;
}

function shouldSummarizeInHistoryCompaction(block: ConversationBlock): boolean {
  return block.kind === "tool call" || block.kind === "tool result";
}

function createHistoryCompactionSummaryBlock(
  blocks: ConversationBlock[],
  index: number
): UserConversationBlock {
  const summary = blocks.map(summarizeCompactedBlock).join("\n");

  return {
    id:
      index === 0
        ? "history-compaction-summary"
        : `history-compaction-summary-${index}`,
    kind: "user",
    content: [
      `[History compacted: ${blocks.length} older tool blocks summarized to reduce context. User, assistant text, and assistant thinking blocks were preserved verbatim.]`,
      truncateText(summary, COMPACTED_TEXT_LIMIT)
    ].join("\n"),
    createdAt: new Date(0).toISOString()
  };
}

function getHistoryCompactionTailStart(blocks: ConversationBlock[]): number {
  const tailCandidateStart = Math.max(
    0,
    blocks.length - HISTORY_COMPACTION_TAIL_MESSAGES
  );
  const tailStart = blocks.findIndex(
    (block, index) => index >= tailCandidateStart && block.kind === "user"
  );

  return tailStart === -1 ? tailCandidateStart : tailStart;
}

export function countHistoryCompactionTailBlocks(
  blocks: ConversationBlock[]
): number {
  if (blocks.length <= HISTORY_COMPACTION_TAIL_MESSAGES) {
    return blocks.length;
  }

  return blocks.length - getHistoryCompactionTailStart(blocks);
}

export function compactHistoryBlocks(
  blocks: ConversationBlock[]
): ConversationBlock[] {
  if (blocks.length <= HISTORY_COMPACTION_TAIL_MESSAGES) {
    return blocks;
  }

  const effectiveTailStart = getHistoryCompactionTailStart(blocks);
  const compacted = blocks.slice(0, effectiveTailStart);
  const tail = blocks.slice(effectiveTailStart);
  const retainedBlocks: ConversationBlock[] = [];
  let pendingSummaryBlocks: ConversationBlock[] = [];
  let summaryIndex = 0;

  const flushSummaryBlocks = () => {
    if (pendingSummaryBlocks.length === 0) {
      return;
    }

    retainedBlocks.push(
      createHistoryCompactionSummaryBlock(pendingSummaryBlocks, summaryIndex)
    );
    pendingSummaryBlocks = [];
    summaryIndex += 1;
  };

  for (const block of compacted) {
    if (shouldSummarizeInHistoryCompaction(block)) {
      pendingSummaryBlocks.push(block);
      continue;
    }

    flushSummaryBlocks();
    retainedBlocks.push(block);
  }
  flushSummaryBlocks();

  return [...retainedBlocks, ...tail];
}

function createDomainInstructions(tools: AnthropicToolDefinition[]): string[] {
  void tools;
  return [];
}

function createTaskBriefWriteRule(binding: TaskBriefBindingInfo): string {
  switch (binding.state) {
    case "unbound":
      return "include plan_name on the first replace_task_brief call.";
    case "bound_named":
      return binding.planFileName
        ? `omit plan_name unless you are reusing ${binding.planFileName}.`
        : "omit plan_name unless you are reusing the current named binding.";
    case "invalid":
      return "the current bound path is invalid for this session; do not assume plan_name alone can recover it.";
  }
}

function createFullCompactionContextMessage(
  session: SessionSnapshot
): AnthropicMessage | null {
  const fullCompactionState = session.context.fullCompactionState;
  if (!fullCompactionState) {
    return null;
  }

  return {
    role: "user",
    content: [
      {
        type: "text",
        text: [
          "Continuation summary from the latest full compaction:",
          `Compacted at: ${fullCompactionState.compactedAt}`,
          `Prompt version: ${fullCompactionState.promptVersion}`,
          `Source blocks: ${fullCompactionState.sourceBlockCount}`,
          `Retained tail blocks: ${fullCompactionState.retainedTailCount}`,
          "",
          fullCompactionState.summaryMarkdown
        ].join("\n")
      }
    ]
  };
}

function createRuntimeContextMessages(
  session: SessionSnapshot,
  runtimeContext: PromptRuntimeContext
): { messages: AnthropicMessage[]; dynamicPromptMessages: string[] } {
  const pendingConfirmation = session.context.pendingConfirmationPayload;
  const pendingText = pendingConfirmation
    ? JSON.stringify(pendingConfirmation, null, 2)
    : "none";
  const pendingUserQuestion = session.context.pendingUserQuestionPayload;
  const userQuestionText = pendingUserQuestion
    ? JSON.stringify(pendingUserQuestion, null, 2)
    : "none";
  const pendingBackgroundNotifications =
    session.context.pendingBackgroundNotifications.filter(
      (notification) =>
        notification.expectedParentReply !== "permission_decision" &&
        notification.request?.kind !== "permission_request"
    );
  const backgroundNotificationText =
    pendingBackgroundNotifications.length > 0
      ? JSON.stringify(pendingBackgroundNotifications, null, 2)
      : "none";
  const currentTurnCount =
    typeof runtimeContext.currentTurnCount === "number"
      ? Math.max(0, Math.floor(runtimeContext.currentTurnCount))
      : null;
  const maxTurns =
    typeof runtimeContext.maxTurns === "number"
      ? Math.max(1, Math.floor(runtimeContext.maxTurns))
      : null;
  const shouldWarnNearTurnBudget =
    currentTurnCount !== null &&
    maxTurns !== null &&
    currentTurnCount < maxTurns &&
    currentTurnCount / maxTurns >= 0.9;
  const dynamicPromptMessages = shouldWarnNearTurnBudget
    ? [
        "Turn budget is nearly exhausted. Consolidate work, avoid exploratory detours, and prefer a final answer or a crisp blocking question."
      ]
    : [];
  const taskBriefBinding = describeTaskBriefBinding({
    workingDirectory: session.workingDirectory,
    sessionId: session.sessionId,
    taskBriefPath: session.context.taskBriefPath
  });
  const runtimeLines = [
    "Runtime context for this run:",
    `Working directory: ${session.workingDirectory}`,
    `Plan mode: ${session.context.planModeEnabled ? "enabled" : "disabled"}`,
    `Task brief path: ${session.context.taskBriefPath ?? "none"}`,
    `Task brief binding: ${taskBriefBinding.state}`,
    `Task brief next write: ${createTaskBriefWriteRule(taskBriefBinding)}`,
    `Active background task count: ${session.context.activeBackgroundTaskCount}`,
    `Pending background notifications: ${backgroundNotificationText}`,
    `Pending confirmation payload: ${pendingText}`,
    `Pending user question payload: ${userQuestionText}`
  ];
  if (dynamicPromptMessages.length > 0) {
    runtimeLines.push(...dynamicPromptMessages);
  }

  return {
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: runtimeLines.join("\n")
          }
        ]
      }
    ],
    dynamicPromptMessages
  };
}

function createSkillsContextMessage(
  skills: SkillDescriptor[]
): AnthropicMessage {
  const skillLines =
    skills.length === 0
      ? ["none"]
      : skills.map((skill) => `- ${skill.name}: ${skill.description}`);

  return {
    role: "user",
    content: [
      {
        type: "text",
        text: ["Runtime skills for this workspace:", ...skillLines].join("\n")
      }
    ]
  };
}

function createWorkspaceInstructionsContextMessage(
  instructions: WorkspaceInstructionsDescriptor | null | undefined
): AnthropicMessage | null {
  if (!instructions) {
    return null;
  }

  const content = instructions.content.trim();
  if (content.length === 0) {
    return null;
  }

  return {
    role: "user",
    content: [
      {
        type: "text",
        text: [
          `Workspace instructions from ${instructions.relativePath}:`,
          "",
          content
        ].join("\n")
      }
    ]
  };
}

function createUserContextHookMessages(
  sections: ResolvedUserContextHookSection[] | undefined
): AnthropicMessage[] {
  if (!sections || sections.length === 0) {
    return [];
  }

  return sections.map((section) => ({
    role: "user",
    content: [
      {
        type: "text",
        text: [
          section.heading,
          section.description,
          "",
          ...section.hooks.map((hook, index) =>
            [
              hook.title
                ? `${index + 1}. ${hook.title}`
                : `${index + 1}. (untitled hook)`,
              hook.content
            ].join("\n")
          )
        ].join("\n")
      }
    ]
  }));
}

function createSubagentHookContextMessage(
  entries: HookContextEntry[] | undefined
): AnthropicMessage | null {
  if (!entries || entries.length === 0) {
    return null;
  }

  return {
    role: "user",
    content: [
      {
        type: "text",
        text: [
          "Injected context from completed subagent hooks:",
          "",
          ...entries.map((entry, index) =>
            [
              `${index + 1}. ${entry.title || entry.hookId} (${entry.hookEvent})`,
              entry.content
            ].join("\n")
          )
        ].join("\n")
      }
    ]
  };
}

function createUserCustomPromptContextMessage(
  userCustomPrompt: string | undefined
): AnthropicMessage | null {
  const content = userCustomPrompt?.trim() ?? "";
  if (content.length === 0) {
    return null;
  }

  return {
    role: "user",
    content: [
      {
        type: "text",
        text: ["User custom prompt from default settings:", "", content].join(
          "\n"
        )
      }
    ]
  };
}

function createPlanModePromptMessage(
  session: SessionSnapshot,
  tools: AnthropicToolDefinition[]
): AnthropicMessage | null {
  if (!session.context.planModeEnabled) {
    return null;
  }

  const toolNames = new Set(tools.map((tool) => tool.name));
  const lines = [
    "Plan mode prompt for this run:",
    "- Stay in planning mode. Do not mutate ordinary workspace files.",
    "- Todo tools are unavailable in plan mode. Use the task brief as the planning artifact."
  ];

  if (toolNames.has("ask_user_question")) {
    lines.push(
      "- Use ask_user_question for requirement clarification instead of asking a plain-text question and guessing."
    );
  }
  if (toolNames.has("search_task_brief")) {
    lines.push(
      "- Use search_task_brief first when you need to locate a section or line number in the current brief."
    );
  }
  if (toolNames.has("read_task_brief")) {
    lines.push(
      "- Use read_task_brief with narrow line windows to inspect the brief."
    );
  }
  if (toolNames.has("edit_task_brief")) {
    lines.push(
      "- Use edit_task_brief for targeted line edits inside an existing brief."
    );
  }
  if (toolNames.has("replace_task_brief")) {
    lines.push(
      "- Use replace_task_brief when creating the first brief or when a full rewrite is clearly cheaper than several small edits."
    );
  }
  lines.push(
    "- Follow the task brief binding and next-write rule from the runtime context instead of inferring from the path alone."
  );

  return {
    role: "user",
    content: [
      {
        type: "text",
        text: lines.join("\n")
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

function stringifyPromptValue(value: unknown): string {
  const serialized = JSON.stringify(value);
  return typeof serialized === "string" ? serialized : String(value);
}

function getContentBlockChars(
  block: AnthropicMessage["content"][number]
): number {
  if (block.type === "text") {
    return block.text.length;
  }

  if (block.type === "thinking") {
    return block.thinking.length;
  }

  if (block.type === "tool_use") {
    return stringifyPromptValue(block.input).length;
  }

  return block.content.length;
}

function getMessageChars(message: AnthropicMessage): number {
  return message.content.reduce(
    (total, block) => total + getContentBlockChars(block),
    0
  );
}

function createToolResultPreview(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length === 0) {
    return "(empty)";
  }

  if (compact.length <= TOOL_RESULT_PREVIEW_LIMIT) {
    return compact;
  }

  return `${compact.slice(0, TOOL_RESULT_PREVIEW_LIMIT)}...[truncated ${compact.length - TOOL_RESULT_PREVIEW_LIMIT} chars]`;
}

function getToolDefinitionChars(tool: AnthropicToolDefinition): number {
  return (
    tool.name.length +
    tool.description.length +
    stringifyPromptValue(tool.input_schema).length
  );
}

function findToolNameForCall(
  messages: AnthropicMessage[],
  toolUseId: string
): string | null {
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "tool_use" && block.id === toolUseId) {
        return block.name;
      }
    }
  }

  return null;
}

function summarizeConversationMessages(
  messages: AnthropicMessage[]
): Pick<
  PromptCompositionStats,
  "conversationChars" | "conversationBreakdown" | "largestToolResults"
> {
  let textChars = 0;
  let thinkingChars = 0;
  let toolUseInputChars = 0;
  let toolResultChars = 0;
  let toolResultCount = 0;
  let thinkingBlockCount = 0;
  const toolResults: PromptCompositionLargestToolResult[] = [];

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "text") {
        textChars += block.text.length;
        continue;
      }

      if (block.type === "thinking") {
        thinkingChars += block.thinking.length;
        thinkingBlockCount += 1;
        continue;
      }

      if (block.type === "tool_use") {
        toolUseInputChars += stringifyPromptValue(block.input).length;
        continue;
      }

      toolResultChars += block.content.length;
      toolResultCount += 1;
      toolResults.push({
        toolUseId: block.tool_use_id,
        toolName:
          findToolNameForCall(messages, block.tool_use_id) ?? "(unknown tool)",
        chars: block.content.length,
        isError: block.is_error ?? false,
        preview: createToolResultPreview(block.content)
      });
    }
  }

  return {
    conversationChars:
      textChars + thinkingChars + toolUseInputChars + toolResultChars,
    conversationBreakdown: {
      textChars,
      thinkingChars,
      toolUseInputChars,
      toolResultChars,
      toolResultCount,
      thinkingBlockCount
    },
    largestToolResults: toolResults
      .sort((left, right) => right.chars - left.chars)
      .slice(0, LARGEST_TOOL_RESULTS_LIMIT)
  };
}

export function summarizePromptEnvelopeComposition(
  promptEnvelope: PromptEnvelope
): PromptCompositionStats {
  const prefixChars = promptEnvelope.prefixMessages.reduce(
    (total, message) => total + getMessageChars(message),
    0
  );
  const runtimeContextChars = promptEnvelope.runtimeContextMessages.reduce(
    (total, message) => total + getMessageChars(message),
    0
  );
  const dynamicPromptChars = promptEnvelope.dynamicPromptMessages.reduce(
    (total, message) => total + message.length,
    0
  );
  const toolDefinitionChars = promptEnvelope.tools.reduce(
    (total, tool) => total + getToolDefinitionChars(tool),
    0
  );
  const conversation = summarizeConversationMessages(promptEnvelope.messages);

  return {
    totalChars:
      promptEnvelope.system.length +
      prefixChars +
      conversation.conversationChars +
      runtimeContextChars +
      toolDefinitionChars,
    systemChars: promptEnvelope.system.length,
    prefixChars,
    conversationChars: conversation.conversationChars,
    runtimeContextChars,
    dynamicPromptChars,
    toolDefinitionChars,
    conversationBreakdown: conversation.conversationBreakdown,
    largestToolResults: conversation.largestToolResults
  };
}

export function buildPromptRequestMessages(
  promptEnvelope: Pick<
    PromptEnvelope,
    "prefixMessages" | "runtimeContextMessages" | "messages"
  >
): AnthropicMessage[] {
  return [
    ...promptEnvelope.prefixMessages,
    ...promptEnvelope.runtimeContextMessages,
    ...promptEnvelope.messages
  ];
}

export function toAnthropicMessages(
  blocks: ConversationBlock[]
): AnthropicMessage[] {
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

  const getResponseGroupId = (block: ConversationBlock): string | undefined =>
    "responseGroupId" in block && typeof block.responseGroupId === "string"
      ? block.responseGroupId
      : undefined;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) {
      continue;
    }

    const responseGroupId = getResponseGroupId(block);
    if (responseGroupId) {
      const groupedBlocks: ConversationBlock[] = [block];
      while (
        index + 1 < blocks.length &&
        getResponseGroupId(blocks[index + 1] as ConversationBlock) ===
          responseGroupId
      ) {
        index += 1;
        const nextBlock = blocks[index];
        if (nextBlock) {
          groupedBlocks.push(nextBlock);
        }
      }

      flush();
      const assistantContent: AnthropicMessage["content"] = [];
      const toolResults: AnthropicMessage["content"] = [];
      for (const groupedBlock of groupedBlocks) {
        if (groupedBlock.kind === "assistant") {
          assistantContent.push(createTextContent(groupedBlock.content));
          continue;
        }
        if (groupedBlock.kind === "assistant thinking") {
          assistantContent.push({
            type: "thinking",
            thinking: groupedBlock.content,
            signature: groupedBlock.signature
          });
          continue;
        }
        if (groupedBlock.kind === "tool call") {
          assistantContent.push({
            type: "tool_use",
            id: groupedBlock.toolCallId,
            name: groupedBlock.toolName,
            input: groupedBlock.input
          });
          continue;
        }
        if (groupedBlock.kind === "tool result") {
          toolResults.push({
            type: "tool_result",
            tool_use_id: groupedBlock.toolCallId,
            content: groupedBlock.output,
            is_error: groupedBlock.isError
          });
        }
      }

      if (assistantContent.length > 0) {
        messages.push(createAnthropicMessage("assistant", assistantContent));
      }
      if (toolResults.length > 0) {
        messages.push(createAnthropicMessage("user", toolResults));
      }
      continue;
    }

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

    if (block.kind === "assistant thinking") {
      append("assistant", {
        type: "thinking",
        thinking: block.content,
        signature: block.signature
      });
      continue;
    }

    if (block.kind === "tool call") {
      append("assistant", {
        type: "tool_use",
        id: block.toolCallId,
        name: block.toolName,
        input: block.input
      });
      continue;
    }

    if (block.kind === "tool result") {
      flush();
      messages.push(
        createAnthropicMessage("user", [
          {
            type: "tool_result",
            tool_use_id: block.toolCallId,
            content: block.output,
            is_error: block.isError
          }
        ])
      );
      continue;
    }

    continue;
  }

  flush();
  return messages;
}

export class PromptBuilder {
  constructor(private readonly systemPrompt = DEFAULT_SYSTEM_PROMPT) {}

  build(
    session: SessionSnapshot,
    toolRegistry: ToolRegistry,
    runtimeContext: PromptRuntimeContext = {},
    skills: SkillDescriptor[] = []
  ): PromptEnvelope {
    const tools = listPromptTools(session, toolRegistry);
    const system = [this.systemPrompt, ...createDomainInstructions(tools)]
      .filter((section) => section.length > 0)
      .join("\n");
    const prefixMessage = createPrefixMessage(session, tools);
    const baseMessages = toAnthropicMessages(session.messages);
    const { messages: runtimeContextMessages, dynamicPromptMessages } =
      createRuntimeContextMessages(session, runtimeContext);
    const fullCompactionContextMessage =
      createFullCompactionContextMessage(session);
    const userCustomPromptContextMessage = createUserCustomPromptContextMessage(
      runtimeContext.userCustomPrompt
    );
    const workspaceInstructionsContextMessage =
      createWorkspaceInstructionsContextMessage(
        runtimeContext.workspaceInstructions
      );
    const contextHookMessages = createUserContextHookMessages(
      runtimeContext.contextHooks
    );
    const subagentHookContextMessage = createSubagentHookContextMessage(
      runtimeContext.hookContextEntries
    );
    const skillsContextMessage = createSkillsContextMessage(skills);
    const cacheKey = createHash("sha256")
      .update(system)
      .update("\n")
      .update(JSON.stringify(prefixMessage))
      .update("\n")
      .update(JSON.stringify(tools))
      .digest("hex");
    const planModePromptMessage = createPlanModePromptMessage(session, tools);

    return {
      system,
      prefixMessages: [prefixMessage],
      messages: baseMessages,
      runtimeContextMessages: [
        ...(planModePromptMessage ? [planModePromptMessage] : []),
        ...(userCustomPromptContextMessage
          ? [userCustomPromptContextMessage]
          : []),
        ...(workspaceInstructionsContextMessage
          ? [workspaceInstructionsContextMessage]
          : []),
        ...contextHookMessages,
        ...(subagentHookContextMessage ? [subagentHookContextMessage] : []),
        skillsContextMessage,
        ...(fullCompactionContextMessage ? [fullCompactionContextMessage] : []),
        ...runtimeContextMessages
      ],
      dynamicPromptMessages,
      tools,
      cacheKey
    };
  }
}

export function createPromptBuilder(
  options: PromptBuilderOptions = {}
): PromptBuilder {
  void options.toolChoice;
  return new PromptBuilder(options.systemPrompt);
}

export function summarizeConversationBlocks(
  blocks: ConversationBlock[]
): string {
  return blocks
    .map((block) => {
      if (block.kind === "user" || block.kind === "assistant") {
        return `${block.kind}: ${block.content}`;
      }

      if (block.kind === "tool call") {
        return `tool call: ${block.toolName}`;
      }

      if (block.kind === "assistant thinking") {
        return "assistant thinking: preserved reasoning for a prior tool-use turn; signature omitted";
      }

      return `tool result: ${block.toolName}`;
    })
    .join("\n");
}

export function extractUserMessages(
  blocks: ConversationBlock[]
): UserConversationBlock[] {
  return blocks.filter(
    (block): block is UserConversationBlock => block.kind === "user"
  );
}

export function isPlainRecord(
  value: unknown
): value is Record<string, unknown> {
  return isRecord(value);
}

export function toToolInputRecord(value: unknown): Record<string, JsonValue> {
  if (!isRecord(value)) {
    return {};
  }

  return value as Record<string, JsonValue>;
}
