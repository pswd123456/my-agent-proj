import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SESSION_MODEL,
  type ThinkingEffort
} from "@ai-app-template/domain";

import type {
  CreateSessionInput,
  ConversationBlock,
  LoopState,
  SessionParentRelationKind,
  SessionForkCheckpoint,
  SessionSnapshot
} from "../types.js";

import type { SessionManager } from "./contracts.js";
import {
  cloneSnapshot,
  createSnapshot,
  forceStopSnapshot,
  isSessionSnapshot,
  resolveWorkingDirectory
} from "./shared.js";

export class FileSessionManager implements SessionManager {
  private readonly activeRuns = new Map<
    string,
    { runId: string; startedAt: number; interruptRequested: boolean }
  >();
  private readonly forceStoppedRunIds = new Map<string, Set<string>>();

  constructor(private readonly baseDirectory: string) {}

  private get sessionsDirectory(): string {
    return path.resolve(this.baseDirectory, "sessions");
  }

  private get forkCheckpointsDirectory(): string {
    return path.resolve(this.baseDirectory, "fork-checkpoints");
  }

  private snapshotPath(sessionId: string): string {
    return path.join(this.sessionsDirectory, `${sessionId}.json`);
  }

  private forkCheckpointPath(checkpointId: string): string {
    return path.join(this.forkCheckpointsDirectory, `${checkpointId}.json`);
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.sessionsDirectory, { recursive: true });
    await fs.mkdir(this.forkCheckpointsDirectory, { recursive: true });
  }

  private async readSnapshotFile(
    sessionId: string
  ): Promise<SessionSnapshot | null> {
    try {
      const raw = await fs.readFile(this.snapshotPath(sessionId), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return isSessionSnapshot(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private async writeSnapshotFile(snapshot: SessionSnapshot): Promise<void> {
    await this.ensureDirectories();
    await fs.writeFile(
      this.snapshotPath(snapshot.sessionId),
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8"
    );
  }

  private async readForkCheckpointFile(
    checkpointId: string
  ): Promise<SessionForkCheckpoint | null> {
    try {
      const raw = await fs.readFile(
        this.forkCheckpointPath(checkpointId),
        "utf8"
      );
      return JSON.parse(raw) as SessionForkCheckpoint;
    } catch {
      return null;
    }
  }

  private async writeForkCheckpointFile(
    checkpoint: SessionForkCheckpoint
  ): Promise<void> {
    await this.ensureDirectories();
    await fs.writeFile(
      this.forkCheckpointPath(checkpoint.id),
      `${JSON.stringify(checkpoint, null, 2)}\n`,
      "utf8"
    );
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
    await this.writeSnapshotFile(nextSnapshot);
    return nextSnapshot;
  }

  async createSession(
    input: CreateSessionInput = {}
  ): Promise<SessionSnapshot> {
    const sessionId = randomUUID();
    const createSnapshotInput: {
      sessionId: string;
      parentSessionId?: string | null;
      parentRelationKind?: SessionParentRelationKind | null;
      forkReplayCheckpointId?: string | null;
      workingDirectory: string;
      model: string;
      thinkingEffort?: ThinkingEffort;
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
      sessionId,
      workingDirectory: resolveWorkingDirectory(input.workingDirectory),
      model: input.model ?? DEFAULT_SESSION_MODEL
    };

    if (
      typeof input.parentSessionId === "string" ||
      input.parentSessionId === null
    ) {
      createSnapshotInput.parentSessionId = input.parentSessionId;
    }
    if (
      input.parentRelationKind === "fork" ||
      input.parentRelationKind === "subagent" ||
      input.parentRelationKind === "hook_subagent" ||
      input.parentRelationKind === null
    ) {
      createSnapshotInput.parentRelationKind = input.parentRelationKind;
    }
    if (
      typeof input.forkReplayCheckpointId === "string" ||
      input.forkReplayCheckpointId === null
    ) {
      createSnapshotInput.forkReplayCheckpointId = input.forkReplayCheckpointId;
    }

    if (input.thinkingEffort) {
      createSnapshotInput.thinkingEffort = input.thinkingEffort;
    }
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

    await this.writeSnapshotFile(snapshot);
    return cloneSnapshot(snapshot);
  }

  async getSession(sessionId: string): Promise<SessionSnapshot | null> {
    const snapshot = await this.readSnapshotFile(sessionId);
    return snapshot ? cloneSnapshot(snapshot) : null;
  }

  async listSessions(): Promise<SessionSnapshot[]> {
    await this.ensureDirectories();
    const entries = await fs.readdir(this.sessionsDirectory, {
      withFileTypes: true
    });
    const sessions: SessionSnapshot[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const sessionId = entry.name.replace(/\.json$/, "");
      const snapshot = await this.readSnapshotFile(sessionId);
      if (snapshot) {
        sessions.push(snapshot);
      }
    }

    return sessions.sort((left, right) =>
      left.updatedAt.localeCompare(right.updatedAt)
    );
  }

  async isExecutionActive(sessionId: string): Promise<boolean> {
    return this.activeRuns.has(sessionId);
  }

  async requestInterrupt(sessionId: string): Promise<SessionSnapshot | null> {
    const current = this.activeRuns.get(sessionId);
    if (!current) {
      return null;
    }

    current.interruptRequested = true;
    this.activeRuns.set(sessionId, current);
    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      sessionState: {
        ...snapshot.sessionState,
        interruptRequested: true
      }
    }));
  }

  async forceStop(sessionId: string): Promise<SessionSnapshot | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    const current = this.activeRuns.get(sessionId);
    if (current) {
      const runIds =
        this.forceStoppedRunIds.get(sessionId) ?? new Set<string>();
      runIds.add(current.runId);
      this.forceStoppedRunIds.set(sessionId, runIds);
      this.activeRuns.delete(sessionId);
    }
    return this.saveSession(forceStopSnapshot(session));
  }

  async isInterruptRequested(
    sessionId: string,
    runId: string
  ): Promise<boolean> {
    if (this.forceStoppedRunIds.get(sessionId)?.has(runId)) {
      return true;
    }

    const current = this.activeRuns.get(sessionId);
    return current?.runId === runId && current.interruptRequested === true;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    await this.ensureDirectories();
    const checkpointEntries = await fs.readdir(this.forkCheckpointsDirectory, {
      withFileTypes: true
    });
    await Promise.all(
      checkpointEntries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const checkpointId = entry.name.replace(/\.json$/, "");
          const checkpoint = await this.readForkCheckpointFile(checkpointId);
          if (checkpoint?.sessionId === sessionId) {
            await fs.unlink(this.forkCheckpointPath(checkpointId));
          }
        })
    );
    try {
      await fs.unlink(this.snapshotPath(sessionId));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  async saveSession(snapshot: SessionSnapshot): Promise<SessionSnapshot> {
    const nextSnapshot = cloneSnapshot(snapshot);
    nextSnapshot.updatedAt = new Date().toISOString();
    await this.writeSnapshotFile(nextSnapshot);
    return cloneSnapshot(nextSnapshot);
  }

  async recover(snapshot: SessionSnapshot): Promise<SessionSnapshot> {
    if (!isSessionSnapshot(snapshot)) {
      throw new Error("Invalid session snapshot.");
    }

    return this.saveSession(snapshot);
  }

  async saveForkCheckpoint(
    checkpoint: SessionForkCheckpoint
  ): Promise<SessionForkCheckpoint> {
    const nextCheckpoint = structuredClone(checkpoint) as SessionForkCheckpoint;
    await this.writeForkCheckpointFile(nextCheckpoint);
    return structuredClone(nextCheckpoint) as SessionForkCheckpoint;
  }

  async getForkCheckpoint(
    checkpointId: string
  ): Promise<SessionForkCheckpoint | null> {
    const checkpoint = await this.readForkCheckpointFile(checkpointId);
    return checkpoint
      ? (structuredClone(checkpoint) as SessionForkCheckpoint)
      : null;
  }

  async findForkCheckpointByAssistantMessage(
    sessionId: string,
    assistantMessageId: string
  ): Promise<SessionForkCheckpoint | null> {
    const checkpoints = await this.listForkCheckpoints(sessionId);
    return (
      checkpoints.find(
        (checkpoint) => checkpoint.assistantMessageId === assistantMessageId
      ) ?? null
    );
  }

  async listForkCheckpoints(
    sessionId: string
  ): Promise<SessionForkCheckpoint[]> {
    await this.ensureDirectories();
    const entries = await fs.readdir(this.forkCheckpointsDirectory, {
      withFileTypes: true
    });
    const checkpoints = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) =>
          this.readForkCheckpointFile(entry.name.replace(/\.json$/, ""))
        )
    );
    return checkpoints
      .flatMap((checkpoint) =>
        checkpoint && checkpoint.sessionId === sessionId ? [checkpoint] : []
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(
        (checkpoint) => structuredClone(checkpoint) as SessionForkCheckpoint
      );
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

  async setModel(sessionId: string, model: string): Promise<SessionSnapshot> {
    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      model
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
      startedAt: now,
      interruptRequested: false
    });

    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      sessionState: {
        ...snapshot.sessionState,
        loopState: "running",
        interruptRequested: false
      }
    }));
  }

  async releaseExecution(
    sessionId: string,
    runId: string
  ): Promise<SessionSnapshot | null> {
    this.forceStoppedRunIds.get(sessionId)?.delete(runId);
    const current = this.activeRuns.get(sessionId);
    if (current?.runId === runId) {
      this.activeRuns.delete(sessionId);
    }

    const session = await this.getSession(sessionId);
    if (!session?.sessionState.interruptRequested) {
      return session;
    }

    return this.updateSession(sessionId, (snapshot) => ({
      ...snapshot,
      sessionState: {
        ...snapshot.sessionState,
        interruptRequested: false
      }
    }));
  }
}

export function createFileSessionManager(
  baseDirectory: string
): FileSessionManager {
  return new FileSessionManager(baseDirectory);
}
