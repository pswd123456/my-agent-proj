import type { ScheduleSessionContext } from "@ai-app-template/domain";

import type { CreateSessionInput, SessionSnapshot } from "../types.js";

import type { ConversationBlock, LoopState } from "../types.js";

export interface SessionManager {
  createSession(input?: CreateSessionInput): Promise<SessionSnapshot>;
  getSession(sessionId: string): Promise<SessionSnapshot | null>;
  listSessions(): Promise<SessionSnapshot[]>;
  saveSession(snapshot: SessionSnapshot): Promise<SessionSnapshot>;
  recover(snapshot: SessionSnapshot): Promise<SessionSnapshot>;
  appendBlock(
    sessionId: string,
    block: ConversationBlock
  ): Promise<SessionSnapshot>;
  setLoopState(sessionId: string, loopState: LoopState): Promise<SessionSnapshot>;
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
  updateContext(
    sessionId: string,
    patch: Partial<ScheduleSessionContext>
  ): Promise<SessionSnapshot>;
}
