import { describe, expect, test } from "bun:test";
import { createPostgresTestSessionManager } from "../../../tests/helpers/postgres-session-manager.js";

describe("session full compaction state persistence", () => {
  test("postgres session manager preserves full compaction fields", async () => {
    const sessionManager = await createPostgresTestSessionManager();
    const session = await sessionManager.createSession({
      workingDirectory: "/tmp/workspace",
      userId: "postgres-user"
    });

    const saved = await sessionManager.saveSession({
      ...session,
      context: {
        ...session.context,
        fullCompactionState: {
          summaryMarkdown: "## Goal\nContinue from compacted history.",
          compactedAt: "2026-04-26T00:00:00.000Z",
          promptVersion: "full-compaction-v1",
          sourceBlockCount: 15,
          retainedTailCount: 6
        }
      },
      sessionState: {
        ...session.sessionState,
        historyCompactionsSinceFullCompaction: 1
      }
    });

    const reloaded = await sessionManager.getSession(saved.sessionId);
    expect(reloaded?.context.fullCompactionState).toEqual(
      saved.context.fullCompactionState
    );
    expect(reloaded?.sessionState.historyCompactionsSinceFullCompaction).toBe(
      1
    );
  });
});
