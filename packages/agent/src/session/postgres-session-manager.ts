import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import {
  DEFAULT_SESSION_MODEL,
  normalizeCapabilityPacks,
  normalizePendingUserQuestionPayload,
  normalizeThinkingEffort,
  type PendingConfirmationPayload,
  type PendingPermissionRequest,
  type PendingUserQuestionPayload,
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
  JsonValue,
  LoopState,
  SessionForkCheckpoint,
  SessionSnapshot,
  ToolResultDetails,
  UserConversationBlock
} from "../types.js";
import type { SessionManager } from "./contracts.js";
import { DEFAULT_EXECUTION_LEASE_TIMEOUT_MS } from "./contracts.js";
import {
  buildCreateSnapshotOverridesFromSessionInput,
  cloneSnapshot,
  createSnapshot,
  forceStopSnapshot,
  isSessionSnapshot,
  resolveWorkingDirectory
} from "./shared.js";
import { resolveTaskBriefPathForSession } from "./task-brief.js";
import { normalizeTodoState } from "./todo-state.js";

type SessionRow = typeof agentSessions.$inferSelect;
export type SessionMessageRow = typeof sessionMessages.$inferSelect;
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

function toStringArray(value: unknown): string[] {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((item): item is string => typeof item === "string");
}

export function toIsoString(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const tzMatch = normalized.match(/([+-]\d{2})(\d{2})?$/);
  const hasExplicitTimeZone =
    normalized.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(normalized) || tzMatch;
  const parsedValue = tzMatch
    ? normalized.replace(
        /([+-]\d{2})(\d{2})?$/,
        (_, hours: string, minutes?: string) => `${hours}:${minutes ?? "00"}`
      )
    : normalized;

  return new Date(
    hasExplicitTimeZone ? parsedValue : `${normalized}Z`
  ).toISOString();
}

export function hasActiveExecutionLease(input: {
  activeRunId: string | null;
  activeRunStartedAt: string | Date | null;
  now?: number;
  staleAfterMs?: number;
}): boolean {
  if (!input.activeRunId) {
    return false;
  }

  const staleAfterMs =
    typeof input.staleAfterMs === "number"
      ? input.staleAfterMs
      : DEFAULT_EXECUTION_LEASE_TIMEOUT_MS;
  if (!Number.isFinite(staleAfterMs) || staleAfterMs < 0) {
    return true;
  }

  if (!input.activeRunStartedAt) {
    return false;
  }

  const startedAtMs = new Date(input.activeRunStartedAt).getTime();
  if (!Number.isFinite(startedAtMs)) {
    return false;
  }

  const now = input.now ?? Date.now();
  return now - startedAtMs < staleAfterMs;
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
    userId: row.userId,
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

function toSessionSnapshot(
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
    userId: snapshot.context.userId,
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

function toSessionForkCheckpoint(
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

export class PostgresSessionManager implements SessionManager {
  private readonly forceStoppedRunIds = new Map<string, Set<string>>();

  constructor(private readonly db: ProductDatabaseClient) {}

  async createSession(
    input: CreateSessionInput = {}
  ): Promise<SessionSnapshot> {
    const snapshot = createSnapshot({
      sessionId: randomUUID(),
      workingDirectory: resolveWorkingDirectory(input.workingDirectory),
      model: input.model ?? DEFAULT_SESSION_MODEL,
      ...buildCreateSnapshotOverridesFromSessionInput(input)
    });

    await this.persistSession(snapshot);
    return cloneSnapshot(snapshot);
  }

  async getSession(sessionId: string): Promise<SessionSnapshot | null> {
    const sessionRows = await this.db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1);

    const row = sessionRows[0];
    if (!row) {
      return null;
    }

    const messageRows = await this.db
      .select()
      .from(sessionMessages)
      .where(eq(sessionMessages.sessionId, sessionId))
      .orderBy(asc(sessionMessages.messageIndex));

    return toSessionSnapshot(row, messageRows);
  }

  async listSessions(): Promise<SessionSnapshot[]> {
    const rows = await this.db
      .select()
      .from(agentSessions)
      .orderBy(asc(agentSessions.updatedAt));

    const sessions = await Promise.all(
      rows.map((row) => this.getSession(row.id))
    );
    return sessions.flatMap((session) => (session ? [session] : []));
  }

  async isExecutionActive(sessionId: string): Promise<boolean> {
    const rows = await this.db
      .select({
        activeRunId: agentSessions.activeRunId,
        activeRunStartedAt: agentSessions.activeRunStartedAt
      })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1);

    const row = rows[0];
    return hasActiveExecutionLease({
      activeRunId: row?.activeRunId ?? null,
      activeRunStartedAt: row?.activeRunStartedAt ?? null
    });
  }

  async requestInterrupt(sessionId: string): Promise<SessionSnapshot | null> {
    const requestedAt = new Date().toISOString();
    const rows = await this.db
      .update(agentSessions)
      .set({
        interruptRequested: true,
        updatedAt: requestedAt
      })
      .where(
        and(
          eq(agentSessions.id, sessionId),
          sql`${agentSessions.activeRunId} is not null`
        )
      )
      .returning({ id: agentSessions.id });

    if (rows.length === 0) {
      return null;
    }

    return this.getSession(sessionId);
  }

  async forceStop(sessionId: string): Promise<SessionSnapshot | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    const nextSnapshot = forceStopSnapshot(session);
    const stoppedAt = new Date().toISOString();
    const activeRunRows = await this.db
      .select({
        activeRunId: agentSessions.activeRunId
      })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1);
    const activeRunId = activeRunRows[0]?.activeRunId;
    if (activeRunId) {
      const runIds =
        this.forceStoppedRunIds.get(sessionId) ?? new Set<string>();
      runIds.add(activeRunId);
      this.forceStoppedRunIds.set(sessionId, runIds);
    }

    await this.db
      .update(agentSessions)
      .set({
        status: nextSnapshot.context.status,
        pendingPermissionRequest: null,
        pendingConfirmationPayload: null,
        pendingUserQuestionPayload: null,
        loopState: nextSnapshot.sessionState.loopState,
        lastError: null,
        pendingToolCallIds: [],
        interruptRequested: false,
        activeRunId: null,
        activeRunStartedAt: null,
        updatedAt: stoppedAt
      })
      .where(eq(agentSessions.id, sessionId));

    return this.getSession(sessionId);
  }

  async isInterruptRequested(
    sessionId: string,
    runId: string
  ): Promise<boolean> {
    if (this.forceStoppedRunIds.get(sessionId)?.has(runId)) {
      return true;
    }

    const rows = await this.db
      .select({
        interruptRequested: agentSessions.interruptRequested
      })
      .from(agentSessions)
      .where(
        and(
          eq(agentSessions.id, sessionId),
          eq(agentSessions.activeRunId, runId)
        )
      )
      .limit(1);

    return rows[0]?.interruptRequested ?? false;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    await this.db
      .delete(sessionForkCheckpoints)
      .where(eq(sessionForkCheckpoints.sessionId, sessionId));
    const rows = await this.db
      .delete(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .returning({ id: agentSessions.id });
    return rows.length > 0;
  }

  async saveSession(snapshot: SessionSnapshot): Promise<SessionSnapshot> {
    if (!isSessionSnapshot(snapshot)) {
      throw new Error("Invalid session snapshot.");
    }

    const nextSnapshot = cloneSnapshot(snapshot);
    nextSnapshot.updatedAt = new Date().toISOString();
    await this.persistSession(nextSnapshot);
    return cloneSnapshot(nextSnapshot);
  }

  async recover(snapshot: SessionSnapshot): Promise<SessionSnapshot> {
    if (!isSessionSnapshot(snapshot)) {
      throw new Error("Invalid session snapshot.");
    }

    const nextSnapshot = cloneSnapshot(snapshot);
    nextSnapshot.updatedAt = new Date().toISOString();
    await this.persistSession(nextSnapshot);
    await this.db
      .delete(sessionMessages)
      .where(eq(sessionMessages.sessionId, snapshot.sessionId));
    for (const [index, block] of nextSnapshot.messages.entries()) {
      await this.insertMessage(snapshot.sessionId, index, block);
    }

    return cloneSnapshot(nextSnapshot);
  }

  async saveForkCheckpoint(
    checkpoint: SessionForkCheckpoint
  ): Promise<SessionForkCheckpoint> {
    const nextCheckpoint = structuredClone(checkpoint) as SessionForkCheckpoint;
    const savedAt = new Date().toISOString();
    const rows = await this.db
      .insert(sessionForkCheckpoints)
      .values({
        id: nextCheckpoint.id,
        sessionId: nextCheckpoint.sessionId,
        assistantMessageId: nextCheckpoint.assistantMessageId,
        turnCount: nextCheckpoint.turnCount,
        baseMessageCount: nextCheckpoint.baseMessageCount,
        responseGroupId: nextCheckpoint.responseGroupId ?? null,
        snapshotJson: nextCheckpoint.snapshot as unknown as Record<
          string,
          unknown
        >,
        promptSeedJson: nextCheckpoint.promptSeed as unknown as Record<
          string,
          unknown
        >,
        createdAt: nextCheckpoint.createdAt,
        updatedAt: savedAt
      })
      .onConflictDoUpdate({
        target: [
          sessionForkCheckpoints.sessionId,
          sessionForkCheckpoints.assistantMessageId
        ],
        set: {
          turnCount: nextCheckpoint.turnCount,
          baseMessageCount: nextCheckpoint.baseMessageCount,
          responseGroupId: nextCheckpoint.responseGroupId ?? null,
          snapshotJson: nextCheckpoint.snapshot as unknown as Record<
            string,
            unknown
          >,
          promptSeedJson: nextCheckpoint.promptSeed as unknown as Record<
            string,
            unknown
          >,
          updatedAt: savedAt
        }
      })
      .returning();

    const saved = rows[0] ? toSessionForkCheckpoint(rows[0]) : null;
    if (!saved) {
      throw new Error(`Failed to save fork checkpoint ${nextCheckpoint.id}`);
    }
    return saved;
  }

  async getForkCheckpoint(
    checkpointId: string
  ): Promise<SessionForkCheckpoint | null> {
    const rows = await this.db
      .select()
      .from(sessionForkCheckpoints)
      .where(eq(sessionForkCheckpoints.id, checkpointId))
      .limit(1);
    const row = rows[0];
    return row ? toSessionForkCheckpoint(row) : null;
  }

  async findForkCheckpointByAssistantMessage(
    sessionId: string,
    assistantMessageId: string
  ): Promise<SessionForkCheckpoint | null> {
    const rows = await this.db
      .select()
      .from(sessionForkCheckpoints)
      .where(
        and(
          eq(sessionForkCheckpoints.sessionId, sessionId),
          eq(sessionForkCheckpoints.assistantMessageId, assistantMessageId)
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? toSessionForkCheckpoint(row) : null;
  }

  async listForkCheckpoints(
    sessionId: string
  ): Promise<SessionForkCheckpoint[]> {
    const rows = await this.db
      .select()
      .from(sessionForkCheckpoints)
      .where(eq(sessionForkCheckpoints.sessionId, sessionId))
      .orderBy(asc(sessionForkCheckpoints.createdAt));
    return rows.flatMap((row) => {
      const checkpoint = toSessionForkCheckpoint(row);
      return checkpoint ? [checkpoint] : [];
    });
  }

  async pruneForkCheckpointsFromTurn(
    sessionId: string,
    turnCount: number
  ): Promise<number> {
    const rows = await this.db
      .delete(sessionForkCheckpoints)
      .where(
        and(
          eq(sessionForkCheckpoints.sessionId, sessionId),
          sql`${sessionForkCheckpoints.turnCount} >= ${Math.max(
            0,
            Math.floor(turnCount)
          )}`
        )
      )
      .returning({ id: sessionForkCheckpoints.id });

    return rows.length;
  }

  async appendBlock(
    sessionId: string,
    block: ConversationBlock
  ): Promise<SessionSnapshot> {
    const nextIndexRows = await this.db
      .select({
        messageIndex: sessionMessages.messageIndex
      })
      .from(sessionMessages)
      .where(eq(sessionMessages.sessionId, sessionId))
      .orderBy(desc(sessionMessages.messageIndex))
      .limit(1);
    const nextIndex = (nextIndexRows[0]?.messageIndex ?? -1) + 1;
    await this.insertMessage(sessionId, nextIndex, block);
    const updatedAt = block.createdAt;
    await this.db
      .update(agentSessions)
      .set({ updatedAt })
      .where(eq(agentSessions.id, sessionId));
    const snapshot = await this.getSession(sessionId);
    if (!snapshot) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return snapshot;
  }

  async setLoopState(
    sessionId: string,
    loopState: LoopState
  ): Promise<SessionSnapshot> {
    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      sessionState: {
        ...snapshot.sessionState,
        loopState
      }
    }));
  }

  async setPromptCacheKey(
    sessionId: string,
    promptCacheKey: string
  ): Promise<SessionSnapshot> {
    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      promptCacheKey
    }));
  }

  async setTurnCount(
    sessionId: string,
    turnCount: number
  ): Promise<SessionSnapshot> {
    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      sessionState: {
        ...snapshot.sessionState,
        turnCount: Math.max(0, Math.floor(turnCount))
      }
    }));
  }

  async setPendingToolCallIds(
    sessionId: string,
    pendingToolCallIds: string[]
  ): Promise<SessionSnapshot> {
    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      sessionState: {
        ...snapshot.sessionState,
        pendingToolCallIds: [...pendingToolCallIds]
      }
    }));
  }

  async addInputTokens(
    sessionId: string,
    inputTokens: number
  ): Promise<SessionSnapshot> {
    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      inputTokensCount: snapshot.inputTokensCount + Math.max(0, inputTokens)
    }));
  }

  async setLastError(
    sessionId: string,
    lastError: string | null
  ): Promise<SessionSnapshot> {
    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      sessionState: {
        ...snapshot.sessionState,
        lastError
      }
    }));
  }

  async setModel(sessionId: string, model: string): Promise<SessionSnapshot> {
    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      model
    }));
  }

  async updateContext(
    sessionId: string,
    patch: Partial<ScheduleSessionContext>
  ): Promise<SessionSnapshot> {
    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      context: {
        ...snapshot.context,
        ...structuredClone(patch)
      }
    }));
  }

  async acquireExecution(
    sessionId: string,
    options: { runId: string; staleAfterMs?: number }
  ): Promise<SessionSnapshot | null> {
    const runStartedAt = new Date().toISOString();
    const staleBefore =
      typeof options.staleAfterMs === "number" && options.staleAfterMs >= 0
        ? new Date(Date.now() - options.staleAfterMs).toISOString()
        : null;

    const rows = await this.db
      .update(agentSessions)
      .set({
        activeRunId: options.runId,
        activeRunStartedAt: runStartedAt,
        interruptRequested: false,
        updatedAt: runStartedAt
      })
      .where(
        and(
          eq(agentSessions.id, sessionId),
          staleBefore
            ? sql`(${agentSessions.activeRunId} is null or ${agentSessions.activeRunStartedAt} is null or ${agentSessions.activeRunStartedAt} <= ${staleBefore})`
            : sql`${agentSessions.activeRunId} is null`
        )
      )
      .returning({ id: agentSessions.id });

    if (rows.length === 0) {
      return null;
    }

    return this.getSession(sessionId);
  }

  async releaseExecution(
    sessionId: string,
    runId: string
  ): Promise<SessionSnapshot | null> {
    const releasedAt = new Date().toISOString();
    this.forceStoppedRunIds.get(sessionId)?.delete(runId);
    await this.db
      .update(agentSessions)
      .set({
        activeRunId: null,
        activeRunStartedAt: null,
        interruptRequested: false,
        updatedAt: releasedAt
      })
      .where(
        and(
          eq(agentSessions.id, sessionId),
          eq(agentSessions.activeRunId, runId)
        )
      );

    return this.getSession(sessionId);
  }

  private async updateSession(
    sessionId: string,
    updater: (snapshot: SessionSnapshot) => SessionSnapshot
  ): Promise<SessionSnapshot> {
    const snapshot = await this.getSession(sessionId);
    if (!snapshot) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    const nextSnapshot = cloneSnapshot(updater(snapshot));
    nextSnapshot.updatedAt = new Date().toISOString();
    await this.persistSession(nextSnapshot);
    return cloneSnapshot(nextSnapshot);
  }

  private async persistSession(snapshot: SessionSnapshot): Promise<void> {
    const values = buildSessionPersistenceValues(snapshot);
    await this.db
      .insert(agentSessions)
      .values(values)
      .onConflictDoUpdate({
        target: agentSessions.id,
        set: {
          userId: values.userId,
          status: values.status,
          currentDateContext: values.currentDateContext,
          yoloMode: values.yoloMode,
          planModeEnabled: values.planModeEnabled,
          thinkingEffort: values.thinkingEffort,
          taskBriefPath: values.taskBriefPath,
          workspaceEscapeAllowed: values.workspaceEscapeAllowed,
          contextWindow: values.contextWindow,
          maxTurns: values.maxTurns,
          shellAllowPatterns: values.shellAllowPatterns,
          shellDenyPatterns: values.shellDenyPatterns,
          toolAllowList: values.toolAllowList,
          toolAskList: values.toolAskList,
          toolDenyList: values.toolDenyList,
          enabledCapabilityPacks: values.enabledCapabilityPacks,
          activeBackgroundTaskCount: values.activeBackgroundTaskCount,
          pendingPermissionRequest: values.pendingPermissionRequest,
          pendingConfirmationPayload: values.pendingConfirmationPayload,
          pendingUserQuestionPayload: values.pendingUserQuestionPayload,
          pendingBackgroundNotifications: values.pendingBackgroundNotifications,
          hookContextEntries: values.hookContextEntries,
          todoState: values.todoState,
          fullCompactionState: values.fullCompactionState,
          pendingConflictSummary: values.pendingConflictSummary,
          firstUserMessage: values.firstUserMessage,
          lastUserMessage: values.lastUserMessage,
          cronJobId: values.cronJobId,
          parentSessionId: values.parentSessionId,
          parentRelationKind: values.parentRelationKind,
          forkReplayCheckpointId: values.forkReplayCheckpointId,
          workingDirectory: values.workingDirectory,
          model: values.model,
          loopState: values.loopState,
          turnCount: values.turnCount,
          lastError: values.lastError,
          pendingToolCallIds: values.pendingToolCallIds,
          interruptRequested: values.interruptRequested,
          historyCompactionsSinceFullCompaction:
            values.historyCompactionsSinceFullCompaction,
          inputTokensCount: values.inputTokensCount,
          promptCacheKey: values.promptCacheKey,
          updatedAt: values.updatedAt
        }
      });
  }

  private async insertMessage(
    sessionId: string,
    index: number,
    block: ConversationBlock
  ): Promise<void> {
    const serialized = serializeBlock(block);
    await this.db.insert(sessionMessages).values({
      id: block.id,
      sessionId,
      messageIndex: index,
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
}

export function createPostgresSessionManager(
  db: ProductDatabaseClient
): PostgresSessionManager {
  return new PostgresSessionManager(db);
}
