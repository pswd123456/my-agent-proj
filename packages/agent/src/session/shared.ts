import path from "node:path";

import type { ScheduleSessionContext } from "@ai-app-template/domain";

import type { ConversationBlock, LoopState, SessionSnapshot, SessionState } from "../types.js";

export function createSessionState(
  loopState: LoopState = "waiting for input"
): SessionState {
  return {
    loopState,
    turnCount: 0,
    lastError: null,
    pendingToolCallIds: []
  };
}

export function createSnapshot(input: {
  sessionId: string;
  workingDirectory: string;
  model: string;
  userId?: string;
}): SessionSnapshot {
  return {
    sessionId: input.sessionId,
    workingDirectory: input.workingDirectory,
    model: input.model,
    context: createScheduleSessionContext(input.userId),
    messages: [],
    sessionState: createSessionState(),
    inputTokensCount: 0,
    promptCacheKey: "",
    updatedAt: new Date().toISOString()
  };
}

export function cloneSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  return structuredClone(snapshot);
}

function resolveCurrentDateContext(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createScheduleSessionContext(userId = "cli-user"): ScheduleSessionContext {
  return {
    userId,
    status: "waiting_for_user_input",
    currentDateContext: resolveCurrentDateContext(),
    pendingPermissionRequest: null,
    pendingConfirmationPayload: null,
    pendingConflictSummary: null,
    lastUserMessage: null
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isConversationBlock(value: unknown): value is ConversationBlock {
  if (!isPlainRecord(value) || typeof value.kind !== "string") {
    return false;
  }

  if (value.kind === "user" || value.kind === "assistant") {
    return typeof value.id === "string" && typeof value.content === "string";
  }

  if (value.kind === "tool call") {
    return (
      typeof value.id === "string" &&
      typeof value.toolCallId === "string" &&
      typeof value.toolName === "string" &&
      isPlainRecord(value.input) &&
      typeof value.state === "string"
    );
  }

  if (value.kind === "tool result") {
    return (
      typeof value.id === "string" &&
      typeof value.toolCallId === "string" &&
      typeof value.toolName === "string" &&
      typeof value.output === "string" &&
      typeof value.isError === "boolean" &&
      typeof value.state === "string"
    );
  }

  return false;
}

export function isSessionSnapshot(value: unknown): value is SessionSnapshot {
  if (!isPlainRecord(value)) {
    return false;
  }

  return (
    typeof value.sessionId === "string" &&
    typeof value.workingDirectory === "string" &&
    typeof value.model === "string" &&
    isPlainRecord(value.context) &&
    typeof value.context.userId === "string" &&
    typeof value.context.status === "string" &&
    typeof value.context.currentDateContext === "string" &&
    Object.prototype.hasOwnProperty.call(value.context, "pendingPermissionRequest") &&
    Object.prototype.hasOwnProperty.call(value.context, "pendingConfirmationPayload") &&
    Object.prototype.hasOwnProperty.call(value.context, "pendingConflictSummary") &&
    Object.prototype.hasOwnProperty.call(value.context, "lastUserMessage") &&
    Array.isArray(value.messages) &&
    value.messages.every(isConversationBlock) &&
    isPlainRecord(value.sessionState) &&
    typeof value.sessionState.loopState === "string" &&
    typeof value.sessionState.turnCount === "number" &&
    typeof value.sessionState.lastError !== "undefined" &&
    Array.isArray(value.sessionState.pendingToolCallIds) &&
    typeof value.inputTokensCount === "number" &&
    typeof value.promptCacheKey === "string" &&
    typeof value.updatedAt === "string"
  );
}

export function resolveWorkingDirectory(
  workingDirectory: string | undefined
): string {
  return path.resolve(workingDirectory ?? process.cwd());
}

export function resolveSessionStateDirectory(
  workspaceRoot: string,
  scope = "agent-sessions"
): string {
  return path.join(path.resolve(workspaceRoot), "tmp", scope);
}
