import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import {
  DEFAULT_SESSION_MODEL,
  normalizeCapabilityPacks,
  type PendingConfirmationPayload,
  type PendingPermissionRequest,
  type PendingUserQuestionPayload,
  type SessionFullCompactionState,
  type SessionTodoState,
  type ScheduleSessionContext
} from "@ai-app-template/domain";

import type { ProductDatabaseClient } from "@ai-app-template/db";
import { agentSessions, sessionMessages } from "@ai-app-template/db";

import type {
  ConversationBlock,
  CreateSessionInput,
  JsonValue,
  LoopState,
  SessionSnapshot
} from "../types.js";
import type { SessionManager } from "./contracts.js";
import {
  cloneSnapshot,
  createSnapshot,
  isSessionSnapshot,
  resolveWorkingDirectory
} from "./shared.js";
import { resolveTaskBriefPathForSession } from "./task-brief.js";
import { normalizeTodoState } from "./todo-state.js";

type SessionRow = typeof agentSessions.$inferSelect;
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

export function toConversationBlock(row: SessionMessageRow): ConversationBlock {
  const createdAt = toIsoString(row.createdAt);
  if (row.role === "user") {
    return {
      id: row.id,
      kind: "user",
      content: row.content ?? "",
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
  return {
    id: row.id,
    kind: "tool result",
    toolCallId: row.toolCallId ?? "",
    toolName: row.toolName ?? "",
    output: row.outputText ?? "",
    isError: Boolean(row.isError),
    state:
      row.state === "pending" || row.state === "success" ? row.state : "failed",
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
    pendingPermissionRequest: isRecord(pendingPermissionRequest)
      ? (pendingPermissionRequest as unknown as PendingPermissionRequest)
      : null,
    pendingConfirmationPayload: isRecord(pendingConfirmationPayload)
      ? (pendingConfirmationPayload as unknown as PendingConfirmationPayload)
      : null,
    pendingUserQuestionPayload: isRecord(pendingUserQuestionPayload)
      ? (pendingUserQuestionPayload as unknown as PendingUserQuestionPayload)
      : null,
    todoState,
    fullCompactionState: isRecord(fullCompactionState)
      ? (fullCompactionState as unknown as SessionFullCompactionState)
      : null,
    pendingConflictSummary: row.pendingConflictSummary,
    lastUserMessage: row.lastUserMessage
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
      inputJson: null,
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
    inputJson: block.responseGroupId
      ? { responseGroupId: block.responseGroupId }
      : null,
    outputText: block.output,
    createdAt: block.createdAt
  };
}

export class PostgresSessionManager implements SessionManager {
  constructor(private readonly db: ProductDatabaseClient) {}

  async createSession(
    input: CreateSessionInput = {}
  ): Promise<SessionSnapshot> {
    const createSnapshotInput: {
      sessionId: string;
      workingDirectory: string;
      model: string;
      userId?: string;
      yoloMode?: boolean;
      planModeEnabled?: boolean;
      contextWindow?: number;
      maxTurns?: number;
      shellAllowPatterns?: string[];
      shellDenyPatterns?: string[];
      toolAllowList?: string[];
      toolAskList?: string[];
      toolDenyList?: string[];
      enabledCapabilityPacks?: string[];
    } = {
      sessionId: randomUUID(),
      workingDirectory: resolveWorkingDirectory(input.workingDirectory),
      model: input.model ?? DEFAULT_SESSION_MODEL
    };

    if (typeof input.userId === "string" && input.userId.length > 0) {
      createSnapshotInput.userId = input.userId;
    }
    if (typeof input.yoloMode === "boolean") {
      createSnapshotInput.yoloMode = input.yoloMode;
    }
    if (typeof input.planModeEnabled === "boolean") {
      createSnapshotInput.planModeEnabled = input.planModeEnabled;
    }
    if (typeof input.contextWindow === "number") {
      createSnapshotInput.contextWindow = input.contextWindow;
    }
    if (typeof input.maxTurns === "number") {
      createSnapshotInput.maxTurns = input.maxTurns;
    }
    if (Array.isArray(input.shellAllowPatterns)) {
      createSnapshotInput.shellAllowPatterns = input.shellAllowPatterns;
    }
    if (Array.isArray(input.shellDenyPatterns)) {
      createSnapshotInput.shellDenyPatterns = input.shellDenyPatterns;
    }
    if (Array.isArray(input.toolAllowList)) {
      createSnapshotInput.toolAllowList = input.toolAllowList;
    }
    if (Array.isArray(input.toolAskList)) {
      createSnapshotInput.toolAskList = input.toolAskList;
    }
    if (Array.isArray(input.toolDenyList)) {
      createSnapshotInput.toolDenyList = input.toolDenyList;
    }
    if (Array.isArray(input.enabledCapabilityPacks)) {
      createSnapshotInput.enabledCapabilityPacks = input.enabledCapabilityPacks;
    }

    const snapshot = createSnapshot(createSnapshotInput);

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

    return {
      sessionId: row.id,
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
        isActive: sql<boolean>`${agentSessions.activeRunId} is not null`
      })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1);

    return rows[0]?.isActive ?? false;
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

  async isInterruptRequested(
    sessionId: string,
    runId: string
  ): Promise<boolean> {
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
    await this.db
      .insert(agentSessions)
      .values({
        id: snapshot.sessionId,
        userId: snapshot.context.userId,
        status: snapshot.context.status,
        currentDateContext: snapshot.context.currentDateContext,
        yoloMode: snapshot.context.yoloMode,
        planModeEnabled: snapshot.context.planModeEnabled,
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
        pendingPermissionRequest: snapshot.context.pendingPermissionRequest,
        pendingConfirmationPayload: snapshot.context.pendingConfirmationPayload,
        pendingUserQuestionPayload: snapshot.context.pendingUserQuestionPayload,
        todoState: snapshot.context.todoState ?? null,
        fullCompactionState: snapshot.context.fullCompactionState ?? null,
        pendingConflictSummary: snapshot.context.pendingConflictSummary,
        lastUserMessage: snapshot.context.lastUserMessage,
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
      })
      .onConflictDoUpdate({
        target: agentSessions.id,
        set: {
          userId: snapshot.context.userId,
          status: snapshot.context.status,
          currentDateContext: snapshot.context.currentDateContext,
          yoloMode: snapshot.context.yoloMode,
          planModeEnabled: snapshot.context.planModeEnabled,
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
          pendingPermissionRequest: snapshot.context.pendingPermissionRequest,
          pendingConfirmationPayload:
            snapshot.context.pendingConfirmationPayload,
          pendingUserQuestionPayload:
            snapshot.context.pendingUserQuestionPayload,
          todoState: snapshot.context.todoState ?? null,
          fullCompactionState: snapshot.context.fullCompactionState ?? null,
          pendingConflictSummary: snapshot.context.pendingConflictSummary,
          lastUserMessage: snapshot.context.lastUserMessage,
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
          updatedAt: snapshot.updatedAt
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
