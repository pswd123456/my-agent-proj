import { sessionMessages } from "@ai-app-template/db";

import type {
  ConversationBlock,
  JsonValue,
  ToolResultDetails,
  UserConversationBlock
} from "../types.js";
import { toIsoString } from "./execution-lease.js";

export type SessionMessageRow = typeof sessionMessages.$inferSelect;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function toJsonRecord(value: unknown): Record<string, JsonValue> {
  const parsed = parseJsonValue(value);
  return isRecord(parsed) ? (parsed as Record<string, JsonValue>) : {};
}

function readResponseGroupId(
  metadata: Record<string, JsonValue>
): string | undefined {
  return typeof metadata.responseGroupId === "string"
    ? metadata.responseGroupId
    : undefined;
}

function readUserConversationSource(
  metadata: Record<string, JsonValue>
): UserConversationBlock["source"] | undefined {
  return metadata.source === "user" || metadata.source === "hook_message"
    ? metadata.source
    : undefined;
}

function readUserHookEvent(
  metadata: Record<string, JsonValue>
): UserConversationBlock["hookEvent"] | undefined {
  return metadata.hookEvent === "session_started" ||
    metadata.hookEvent === "run_started" ||
    metadata.hookEvent === "run_end"
    ? metadata.hookEvent
    : undefined;
}

function readUserHookTitle(
  metadata: Record<string, JsonValue>
): UserConversationBlock["hookTitle"] | undefined {
  return typeof metadata.hookTitle === "string"
    ? metadata.hookTitle
    : undefined;
}

function readToolInput(
  metadata: Record<string, JsonValue>
): Record<string, JsonValue> {
  if (isRecord(metadata.toolInput)) {
    return metadata.toolInput as Record<string, JsonValue>;
  }

  const {
    responseGroupId: _responseGroupId,
    signature: _signature,
    ...legacy
  } = metadata;
  return legacy as Record<string, JsonValue>;
}

function readToolResultDetails(
  metadata: Record<string, JsonValue>
): ToolResultDetails | undefined {
  if (!isRecord(metadata.details)) {
    return undefined;
  }

  const details = metadata.details as Record<string, unknown>;
  if (details.kind === "task_brief") {
    if (
      typeof details.path !== "string" ||
      typeof details.content !== "string" ||
      (details.operation !== "replace" && details.operation !== "edit")
    ) {
      return undefined;
    }

    const startLine =
      typeof details.startLine === "number" ? details.startLine : undefined;
    const endLine =
      typeof details.endLine === "number" ? details.endLine : undefined;

    return {
      kind: "task_brief",
      path: details.path,
      content: details.content,
      operation: details.operation,
      ...(typeof startLine === "number" ? { startLine } : {}),
      ...(typeof endLine === "number" ? { endLine } : {})
    };
  }

  if (details.kind === "shell_command") {
    if (
      details.action !== "start" &&
      details.action !== "get" &&
      details.action !== "cancel"
    ) {
      return undefined;
    }

    const command =
      typeof details.command === "string" ? details.command : undefined;
    const executionMode =
      details.executionMode === "inline" ||
      details.executionMode === "background"
        ? details.executionMode
        : undefined;
    const taskId =
      typeof details.taskId === "string" ? details.taskId : undefined;

    return {
      kind: "shell_command",
      action: details.action,
      ...(command ? { command } : {}),
      ...(executionMode ? { executionMode } : {}),
      ...(taskId ? { taskId } : {})
    };
  }

  if (
    details.kind !== "workspace_file_changes" ||
    !Array.isArray(details.files)
  ) {
    return undefined;
  }

  const files = details.files
    .filter(
      (
        file
      ): file is {
        path: string;
        action: "modify" | "create" | "delete";
        addedLineCount: number;
        removedLineCount: number;
        diff: string;
      } =>
        isRecord(file) &&
        typeof file.path === "string" &&
        (file.action === "modify" ||
          file.action === "create" ||
          file.action === "delete") &&
        typeof file.addedLineCount === "number" &&
        typeof file.removedLineCount === "number" &&
        typeof file.diff === "string"
    )
    .map((file) => ({
      path: file.path,
      action: file.action,
      addedLineCount: file.addedLineCount,
      removedLineCount: file.removedLineCount,
      diff: file.diff
    }));

  return {
    kind: "workspace_file_changes",
    files
  };
}

export function serializeBlock(block: ConversationBlock): {
  role: string;
  content: string | null;
  toolName: string | null;
  toolCallId: string | null;
  state: string | null;
  isError: boolean | null;
  inputJson: Record<string, JsonValue> | null;
  outputText: string | null;
  createdAt: string;
} {
  if (block.kind === "user") {
    return {
      role: "user",
      content: block.content,
      toolName: null,
      toolCallId: null,
      state: null,
      isError: null,
      inputJson:
        typeof block.source === "string" ||
        typeof block.hookEvent === "string" ||
        typeof block.hookTitle === "string"
          ? ({
              ...(typeof block.source === "string"
                ? { source: block.source }
                : {}),
              ...(typeof block.hookEvent === "string"
                ? { hookEvent: block.hookEvent }
                : {}),
              ...(typeof block.hookTitle === "string"
                ? { hookTitle: block.hookTitle }
                : {})
            } as Record<string, JsonValue>)
          : null,
      outputText: null,
      createdAt: block.createdAt
    };
  }

  if (block.kind === "assistant") {
    return {
      role: "assistant",
      content: block.content,
      toolName: null,
      toolCallId: null,
      state: null,
      isError: null,
      inputJson: block.responseGroupId
        ? { responseGroupId: block.responseGroupId }
        : null,
      outputText: null,
      createdAt: block.createdAt
    };
  }

  if (block.kind === "assistant thinking") {
    return {
      role: "assistant_thinking",
      content: block.content,
      toolName: null,
      toolCallId: null,
      state: null,
      isError: null,
      inputJson: {
        signature: block.signature,
        ...(block.responseGroupId
          ? { responseGroupId: block.responseGroupId }
          : {})
      },
      outputText: null,
      createdAt: block.createdAt
    };
  }

  if (block.kind === "tool call") {
    return {
      role: "tool_call",
      content: null,
      toolName: block.toolName,
      toolCallId: block.toolCallId,
      state: block.state,
      isError: null,
      inputJson: {
        toolInput: block.input,
        ...(block.responseGroupId
          ? { responseGroupId: block.responseGroupId }
          : {})
      },
      outputText: null,
      createdAt: block.createdAt
    };
  }

  return {
    role: "tool_result",
    content: null,
    toolName: block.toolName,
    toolCallId: block.toolCallId,
    state: block.state,
    isError: block.isError,
    inputJson:
      block.responseGroupId || block.details
        ? ({
            ...(block.responseGroupId
              ? { responseGroupId: block.responseGroupId }
              : {}),
            ...(block.details ? { details: block.details } : {})
          } as Record<string, JsonValue>)
        : null,
    outputText: block.output,
    createdAt: block.createdAt
  };
}

export function toConversationBlock(row: SessionMessageRow): ConversationBlock {
  const createdAt = toIsoString(row.createdAt);
  if (row.role === "user") {
    const metadata = toJsonRecord(row.inputJson);
    const source = readUserConversationSource(metadata);
    const hookEvent = readUserHookEvent(metadata);
    const hookTitle = readUserHookTitle(metadata);
    return {
      id: row.id,
      kind: "user",
      content: row.content ?? "",
      ...(typeof source === "string" ? { source } : {}),
      ...(typeof hookEvent === "string" ? { hookEvent } : {}),
      ...(typeof hookTitle === "string" ? { hookTitle } : {}),
      createdAt
    };
  }

  if (row.role === "assistant") {
    const metadata = toJsonRecord(row.inputJson);
    const responseGroupId = readResponseGroupId(metadata);
    return {
      id: row.id,
      kind: "assistant",
      content: row.content ?? "",
      ...(responseGroupId ? { responseGroupId } : {}),
      createdAt
    };
  }

  if (row.role === "assistant_thinking") {
    const metadata = toJsonRecord(row.inputJson);
    const responseGroupId = readResponseGroupId(metadata);
    return {
      id: row.id,
      kind: "assistant thinking",
      content: row.content ?? "",
      signature:
        typeof metadata.signature === "string" ? metadata.signature : "",
      ...(responseGroupId ? { responseGroupId } : {}),
      createdAt
    };
  }

  if (row.role === "tool_call") {
    const metadata = toJsonRecord(row.inputJson);
    const responseGroupId = readResponseGroupId(metadata);
    return {
      id: row.id,
      kind: "tool call",
      toolCallId: row.toolCallId ?? "",
      toolName: row.toolName ?? "",
      input: readToolInput(metadata),
      state:
        row.state === "success" || row.state === "failed"
          ? row.state
          : "pending",
      ...(responseGroupId ? { responseGroupId } : {}),
      createdAt
    } as ConversationBlock;
  }

  const metadata = toJsonRecord(row.inputJson);
  const responseGroupId = readResponseGroupId(metadata);
  const details = readToolResultDetails(metadata);
  return {
    id: row.id,
    kind: "tool result",
    toolCallId: row.toolCallId ?? "",
    toolName: row.toolName ?? "",
    output: row.outputText ?? "",
    isError: Boolean(row.isError),
    state:
      row.state === "pending" || row.state === "success" ? row.state : "failed",
    ...(details ? { details } : {}),
    ...(responseGroupId ? { responseGroupId } : {}),
    createdAt
  };
}
