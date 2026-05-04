import { and, asc, desc, eq, sql } from "drizzle-orm";

import type { ScheduleSessionContext } from "@ai-app-template/domain";

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
import type { SessionManager } from "./contracts.js";
import { cloneSnapshot, forceStopSnapshot, isSessionSnapshot } from "./shared.js";
import {
  hasActiveExecutionLease,
  resolveExecutionLeaseStaleBefore,
  shouldTreatRunAsInterrupted
} from "./execution-lease.js";
import { insertSessionMessage } from "./session-row-mapper.js";
import {
  buildSessionPersistenceValues,
  createSessionSnapshot,
  toSessionForkCheckpoint,
  toSessionSnapshot
} from "./session-row-mapper.js";

export { hasActiveExecutionLease, toIsoString } from "./execution-lease.js";
export {
  serializeBlock,
  toConversationBlock,
  type SessionMessageRow
} from "./message-codec.js";
export { buildSessionPersistenceValues, toSessionContext } from "./session-row-mapper.js";

export class PostgresSessionManager implements SessionManager {
  private readonly forceStoppedRunIds = new Map<string, Set<string>>();
  private readonly executionAbortControllers = new Map<
    string,
    Map<string, AbortController>
  >();

  constructor(private readonly db: ProductDatabaseClient) {}

  async createSession(
    input: CreateSessionInput = {}
  ): Promise<SessionSnapshot> {
    const snapshot = createSessionSnapshot(input);

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
      .returning({
        id: agentSessions.id,
        activeRunId: agentSessions.activeRunId
      });

    if (rows.length === 0) {
      return null;
    }
    const activeRunId = rows[0]?.activeRunId;
    if (activeRunId) {
      this.abortExecution(sessionId, activeRunId);
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
      this.abortExecution(sessionId, activeRunId);
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

  registerExecutionAbort(
    sessionId: string,
    runId: string,
    controller: AbortController
  ): void {
    const controllers =
      this.executionAbortControllers.get(sessionId) ??
      new Map<string, AbortController>();
    controllers.set(runId, controller);
    this.executionAbortControllers.set(sessionId, controllers);
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
        activeRunId: agentSessions.activeRunId,
        loopState: agentSessions.loopState,
        interruptRequested: agentSessions.interruptRequested
      })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return false;
    }
    return shouldTreatRunAsInterrupted({
      runId,
      lease: { activeRunId: row.activeRunId },
      loopState: row.loopState,
      interruptRequested: row.interruptRequested
    });
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
    const staleBefore = resolveExecutionLeaseStaleBefore(options.staleAfterMs);

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
    this.executionAbortControllers.get(sessionId)?.delete(runId);
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

  private abortExecution(sessionId: string, runId: string): void {
    const controller = this.executionAbortControllers
      .get(sessionId)
      ?.get(runId);
    if (!controller || controller.signal.aborted) {
      return;
    }
    controller.abort();
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
    await insertSessionMessage({
      db: this.db,
      sessionId,
      index,
      block
    });
  }
}

export function createPostgresSessionManager(
  db: ProductDatabaseClient
): PostgresSessionManager {
  return new PostgresSessionManager(db);
}
