import path from "node:path";

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_SESSION_MAX_TURNS,
  createPermissionRuleLists,
  normalizePendingUserQuestionPayload,
  normalizeCapabilityPacks,
  normalizeThinkingEffort,
  type BackgroundNotificationKind,
  type HookContextEntry,
  type SessionBackgroundNotification,
  type ScheduleSessionContext,
  type ThinkingEffort
} from "@ai-app-template/domain";

import type {
  ConversationBlock,
  CreateSessionInput,
  LoopState,
  SessionForkCheckpoint,
  SessionParentRelationKind,
  SessionSnapshot,
  SessionState,
  ToolResultDetails,
  UserConversationBlock
} from "../types.js";
import { resolveTaskBriefPathForSession } from "./task-brief.js";
import { normalizeTodoState } from "./todo-state.js";

type CreateSnapshotInput = {
  sessionId: string;
  cronJobId?: string | null;
  parentSessionId?: string | null;
  parentRelationKind?: SessionParentRelationKind | null;
  forkReplayCheckpointId?: string | null;
  workingDirectory: string;
  model: string;
  yoloMode?: boolean;
  planModeEnabled?: boolean;
  thinkingEffort?: ThinkingEffort;
  taskBriefPath?: string | null;
  firstUserMessage?: string | null;
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
};

function pickScheduleSessionContextInput(
  input: Pick<
    CreateSnapshotInput,
    | "yoloMode"
    | "planModeEnabled"
    | "thinkingEffort"
    | "taskBriefPath"
    | "firstUserMessage"
    | "lastUserMessage"
    | "workspaceEscapeAllowed"
    | "shellAllowPatterns"
    | "shellDenyPatterns"
    | "toolAllowList"
    | "toolAskList"
    | "toolDenyList"
    | "enabledCapabilityPacks"
  >
) {
  return {
    ...(typeof input.yoloMode === "boolean"
      ? { yoloMode: input.yoloMode }
      : {}),
    ...(typeof input.planModeEnabled === "boolean"
      ? { planModeEnabled: input.planModeEnabled }
      : {}),
    ...(input.thinkingEffort ? { thinkingEffort: input.thinkingEffort } : {}),
    ...(typeof input.taskBriefPath === "string" || input.taskBriefPath === null
      ? { taskBriefPath: input.taskBriefPath }
      : {}),
    ...(typeof input.firstUserMessage === "string" ||
    input.firstUserMessage === null
      ? { firstUserMessage: input.firstUserMessage }
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
}

export function buildCreateSnapshotOverridesFromSessionInput(
  input: CreateSessionInput
): Omit<
  Partial<CreateSnapshotInput>,
  "sessionId" | "workingDirectory" | "model"
> {
  return {
    ...(typeof input.cronJobId === "string" || input.cronJobId === null
      ? { cronJobId: input.cronJobId }
      : {}),
    ...(typeof input.parentSessionId === "string" ||
    input.parentSessionId === null
      ? { parentSessionId: input.parentSessionId }
      : {}),
    ...(input.parentRelationKind === "fork" ||
    input.parentRelationKind === "subagent" ||
    input.parentRelationKind === "hook_subagent" ||
    input.parentRelationKind === null
      ? { parentRelationKind: input.parentRelationKind }
      : {}),
    ...(typeof input.forkReplayCheckpointId === "string" ||
    input.forkReplayCheckpointId === null
      ? { forkReplayCheckpointId: input.forkReplayCheckpointId }
      : {}),
    ...(typeof input.contextWindow === "number"
      ? { contextWindow: input.contextWindow }
      : {}),
    ...(typeof input.maxTurns === "number" ? { maxTurns: input.maxTurns } : {}),
    ...pickScheduleSessionContextInput(input)
  };
}

function normalizeBackgroundNotificationKind(
  kind: string | undefined
): BackgroundNotificationKind {
  switch (kind) {
    case "delegate_completed":
      return "task_completed";
    case "delegate_needs_main_agent":
      return "task_waiting";
    case "delegate_failed":
      return "task_failed";
    case "delegate_cancelled":
      return "task_cancelled";
    case "delegate_timeout":
      return "task_timeout";
    case "task_completed":
    case "task_waiting":
    case "task_failed":
    case "task_cancelled":
    case "task_timeout":
      return kind;
    default:
      return "task_completed";
  }
}

function normalizeBackgroundNotification(
  value: SessionBackgroundNotification
): SessionBackgroundNotification {
  return {
    ...value,
    kind: normalizeBackgroundNotificationKind(value.kind),
    taskKind: value.taskKind ?? "subagent",
    expectedParentReply: value.expectedParentReply ?? "none",
    result: value.result ?? null
  };
}

function normalizeHookContextEntry(value: HookContextEntry): HookContextEntry {
  return {
    ...value,
    waitMode: value.waitMode === "unblocking" ? value.waitMode : "blocking"
  };
}

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

export function createSnapshot(input: CreateSnapshotInput): SessionSnapshot {
  const contextInput = pickScheduleSessionContextInput(input);
  return {
    sessionId: input.sessionId,
    cronJobId: input.cronJobId ?? null,
    parentSessionId: input.parentSessionId ?? null,
    parentRelationKind: input.parentRelationKind ?? null,
    forkReplayCheckpointId: input.forkReplayCheckpointId ?? null,
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
        ...(typeof contextInput.firstUserMessage === "string" ||
        contextInput.firstUserMessage === null
          ? { firstUserMessage: contextInput.firstUserMessage }
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
    cronJobId: typeof cloned.cronJobId === "string" ? cloned.cronJobId : null,
    parentSessionId: cloned.parentSessionId ?? null,
    parentRelationKind: isSessionParentRelationKind(cloned.parentRelationKind)
      ? cloned.parentRelationKind
      : null,
    forkReplayCheckpointId: cloned.forkReplayCheckpointId ?? null,
    context: {
      ...cloned.context,
      yoloMode: cloned.context.yoloMode ?? false,
      planModeEnabled: cloned.context.planModeEnabled ?? false,
      thinkingEffort: normalizeThinkingEffort(cloned.context.thinkingEffort),
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
      activeBackgroundTaskCount: Math.max(
        0,
        Math.floor(cloned.context.activeBackgroundTaskCount ?? 0)
      ),
      pendingUserQuestionPayload: normalizePendingUserQuestionPayload(
        cloned.context.pendingUserQuestionPayload
      ),
      pendingBackgroundNotifications: Array.isArray(
        cloned.context.pendingBackgroundNotifications
      )
        ? cloned.context.pendingBackgroundNotifications.map((notification) =>
            normalizeBackgroundNotification(
              structuredClone(notification) as SessionBackgroundNotification
            )
          )
        : [],
      hookContextEntries: Array.isArray(cloned.context.hookContextEntries)
        ? cloned.context.hookContextEntries.map((entry) =>
            normalizeHookContextEntry(
              structuredClone(entry) as HookContextEntry
            )
          )
        : [],
      todoState: normalizeTodoState(cloned.context.todoState),
      fullCompactionState: cloned.context.fullCompactionState ?? null,
      pendingConflictSummary: cloned.context.pendingConflictSummary ?? null,
      firstUserMessage: cloned.context.firstUserMessage ?? null,
      lastUserMessage: cloned.context.lastUserMessage ?? null
    },
    sessionState: {
      ...cloned.sessionState,
      interruptRequested: cloned.sessionState.interruptRequested ?? false,
      historyCompactionsSinceFullCompaction:
        cloned.sessionState.historyCompactionsSinceFullCompaction ?? 0
    }
  };
}

export function cloneForkCheckpoint(
  checkpoint: SessionForkCheckpoint
): SessionForkCheckpoint {
  return {
    ...structuredClone(checkpoint),
    responseGroupId: checkpoint.responseGroupId ?? null,
    snapshot: cloneSnapshot(checkpoint.snapshot),
    promptSeed: structuredClone(checkpoint.promptSeed)
  };
}

export function forceStopSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  return cloneSnapshot({
    ...snapshot,
    context: {
      ...snapshot.context,
      status: "waiting_for_user_input",
      pendingPermissionRequest: null,
      pendingConfirmationPayload: null,
      pendingUserQuestionPayload: null,
      pendingConflictSummary: null
    },
    sessionState: {
      ...snapshot.sessionState,
      loopState: "interrupted",
      lastError: null,
      pendingToolCallIds: [],
      interruptRequested: false
    }
  });
}

function resolveCurrentDateContext(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createScheduleSessionContext(
  input: {
    yoloMode?: boolean;
    planModeEnabled?: boolean;
    thinkingEffort?: ThinkingEffort;
    taskBriefPath?: string | null;
    firstUserMessage?: string | null;
    lastUserMessage?: string | null;
    workspaceEscapeAllowed?: boolean;
    shellAllowPatterns?: string[];
    shellDenyPatterns?: string[];
    toolAllowList?: string[];
    toolAskList?: string[];
    toolDenyList?: string[];
    enabledCapabilityPacks?: string[];
    activeBackgroundTaskCount?: number;
    pendingBackgroundNotifications?: SessionBackgroundNotification[];
    hookContextEntries?: HookContextEntry[];
  } = {}
): ScheduleSessionContext {
  const permissionRules = createPermissionRuleLists();
  return {
    status: "waiting_for_user_input",
    currentDateContext: resolveCurrentDateContext(),
    yoloMode: input.yoloMode ?? false,
    planModeEnabled: input.planModeEnabled ?? false,
    thinkingEffort: normalizeThinkingEffort(input.thinkingEffort),
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
    activeBackgroundTaskCount: Math.max(
      0,
      Math.floor(input.activeBackgroundTaskCount ?? 0)
    ),
    pendingPermissionRequest: null,
    pendingConfirmationPayload: null,
    pendingUserQuestionPayload: null,
    pendingBackgroundNotifications: structuredClone(
      (input.pendingBackgroundNotifications ?? []).map((notification) =>
        normalizeBackgroundNotification(notification)
      )
    ),
    hookContextEntries: structuredClone(
      (input.hookContextEntries ?? []).map((entry) =>
        normalizeHookContextEntry(entry)
      )
    ),
    todoState: null,
    fullCompactionState: null,
    pendingConflictSummary: null,
    firstUserMessage: input.firstUserMessage ?? null,
    lastUserMessage: input.lastUserMessage ?? null
  };
}

export function isHookMessageBlock(
  block: ConversationBlock
): block is UserConversationBlock {
  return block.kind === "user" && block.source === "hook_message";
}

export function isUserInputMessageBlock(
  block: ConversationBlock
): block is UserConversationBlock {
  return block.kind === "user" && block.source !== "hook_message";
}

export function getUserInputMessageBounds(messages: ConversationBlock[]): {
  firstUserMessage: string | null;
  lastUserMessage: string | null;
} {
  let firstUserMessage: string | null = null;
  let lastUserMessage: string | null = null;

  for (const block of messages) {
    if (!isUserInputMessageBlock(block)) {
      continue;
    }

    if (firstUserMessage === null) {
      firstUserMessage = block.content;
    }
    lastUserMessage = block.content;
  }

  return {
    firstUserMessage,
    lastUserMessage
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSessionParentRelationKind(
  value: unknown
): value is SessionParentRelationKind {
  return value === "fork" || value === "subagent" || value === "hook_subagent";
}

function isToolResultDetails(value: unknown): value is ToolResultDetails {
  if (!isPlainRecord(value) || typeof value.kind !== "string") {
    return false;
  }

  if (value.kind === "workspace_file_changes") {
    return (
      Array.isArray(value.files) &&
      value.files.every(
        (file) =>
          isPlainRecord(file) &&
          typeof file.path === "string" &&
          (file.action === "modify" ||
            file.action === "create" ||
            file.action === "delete") &&
          typeof file.addedLineCount === "number" &&
          typeof file.removedLineCount === "number" &&
          typeof file.diff === "string"
      )
    );
  }

  if (value.kind === "task_brief") {
    return (
      typeof value.path === "string" &&
      typeof value.content === "string" &&
      (value.operation === "replace" || value.operation === "edit") &&
      (typeof value.startLine === "number" ||
        typeof value.startLine === "undefined") &&
      (typeof value.endLine === "number" ||
        typeof value.endLine === "undefined")
    );
  }

  return false;
}

export function isConversationBlock(
  value: unknown
): value is ConversationBlock {
  if (!isPlainRecord(value) || typeof value.kind !== "string") {
    return false;
  }

  if (value.kind === "user") {
    return (
      typeof value.id === "string" &&
      typeof value.content === "string" &&
      (value.source === "user" ||
        value.source === "hook_message" ||
        typeof value.source === "undefined") &&
      (typeof value.hookEvent === "string" ||
        typeof value.hookEvent === "undefined") &&
      (typeof value.hookTitle === "string" ||
        typeof value.hookTitle === "undefined")
    );
  }

  if (value.kind === "assistant") {
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
      (typeof value.details === "undefined" ||
        isToolResultDetails(value.details)) &&
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
    (typeof value.cronJobId === "string" ||
      value.cronJobId === null ||
      typeof value.cronJobId === "undefined") &&
    (typeof value.parentSessionId === "string" ||
      value.parentSessionId === null ||
      typeof value.parentSessionId === "undefined") &&
    (isSessionParentRelationKind(value.parentRelationKind) ||
      value.parentRelationKind === null ||
      typeof value.parentRelationKind === "undefined") &&
    (typeof value.forkReplayCheckpointId === "string" ||
      value.forkReplayCheckpointId === null ||
      typeof value.forkReplayCheckpointId === "undefined") &&
    typeof value.workingDirectory === "string" &&
    typeof value.model === "string" &&
    typeof value.contextWindow === "number" &&
    typeof value.maxTurns === "number" &&
    isPlainRecord(value.context) &&
    typeof value.context.status === "string" &&
    typeof value.context.currentDateContext === "string" &&
    (typeof value.context.yoloMode === "boolean" ||
      typeof value.context.yoloMode === "undefined") &&
    (typeof value.context.planModeEnabled === "boolean" ||
      typeof value.context.planModeEnabled === "undefined") &&
    (value.context.thinkingEffort === "high" ||
      value.context.thinkingEffort === "max" ||
      typeof value.context.thinkingEffort === "undefined") &&
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
    (typeof value.context.activeBackgroundTaskCount === "undefined" ||
      typeof value.context.activeBackgroundTaskCount === "number") &&
    (typeof value.context.pendingBackgroundNotifications === "undefined" ||
      Array.isArray(value.context.pendingBackgroundNotifications)) &&
    (typeof value.context.hookContextEntries === "undefined" ||
      Array.isArray(value.context.hookContextEntries)) &&
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
    (typeof value.context.firstUserMessage === "string" ||
      value.context.firstUserMessage === null ||
      typeof value.context.firstUserMessage === "undefined") &&
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
