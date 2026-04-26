import path from "node:path";

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_SESSION_MAX_TURNS,
  createPermissionRuleLists,
  normalizeCapabilityPacks,
  type ScheduleSessionContext
} from "@ai-app-template/domain";

import type {
  ConversationBlock,
  LoopState,
  SessionSnapshot,
  SessionState
} from "../types.js";
import { resolveTaskBriefPathForSession } from "./task-brief.js";
import { normalizeTodoState } from "./todo-state.js";

export function createSessionState(
  loopState: LoopState = "waiting for input"
): SessionState {
  return {
    loopState,
    turnCount: 0,
    lastError: null,
    pendingToolCallIds: [],
    interruptRequested: false,
    historyCompactionsSinceFullCompaction: 0
  };
}

export function createSnapshot(input: {
  sessionId: string;
  workingDirectory: string;
  model: string;
  userId?: string;
  yoloMode?: boolean;
  planModeEnabled?: boolean;
  taskBriefPath?: string | null;
  lastUserMessage?: string | null;
  workspaceEscapeAllowed?: boolean;
  contextWindow?: number;
  maxTurns?: number;
  shellAllowPatterns?: string[];
  shellDenyPatterns?: string[];
  toolAllowList?: string[];
  toolAskList?: string[];
  toolDenyList?: string[];
  enabledCapabilityPacks?: string[];
}): SessionSnapshot {
  const contextInput = {
    ...(typeof input.userId === "string" ? { userId: input.userId } : {}),
    ...(typeof input.yoloMode === "boolean"
      ? { yoloMode: input.yoloMode }
      : {}),
    ...(typeof input.planModeEnabled === "boolean"
      ? { planModeEnabled: input.planModeEnabled }
      : {}),
    ...(typeof input.taskBriefPath === "string" || input.taskBriefPath === null
      ? { taskBriefPath: input.taskBriefPath }
      : {}),
    ...(typeof input.lastUserMessage === "string" ||
    input.lastUserMessage === null
      ? { lastUserMessage: input.lastUserMessage }
      : {}),
    ...(typeof input.workspaceEscapeAllowed === "boolean"
      ? { workspaceEscapeAllowed: input.workspaceEscapeAllowed }
      : {}),
    ...(Array.isArray(input.shellAllowPatterns)
      ? { shellAllowPatterns: input.shellAllowPatterns }
      : {}),
    ...(Array.isArray(input.shellDenyPatterns)
      ? { shellDenyPatterns: input.shellDenyPatterns }
      : {}),
    ...(Array.isArray(input.toolAllowList)
      ? { toolAllowList: input.toolAllowList }
      : {}),
    ...(Array.isArray(input.toolAskList)
      ? { toolAskList: input.toolAskList }
      : {}),
    ...(Array.isArray(input.toolDenyList)
      ? { toolDenyList: input.toolDenyList }
      : {}),
    ...(Array.isArray(input.enabledCapabilityPacks)
      ? { enabledCapabilityPacks: input.enabledCapabilityPacks }
      : {})
  };
  return {
    sessionId: input.sessionId,
    workingDirectory: input.workingDirectory,
    model: input.model,
    contextWindow: input.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTurns: input.maxTurns ?? DEFAULT_SESSION_MAX_TURNS,
    context: {
      ...createScheduleSessionContext(contextInput),
      taskBriefPath: resolveTaskBriefPathForSession({
        workingDirectory: input.workingDirectory,
        sessionId: input.sessionId,
        ...(typeof contextInput.planModeEnabled === "boolean"
          ? { planModeEnabled: contextInput.planModeEnabled }
          : {}),
        ...(typeof contextInput.taskBriefPath === "string" ||
        contextInput.taskBriefPath === null
          ? { taskBriefPath: contextInput.taskBriefPath }
          : {}),
        ...(typeof contextInput.lastUserMessage === "string" ||
        contextInput.lastUserMessage === null
          ? { lastUserMessage: contextInput.lastUserMessage }
          : {})
      })
    },
    messages: [],
    sessionState: createSessionState(),
    inputTokensCount: 0,
    promptCacheKey: "",
    updatedAt: new Date().toISOString()
  };
}

export function cloneSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  const cloned = structuredClone(snapshot) as SessionSnapshot;
  const permissionRules = cloned.context ?? createScheduleSessionContext();
  return {
    ...cloned,
    context: {
      ...cloned.context,
      yoloMode: cloned.context.yoloMode ?? false,
      planModeEnabled: cloned.context.planModeEnabled ?? false,
      taskBriefPath: resolveTaskBriefPathForSession({
        workingDirectory: cloned.workingDirectory,
        sessionId: cloned.sessionId,
        planModeEnabled: cloned.context.planModeEnabled ?? false,
        taskBriefPath: cloned.context.taskBriefPath ?? null
      }),
      workspaceEscapeAllowed: cloned.context.workspaceEscapeAllowed ?? false,
      shellAllowPatterns: permissionRules.shellAllowPatterns ?? [],
      shellDenyPatterns: permissionRules.shellDenyPatterns ?? [],
      toolAllowList: permissionRules.toolAllowList ?? [],
      toolAskList: permissionRules.toolAskList ?? [],
      toolDenyList: permissionRules.toolDenyList ?? [],
      enabledCapabilityPacks: normalizeCapabilityPacks(
        cloned.context.enabledCapabilityPacks
      ),
      pendingUserQuestionPayload:
        cloned.context.pendingUserQuestionPayload ?? null,
      todoState: normalizeTodoState(cloned.context.todoState),
      fullCompactionState: cloned.context.fullCompactionState ?? null
    },
    sessionState: {
      ...cloned.sessionState,
      interruptRequested: cloned.sessionState.interruptRequested ?? false,
      historyCompactionsSinceFullCompaction:
        cloned.sessionState.historyCompactionsSinceFullCompaction ?? 0
    }
  };
}

function resolveCurrentDateContext(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createScheduleSessionContext(
  input: {
    userId?: string;
    yoloMode?: boolean;
    planModeEnabled?: boolean;
    taskBriefPath?: string | null;
    lastUserMessage?: string | null;
    workspaceEscapeAllowed?: boolean;
    shellAllowPatterns?: string[];
    shellDenyPatterns?: string[];
    toolAllowList?: string[];
    toolAskList?: string[];
    toolDenyList?: string[];
    enabledCapabilityPacks?: string[];
  } = {}
): ScheduleSessionContext {
  const permissionRules = createPermissionRuleLists();
  return {
    userId: input.userId ?? "cli-user",
    status: "waiting_for_user_input",
    currentDateContext: resolveCurrentDateContext(),
    yoloMode: input.yoloMode ?? false,
    planModeEnabled: input.planModeEnabled ?? false,
    taskBriefPath: input.taskBriefPath ?? null,
    workspaceEscapeAllowed: input.workspaceEscapeAllowed ?? false,
    shellAllowPatterns:
      input.shellAllowPatterns ?? permissionRules.shellAllowPatterns,
    shellDenyPatterns:
      input.shellDenyPatterns ?? permissionRules.shellDenyPatterns,
    toolAllowList: input.toolAllowList ?? permissionRules.toolAllowList,
    toolAskList: input.toolAskList ?? permissionRules.toolAskList,
    toolDenyList: input.toolDenyList ?? permissionRules.toolDenyList,
    enabledCapabilityPacks: normalizeCapabilityPacks(
      input.enabledCapabilityPacks
    ),
    pendingPermissionRequest: null,
    pendingConfirmationPayload: null,
    pendingUserQuestionPayload: null,
    todoState: null,
    fullCompactionState: null,
    pendingConflictSummary: null,
    lastUserMessage: input.lastUserMessage ?? null
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isConversationBlock(
  value: unknown
): value is ConversationBlock {
  if (!isPlainRecord(value) || typeof value.kind !== "string") {
    return false;
  }

  if (value.kind === "user" || value.kind === "assistant") {
    return (
      typeof value.id === "string" &&
      typeof value.content === "string" &&
      (typeof value.responseGroupId === "string" ||
        typeof value.responseGroupId === "undefined")
    );
  }

  if (value.kind === "assistant thinking") {
    return (
      typeof value.id === "string" &&
      typeof value.content === "string" &&
      typeof value.signature === "string" &&
      (typeof value.responseGroupId === "string" ||
        typeof value.responseGroupId === "undefined")
    );
  }

  if (value.kind === "tool call") {
    return (
      typeof value.id === "string" &&
      typeof value.toolCallId === "string" &&
      typeof value.toolName === "string" &&
      isPlainRecord(value.input) &&
      typeof value.state === "string" &&
      (typeof value.responseGroupId === "string" ||
        typeof value.responseGroupId === "undefined")
    );
  }

  if (value.kind === "tool result") {
    return (
      typeof value.id === "string" &&
      typeof value.toolCallId === "string" &&
      typeof value.toolName === "string" &&
      typeof value.output === "string" &&
      typeof value.isError === "boolean" &&
      typeof value.state === "string" &&
      (typeof value.responseGroupId === "string" ||
        typeof value.responseGroupId === "undefined")
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
    typeof value.contextWindow === "number" &&
    typeof value.maxTurns === "number" &&
    isPlainRecord(value.context) &&
    typeof value.context.userId === "string" &&
    typeof value.context.status === "string" &&
    typeof value.context.currentDateContext === "string" &&
    (typeof value.context.yoloMode === "boolean" ||
      typeof value.context.yoloMode === "undefined") &&
    (typeof value.context.planModeEnabled === "boolean" ||
      typeof value.context.planModeEnabled === "undefined") &&
    (typeof value.context.taskBriefPath === "string" ||
      value.context.taskBriefPath === null ||
      typeof value.context.taskBriefPath === "undefined") &&
    (typeof value.context.workspaceEscapeAllowed === "boolean" ||
      typeof value.context.workspaceEscapeAllowed === "undefined") &&
    (typeof value.context.shellAllowPatterns === "undefined" ||
      Array.isArray(value.context.shellAllowPatterns)) &&
    (typeof value.context.shellDenyPatterns === "undefined" ||
      Array.isArray(value.context.shellDenyPatterns)) &&
    (typeof value.context.toolAllowList === "undefined" ||
      Array.isArray(value.context.toolAllowList)) &&
    (typeof value.context.toolAskList === "undefined" ||
      Array.isArray(value.context.toolAskList)) &&
    (typeof value.context.toolDenyList === "undefined" ||
      Array.isArray(value.context.toolDenyList)) &&
    (typeof value.context.enabledCapabilityPacks === "undefined" ||
      Array.isArray(value.context.enabledCapabilityPacks)) &&
    (typeof value.context.todoState === "undefined" ||
      value.context.todoState === null ||
      (isPlainRecord(value.context.todoState) &&
        Array.isArray(value.context.todoState.items) &&
        (typeof value.context.todoState.activeItemId === "string" ||
          value.context.todoState.activeItemId === null) &&
        (typeof value.context.todoState.lastUpdatedAt === "string" ||
          value.context.todoState.lastUpdatedAt === null))) &&
    (typeof value.context.fullCompactionState === "undefined" ||
      value.context.fullCompactionState === null ||
      (isPlainRecord(value.context.fullCompactionState) &&
        typeof value.context.fullCompactionState.summaryMarkdown === "string" &&
        typeof value.context.fullCompactionState.compactedAt === "string" &&
        typeof value.context.fullCompactionState.promptVersion === "string" &&
        typeof value.context.fullCompactionState.sourceBlockCount ===
          "number" &&
        typeof value.context.fullCompactionState.retainedTailCount ===
          "number")) &&
    Object.prototype.hasOwnProperty.call(
      value.context,
      "pendingPermissionRequest"
    ) &&
    Object.prototype.hasOwnProperty.call(
      value.context,
      "pendingConfirmationPayload"
    ) &&
    Object.prototype.hasOwnProperty.call(
      value.context,
      "pendingConflictSummary"
    ) &&
    Object.prototype.hasOwnProperty.call(value.context, "lastUserMessage") &&
    Array.isArray(value.messages) &&
    value.messages.every(isConversationBlock) &&
    isPlainRecord(value.sessionState) &&
    typeof value.sessionState.loopState === "string" &&
    typeof value.sessionState.turnCount === "number" &&
    typeof value.sessionState.lastError !== "undefined" &&
    Array.isArray(value.sessionState.pendingToolCallIds) &&
    (typeof value.sessionState.interruptRequested === "boolean" ||
      typeof value.sessionState.interruptRequested === "undefined") &&
    (typeof value.sessionState.historyCompactionsSinceFullCompaction ===
      "number" ||
      typeof value.sessionState.historyCompactionsSinceFullCompaction ===
        "undefined") &&
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
