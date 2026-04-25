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
import type { ToolRegistry } from "./tools/registry.js";
import { normalizeCapabilityPacks } from "@ai-app-template/domain";
import { estimatePromptTokens } from "./runtime/token-budget.js";

export interface PromptEnvelope {
  system: string;
  prefixMessages: AnthropicMessage[];
  messages: AnthropicMessage[];
  runtimeContextMessages: AnthropicMessage[];
  tools: AnthropicToolDefinition[];
  cacheKey: string;
}

export interface PromptBuilderOptions {
  systemPrompt?: string;
  toolChoice?: AnthropicToolChoice;
}

export interface PromptRuntimeContext {
  currentDateTimeContext: string;
  currentTimeZone: string;
}

const DEFAULT_SYSTEM_PROMPT = [
  "You are a personal assistant.",
  "Use the available tools directly and adapt to the tools that are actually available in this run.",
  "Adapt to the tools that are actually available in this run instead of assuming a fixed product workflow.",
  "Prefer inspecting the current workspace or persisted state before taking actions that depend on existing context.",
  "When a capability is not exposed in the current tool list, say so briefly instead of inventing hidden tools.",
  "When a tool returns INVALID_TOOL_INPUT or other validation errors, correct the tool call instead of repeating the same mistake.",
  "Before taking an action, you MUST briefly state your immediate intent in one short sentence so the user can follow what you are about to do.",
  "Keep pre-action intent text concrete and short; do not restate the whole task or write long plans unless the user asks for them.",
  "When the session contains a pending confirmation payload and the user answers yes/no or revises the time, treat it as a response to that pending confirmation.",
  "Some file writes, deletes, moves, shell commands, and network requests may trigger a permission pause before execution.",
  "Actively utilize the skills listed in the runtime context when they are relevant to the user's request and can improve efficiency or reliability.",
  "Only rely on skills explicitly listed in the current runtime context. Do not invent or assume unavailable skills.",
  "Keep the final text concise and rely on stable tool results for detail."
].join("\n");

const EPHEMERAL_CACHE_CONTROL = {
  type: "ephemeral"
} as const;

const HISTORY_COMPACTION_TRIGGER_RATIO = 0.6;
const HISTORY_COMPACTION_TAIL_MESSAGES = 18;
const COMPACTED_TEXT_LIMIT = 1_200;

function toolSummary(tools: AnthropicToolDefinition[]): string {
  return tools.map((tool) => tool.name).join(", ");
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
          `Current date context: ${session.context.currentDateContext}`,
          `YOLO mode: ${session.context.yoloMode ? "enabled" : "disabled"}`,
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
    return `user: ${truncateText(block.content, 320)}`;
  }

  if (block.kind === "assistant") {
    return `assistant: ${truncateText(block.content, 420)}`;
  }

  if (block.kind === "assistant thinking") {
    return "assistant thinking: preserved reasoning for a prior tool-use turn; signature omitted from compact summary";
  }

  if (block.kind === "tool call") {
    return `tool call: ${block.toolName} ${truncateText(JSON.stringify(block.input), 320)}`;
  }

  return `tool result: ${block.toolName} ${block.isError ? "failed" : "succeeded"}; ${truncateText(block.output, 520)}`;
}

function compactHistoryBlocks(
  blocks: ConversationBlock[]
): ConversationBlock[] {
  if (blocks.length <= HISTORY_COMPACTION_TAIL_MESSAGES) {
    return blocks;
  }

  const tailCandidateStart = Math.max(
    0,
    blocks.length - HISTORY_COMPACTION_TAIL_MESSAGES
  );
  const tailStart = blocks.findIndex(
    (block, index) => index >= tailCandidateStart && block.kind === "user"
  );
  const effectiveTailStart = tailStart === -1 ? tailCandidateStart : tailStart;
  const compacted = blocks.slice(0, effectiveTailStart);
  const tail = blocks.slice(effectiveTailStart);
  const summary = compacted.map(summarizeCompactedBlock).join("\n");

  return [
    {
      id: "history-compaction-summary",
      kind: "user",
      content: [
        `[History compacted: ${compacted.length} older blocks summarized to reduce context.]`,
        truncateText(summary, COMPACTED_TEXT_LIMIT)
      ].join("\n"),
      createdAt: new Date(0).toISOString()
    },
    ...tail
  ];
}

function createDomainInstructions(tools: AnthropicToolDefinition[]): string[] {
  void tools;
  return [];
}

function createRuntimeContextMessage(
  session: SessionSnapshot,
  runtimeContext: PromptRuntimeContext
): AnthropicMessage {
  const pendingConfirmation = session.context.pendingConfirmationPayload;
  const pendingText = pendingConfirmation
    ? JSON.stringify(pendingConfirmation, null, 2)
    : "none";
  const pendingPermissionRequest = session.context.pendingPermissionRequest;
  const permissionText = pendingPermissionRequest
    ? JSON.stringify(pendingPermissionRequest, null, 2)
    : "none";

  return {
    role: "user",
    content: [
      {
        type: "text",
        text: [
          "Runtime context for this run:",
          `Current local datetime: ${runtimeContext.currentDateTimeContext}`,
          `Current timezone: ${runtimeContext.currentTimeZone}`,
          `Working directory: ${session.workingDirectory}`,
          `Session status: ${session.context.status}`,
          `YOLO mode: ${session.context.yoloMode ? "enabled" : "disabled"}`,
          `Pending permission request: ${permissionText}`,
          `Pending confirmation payload: ${pendingText}`
        ].join("\n")
      }
    ]
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
  constructor(
    private readonly systemPrompt = DEFAULT_SYSTEM_PROMPT,
    private readonly toolChoice?: AnthropicToolChoice
  ) {}

  build(
    session: SessionSnapshot,
    toolRegistry: ToolRegistry,
    runtimeContext: PromptRuntimeContext = {
      currentDateTimeContext: formatPromptDateTimeContext(),
      currentTimeZone: resolvePromptTimeZone()
    },
    skills: SkillDescriptor[] = []
  ): PromptEnvelope {
    const tools = toolRegistry.toAnthropicTools();
    const system = [this.systemPrompt, ...createDomainInstructions(tools)]
      .filter((section) => section.length > 0)
      .join("\n");
    const prefixMessage = createPrefixMessage(session, tools);
    const baseMessages = toAnthropicMessages(session.messages);
    const runtimeContextMessage = createRuntimeContextMessage(
      session,
      runtimeContext
    );
    const skillsContextMessage = createSkillsContextMessage(skills);
    const shouldCompactHistory =
      estimatePromptTokens(
        {
          system,
          prefixMessages: [prefixMessage],
          messages: baseMessages,
          runtimeContextMessages: [runtimeContextMessage, skillsContextMessage],
          tools,
          cacheKey: ""
        },
        this.toolChoice
      ) > Math.floor(session.contextWindow * HISTORY_COMPACTION_TRIGGER_RATIO);
    const messages = shouldCompactHistory
      ? toAnthropicMessages(compactHistoryBlocks(session.messages))
      : baseMessages;
    const cacheKey = createHash("sha256")
      .update(system)
      .update("\n")
      .update(JSON.stringify(prefixMessage))
      .update("\n")
      .update(JSON.stringify(tools))
      .digest("hex");

    return {
      system,
      prefixMessages: [prefixMessage],
      messages,
      runtimeContextMessages: [runtimeContextMessage, skillsContextMessage],
      tools,
      cacheKey
    };
  }
}

export function createPromptBuilder(
  options: PromptBuilderOptions = {}
): PromptBuilder {
  return new PromptBuilder(options.systemPrompt, options.toolChoice);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatPromptDateTimeContext(now = new Date()): string {
  return [
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    `${pad(now.getHours())}:${pad(now.getMinutes())}`
  ].join(" ");
}

export function resolvePromptTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
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
