import { createHash } from "node:crypto";

import type { AnthropicMessage, AnthropicToolDefinition } from "./model.js";
import type {
  ConversationBlock,
  JsonValue,
  SessionSnapshot,
  UserConversationBlock
} from "./types.js";
import type { SkillDescriptor } from "./skills/index.js";
import type { ToolRegistry } from "./tools/registry.js";

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
}

export interface PromptRuntimeContext {
  currentDateTimeContext: string;
  currentTimeZone: string;
}

const DEFAULT_SYSTEM_PROMPT = [
  "You are a personal assistant operating a CLI-first workspace runtime.",
  "This runtime exposes one unified tool surface through a flat tool registry rather than scattered ad-hoc tools.",
  "Adapt to the tools that are actually available in this run instead of assuming a fixed product workflow.",
  "Prefer inspecting the current workspace or persisted state before taking actions that depend on existing context.",
  "When a capability is not exposed in the current tool list, say so briefly instead of inventing hidden tools.",
  "When a tool returns INVALID_TOOL_INPUT or other validation errors, correct the tool call instead of repeating the same mistake.",
  "When the session contains a pending confirmation payload and the user answers yes/no or revises the time, treat it as a response to that pending confirmation.",
  "Some file writes, deletes, moves, shell commands, and network requests may trigger a permission pause before execution.",
  "When YOLO mode is enabled in the runtime context, destructive workspace-file operations may run without a permission pause, but shell/network approvals and sandbox blocks still apply.",
  "If a tool call is blocked by sandbox or permission rules, do not retry the same risky action blindly; choose a safer path or ask the user.",
  "Actively utilize the skills listed in the runtime context when they are relevant to the user's request and can improve efficiency or reliability.",
  "Only rely on skills explicitly listed in the current runtime context. Do not invent or assume unavailable skills.",
  "In CLI mode, keep the final text concise and rely on stable tool results for detail."
].join("\n");

const EPHEMERAL_CACHE_CONTROL = {
  type: "ephemeral"
} as const;

const SCHEDULE_READ_TOOL_NAMES = [
  "list_routine_by_date",
  "list_routine_by_week",
  "search_routine_by_oclock"
] as const;

const SCHEDULE_WRITE_TOOL_NAMES = [
  "create_routine",
  "edit_routine",
  "delete_routine"
] as const;

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
        cache_control: EPHEMERAL_CACHE_CONTROL,
        text: [
          `Workspace root: ${session.workingDirectory}`,
          `Current date context: ${session.context.currentDateContext}`,
          `YOLO mode: ${session.context.yoloMode ? "enabled" : "disabled"}`,
          "Mounted tool surface: unified flat registry",
          "Available tools:",
          toolSummary(tools)
        ].join("\n")
      }
    ]
  };
}

function createDomainInstructions(tools: AnthropicToolDefinition[]): string[] {
  const toolNames = new Set(tools.map((tool) => tool.name));
  const availableReadTools = SCHEDULE_READ_TOOL_NAMES.filter((toolName) =>
    toolNames.has(toolName)
  );
  const availableWriteTools = SCHEDULE_WRITE_TOOL_NAMES.filter((toolName) =>
    toolNames.has(toolName)
  );
  const instructions: string[] = [];

  if (availableReadTools.length > 0) {
    instructions.push(
      `If you need to inspect existing routines before writing, call ${availableReadTools.join(", ")} first.`
    );
  }

  if (availableWriteTools.length > 0) {
    instructions.push(
      `You may call ${availableWriteTools.join(", ")} directly only when the requested change is safe and conflict-free.`
    );
  }

  if (
    toolNames.has("create_routine") &&
    toolNames.has("ask_for_confirmation")
  ) {
    instructions.push(
      "If a new routine would overlap an existing one, do not call ask_for_confirmation or overwrite anything; surface the overlap as an error."
    );
  }

  if (toolNames.has("ask_for_confirmation")) {
    instructions.push(
      "Use ask_for_confirmation only for overwrite-risk edits, ambiguous delete targets, or other high-risk inference that does not create an overlapping routine."
    );
  }

  if (availableReadTools.length > 0 || availableWriteTools.length > 0) {
    instructions.unshift(
      "Routine-management tools are currently mounted as one capability pack in this runtime."
    );
    instructions.push(
      "When the user expresses times ambiguously, default the date context to the provided current_date_context when no date is named, default duration to 60 minutes when only a start time is given, and use fixed constraints before placing flexible tasks."
    );
  }

  return instructions;
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
    const messages = toAnthropicMessages(session.messages);
    const runtimeContextMessage = createRuntimeContextMessage(
      session,
      runtimeContext
    );
    const skillsContextMessage = createSkillsContextMessage(skills);
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
  return new PromptBuilder(options.systemPrompt);
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
