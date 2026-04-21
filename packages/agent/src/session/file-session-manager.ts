import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { CreateSessionInput, ConversationBlock, LoopState, SessionSnapshot } from "../types.js";

import type { SessionManager } from "./contracts.js";
import {
  cloneSnapshot,
  createSnapshot,
  isSessionSnapshot,
  resolveWorkingDirectory
} from "./shared.js";

export class FileSessionManager implements SessionManager {
  constructor(private readonly baseDirectory: string) {}

  private get sessionsDirectory(): string {
    return path.resolve(this.baseDirectory, "sessions");
  }

  private snapshotPath(sessionId: string): string {
    return path.join(this.sessionsDirectory, `${sessionId}.json`);
  }

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.sessionsDirectory, { recursive: true });
  }

  private async readSnapshotFile(sessionId: string): Promise<SessionSnapshot | null> {
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

  async createSession(input: CreateSessionInput = {}): Promise<SessionSnapshot> {
    const sessionId = randomUUID();
    const snapshot = createSnapshot({
      sessionId,
      workingDirectory: resolveWorkingDirectory(input.workingDirectory),
      model: input.model ?? "MiniMax-M2.7"
    });

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
}

export function createFileSessionManager(baseDirectory: string): FileSessionManager {
  return new FileSessionManager(baseDirectory);
}
