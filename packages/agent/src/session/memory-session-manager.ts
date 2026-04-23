import { randomUUID } from "node:crypto";

import type {
  CreateSessionInput,
  ConversationBlock,
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

export class MemorySessionManager implements SessionManager {
  private readonly sessions = new Map<string, SessionSnapshot>();
  private readonly activeRuns = new Map<
    string,
    { runId: string; startedAt: number }
  >();

  async createSession(
    input: CreateSessionInput = {}
  ): Promise<SessionSnapshot> {
    const createSnapshotInput: {
      sessionId: string;
      workingDirectory: string;
      model: string;
      userId?: string;
      yoloMode?: boolean;
      contextWindow?: number;
      maxTurns?: number;
      shellAllowPatterns?: string[];
      shellDenyPatterns?: string[];
      toolAllowList?: string[];
      toolAskList?: string[];
      toolDenyList?: string[];
    } = {
      sessionId: randomUUID(),
      workingDirectory: resolveWorkingDirectory(input.workingDirectory),
      model: input.model ?? "MiniMax-M2.7"
    };

    if (typeof input.userId === "string" && input.userId.length > 0) {
      createSnapshotInput.userId = input.userId;
    }
    if (typeof input.yoloMode === "boolean") {
      createSnapshotInput.yoloMode = input.yoloMode;
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

    const snapshot = createSnapshot(createSnapshotInput);

    this.sessions.set(snapshot.sessionId, cloneSnapshot(snapshot));
    return cloneSnapshot(snapshot);
  }

  async getSession(sessionId: string): Promise<SessionSnapshot | null> {
    const snapshot = this.sessions.get(sessionId);
    return snapshot ? cloneSnapshot(snapshot) : null;
  }

  async listSessions(): Promise<SessionSnapshot[]> {
    return [...this.sessions.values()].map(cloneSnapshot);
  }

  async isExecutionActive(sessionId: string): Promise<boolean> {
    return this.activeRuns.has(sessionId);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    return this.sessions.delete(sessionId);
  }

  async saveSession(snapshot: SessionSnapshot): Promise<SessionSnapshot> {
    const nextSnapshot = cloneSnapshot(snapshot);
    nextSnapshot.updatedAt = new Date().toISOString();
    this.sessions.set(nextSnapshot.sessionId, cloneSnapshot(nextSnapshot));
    return cloneSnapshot(nextSnapshot);
  }

  async recover(snapshot: SessionSnapshot): Promise<SessionSnapshot> {
    if (!isSessionSnapshot(snapshot)) {
      throw new Error("Invalid session snapshot.");
    }

    return this.saveSession(snapshot);
  }

  async appendBlock(
    sessionId: string,
    block: ConversationBlock
  ): Promise<SessionSnapshot> {
    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      messages: [...snapshot.messages, structuredClone(block)]
    }));
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

  async updateContext(
    sessionId: string,
    patch: Partial<SessionSnapshot["context"]>
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
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    const current = this.activeRuns.get(sessionId);
    const now = Date.now();
    const isStale =
      current &&
      typeof options.staleAfterMs === "number" &&
      options.staleAfterMs >= 0 &&
      now - current.startedAt >= options.staleAfterMs;

    if (current && !isStale) {
      return null;
    }

    this.activeRuns.set(sessionId, {
      runId: options.runId,
      startedAt: now
    });

    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      sessionState: {
        ...snapshot.sessionState,
        loopState: "running"
      }
    }));
  }

  async releaseExecution(
    sessionId: string,
    runId: string
  ): Promise<SessionSnapshot | null> {
    const current = this.activeRuns.get(sessionId);
    if (current?.runId === runId) {
      this.activeRuns.delete(sessionId);
    }

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
    this.sessions.set(nextSnapshot.sessionId, cloneSnapshot(nextSnapshot));
    return cloneSnapshot(nextSnapshot);
  }
}

export function createMemorySessionManager(): MemorySessionManager {
  return new MemorySessionManager();
}
