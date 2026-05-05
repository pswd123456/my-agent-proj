import type { ScheduleSessionContext } from "@ai-app-template/domain";

import type {
  CreateSessionInput,
  SessionForkCheckpoint,
  SessionSnapshot
} from "../types.js";

import type { ConversationBlock, LoopState } from "../types.js";

export interface AcquireExecutionOptions {
  runId: string;
  staleAfterMs?: number;
}

export const DEFAULT_EXECUTION_LEASE_TIMEOUT_MS = 30 * 60_000;

export interface SessionManager {
  createSession(input?: CreateSessionInput): Promise<SessionSnapshot>;
  getSession(sessionId: string): Promise<SessionSnapshot | null>;
  listSessions(): Promise<SessionSnapshot[]>;
  isExecutionActive(sessionId: string): Promise<boolean>;
  requestInterrupt(sessionId: string): Promise<SessionSnapshot | null>;
  forceStop(sessionId: string): Promise<SessionSnapshot | null>;
  registerExecutionAbort(
    sessionId: string,
    runId: string,
    controller: AbortController
  ): void;
  isInterruptRequested(sessionId: string, runId: string): Promise<boolean>;
  deleteSession(sessionId: string): Promise<boolean>;
  saveSession(snapshot: SessionSnapshot): Promise<SessionSnapshot>;
  recover(snapshot: SessionSnapshot): Promise<SessionSnapshot>;
  saveForkCheckpoint(
    checkpoint: SessionForkCheckpoint
  ): Promise<SessionForkCheckpoint>;
  getForkCheckpoint(
    checkpointId: string
  ): Promise<SessionForkCheckpoint | null>;
  findForkCheckpointByAssistantMessage(
    sessionId: string,
    assistantMessageId: string
  ): Promise<SessionForkCheckpoint | null>;
  listForkCheckpoints(sessionId: string): Promise<SessionForkCheckpoint[]>;
  pruneForkCheckpointsFromTurn(
    sessionId: string,
    turnCount: number
  ): Promise<number>;
  appendBlock(
    sessionId: string,
    block: ConversationBlock
  ): Promise<SessionSnapshot>;
  setLoopState(
    sessionId: string,
    loopState: LoopState
  ): Promise<SessionSnapshot>;
  setPromptCacheKey(
    sessionId: string,
    promptCacheKey: string
  ): Promise<SessionSnapshot>;
  setTurnCount(sessionId: string, turnCount: number): Promise<SessionSnapshot>;
  setPendingToolCallIds(
    sessionId: string,
    pendingToolCallIds: string[]
  ): Promise<SessionSnapshot>;
  addInputTokens(
    sessionId: string,
    inputTokens: number
  ): Promise<SessionSnapshot>;
  setLastError(
    sessionId: string,
    lastError: string | null
  ): Promise<SessionSnapshot>;
  setWorkingDirectory(
    sessionId: string,
    workingDirectory: string
  ): Promise<SessionSnapshot>;
  setModel(sessionId: string, model: string): Promise<SessionSnapshot>;
  updateContext(
    sessionId: string,
    patch: Partial<ScheduleSessionContext>
  ): Promise<SessionSnapshot>;
  acquireExecution(
    sessionId: string,
    options: AcquireExecutionOptions
  ): Promise<SessionSnapshot | null>;
  releaseExecution(
    sessionId: string,
    runId: string
  ): Promise<SessionSnapshot | null>;
}
