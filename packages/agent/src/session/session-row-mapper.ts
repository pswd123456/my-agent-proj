import { randomUUID } from "node:crypto";

import {
  DEFAULT_SESSION_MODEL,
  normalizeCapabilityPacks,
  normalizePendingUserQuestionPayload,
  normalizeThinkingEffort,
  type PendingConfirmationPayload,
  type PendingPermissionRequest,
  type SessionBackgroundNotification,
  type SessionFullCompactionState,
  type SessionTodoState,
  type ScheduleSessionContext
} from "@ai-app-template/domain";
import type { ProductDatabaseClient } from "@ai-app-template/db";
import {
  agentSessions,
  sessionForkCheckpoints,
  sessionMessages
} from "@ai-app-template/db";

import type {
  ConversationBlock,
  CreateSessionInput,
  LoopState,
  SessionForkCheckpoint,
  SessionSnapshot
} from "../types.js";
import {
  buildCreateSnapshotOverridesFromSessionInput,
  createSnapshot,
  isSessionSnapshot,
  resolveWorkingDirectory
} from "./shared.js";
import {
  serializeBlock,
  toConversationBlock,
  type SessionMessageRow
} from "./message-codec.js";
import { toIsoString } from "./execution-lease.js";
import { resolveTaskBriefPathForSession } from "./task-brief.js";
import { normalizeTodoState } from "./todo-state.js";

type SessionRow = typeof agentSessions.$inferSelect;
type SessionForkCheckpointRow = typeof sessionForkCheckpoints.$inferSelect;

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

function toStringArray(value: unknown): string[] {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((item): item is string => typeof item === "string");
}

export function createSessionSnapshot(
  input: CreateSessionInput = {}
): SessionSnapshot {
  return createSnapshot({
    sessionId: randomUUID(),
    workingDirectory: resolveWorkingDirectory(input.workingDirectory),
    model: input.model ?? DEFAULT_SESSION_MODEL,
    ...buildCreateSnapshotOverridesFromSessionInput(input)
  });
}

export function toSessionContext(row: SessionRow): ScheduleSessionContext {
  const pendingPermissionRequest = parseJsonValue(row.pendingPermissionRequest);
  const pendingConfirmationPayload = parseJsonValue(
    row.pendingConfirmationPayload
  );
  const pendingUserQuestionPayload = parseJsonValue(
    row.pendingUserQuestionPayload
  );
  const pendingBackgroundNotifications = parseJsonValue(
    row.pendingBackgroundNotifications
  );
  const hookContextEntries = parseJsonValue(row.hookContextEntries);
  const todoState = normalizeTodoState(
    parseJsonValue(row.todoState) as SessionTodoState | null | undefined
  );
  const fullCompactionState = parseJsonValue(row.fullCompactionState);

  return {
    status: row.status as ScheduleSessionContext["status"],
    currentDateContext: row.currentDateContext,
    yoloMode: row.yoloMode ?? false,
    planModeEnabled: row.planModeEnabled ?? false,
    thinkingEffort: normalizeThinkingEffort(row.thinkingEffort),
    taskBriefPath: resolveTaskBriefPathForSession({
      workingDirectory: row.workingDirectory,
      sessionId: row.id,
      planModeEnabled: row.planModeEnabled ?? false,
      taskBriefPath: row.taskBriefPath
    }),
    workspaceEscapeAllowed: row.workspaceEscapeAllowed ?? false,
    shellAllowPatterns: toStringArray(row.shellAllowPatterns),
    shellDenyPatterns: toStringArray(row.shellDenyPatterns),
    toolAllowList: toStringArray(row.toolAllowList),
    toolAskList: toStringArray(row.toolAskList),
    toolDenyList: toStringArray(row.toolDenyList),
    enabledCapabilityPacks: normalizeCapabilityPacks(
      toStringArray(row.enabledCapabilityPacks)
    ),
    activeBackgroundTaskCount: Math.max(0, row.activeBackgroundTaskCount ?? 0),
    pendingPermissionRequest: isRecord(pendingPermissionRequest)
      ? (pendingPermissionRequest as unknown as PendingPermissionRequest)
      : null,
    pendingConfirmationPayload: isRecord(pendingConfirmationPayload)
      ? (pendingConfirmationPayload as unknown as PendingConfirmationPayload)
      : null,
    pendingUserQuestionPayload: isRecord(pendingUserQuestionPayload)
      ? normalizePendingUserQuestionPayload(pendingUserQuestionPayload)
      : null,
    pendingBackgroundNotifications: Array.isArray(
      pendingBackgroundNotifications
    )
      ? (pendingBackgroundNotifications as SessionBackgroundNotification[])
      : [],
    hookContextEntries: Array.isArray(hookContextEntries)
      ? (hookContextEntries as ScheduleSessionContext["hookContextEntries"])
      : [],
    todoState,
    fullCompactionState: isRecord(fullCompactionState)
      ? (fullCompactionState as unknown as SessionFullCompactionState)
      : null,
    pendingConflictSummary: row.pendingConflictSummary,
    firstUserMessage: row.firstUserMessage,
    lastUserMessage: row.lastUserMessage
  };
}

export function toSessionSnapshot(
  row: SessionRow,
  messageRows: SessionMessageRow[]
): SessionSnapshot {
  return {
    sessionId: row.id,
    cronJobId: row.cronJobId,
    parentSessionId: row.parentSessionId,
    parentRelationKind:
      row.parentRelationKind === "fork" ||
      row.parentRelationKind === "subagent" ||
      row.parentRelationKind === "hook_subagent"
        ? row.parentRelationKind
        : null,
    forkReplayCheckpointId: row.forkReplayCheckpointId,
    workingDirectory: row.workingDirectory,
    model: row.model,
    contextWindow: row.contextWindow,
    maxTurns: row.maxTurns,
    context: toSessionContext(row),
    messages: messageRows.map(toConversationBlock),
    sessionState: {
      loopState: row.loopState as LoopState,
      turnCount: row.turnCount,
      lastError: row.lastError,
      pendingToolCallIds: toStringArray(row.pendingToolCallIds),
      interruptRequested: row.interruptRequested,
      historyCompactionsSinceFullCompaction:
        row.historyCompactionsSinceFullCompaction ?? 0
    },
    inputTokensCount: row.inputTokensCount,
    promptCacheKey: row.promptCacheKey,
    updatedAt: toIsoString(row.updatedAt)
  };
}

export function buildSessionPersistenceValues(
  snapshot: SessionSnapshot
): typeof agentSessions.$inferInsert {
  return {
    id: snapshot.sessionId,
    status: snapshot.context.status,
    currentDateContext: snapshot.context.currentDateContext,
    yoloMode: snapshot.context.yoloMode,
    planModeEnabled: snapshot.context.planModeEnabled,
    thinkingEffort: snapshot.context.thinkingEffort,
    taskBriefPath: snapshot.context.taskBriefPath,
    workspaceEscapeAllowed: snapshot.context.workspaceEscapeAllowed,
    contextWindow: snapshot.contextWindow,
    maxTurns: snapshot.maxTurns,
    shellAllowPatterns: snapshot.context.shellAllowPatterns,
    shellDenyPatterns: snapshot.context.shellDenyPatterns,
    toolAllowList: snapshot.context.toolAllowList,
    toolAskList: snapshot.context.toolAskList,
    toolDenyList: snapshot.context.toolDenyList,
    enabledCapabilityPacks: snapshot.context.enabledCapabilityPacks,
    activeBackgroundTaskCount: snapshot.context.activeBackgroundTaskCount,
    pendingPermissionRequest: snapshot.context.pendingPermissionRequest,
    pendingConfirmationPayload: snapshot.context.pendingConfirmationPayload,
    pendingUserQuestionPayload: snapshot.context.pendingUserQuestionPayload,
    pendingBackgroundNotifications:
      snapshot.context.pendingBackgroundNotifications,
    hookContextEntries: snapshot.context.hookContextEntries,
    todoState: snapshot.context.todoState ?? null,
    fullCompactionState: snapshot.context.fullCompactionState ?? null,
    pendingConflictSummary: snapshot.context.pendingConflictSummary,
    firstUserMessage: snapshot.context.firstUserMessage,
    lastUserMessage: snapshot.context.lastUserMessage,
    cronJobId: snapshot.cronJobId ?? null,
    parentSessionId: snapshot.parentSessionId ?? null,
    parentRelationKind: snapshot.parentRelationKind ?? null,
    forkReplayCheckpointId: snapshot.forkReplayCheckpointId ?? null,
    workingDirectory: snapshot.workingDirectory,
    model: snapshot.model,
    loopState: snapshot.sessionState.loopState,
    turnCount: snapshot.sessionState.turnCount,
    lastError: snapshot.sessionState.lastError,
    pendingToolCallIds: snapshot.sessionState.pendingToolCallIds,
    interruptRequested: snapshot.sessionState.interruptRequested,
    historyCompactionsSinceFullCompaction:
      snapshot.sessionState.historyCompactionsSinceFullCompaction,
    inputTokensCount: snapshot.inputTokensCount,
    promptCacheKey: snapshot.promptCacheKey,
    createdAt: snapshot.updatedAt,
    updatedAt: snapshot.updatedAt
  };
}

export function toSessionForkCheckpoint(
  row: SessionForkCheckpointRow
): SessionForkCheckpoint | null {
  const snapshot = parseJsonValue(row.snapshotJson);
  const promptSeed = parseJsonValue(row.promptSeedJson);
  if (!isSessionSnapshot(snapshot) || !isRecord(promptSeed)) {
    return null;
  }

  return {
    id: row.id,
    sessionId: row.sessionId,
    assistantMessageId: row.assistantMessageId,
    turnCount: row.turnCount,
    baseMessageCount: row.baseMessageCount,
    responseGroupId: row.responseGroupId,
    snapshot,
    promptSeed: {
      system: typeof promptSeed.system === "string" ? promptSeed.system : "",
      requestMessages: Array.isArray(promptSeed.requestMessages)
        ? (promptSeed.requestMessages as SessionForkCheckpoint["promptSeed"]["requestMessages"])
        : [],
      runtimeContextMessages: Array.isArray(promptSeed.runtimeContextMessages)
        ? (promptSeed.runtimeContextMessages as SessionForkCheckpoint["promptSeed"]["runtimeContextMessages"])
        : [],
      tools: Array.isArray(promptSeed.tools)
        ? (promptSeed.tools as SessionForkCheckpoint["promptSeed"]["tools"])
        : [],
      toolChoice:
        promptSeed.toolChoice === null || isRecord(promptSeed.toolChoice)
          ? (promptSeed.toolChoice as SessionForkCheckpoint["promptSeed"]["toolChoice"])
          : null
    },
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export async function insertSessionMessage(input: {
  db: ProductDatabaseClient;
  sessionId: string;
  index: number;
  block: ConversationBlock;
}): Promise<void> {
  const serialized = serializeBlock(input.block);
  await input.db.insert(sessionMessages).values({
    id: input.block.id,
    sessionId: input.sessionId,
    messageIndex: input.index,
    role: serialized.role,
    content: serialized.content,
    toolName: serialized.toolName,
    toolCallId: serialized.toolCallId,
    state: serialized.state,
    isError: serialized.isError,
    inputJson: serialized.inputJson,
    outputText: serialized.outputText,
    createdAt: serialized.createdAt
  });
}
